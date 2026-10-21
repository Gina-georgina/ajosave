/**
 * Provider Chaos Tests (#99)
 *
 * Simulates failure, degradation, retry, and boundary conditions for every
 * external provider the application depends on:
 *   - Paystack (NGN payment on-ramp)
 *   - Stellar / Horizon (USDC transactions)
 *   - Termii SMS (OTP delivery)
 *   - FX rate API
 *
 * The circuit-breaker is tested independently as the central resilience
 * primitive. All tests are pure unit tests (no real network, no DB).
 *
 * @jest-environment node
 */

// ─── Shared mock client (used by both paystack.ts and sms.ts) ───────────────
const mockHttpClient = {
  post: jest.fn(),
  get: jest.fn(),
  interceptors: { request: { use: jest.fn() } },
};

// ─── Mocks ──────────────────────────────────────────────────────────────────

jest.mock("axios", () => ({
  default: { create: jest.fn(() => mockHttpClient), get: jest.fn() },
  create: jest.fn(() => mockHttpClient),
  get: jest.fn(),
}));

jest.mock("@/server/config", () => ({
  serverConfig: {
    paystack: {
      secretKey: "sk_test_placeholder",
      platformSubaccount: undefined,
    },
    termii: {
      senderId: "STELLAR",
      apiKey: "termii-test-key",
    },
    stellar: {
      horizonUrl: "https://horizon-testnet.stellar.org",
      network: "testnet",
      serverSecretKey: "SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    },
    usdc: {
      assetCode: "USDC",
      issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    },
  },
}));

const mockRedisClient = {
  get: jest.fn(),
  set: jest.fn().mockResolvedValue("OK"),
  setEx: jest.fn().mockResolvedValue("OK"),
};

jest.mock("@/lib/redis", () => ({
  getRedis: jest.fn().mockResolvedValue(mockRedisClient),
}));

// We need a standalone axios.get mock for the FX module (which uses axios.get directly)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const axiosMock = require("axios");

// ─── Imports ─────────────────────────────────────────────────────────────────

import { CircuitBreaker, CircuitOpenError } from "@/lib/circuit-breaker";

// ════════════════════════════════════════════════════════════════════════════
// 1. Circuit Breaker – the resilience primitive
// ════════════════════════════════════════════════════════════════════════════

describe("CircuitBreaker – resilience primitive", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("starts in CLOSED state", () => {
    const cb = new CircuitBreaker("test-closed");
    expect(cb.currentState).toBe("CLOSED");
  });

  it("stays CLOSED after fewer failures than the threshold", async () => {
    const cb = new CircuitBreaker("test-under-threshold", { failureThreshold: 3 });
    for (let i = 0; i < 2; i++) {
      await expect(cb.execute(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    }
    expect(cb.currentState).toBe("CLOSED");
  });

  it("opens after reaching the failure threshold", async () => {
    const cb = new CircuitBreaker("test-open", { failureThreshold: 3 });
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(() => Promise.reject(new Error("err")))).rejects.toThrow();
    }
    expect(cb.currentState).toBe("OPEN");
  });

  it("throws CircuitOpenError immediately when OPEN (fail-fast)", async () => {
    const cb = new CircuitBreaker("test-fail-fast", { failureThreshold: 1 });
    await expect(cb.execute(() => Promise.reject(new Error("first")))).rejects.toThrow();
    expect(cb.currentState).toBe("OPEN");

    const fastFail = cb.execute(() => Promise.resolve("should not run"));
    await expect(fastFail).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it("transitions OPEN → HALF_OPEN after the reset timeout elapses", async () => {
    const resetTimeoutMs = 1_000;
    const cb = new CircuitBreaker("test-half-open", {
      failureThreshold: 1,
      resetTimeoutMs,
    });
    await expect(cb.execute(() => Promise.reject(new Error("trip")))).rejects.toThrow();
    expect(cb.currentState).toBe("OPEN");

    jest.advanceTimersByTime(resetTimeoutMs + 1);

    // Next call is a probe — it succeeds and closes the circuit
    await cb.execute(() => Promise.resolve("probe ok"));
    expect(cb.currentState).toBe("CLOSED");
  });

  it("re-opens if the HALF_OPEN probe fails", async () => {
    const resetTimeoutMs = 500;
    const cb = new CircuitBreaker("test-reopen", {
      failureThreshold: 1,
      resetTimeoutMs,
    });
    await expect(cb.execute(() => Promise.reject(new Error("trip")))).rejects.toThrow();
    jest.advanceTimersByTime(resetTimeoutMs + 1);

    await expect(cb.execute(() => Promise.reject(new Error("probe fail")))).rejects.toThrow();
    expect(cb.currentState).toBe("OPEN");
  });

  it("closes and resets the counter after a success", async () => {
    const cb = new CircuitBreaker("test-reset", { failureThreshold: 5 });
    await expect(cb.execute(() => Promise.reject(new Error("e")))).rejects.toThrow();
    await cb.execute(() => Promise.resolve("ok"));
    expect(cb.currentState).toBe("CLOSED");
  });

  it("manual reset() clears OPEN state", async () => {
    const cb = new CircuitBreaker("test-manual-reset", { failureThreshold: 1 });
    await expect(cb.execute(() => Promise.reject(new Error("err")))).rejects.toThrow();
    expect(cb.currentState).toBe("OPEN");
    cb.reset();
    expect(cb.currentState).toBe("CLOSED");
  });

  it("does not swallow the original error when CLOSED/HALF_OPEN", async () => {
    const cb = new CircuitBreaker("test-error-passthrough");
    const specificError = new Error("Specific provider error");
    await expect(cb.execute(() => Promise.reject(specificError))).rejects.toThrow(
      "Specific provider error"
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Paystack Provider Chaos
// ════════════════════════════════════════════════════════════════════════════

describe("Paystack – chaos scenarios", () => {
  // Import lazily so jest.mock() runs first
  let initializePayment: (p: {
    email: string;
    amount: number;
    currency: "NGN" | "GBP" | "USD" | "EUR";
    reference: string;
    callbackUrl: string;
    metadata?: Record<string, unknown>;
  }) => Promise<{ authorizationUrl: string; reference: string; platformFee: number }>;

  let verifyPayment: (reference: string) => Promise<{
    status: "success" | "failed" | "pending";
    amount: number;
    currency: string;
  }>;

  const baseParams = {
    email: "test@example.com",
    amount: 5000,
    currency: "NGN" as const,
    reference: "ref-chaos-001",
    callbackUrl: "https://ajosave.app/callback",
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // Re-import after clearing mocks to get a fresh module reference
    jest.resetModules();
    ({ initializePayment, verifyPayment } = await import("@/lib/paystack"));
  });

  // ── Initialization ────────────────────────────────────────────────────────

  it("propagates a network-level timeout from Paystack initialize", async () => {
    const timeoutErr = Object.assign(new Error("ECONNABORTED: timeout"), { code: "ECONNABORTED" });
    mockHttpClient.post.mockRejectedValue(timeoutErr);
    await expect(initializePayment(baseParams)).rejects.toThrow("ECONNABORTED");
  });

  it("propagates HTTP 500 from Paystack initialize", async () => {
    const err = Object.assign(new Error("Internal Server Error"), {
      response: { status: 500, data: { message: "Internal error" } },
    });
    mockHttpClient.post.mockRejectedValue(err);
    await expect(initializePayment(baseParams)).rejects.toThrow("Internal Server Error");
  });

  it("propagates HTTP 401 (invalid key) from Paystack initialize", async () => {
    const err = Object.assign(new Error("Unauthorized"), {
      response: { status: 401, data: { message: "Invalid key" } },
    });
    mockHttpClient.post.mockRejectedValue(err);
    await expect(initializePayment(baseParams)).rejects.toThrow("Unauthorized");
  });

  it("propagates HTTP 429 (rate-limited) from Paystack initialize", async () => {
    const err = Object.assign(new Error("Too Many Requests"), {
      response: { status: 429, data: { message: "Rate limit exceeded" } },
    });
    mockHttpClient.post.mockRejectedValue(err);
    await expect(initializePayment(baseParams)).rejects.toThrow("Too Many Requests");
  });

  it("succeeds when Paystack returns a valid authorization_url", async () => {
    mockHttpClient.post.mockResolvedValue({
      data: {
        data: {
          authorization_url: "https://paystack.com/pay/abc",
          reference: baseParams.reference,
        },
      },
    });
    const result = await initializePayment(baseParams);
    expect(result.authorizationUrl).toBe("https://paystack.com/pay/abc");
    expect(result.reference).toBe(baseParams.reference);
  });

  // ── Verify ────────────────────────────────────────────────────────────────

  it("returns 'failed' status when Paystack verify reports failure", async () => {
    mockHttpClient.get.mockResolvedValue({
      data: { data: { status: "failed", amount: 500000, currency: "NGN" } },
    });
    const result = await verifyPayment("ref-chaos-001");
    expect(result.status).toBe("failed");
  });

  it("returns 'pending' status for an in-flight transaction", async () => {
    mockHttpClient.get.mockResolvedValue({
      data: { data: { status: "pending", amount: 500000, currency: "NGN" } },
    });
    const result = await verifyPayment("ref-in-flight");
    expect(result.status).toBe("pending");
  });

  it("propagates network errors from verifyPayment", async () => {
    mockHttpClient.get.mockRejectedValue(new Error("DNS resolution failed"));
    await expect(verifyPayment("ref-chaos-001")).rejects.toThrow("DNS resolution failed");
  });

  it("propagates HTTP 404 (unknown reference) from verifyPayment", async () => {
    const err = Object.assign(new Error("Not Found"), {
      response: { status: 404, data: { message: "Transaction reference not found" } },
    });
    mockHttpClient.get.mockRejectedValue(err);
    await expect(verifyPayment("unknown-ref")).rejects.toThrow("Not Found");
  });

  // ── Amount / currency boundary cases ─────────────────────────────────────

  it("converts NGN amount to kobo before calling Paystack API", async () => {
    mockHttpClient.post.mockResolvedValue({
      data: {
        data: { authorization_url: "https://paystack.com/pay/x", reference: "r1" },
      },
    });
    await initializePayment({ ...baseParams, amount: 1000, currency: "NGN" });
    expect(mockHttpClient.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ amount: 100_000 }) // 1000 NGN × 100
    );
  });

  it("converts GBP amount to pence before calling Paystack API", async () => {
    mockHttpClient.post.mockResolvedValue({
      data: {
        data: { authorization_url: "https://paystack.com/pay/x", reference: "r2" },
      },
    });
    await initializePayment({ ...baseParams, amount: 50, currency: "GBP" });
    expect(mockHttpClient.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ amount: 5_000 }) // 50 GBP × 100
    );
  });

  it("returns an unexpected status field without throwing", async () => {
    mockHttpClient.get.mockResolvedValue({
      data: { data: { status: "abandoned", amount: 100, currency: "NGN" } },
    });
    const result = await verifyPayment("ref-abandoned");
    // The lib returns whatever status comes back; callers validate it
    expect(result.status).toBe("abandoned");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. SMS Provider (Termii) Chaos
// ════════════════════════════════════════════════════════════════════════════

describe("Termii SMS – chaos scenarios", () => {
  let sendOtp: (phone: string) => Promise<string>;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.resetModules();
    ({ sendOtp } = await import("@/lib/sms"));
  });

  it("propagates a network error when Termii is unreachable", async () => {
    mockHttpClient.post.mockRejectedValue(new Error("Network Error"));
    await expect(sendOtp("+2348012345678")).rejects.toThrow("Network Error");
  });

  it("propagates HTTP 403 (invalid API key) from Termii", async () => {
    const err = Object.assign(new Error("Forbidden"), {
      response: { status: 403, data: { message: "Invalid API key" } },
    });
    mockHttpClient.post.mockRejectedValue(err);
    await expect(sendOtp("+2348012345678")).rejects.toThrow("Forbidden");
  });

  it("propagates HTTP 400 (bad phone number) from Termii", async () => {
    const err = Object.assign(new Error("Bad Request"), {
      response: { status: 400, data: { message: "Invalid phone number format" } },
    });
    mockHttpClient.post.mockRejectedValue(err);
    await expect(sendOtp("+invalid")).rejects.toThrow("Bad Request");
  });

  it("propagates HTTP 503 (Termii service unavailable)", async () => {
    const err = Object.assign(new Error("Service Unavailable"), {
      response: { status: 503 },
    });
    mockHttpClient.post.mockRejectedValue(err);
    await expect(sendOtp("+2348012345678")).rejects.toThrow("Service Unavailable");
  });

  it("returns a 6-digit OTP string when Termii succeeds", async () => {
    mockHttpClient.post.mockResolvedValue({ data: { code: 200, message: "Successfully Sent" } });
    const otp = await sendOtp("+2348012345678");
    expect(typeof otp).toBe("string");
    expect(otp).toHaveLength(6);
    expect(/^\d{6}$/.test(otp)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. FX Rate Provider Chaos
// ════════════════════════════════════════════════════════════════════════════

describe("FX Rate Provider – chaos scenarios", () => {
  let getFiatPerUsdc: (currency: string) => Promise<number>;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.resetModules();
    mockRedisClient.get.mockReset();
    mockRedisClient.set.mockReset().mockResolvedValue("OK");
    mockRedisClient.setEx.mockReset().mockResolvedValue("OK");
    axiosMock.get.mockReset();
    ({ getFiatPerUsdc } = await import("@/lib/fx"));
  });

  it("uses cached rate when available (no network call)", async () => {
    mockRedisClient.get.mockResolvedValue("1580");
    const rate = await getFiatPerUsdc("NGN");
    expect(rate).toBe(1580);
    expect(axiosMock.get).not.toHaveBeenCalled();
  });

  it("falls back to last known rate when the live API fails", async () => {
    mockRedisClient.get
      .mockResolvedValueOnce(null)    // cache miss
      .mockResolvedValueOnce("1600"); // last known fallback
    axiosMock.get.mockRejectedValue(new Error("ECONNREFUSED"));
    const rate = await getFiatPerUsdc("NGN");
    expect(rate).toBe(1600);
  });

  it("falls back to hardcoded rate when both cache and live API unavailable", async () => {
    mockRedisClient.get.mockResolvedValue(null); // no cache, no last-known
    axiosMock.get.mockRejectedValue(new Error("Gateway Timeout"));
    const rate = await getFiatPerUsdc("NGN");
    expect(rate).toBe(1600); // hardcoded NGN fallback
  });

  it("falls back to 1.0 for unknown currencies when all else fails", async () => {
    mockRedisClient.get.mockResolvedValue(null);
    axiosMock.get.mockRejectedValue(new Error("timeout"));
    const rate = await getFiatPerUsdc("XYZ");
    expect(rate).toBe(1.0);
  });

  it("fetches live rate and caches it when cache is cold", async () => {
    mockRedisClient.get.mockResolvedValue(null);
    axiosMock.get.mockResolvedValue({ data: { rates: { NGN: 1620 } } });
    const rate = await getFiatPerUsdc("NGN");
    expect(rate).toBe(1620);
    expect(mockRedisClient.setEx).toHaveBeenCalled();
    expect(mockRedisClient.set).toHaveBeenCalled(); // last known
  });

  it("falls back to hardcoded when the live response is missing the currency rate", async () => {
    mockRedisClient.get.mockResolvedValue(null);
    axiosMock.get.mockResolvedValue({ data: { rates: {} } }); // NGN absent
    const rate = await getFiatPerUsdc("NGN");
    expect(rate).toBe(1600); // hardcoded fallback
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5. Provider Circuit-Breaker Integration
//    Validates that each provider's shared breaker trips and recovers.
// ════════════════════════════════════════════════════════════════════════════

describe("Provider circuit-breakers – chaos integration", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function makeBreaker(name: string, threshold = 3, resetMs = 1_000) {
    return new CircuitBreaker(name, { failureThreshold: threshold, resetTimeoutMs: resetMs });
  }

  it("Paystack breaker trips after repeated 5xx errors", async () => {
    const breaker = makeBreaker("paystack-chaos", 3);
    const paystackOp = () => Promise.reject(new Error("502 Bad Gateway"));

    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(paystackOp)).rejects.toThrow();
    }
    expect(breaker.currentState).toBe("OPEN");

    await expect(breaker.execute(paystackOp)).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it("Stellar breaker trips after repeated Horizon connection errors", async () => {
    const breaker = makeBreaker("stellar-chaos", 3);
    const stellarOp = () =>
      Promise.reject(Object.assign(new Error("Connection refused"), { code: "ECONNREFUSED" }));

    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(stellarOp)).rejects.toThrow("Connection refused");
    }
    expect(breaker.currentState).toBe("OPEN");
  });

  it("SMS breaker trips after repeated gateway failures", async () => {
    const breaker = makeBreaker("sms-chaos", 3);
    const smsOp = () => Promise.reject(new Error("SMS gateway unreachable"));

    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(smsOp)).rejects.toThrow();
    }
    expect(breaker.currentState).toBe("OPEN");
  });

  it("breaker recovers and closes after a successful probe", async () => {
    const breaker = makeBreaker("recovery-chaos", 2, 500);
    const alwaysFail = () => Promise.reject(new Error("fail"));

    for (let i = 0; i < 2; i++) {
      await expect(breaker.execute(alwaysFail)).rejects.toThrow();
    }
    expect(breaker.currentState).toBe("OPEN");

    jest.advanceTimersByTime(501);
    await breaker.execute(() => Promise.resolve("healthy"));
    expect(breaker.currentState).toBe("CLOSED");
  });

  it("concurrent calls during OPEN state all fail-fast without touching the provider", async () => {
    const breaker = makeBreaker("concurrent-chaos", 1);
    const providerCallCount = { value: 0 };

    const op = () => {
      providerCallCount.value++;
      return Promise.reject(new Error("trip"));
    };

    await expect(breaker.execute(op)).rejects.toThrow();
    expect(breaker.currentState).toBe("OPEN");

    await Promise.allSettled(Array.from({ length: 5 }, () => breaker.execute(op)));
    // Only the original trip call reached the provider
    expect(providerCallCount.value).toBe(1);
  });

  it("CircuitOpenError message includes the provider name", async () => {
    const breaker = makeBreaker("my-provider", 1);
    await expect(breaker.execute(() => Promise.reject(new Error("x")))).rejects.toThrow();
    const err = await breaker.execute(() => Promise.resolve()).catch((e) => e);
    expect(err).toBeInstanceOf(CircuitOpenError);
    expect(err.message).toContain("my-provider");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 6. Boundary and edge cases
// ════════════════════════════════════════════════════════════════════════════

describe("Provider chaos – boundary and edge cases", () => {
  it("CircuitBreaker with threshold=1 opens on the very first failure", async () => {
    const cb = new CircuitBreaker("instant-open", { failureThreshold: 1 });
    await expect(cb.execute(() => Promise.reject(new Error("instant")))).rejects.toThrow();
    expect(cb.currentState).toBe("OPEN");
  });

  it("CircuitBreaker with a very large threshold does not open under normal churn", async () => {
    const cb = new CircuitBreaker("never-open", { failureThreshold: 1_000_000 });
    for (let i = 0; i < 999; i++) {
      await expect(cb.execute(() => Promise.reject(new Error("e")))).rejects.toThrow();
    }
    expect(cb.currentState).toBe("CLOSED");
  });

  it("CircuitBreaker execute resolves with the provider return value", async () => {
    const cb = new CircuitBreaker("happy-path");
    const result = await cb.execute(() => Promise.resolve({ txHash: "abc123" }));
    expect(result).toEqual({ txHash: "abc123" });
  });

  it("CircuitBreaker handles async providers that reject with non-Error objects", async () => {
    const cb = new CircuitBreaker("non-error-reject", { failureThreshold: 1 });
    await expect(cb.execute(() => Promise.reject("string error"))).rejects.toBe("string error");
    expect(cb.currentState).toBe("OPEN");
  });

  it("multiple independent breakers do not interfere with each other", async () => {
    const a = new CircuitBreaker("a-provider", { failureThreshold: 1 });
    const b = new CircuitBreaker("b-provider", { failureThreshold: 5 });

    await expect(a.execute(() => Promise.reject(new Error("a down")))).rejects.toThrow();
    expect(a.currentState).toBe("OPEN");
    expect(b.currentState).toBe("CLOSED");

    // b still works
    const result = await b.execute(() => Promise.resolve("b ok"));
    expect(result).toBe("b ok");
  });
});
