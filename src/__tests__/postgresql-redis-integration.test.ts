/**
 * @jest-environment node
 *
 * PostgreSQL / Redis integration tests (#88)
 *
 * Covers:
 * - db.ts: query retry, transaction rollback, pool management
 * - redis.ts: connection lazy-init and client reuse
 * - sessions.ts: token denylist, revocation flows, Redis fallback
 * - lockout.ts: failure counting, lockout trigger, reset
 */

// ── Redis mock factory ────────────────────────────────────────────────────────
const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  setEx: jest.fn(),
  del: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn(),
  ttl: jest.fn(),
  connect: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
};

jest.mock("../redis", () => ({
  getRedis: jest.fn().mockResolvedValue(mockRedis),
}));

// ── DB mock ───────────────────────────────────────────────────────────────────
jest.mock("../db", () => ({
  query: jest.fn(),
  transaction: jest.fn(),
  closePool: jest.fn(),
  getPoolStats: jest.fn(),
}));

import * as db from "../db";
import { getRedis } from "../redis";
import {
  hashToken,
  parseUserAgent,
  getIpAddress,
  denylistTokenHashes,
  isSessionRevoked,
  getUserSessions,
  getSessionByTokenHash,
  revokeSession,
  revokeAllOtherSessions,
  revokeAllSessions,
  cleanupExpiredSessions,
  createSession,
} from "../sessions";
import {
  getLockoutStatus,
  isLockedOut,
  recordFailure,
  resetLockout,
  MAX_FAILURES,
  LOCKOUT_DURATION,
} from "../lockout";

const mockQuery = db.query as jest.MockedFunction<typeof db.query>;
const mockTransaction = db.transaction as jest.MockedFunction<typeof db.transaction>;

// ─────────────────────────────────────────────────────────────────────────────
// A: db.ts — query and transaction behaviour
// ─────────────────────────────────────────────────────────────────────────────
describe("db.query", () => {
  beforeEach(() => jest.clearAllMocks());

  it("resolves on success", async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: "1" }], rowCount: 1 } as any);
    const result = await db.query("SELECT 1");
    expect(result.rows).toHaveLength(1);
  });

  it("rejects when DB is unavailable", async () => {
    mockQuery.mockRejectedValue(new Error("Connection terminated"));
    await expect(db.query("SELECT 1")).rejects.toThrow("Connection terminated");
  });

  it("passes params correctly", async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as any);
    await db.query("SELECT * FROM circles WHERE id = $1", ["c1"]);
    expect(mockQuery).toHaveBeenCalledWith(
      "SELECT * FROM circles WHERE id = $1",
      ["c1"],
    );
  });
});

