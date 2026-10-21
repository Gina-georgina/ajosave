/**
 * @jest-environment node
 *
 * Provider contract fixtures (#89)
 *
 * Covers:
 * - Paystack: initializePayment, verifyPayment, calculatePlatformFee
 * - Stellar: sendUsdcPayment, getUsdcBalance (Horizon)
 * - Webhook: verifyPaystackSignature, validateWebhookTimestamp, extractEventId
 * - Paystack response envelope shape contract (provider fixture assertions)
 * - Stellar response envelope shape contract
 */

// ── Paystack / axios mock ─────────────────────────────────────────────────────
const mockAxiosClient = {
  post: jest.fn(),
  get: jest.fn(),
  interceptors: { request: { use: jest.fn() } },
};

jest.mock("axios", () => ({
  create: jest.fn(() => mockAxiosClient),
}));

jest.mock("@/server/config", () => ({
  serverConfig: {
    paystack: {
      secretKey: "sk_test_fixture_key",
      platformSubaccount: null,
    },
    stellar: {
      network: "testnet",
      horizonUrl: "https://horizon-testnet.stellar.org",
      serverSecretKey: "SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      sorobanRpcUrl: "https://soroban-testnet.stellar.org",
    },
    usdc: {
      assetCode: "USDC",
      issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    },
    database: { url: "postgresql://test" },
    redis: { url: "redis://localhost:6379" },
  },
}));

// ── Stellar SDK mock ──────────────────────────────────────────────────────────
const mockStellarAccount = {
  balances: [
    { asset_type: "credit_alphanum4", asset_code: "USDC", balance: "50.0000000" },
    { asset_type: "native", balance: "100.0000000" },
  ],
  sequence: "100",
};

const mockSubmitResult = { hash: "stellar-tx-hash-abc123" };

const mockTxBuilder = {
  addOperation: jest.fn().mockReturnThis(),
  setTimeout: jest.fn().mockReturnThis(),
  build: jest.fn().mockReturnValue({ sign: jest.fn(), operations: [] }),
};

jest.mock("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: jest.fn().mockImplementation(() => ({
      loadAccount: jest.fn().mockResolvedValue(mockStellarAccount),
      submitTransaction: jest.fn().mockResolvedValue(mockSubmitResult),
    })),
  },
  Keypair: {
    fromSecret: jest.fn().mockReturnValue({
      publicKey: () => "GCBVPTGYLOELZOOOLS4W765VOL3CCXWCTTTGWIYSAFPRLJLRG6VWAEB5",
      sign: jest.fn(),
    }),
  },
  Asset: jest.fn().mockImplementation((code, issuer) => ({ code, issuer })),
  TransactionBuilder: jest.fn().mockImplementation(() => mockTxBuilder),
  Operation: {
    payment: jest.fn().mockReturnValue({ type: "payment" }),
  },
  BASE_FEE: "100",
  Networks: {
    PUBLIC: "Public Global Stellar Network ; September 2015",
    TESTNET: "Test SDF Network ; September 2015",
  },
}));

// ── Circuit breaker mock ──────────────────────────────────────────────────────
jest.mock("@/lib/circuit-breaker", () => ({
  stellarBreaker: {
    execute: jest.fn().mockImplementation((fn: () => unknown) => fn()),
  },
}));

import { createHmac } from "crypto";
import {
  initializePayment,
  verifyPayment,
  calculatePlatformFee,
  PLATFORM_FEE_RATE,
} from "@/lib/paystack";
import { sendUsdcPayment, getUsdcBalance } from "@/lib/stellar";
import {
  verifyPaystackSignature,
  validateWebhookTimestamp,
  extractEventId,
  DEFAULT_MAX_AGE_MS,
} from "@/lib/webhook-replay";

// ─────────────────────────────────────────────────────────────────────────────
// A: Paystack provider contract fixtures
// ─────────────────────────────────────────────────────────────────────────────

/** Canonical Paystack charge.success event fixture */
const PAYSTACK_CHARGE_SUCCESS_FIXTURE = {
  event: "charge.success",
  data: {
    id: 302961,
    domain: "test",
    status: "success",
    reference: "ajo-ref-001",
    amount: 500000,
    currency: "NGN",
    paid_at: "2023-09-14T13:32:05.000Z",
    created_at: "2023-09-14T13:31:58.000Z",
    channel: "card",
    customer: {
      id: 84312,
      email: "user@example.com",
      customer_code: "CUS_xyz",
    },
    authorization: {
      authorization_code: "AUTH_abc",
      card_type: "visa",
      bank: "TEST BANK",
    },
  },
};

