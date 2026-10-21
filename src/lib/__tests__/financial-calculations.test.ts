/**
 * @jest-environment node
 *
 * Financial calculation coverage (#86)
 *
 * Covers edge cases for:
 * - money.ts  (USDC amount validation, partial payments)
 * - currency.ts (fiat/USDC conversion, formatting, validation)
 * - reconciliation.ts (ledger vs settlement matching)
 * - circle-lifecycle.ts (state machine transitions and guards)
 * - fx.ts (rate caching and fallback)
 */

jest.mock("../logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// ── fx.ts dependencies ────────────────────────────────────────────────────────
const mockRedisGet = jest.fn();
const mockRedisSetEx = jest.fn();
const mockRedisSet = jest.fn();
jest.mock("../redis", () => ({
  getRedis: jest.fn().mockResolvedValue({
    get: (...a: unknown[]) => mockRedisGet(...a),
    setEx: (...a: unknown[]) => mockRedisSetEx(...a),
    set: (...a: unknown[]) => mockRedisSet(...a),
  }),
}));

import axios from "axios";
jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

import { assertValidUsdcAmount, assertValidPartialPayment } from "../money";
import {
  fiatToUsdc,
  usdcToFiat,
  getSmallestUnitMultiplier,
  toSmallestUnit,
  getCurrencySymbol,
  formatCurrency,
  isSupportedCurrency,
  SupportedCurrency,
} from "../currency";
import { reconcile } from "../reconciliation";
import { transition, isTerminal, allowedEvents, isCircleStatus } from "../circle-lifecycle";
import { getFiatPerUsdc } from "../fx";

// ─────────────────────────────────────────────────────────────────────────────
// #86-A  money.ts — USDC amount validation
// ─────────────────────────────────────────────────────────────────────────────
describe("assertValidUsdcAmount — happy path", () => {
  it.each([
    "1",
    "0.1",
    "0.0000001",
    "9999999999999.9999999",
    "10.5",
    "100",
  ])("accepts %s", (v) => {
    expect(() => assertValidUsdcAmount(v)).not.toThrow();
    expect(assertValidUsdcAmount(v)).toBe(v);
  });

  it("coerces a number to a string and returns it", () => {
    expect(assertValidUsdcAmount(5)).toBe("5");
    expect(assertValidUsdcAmount(0.5)).toBe("0.5");
  });
});

describe("assertValidUsdcAmount — boundary / failure cases", () => {
  it.each([
    ["zero string", "0"],
    ["negative string", "-1"],
    ["too many decimals", "1.12345678"],
    ["empty string", ""],
    ["letters", "abc"],
    ["null", null],
    ["undefined", undefined],
    ["too many integer digits", "12345678901234"],
    ["object", {}],
    ["NaN", NaN],
  ])("rejects %s → %p", (_label, v) => {
    expect(() => assertValidUsdcAmount(v)).toThrow();
  });

  it("uses the supplied field name in the error", () => {
    try {
      assertValidUsdcAmount("0", "my_field");
    } catch (e: unknown) {
      expect((e as Error).message).toContain("my_field");
    }
  });
});

describe("assertValidPartialPayment — boundary cases", () => {
  it("accepts 0 paid (pre-payment intent)", () => {
    expect(() => assertValidPartialPayment(0, 10)).not.toThrow();
  });
  it("accepts exact payment (paid === due)", () => {
    expect(() => assertValidPartialPayment(10, 10)).not.toThrow();
  });
  it("accepts partial (paid < due)", () => {
    expect(() => assertValidPartialPayment(0.0000001, 1)).not.toThrow();
  });
  it("rejects paid > due", () => {
    expect(() => assertValidPartialPayment(10.0000001, 10)).toThrow();
  });
  it("rejects negative paid", () => {
    expect(() => assertValidPartialPayment(-0.1, 10)).toThrow();
  });
  it("rejects non-finite paid (NaN)", () => {
    expect(() => assertValidPartialPayment(NaN, 10)).toThrow();
  });
  it("rejects Infinity paid", () => {
    expect(() => assertValidPartialPayment(Infinity, 10)).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #86-B  currency.ts — conversion functions
// ─────────────────────────────────────────────────────────────────────────────
describe("fiatToUsdc", () => {
  it("converts NGN to USDC correctly", () => {
    // 1 USDC = 1600 NGN  →  1600 NGN = 1 USDC
    expect(fiatToUsdc(1600, "NGN")).toBe("1.0000000");
  });

  it("converts USD (1:1) to USDC", () => {
    expect(fiatToUsdc(1, "USD")).toBe("1.0000000");
  });

  it("converts GBP to USDC", () => {
    const result = parseFloat(fiatToUsdc(0.79, "GBP"));
    expect(result).toBeCloseTo(1.0, 5);
  });

  it("converts EUR to USDC", () => {
    const result = parseFloat(fiatToUsdc(0.92, "EUR"));
    expect(result).toBeCloseTo(1.0, 5);
  });

  it("returns a string with 7 decimal places", () => {
    const result = fiatToUsdc(100, "NGN");
    expect(result).toMatch(/^\d+\.\d{7}$/);
  });

  it("throws for unsupported currency", () => {
    expect(() => fiatToUsdc(100, "XYZ" as SupportedCurrency)).toThrow("Unsupported currency");
  });

  it("handles zero amount", () => {
    expect(fiatToUsdc(0, "NGN")).toBe("0.0000000");
  });
});

describe("usdcToFiat", () => {
  it("converts USDC to NGN", () => {
    expect(usdcToFiat("1.0000000", "NGN")).toBe(1600);
  });

  it("converts USDC to USD (1:1)", () => {
    expect(usdcToFiat("1.0000000", "USD")).toBe(1);
  });

  it("throws for unsupported currency", () => {
    expect(() => usdcToFiat("1.0", "XYZ" as SupportedCurrency)).toThrow("Unsupported currency");
  });

  it("returns a number rounded to 2 dp", () => {
    const result = usdcToFiat("0.5", "USD");
    expect(Number.isFinite(result)).toBe(true);
    expect(result.toString()).toMatch(/^\d+(\.\d{1,2})?$/);
  });
});

describe("toSmallestUnit & getSmallestUnitMultiplier", () => {
  it("multiplier is 100 for all currencies", () => {
    (["NGN", "GBP", "USD", "EUR"] as SupportedCurrency[]).forEach((c) => {
      expect(getSmallestUnitMultiplier(c)).toBe(100);
    });
  });

  it("converts 1 NGN to 100 kobo", () => {
    expect(toSmallestUnit(1, "NGN")).toBe(100);
  });

  it("rounds correctly", () => {
    expect(toSmallestUnit(1.005, "NGN")).toBe(101);
    expect(toSmallestUnit(0.001, "NGN")).toBe(0);
  });
});

describe("getCurrencySymbol", () => {
  const cases: [SupportedCurrency, string][] = [
    ["NGN", "₦"],
    ["GBP", "£"],
    ["USD", "$"],
    ["EUR", "€"],
  ];
  it.each(cases)("returns %s symbol for %s", (currency, symbol) => {
    expect(getCurrencySymbol(currency)).toBe(symbol);
  });
});

describe("formatCurrency", () => {
  it("formats NGN with ₦ symbol", () => {
    expect(formatCurrency(1000, "NGN")).toContain("₦");
    expect(formatCurrency(1000, "NGN")).toContain("1,000");
  });

  it("includes 2 decimal places", () => {
    expect(formatCurrency(1, "USD")).toMatch(/\$1\.00/);
  });

  it("handles zero", () => {
    expect(formatCurrency(0, "EUR")).toContain("0.00");
  });
});

describe("isSupportedCurrency", () => {
  it.each(["NGN", "GBP", "USD", "EUR"])("returns true for %s", (c) => {
    expect(isSupportedCurrency(c)).toBe(true);
  });

  it.each(["XOF", "CNY", "", "USDC", "ngn"])("returns false for %s", (c) => {
    expect(isSupportedCurrency(c)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #86-C  reconciliation.ts — edge cases
// ─────────────────────────────────────────────────────────────────────────────
describe("reconcile — edge cases", () => {
  it("returns matched=0 and empty discrepancies for empty inputs", () => {
    const r = reconcile([], []);
    expect(r).toEqual({ matched: 0, discrepancies: [] });
  });

  it("ignores pending ledger entries with no reference", () => {
    const r = reconcile(
      [{ id: "x", reference: null, amountUsdc: "1", status: "pending" }],
      [],
    );
    expect(r.discrepancies).toHaveLength(0);
  });

  it("flags confirmed entries with null reference as missing_reference", () => {
    const r = reconcile(
      [{ id: "x", reference: null, amountUsdc: "1", status: "confirmed" }],
      [],
    );
    expect(r.discrepancies).toHaveLength(1);
    expect(r.discrepancies[0].kind).toBe("missing_reference");
  });

  it("flags duplicate ledger references as duplicate_reference", () => {
    const r = reconcile(
      [
        { id: "a", reference: "dup", amountUsdc: "1", status: "confirmed" },
        { id: "b", reference: "dup", amountUsdc: "1", status: "confirmed" },
      ],
      [{ reference: "dup", amountUsdc: "1", successful: true }],
    );
    expect(r.discrepancies.some((d) => d.kind === "duplicate_reference")).toBe(true);
  });

  it("flags duplicate settlement references as duplicate_reference", () => {
    const r = reconcile(
      [{ id: "a", reference: "ref1", amountUsdc: "1", status: "confirmed" }],
      [
        { reference: "ref1", amountUsdc: "1", successful: true },
        { reference: "ref1", amountUsdc: "1", successful: true },
      ],
    );
    expect(r.discrepancies.some((d) => d.kind === "duplicate_reference")).toBe(true);
  });

  it("detects amount_mismatch even for sub-stroops difference", () => {
    const r = reconcile(
      [{ id: "a", reference: "ref1", amountUsdc: "1.0000000", status: "confirmed" }],
      [{ reference: "ref1", amountUsdc: "1.0000001", successful: true }],
    );
    expect(r.discrepancies[0].kind).toBe("amount_mismatch");
  });

  it("matches correctly despite trailing zeros", () => {
    const r = reconcile(
      [{ id: "a", reference: "ref1", amountUsdc: "10.0000000", status: "confirmed" }],
      [{ reference: "ref1", amountUsdc: "10", successful: true }],
    );
    expect(r).toEqual({ matched: 1, discrepancies: [] });
  });

  it("flags orphan settlements (settlement with no ledger entry)", () => {
    const r = reconcile(
      [],
      [{ reference: "orphan", amountUsdc: "1", successful: true }],
    );
    expect(r.discrepancies[0].kind).toBe("orphan_settlement");
  });

  it("increments matched counter for each clean match", () => {
    const r = reconcile(
      [
        { id: "1", reference: "r1", amountUsdc: "5", status: "confirmed" },
        { id: "2", reference: "r2", amountUsdc: "5", status: "confirmed" },
      ],
      [
        { reference: "r1", amountUsdc: "5", successful: true },
        { reference: "r2", amountUsdc: "5", successful: true },
      ],
    );
    expect(r.matched).toBe(2);
    expect(r.discrepancies).toHaveLength(0);
  });

  it("treats 'completed' ledger status as settled", () => {
    const r = reconcile(
      [{ id: "a", reference: "ref1", amountUsdc: "1", status: "completed" }],
      [{ reference: "ref1", amountUsdc: "1", successful: true }],
    );
    expect(r.matched).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #86-D  circle-lifecycle.ts — state machine edge cases
// ─────────────────────────────────────────────────────────────────────────────
describe("circle lifecycle — valid transitions", () => {
  const base = { memberCount: 3, maxMembers: 3, currentCycle: 0 };

  it("open → cancel → cancelled", () => {
    expect(transition({ ...base, status: "open" }, "cancel")).toBe("cancelled");
  });
  it("active → cancel → cancelled", () => {
    expect(transition({ ...base, status: "active" }, "cancel")).toBe("cancelled");
  });
  it("paused → cancel → cancelled", () => {
    expect(transition({ ...base, status: "paused" }, "cancel")).toBe("cancelled");
  });
  it("open → start → active (full membership)", () => {
    expect(transition({ ...base, status: "open" }, "start")).toBe("active");
  });
  it("active → pause → paused", () => {
    expect(transition({ ...base, status: "active" }, "pause")).toBe("paused");
  });
  it("paused → resume → active", () => {
    expect(transition({ ...base, status: "paused" }, "resume")).toBe("active");
  });
  it("active → complete (last cycle)", () => {
    expect(
      transition({ ...base, status: "active", currentCycle: 3 }, "complete"),
    ).toBe("completed");
  });
});

describe("circle lifecycle — invalid transitions and guards", () => {
  const base = { memberCount: 3, maxMembers: 3, currentCycle: 0 };

  it("rejects start from open when not full", () => {
    expect(() =>
      transition({ ...base, status: "open", memberCount: 2 }, "start"),
    ).toThrow();
  });
  it("rejects pause from open (not started)", () => {
    expect(() => transition({ ...base, status: "open" }, "pause")).toThrow();
  });
  it("rejects complete when not on last cycle", () => {
    expect(() =>
      transition({ ...base, status: "active", currentCycle: 1 }, "complete"),
    ).toThrow();
  });
  it("rejects any event from completed (terminal)", () => {
    expect(() => transition({ ...base, status: "completed" }, "cancel")).toThrow();
    expect(() => transition({ ...base, status: "completed" }, "start")).toThrow();
  });
  it("rejects any event from cancelled (terminal)", () => {
    expect(() => transition({ ...base, status: "cancelled" }, "resume")).toThrow();
  });
  it("rejects unknown status", () => {
    expect(() => transition({ ...base, status: "unknown_state" }, "start")).toThrow();
  });
  it("rejects unknown event", () => {
    expect(() =>
      transition({ ...base, status: "open" }, "teleport" as any),
    ).toThrow();
  });
});

describe("isTerminal / allowedEvents / isCircleStatus", () => {
  it("identifies terminal states", () => {
    expect(isTerminal("completed")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
  });
  it("identifies non-terminal states", () => {
    expect(isTerminal("open")).toBe(false);
    expect(isTerminal("active")).toBe(false);
    expect(isTerminal("paused")).toBe(false);
  });
  it("returns empty allowed events for terminal states", () => {
    expect(allowedEvents("completed")).toEqual([]);
    expect(allowedEvents("cancelled")).toEqual([]);
  });
  it("returns allowed events for active states", () => {
    expect(allowedEvents("open")).toContain("start");
    expect(allowedEvents("active")).toContain("pause");
    expect(allowedEvents("paused")).toContain("resume");
  });
  it("validates known statuses", () => {
    ["open", "active", "paused", "completed", "cancelled"].forEach((s) => {
      expect(isCircleStatus(s)).toBe(true);
    });
  });
  it("rejects unknown statuses", () => {
    expect(isCircleStatus("waiting")).toBe(false);
    expect(isCircleStatus(null)).toBe(false);
    expect(isCircleStatus(42)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #86-E  fx.ts — rate caching and fallback
// ─────────────────────────────────────────────────────────────────────────────
describe("getFiatPerUsdc — caching and fallback", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSetEx.mockResolvedValue("OK");
    mockRedisSet.mockResolvedValue("OK");
  });

  it("returns cached rate if available", async () => {
    mockRedisGet.mockResolvedValue("1650");
    const rate = await getFiatPerUsdc("NGN");
    expect(rate).toBe(1650);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("fetches live rate and caches it on cache miss", async () => {
    mockRedisGet.mockResolvedValue(null);
    mockedAxios.get.mockResolvedValue({ data: { rates: { NGN: 1700 } } });
    const rate = await getFiatPerUsdc("NGN");
    expect(rate).toBe(1700);
    expect(mockRedisSetEx).toHaveBeenCalled();
    expect(mockRedisSet).toHaveBeenCalled();
  });

  it("falls back to last-known Redis rate on network failure", async () => {
    mockRedisGet
      .mockResolvedValueOnce(null)    // cache miss
      .mockResolvedValueOnce("1620"); // last-known fallback
    mockedAxios.get.mockRejectedValue(new Error("Network timeout"));
    const rate = await getFiatPerUsdc("NGN");
    expect(rate).toBe(1620);
  });

  it("falls back to hardcoded rate when Redis and live both fail", async () => {
    mockRedisGet.mockResolvedValue(null);
    mockedAxios.get.mockRejectedValue(new Error("Network timeout"));
    const rate = await getFiatPerUsdc("NGN");
    expect(rate).toBe(1600); // hardcoded fallback
  });

  it("uses 1.0 as fallback for unknown currency", async () => {
    mockRedisGet.mockResolvedValue(null);
    mockedAxios.get.mockRejectedValue(new Error("fail"));
    const rate = await getFiatPerUsdc("XOF");
    expect(rate).toBe(1.0);
  });
});