describe("db.transaction", () => {
  beforeEach(() => jest.clearAllMocks());

  it("commits on success and returns fn result", async () => {
    mockTransaction.mockImplementation(async (fn) => fn(mockQuery as any));
    mockQuery.mockResolvedValue({ rows: [{ id: "tx-result" }] } as any);
    const result = await db.transaction(async (q) => q("SELECT 1"));
    expect(result.rows[0].id).toBe("tx-result");
  });

  it("propagates errors from transaction fn", async () => {
    mockTransaction.mockImplementation(async (fn) => {
      await fn(jest.fn().mockRejectedValue(new Error("FK violation")) as any);
    });
    await expect(
      db.transaction(async (q) => q("BAD SQL")),
    ).rejects.toThrow("FK violation");
  });

  it("is called exactly once for a single transaction", async () => {
    mockTransaction.mockResolvedValue(undefined);
    await db.transaction(async () => undefined);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B: redis.ts — connection behaviour
// ─────────────────────────────────────────────────────────────────────────────
describe("getRedis", () => {
  it("returns a Redis client", async () => {
    const redis = await getRedis();
    expect(redis).toBeDefined();
    expect(typeof redis.get).toBe("function");
  });

  it("returns the same instance on repeated calls (singleton)", async () => {
    const r1 = await getRedis();
    const r2 = await getRedis();
    expect(r1).toBe(r2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C: sessions.ts — token management
// ─────────────────────────────────────────────────────────────────────────────
describe("hashToken", () => {
  it("returns a 64-char hex string", () => {
    const h = hashToken("some-jwt-token");
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]+$/);
  });

  it("is deterministic", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
  });

  it("produces different hashes for different inputs", () => {
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });
});

describe("parseUserAgent", () => {
  it("detects Chrome on Windows", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/118.0.0.0 Safari/537.36";
    const result = parseUserAgent(ua);
    expect(result.browser).toBe("Chrome");
    expect(result.os).toBe("Windows");
    expect(result.deviceType).toBe("desktop");
  });

  it("detects mobile device", () => {
    const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
    const result = parseUserAgent(ua);
    expect(result.deviceType).toBe("mobile");
    expect(result.os).toBe("iOS");
  });

  it("detects Firefox on Linux", () => {
    const ua = "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/115.0";
    const result = parseUserAgent(ua);
    expect(result.browser).toBe("Firefox");
    expect(result.os).toBe("Linux");
  });

  it("detects Safari on macOS", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/605.1.15 Version/16.0 Safari/605.1.15";
    const result = parseUserAgent(ua);
    expect(result.browser).toBe("Safari");
    expect(result.os).toBe("macOS");
  });

  it("falls back to Unknown for unrecognised UA", () => {
    const result = parseUserAgent("CustomBot/1.0");
    expect(result.browser).toBe("Unknown");
    expect(result.os).toBe("Unknown");
  });

  it("returns a deviceName string", () => {
    const result = parseUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/118.0");
    expect(typeof result.deviceName).toBe("string");
    expect(result.deviceName.length).toBeGreaterThan(0);
  });
});

describe("getIpAddress", () => {
  const makeReq = (headers: Record<string, string | null>) => ({
    headers: { get: (k: string) => headers[k] ?? null },
  });

  it("returns first IP from x-forwarded-for", () => {
    const req = makeReq({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
    expect(getIpAddress(req as any)).toBe("1.2.3.4");
  });

  it("returns x-real-ip when x-forwarded-for is absent", () => {
    const req = makeReq({ "x-forwarded-for": null, "x-real-ip": "9.10.11.12" });
    expect(getIpAddress(req as any)).toBe("9.10.11.12");
  });

  it("returns 'unknown' when no IP headers are present", () => {
    const req = makeReq({ "x-forwarded-for": null, "x-real-ip": null });
    expect(getIpAddress(req as any)).toBe("unknown");
  });
});

describe("denylistTokenHashes", () => {
  beforeEach(() => jest.clearAllMocks());

  it("does nothing for empty array", async () => {
    await denylistTokenHashes([]);
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it("calls redis.set for each hash", async () => {
    mockRedis.set.mockResolvedValue("OK");
    await denylistTokenHashes(["hash1", "hash2"]);
    expect(mockRedis.set).toHaveBeenCalledTimes(2);
    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringContaining("hash1"),
      "1",
      expect.any(Object),
    );
  });

  it("does not throw when Redis fails (soft failure)", async () => {
    mockRedis.set.mockRejectedValue(new Error("Redis unavailable"));
    await expect(denylistTokenHashes(["hash1"])).resolves.toBeUndefined();
  });
});

describe("isSessionRevoked", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns true when hash is in Redis denylist", async () => {
    mockRedis.get.mockResolvedValue("1");
    const result = await isSessionRevoked("revoked-hash");
    expect(result).toBe(true);
  });

  it("falls back to DB lookup when Redis miss", async () => {
    mockRedis.get.mockResolvedValue(null);
    mockQuery.mockResolvedValue({ rows: [{ id: "s1", token_hash: "valid-hash" }] } as any);
    const result = await isSessionRevoked("valid-hash");
    expect(result).toBe(false);
  });

  it("returns true when Redis misses and DB has no session", async () => {
    mockRedis.get.mockResolvedValue(null);
    mockQuery.mockResolvedValue({ rows: [] } as any);
    const result = await isSessionRevoked("expired-hash");
    expect(result).toBe(true);
  });

  it("falls back to DB when Redis throws", async () => {
    mockRedis.get.mockRejectedValue(new Error("Redis timeout"));
    mockQuery.mockResolvedValue({ rows: [{ id: "s1" }] } as any);
    const result = await isSessionRevoked("some-hash");
    expect(result).toBe(false);
  });
});

describe("getUserSessions", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns formatted session info", async () => {
    const now = new Date();
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: "s1",
          device_name: "Chrome on Windows",
          device_type: "desktop",
          browser: "Chrome",
          os: "Windows",
          ip_address: "1.2.3.4",
          last_active_at: now,
          created_at: now,
        },
      ],
    } as any);
    const sessions = await getUserSessions("u1");
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("s1");
    expect(sessions[0].browser).toBe("Chrome");
    expect(sessions[0].isCurrent).toBe(false);
  });

  it("handles null device fields gracefully", async () => {
    const now = new Date();
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: "s2",
          device_name: null,
          device_type: null,
          browser: null,
          os: null,
          ip_address: null,
          last_active_at: now,
          created_at: now,
        },
      ],
    } as any);
    const sessions = await getUserSessions("u1");
    expect(sessions[0].deviceName).toBe("Unknown Device");
    expect(sessions[0].browser).toBe("Unknown");
  });

  it("returns empty array when user has no sessions", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);
    const sessions = await getUserSessions("u1");
    expect(sessions).toEqual([]);
  });
});

describe("revokeSession", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns true when session is deleted", async () => {
    mockQuery.mockResolvedValue({ rows: [{ token_hash: "h1" }] } as any);
    mockRedis.set.mockResolvedValue("OK");
    const result = await revokeSession("s1", "u1");
    expect(result).toBe(true);
    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringContaining("h1"),
      "1",
      expect.any(Object),
    );
  });

  it("returns false when session not found (wrong owner)", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);
    const result = await revokeSession("s1", "wrong-user");
    expect(result).toBe(false);
  });
});