/** Canonical Paystack initialize response fixture */
const PAYSTACK_INIT_RESPONSE_FIXTURE = {
  status: true,
  message: "Authorization URL created",
  data: {
    authorization_url: "https://checkout.paystack.com/0peioxfhpn",
    access_code: "0peioxfhpn",
    reference: "ajo-ref-001",
  },
};

/** Canonical Paystack verify response fixture */
const PAYSTACK_VERIFY_RESPONSE_FIXTURE = {
  status: true,
  message: "Verification successful",
  data: {
    id: 302961,
    domain: "test",
    status: "success",
    reference: "ajo-ref-001",
    amount: 500000,
    currency: "NGN",
    paid_at: "2023-09-14T13:32:05.000Z",
    created_at: "2023-09-14T13:31:58.000Z",
    channel: "card",
    fees: 7500,
    authorization: {
      authorization_code: "AUTH_abc",
      card_type: "visa",
      reusable: false,
    },
    customer: {
      email: "user@example.com",
      customer_code: "CUS_xyz",
    },
  },
};

describe("Paystack — initializePayment contract", () => {
  beforeEach(() => jest.clearAllMocks());

  it("POSTs to /transaction/initialize with correct shape", async () => {
    mockAxiosClient.post.mockResolvedValue({ data: PAYSTACK_INIT_RESPONSE_FIXTURE });

    const result = await initializePayment({
      email: "user@example.com",
      amount: 5000,
      currency: "NGN",
      reference: "ajo-ref-001",
      callbackUrl: "https://ajosave.app/callback",
    });

    expect(mockAxiosClient.post).toHaveBeenCalledWith(
      "/transaction/initialize",
      expect.objectContaining({
        email: "user@example.com",
        amount: 500000, // 5000 NGN × 100 kobo
        currency: "NGN",
        reference: "ajo-ref-001",
        callback_url: "https://ajosave.app/callback",
      }),
    );

    // Contract: response has these required fields
    expect(result.authorizationUrl).toBe("https://checkout.paystack.com/0peioxfhpn");
    expect(result.reference).toBe("ajo-ref-001");
    expect(typeof result.platformFee).toBe("number");
  });

  it("includes metadata in the request body", async () => {
    mockAxiosClient.post.mockResolvedValue({ data: PAYSTACK_INIT_RESPONSE_FIXTURE });

    await initializePayment({
      email: "user@example.com",
      amount: 1000,
      currency: "NGN",
      reference: "ref-002",
      callbackUrl: "https://ajosave.app/callback",
      metadata: { circleId: "c1", memberId: "m1" },
    });

    expect(mockAxiosClient.post).toHaveBeenCalledWith(
      "/transaction/initialize",
      expect.objectContaining({
        metadata: expect.objectContaining({
          circleId: "c1",
          memberId: "m1",
          platform_fee: expect.any(Number),
          platform_fee_rate: PLATFORM_FEE_RATE,
        }),
      }),
    );
  });

  it("propagates Paystack HTTP errors", async () => {
    mockAxiosClient.post.mockRejectedValue(new Error("401 Unauthorized"));
    await expect(
      initializePayment({
        email: "u@t.com",
        amount: 100,
        currency: "NGN",
        reference: "ref",
        callbackUrl: "https://x.com",
      }),
    ).rejects.toThrow();
  });

  it("handles GBP currency correctly", async () => {
    mockAxiosClient.post.mockResolvedValue({ data: PAYSTACK_INIT_RESPONSE_FIXTURE });
    await initializePayment({
      email: "user@example.com",
      amount: 10,
      currency: "GBP",
      reference: "ref-gbp",
      callbackUrl: "https://ajosave.app/callback",
    });
    expect(mockAxiosClient.post).toHaveBeenCalledWith(
      "/transaction/initialize",
      expect.objectContaining({ currency: "GBP", amount: 1000 }), // 10 × 100 pence
    );
  });
});

