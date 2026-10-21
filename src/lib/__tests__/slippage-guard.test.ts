/**
 * Unit tests for the Slippage Guard — Issue #222
 */

import {
  lockQuote,
  getLockedQuote,
  assertSlippage,
  SlippageExceededError,
} from "../slippage-guard";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRedisStore: Record<string, string> = {};
const mockRedis = {
  get: jest.fn(async (key: string) => mockRedisStore[key] ?? null),
  set: jest.fn(async (key: string, val: string) => {
    mockRedisStore[key] = val;
    return "OK";
  }),
  setEx: jest.fn(async (key: string, _ttl: number, val: string) => {
    mockRedisStore[key] = val;
    return "OK";
  }),
};

jest.mock("@/lib/redis", () => ({
  getRedis: jest.fn(async () => mockRedis),
}));

jest.mock("@/lib/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// We control the live rate returned by getFiatPerUsdc.
let mockedLiveRate = 1600;
jest.mock("@/lib/fx", () => ({
  getFiatPerUsdc: jest.fn(async () => mockedLiveRate),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clearStore() {
  Object.keys(mockRedisStore).forEach((k) => delete mockRedisStore[k]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("lockQuote", () => {
  beforeEach(clearStore);

  it("stores a quote in Redis and returns it", async () => {
    mockedLiveRate = 1600;
    const quote = await lockQuote("ref-001", "NGN");

    expect(quote.reference).toBe("ref-001");
    expect(quote.currency).toBe("NGN");
    expect(quote.quotedRate).toBe(1600);
    expect(quote.expiresAt).toBeGreaterThan(quote.createdAt);
    expect(mockRedis.setEx).toHaveBeenCalledWith(
      expect.stringContaining("ref-001"),
      expect.any(Number),
      expect.stringContaining("1600")
    );
  });
});

describe("getLockedQuote", () => {
  beforeEach(clearStore);

  it("returns null when quote does not exist", async () => {
    const result = await getLockedQuote("non-existent");
    expect(result).toBeNull();
  });

  it("returns the quote after it has been locked", async () => {
    mockedLiveRate = 1550;
    await lockQuote("ref-002", "NGN");
    const retrieved = await getLockedQuote("ref-002");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.quotedRate).toBe(1550);
  });
});

describe("assertSlippage", () => {
  beforeEach(clearStore);

  it("passes when live rate is within threshold (no deviation)", async () => {
    mockedLiveRate = 1600;
    await lockQuote("ref-ok", "NGN");

    // Live rate same as quoted — 0 % deviation
    mockedLiveRate = 1600;
    const result = await assertSlippage("ref-ok", "NGN");
    expect(result.liveRate).toBe(1600);
    expect(result.quote.quotedRate).toBe(1600);
  });

  it("passes when live rate is within the 2 % threshold", async () => {
    mockedLiveRate = 1600;
    await lockQuote("ref-within", "NGN");

    // 1 % increase — within threshold
    mockedLiveRate = 1616;
    await expect(assertSlippage("ref-within", "NGN")).resolves.toBeDefined();
  });

  it("throws SlippageExceededError when deviation exceeds threshold", async () => {
    mockedLiveRate = 1600;
    await lockQuote("ref-slip", "NGN");

    // 3 % increase — beyond default 2 % threshold
    mockedLiveRate = 1648;
    await expect(assertSlippage("ref-slip", "NGN")).rejects.toBeInstanceOf(
      SlippageExceededError
    );
  });

  it("includes quoted and live rates in the error", async () => {
    mockedLiveRate = 1600;
    await lockQuote("ref-err", "NGN");

    mockedLiveRate = 1700; // ~6.25 % deviation
    try {
      await assertSlippage("ref-err", "NGN");
      fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SlippageExceededError);
      const slipErr = err as SlippageExceededError;
      expect(slipErr.quotedRate).toBe(1600);
      expect(slipErr.liveRate).toBe(1700);
      expect(slipErr.deviationPct).toBeCloseTo(6.25, 1);
    }
  });

  it("throws when quote is expired / missing", async () => {
    // No quote locked for this reference
    await expect(assertSlippage("ref-missing", "NGN")).rejects.toThrow(
      /expired or was not found/
    );
  });

  it("passes when live rate drops within threshold", async () => {
    mockedLiveRate = 1600;
    await lockQuote("ref-drop", "NGN");

    // 1 % drop — still within threshold
    mockedLiveRate = 1584;
    await expect(assertSlippage("ref-drop", "NGN")).resolves.toBeDefined();
  });

  it("throws when live rate drops beyond threshold", async () => {
    mockedLiveRate = 1600;
    await lockQuote("ref-drop-exceed", "NGN");

    // 5 % drop
    mockedLiveRate = 1520;
    await expect(assertSlippage("ref-drop-exceed", "NGN")).rejects.toBeInstanceOf(
      SlippageExceededError
    );
  });
});