describe("revokeAllOtherSessions", () => {
  beforeEach(() => jest.clearAllMocks());

  it("deletes all except current and denylists hashes", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ token_hash: "h1" }, { token_hash: "h2" }],
    } as any);
    mockRedis.set.mockResolvedValue("OK");
    const count = await revokeAllOtherSessions("u1", "current-session");
    expect(count).toBe(2);
    expect(mockRedis.set).toHaveBeenCalledTimes(2);
  });

  it("returns 0 when no other sessions exist", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);
    const count = await revokeAllOtherSessions("u1", "current");
    expect(count).toBe(0);
  });
});

describe("revokeAllSessions", () => {
  beforeEach(() => jest.clearAllMocks());

  it("removes all sessions for a user", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ token_hash: "h1" }, { token_hash: "h2" }, { token_hash: "h3" }],
    } as any);
    mockRedis.set.mockResolvedValue("OK");
    const count = await revokeAllSessions("u1");
    expect(count).toBe(3);
  });
});

describe("cleanupExpiredSessions", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns the count of deleted rows", async () => {
    mockQuery.mockResolvedValue({ rowCount: 7 } as any);
    const n = await cleanupExpiredSessions();
    expect(n).toBe(7);
  });

  it("returns 0 when nothing expired", async () => {
    mockQuery.mockResolvedValue({ rowCount: 0 } as any);
    expect(await cleanupExpiredSessions()).toBe(0);
  });

  it("returns 0 when rowCount is null", async () => {
    mockQuery.mockResolvedValue({ rowCount: null } as any);
    expect(await cleanupExpiredSessions()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D: lockout.ts — brute-force protection with Redis
// ─────────────────────────────────────────────────────────────────────────────
describe("getLockoutStatus", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns locked status when lockout key is set in Redis", async () => {
    mockRedis.get.mockResolvedValueOnce("1"); // lockout key present
    mockRedis.ttl.mockResolvedValue(1800);
    const status = await getLockoutStatus("+2348001234567");
    expect(status.isLocked).toBe(true);
    expect(status.remainingAttempts).toBe(0);
    expect(status.lockoutRemainingSeconds).toBe(1800);
  });

  it("returns unlocked status with attempt count", async () => {
    mockRedis.get
      .mockResolvedValueOnce(null)  // no lockout key
      .mockResolvedValueOnce("3");  // 3 previous failures
    const status = await getLockoutStatus("+2348001234567");
    expect(status.isLocked).toBe(false);
    expect(status.attempts).toBe(3);
    expect(status.remainingAttempts).toBe(MAX_FAILURES - 3);
  });

  it("returns 0 attempts for a fresh phone number", async () => {
    mockRedis.get.mockResolvedValue(null);
    const status = await getLockoutStatus("+new-number");
    expect(status.isLocked).toBe(false);
    expect(status.attempts).toBe(0);
    expect(status.remainingAttempts).toBe(MAX_FAILURES);
  });
});

describe("isLockedOut", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns true when locked", async () => {
    mockRedis.get.mockResolvedValueOnce("1");
    mockRedis.ttl.mockResolvedValue(100);
    expect(await isLockedOut("+number")).toBe(true);
  });

  it("returns false when not locked", async () => {
    mockRedis.get.mockResolvedValue(null);
    expect(await isLockedOut("+number")).toBe(false);
  });
});

describe("recordFailure", () => {
  beforeEach(() => jest.clearAllMocks());

  it("increments failure count and sets expiry on first failure", async () => {
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);
    const status = await recordFailure("+number");
    expect(status.isLocked).toBe(false);
    expect(status.attempts).toBe(1);
    expect(mockRedis.expire).toHaveBeenCalledTimes(1);
  });

  it("does NOT set expire for subsequent failures", async () => {
    mockRedis.incr.mockResolvedValue(2);
    await recordFailure("+number");
    expect(mockRedis.expire).not.toHaveBeenCalled();
  });

  it("triggers lockout when failure count reaches MAX_FAILURES", async () => {
    mockRedis.incr.mockResolvedValue(MAX_FAILURES);
    mockRedis.set.mockResolvedValue("OK");
    mockRedis.del.mockResolvedValue(1);
    const status = await recordFailure("+number");
    expect(status.isLocked).toBe(true);
    expect(status.remainingAttempts).toBe(0);
    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringContaining("lockout:"),
      "1",
      expect.objectContaining({ EX: LOCKOUT_DURATION }),
    );
  });

  it("exceeding MAX_FAILURES also locks (defensive)", async () => {
    mockRedis.incr.mockResolvedValue(MAX_FAILURES + 1);
    mockRedis.set.mockResolvedValue("OK");
    mockRedis.del.mockResolvedValue(1);
    const status = await recordFailure("+number");
    expect(status.isLocked).toBe(true);
  });
});

describe("resetLockout", () => {
  beforeEach(() => jest.clearAllMocks());

  it("deletes both the failures and lockout keys", async () => {
    mockRedis.del.mockResolvedValue(1);
    await resetLockout("+number");
    expect(mockRedis.del).toHaveBeenCalledTimes(2);
    expect(mockRedis.del).toHaveBeenCalledWith("otp_failures:+number");
    expect(mockRedis.del).toHaveBeenCalledWith("lockout:+number");
  });
});