describe("Paystack — verifyPayment contract", () => {
  beforeEach(() => jest.clearAllMocks());

  it("GETs /transaction/verify/:reference", async () => {
    mockAxiosClient.get.mockResolvedValue({ data: PAYSTACK_VERIFY_RESPONSE_FIXTURE });
    const result = await verifyPayment("ajo-ref-001");
    expect(mockAxiosClient.get).toHaveBeenCalledWith(
      "/transaction/verify/ajo-ref-001",
    );
    // Contract: returned shape has status, amount, currency
    expect(result.status).toBe("success");
    expect(result.amount).toBe(500000);
    expect(result.currency).toBe("NGN");
  });

  it("returns 'failed' status for failed transaction", async () => {
    mockAxiosClient.get.mockResolvedValue({
      data: {
        ...PAYSTACK_VERIFY_RESPONSE_FIXTURE,
        data: { ...PAYSTACK_VERIFY_RESPONSE_FIXTURE.data, status: "failed" },
      },
    });
    const result = await verifyPayment("ajo-ref-failed");
    expect(result.status).toBe("failed");
  });

  it("propagates network errors", async () => {
    mockAxiosClient.get.mockRejectedValue(new Error("ECONNRESET"));
    await expect(verifyPayment("ref")).rejects.toThrow("ECONNRESET");
  });
});

describe("Paystack — calculatePlatformFee contract", () => {
  it("computes 0.5% by default", () => {
    // 0.5% of 500000 = 2500
    expect(calculatePlatformFee(500000)).toBe(2500);
  });

  it("rounds to nearest integer", () => {
    // 0.5% of 1 = 0.005 → rounds to 0
    expect(calculatePlatformFee(1)).toBe(0);
    // 0.5% of 200 = 1
    expect(calculatePlatformFee(200)).toBe(1);
  });

  it("returns 0 for zero input", () => {
    expect(calculatePlatformFee(0)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B: Stellar / Horizon provider contract fixtures
// ─────────────────────────────────────────────────────────────────────────────

/** Canonical Stellar account fixture */
const STELLAR_ACCOUNT_FIXTURE = {
  id: "GCBVPTGYLOELZOOOLS4W765VOL3CCXWCTTTGWIYSAFPRLJLRG6VWAEB5",
  sequence: "12345",
  balances: [
    {
      asset_type: "credit_alphanum4",
      asset_code: "USDC",
      asset_issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      balance: "100.0000000",
      limit: "922337203685.4775807",
      is_authorized: true,
    },
    {
      asset_type: "native",
      balance: "5.0000000",
    },
  ],
};

describe("Stellar — sendUsdcPayment contract", () => {
  it("returns a transaction hash string", async () => {
    const hash = await sendUsdcPayment(
      "GCBVPTGYLOELZOOOLS4W765VOL3CCXWCTTTGWIYSAFPRLJLRG6VWAEB5",
      "10.0000000",
    );
    // Contract: returns non-empty string tx hash
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
    expect(hash).toBe("stellar-tx-hash-abc123");
  });

  it("propagates circuit breaker errors", async () => {
    const { stellarBreaker } = require("@/lib/circuit-breaker");
    stellarBreaker.execute.mockRejectedValueOnce(new Error("Circuit open"));
    await expect(
      sendUsdcPayment("GCBVPTGYLOELZOOOLS4W765VOL3CCXWCTTTGWIYSAFPRLJLRG6VWAEB5", "1"),
    ).rejects.toThrow("Circuit open");
  });
});

describe("Stellar — getUsdcBalance contract", () => {
  it("returns USDC balance from account balances", async () => {
    const balance = await getUsdcBalance(
      "GCBVPTGYLOELZOOOLS4W765VOL3CCXWCTTTGWIYSAFPRLJLRG6VWAEB5",
    );
    // Contract: returns a string representation of the balance
    expect(typeof balance).toBe("string");
    expect(parseFloat(balance)).toBeGreaterThanOrEqual(0);
    expect(balance).toBe("50.0000000");
  });

  it("returns '0' when account has no USDC balance", async () => {
    const { Horizon } = require("@stellar/stellar-sdk");
    Horizon.Server.mockImplementationOnce(() => ({
      loadAccount: jest.fn().mockResolvedValue({
        balances: [{ asset_type: "native", balance: "10" }],
      }),
    }));
    const balance = await getUsdcBalance("GSOME_KEY");
    expect(balance).toBe("0");
  });

  it("returns '0' on Horizon failure (not found / network error)", async () => {
    const { Horizon } = require("@stellar/stellar-sdk");
    Horizon.Server.mockImplementationOnce(() => ({
      loadAccount: jest.fn().mockRejectedValue(new Error("Account not found")),
    }));
    const balance = await getUsdcBalance("GINVALID_KEY");
    expect(balance).toBe("0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C: Webhook provider contract fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makePaystackSignature(body: string, secret: string): string {
  return createHmac("sha512", secret).update(body).digest("hex");
}

describe("verifyPaystackSignature — contract", () => {
  const secret = "sk_test_fixture_key";
  const body = JSON.stringify(PAYSTACK_CHARGE_SUCCESS_FIXTURE);
  const validSig = makePaystackSignature(body, secret);

  it("validates a correct Paystack webhook signature", () => {
    const result = verifyPaystackSignature(body, validSig, secret);
    expect(result.valid).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const tampered = JSON.stringify({ ...PAYSTACK_CHARGE_SUCCESS_FIXTURE, event: "charge.failed" });
    const result = verifyPaystackSignature(tampered, validSig, secret);
    expect(result.valid).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it("rejects wrong secret key", () => {
    const result = verifyPaystackSignature(body, validSig, "wrong-secret");
    expect(result.valid).toBe(false);
  });

  it("rejects missing signature header", () => {
    const result = verifyPaystackSignature(body, "", secret);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Missing signature");
  });

  it("rejects empty request body", () => {
    const result = verifyPaystackSignature("", validSig, secret);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Empty request body");
  });

  it("rejects missing secret key", () => {
    const result = verifyPaystackSignature(body, validSig, "");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Missing secret key");
  });

  it("rejects signature with length mismatch", () => {
    const result = verifyPaystackSignature(body, "tooshort", secret);
    expect(result.valid).toBe(false);
  });
});

describe("validateWebhookTimestamp — replay attack protection", () => {
  it("accepts a fresh timestamp (just now)", () => {
    const result = validateWebhookTimestamp(new Date().toISOString());
    expect(result.valid).toBe(true);
  });

  it("accepts Unix epoch in seconds", () => {
    const seconds = Math.floor(Date.now() / 1000) - 60; // 1 min ago
    const result = validateWebhookTimestamp(seconds);
    expect(result.valid).toBe(true);
  });

  it("accepts Unix epoch in milliseconds", () => {
    const ms = Date.now() - 30_000; // 30 sec ago
    const result = validateWebhookTimestamp(ms);
    expect(result.valid).toBe(true);
  });

  it("rejects timestamp older than default window (5 min)", () => {
    const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    const result = validateWebhookTimestamp(sixMinutesAgo);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("too old");
  });

  it("rejects undefined/null timestamp", () => {
    expect(validateWebhookTimestamp(undefined).valid).toBe(false);
    expect(validateWebhookTimestamp(null as any).valid).toBe(false);
  });

  it("rejects non-parseable date string", () => {
    const result = validateWebhookTimestamp("not-a-date");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Invalid");
  });

  it("accepts event just within the window boundary", () => {
    const justInsideWindow = new Date(Date.now() - DEFAULT_MAX_AGE_MS + 1000).toISOString();
    const result = validateWebhookTimestamp(justInsideWindow);
    expect(result.valid).toBe(true);
  });

  it("rejects event just outside the window boundary", () => {
    const justOutsideWindow = new Date(Date.now() - DEFAULT_MAX_AGE_MS - 5000).toISOString();
    const result = validateWebhookTimestamp(justOutsideWindow);
    expect(result.valid).toBe(false);
  });

  it("allows slightly future timestamps within clock-skew tolerance", () => {
    const slightlyFuture = new Date(Date.now() + 15_000).toISOString();
    const result = validateWebhookTimestamp(slightlyFuture);
    expect(result.valid).toBe(true);
  });

  it("rejects far-future timestamps (possible replay)", () => {
    const farFuture = new Date(Date.now() + 2 * 60 * 1000).toISOString();
    const result = validateWebhookTimestamp(farFuture);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("future");
  });

  it("respects custom maxAgeMs", () => {
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    expect(validateWebhookTimestamp(twoMinAgo, 60_000).valid).toBe(false); // max 1 min
    expect(validateWebhookTimestamp(twoMinAgo, 3 * 60_000).valid).toBe(true); // max 3 min
  });
});

describe("extractEventId — deduplication contract", () => {
  it("extracts top-level id", () => {
    const result = extractEventId({ id: 302961, event: "charge.success" });
    expect(result).toBe("302961");
  });

  it("extracts string id", () => {
    const result = extractEventId({ id: "evt_abc123", event: "charge.success" });
    expect(result).toBe("evt_abc123");
  });

  it("falls back to data.id when top-level id is absent", () => {
    const result = extractEventId({ data: { id: "inner-id-456" } });
    expect(result).toBe("inner-id-456");
  });

  it("falls back to data.reference when id and data.id are absent", () => {
    const result = extractEventId({ data: { reference: "REF_xyz" } });
    expect(result).toBe("ref:REF_xyz");
  });

  it("falls back to SHA-256 hash for payloads without any id", () => {
    const result = extractEventId({ event: "unknown", data: { foo: "bar" } });
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns null for empty/null payload", () => {
    expect(extractEventId(null as any)).toBeNull();
    expect(extractEventId({} as any)).toMatch(/^[0-9a-f]{64}$/); // empty object hashes
  });

  it("is deterministic for the same payload", () => {
    const payload = { event: "test", data: { amount: 100 } };
    expect(extractEventId(payload)).toBe(extractEventId(payload));
  });

  it("extracts id from the canonical charge.success fixture", () => {
    const result = extractEventId(PAYSTACK_CHARGE_SUCCESS_FIXTURE as any);
    expect(result).toBe("302961");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D: Full webhook processing pipeline fixture
// ─────────────────────────────────────────────────────────────────────────────
describe("Webhook processing pipeline — end-to-end fixture", () => {
  const SECRET = "sk_live_webhook_secret";

  it("accepts a fully valid fresh Paystack charge.success event", () => {
    const payload = {
      ...PAYSTACK_CHARGE_SUCCESS_FIXTURE,
      data: {
        ...PAYSTACK_CHARGE_SUCCESS_FIXTURE.data,
        created_at: new Date().toISOString(), // fresh timestamp
      },
    };
    const rawBody = JSON.stringify(payload);
    const sig = makePaystackSignature(rawBody, SECRET);

    const sigResult = verifyPaystackSignature(rawBody, sig, SECRET);
    const tsResult = validateWebhookTimestamp(payload.data.created_at);
    const eventId = extractEventId(payload as any);

    expect(sigResult.valid).toBe(true);
    expect(tsResult.valid).toBe(true);
    expect(eventId).toBe("302961");
  });

  it("rejects a replayed old event (valid sig, old timestamp)", () => {
    const payload = {
      ...PAYSTACK_CHARGE_SUCCESS_FIXTURE,
      data: {
        ...PAYSTACK_CHARGE_SUCCESS_FIXTURE.data,
        created_at: "2020-01-01T00:00:00.000Z", // old timestamp
      },
    };
    const rawBody = JSON.stringify(payload);
    const sig = makePaystackSignature(rawBody, SECRET);

    const sigResult = verifyPaystackSignature(rawBody, sig, SECRET);
    const tsResult = validateWebhookTimestamp(payload.data.created_at);

    expect(sigResult.valid).toBe(true); // signature is valid
    expect(tsResult.valid).toBe(false); // but event is old → reject
  });

  it("rejects a tampered event (modified body, old timestamp)", () => {
    const originalBody = JSON.stringify(PAYSTACK_CHARGE_SUCCESS_FIXTURE);
    const sig = makePaystackSignature(originalBody, SECRET);

    // Attacker changes amount
    const tamperedPayload = {
      ...PAYSTACK_CHARGE_SUCCESS_FIXTURE,
      data: { ...PAYSTACK_CHARGE_SUCCESS_FIXTURE.data, amount: 1 },
    };
    const tamperedBody = JSON.stringify(tamperedPayload);

    const sigResult = verifyPaystackSignature(tamperedBody, sig, SECRET);
    expect(sigResult.valid).toBe(false);
  });
});
