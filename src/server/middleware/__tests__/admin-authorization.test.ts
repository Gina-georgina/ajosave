/**
 * @jest-environment node
 *
 * Admin authorization coverage (#87)
 *
 * Covers:
 * - withAuthorization middleware (role checks, resource checks, session errors)
 * - resolveUser helper edge cases
 * - admin.service.ts: authorization-gated operations and error paths
 */

// ── Shared mocks ──────────────────────────────────────────────────────────────
jest.mock("next-auth", () => ({ getServerSession: jest.fn() }));
jest.mock("@/lib/auth", () => ({ authOptions: {} }));
jest.mock("@/lib/logger", () => ({
  __esModule: true,
  default: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));
jest.mock("next/server", () => ({
  NextRequest: class {},
  NextResponse: {
    json: jest.fn((body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    })),
  },
}));
jest.mock("@/lib/db", () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import logger from "@/lib/logger";
import { withAuthorization, resolveUser, DEFAULT_ROLE } from "@/server/middleware/authorization";
import * as db from "@/lib/db";
import {
  adminListCircles,
  adminListDeletedCircles,
  adminSoftDeleteUser,
  adminListUsers,
  adminGetPlatformStats,
  adminListPayouts,
  adminRemoveMember,
  adminGetPayoutRecipientKey,
} from "@/server/services/admin.service";

const session = getServerSession as jest.Mock;
const mockQuery = db.query as jest.MockedFunction<typeof db.query>;
const mockTransaction = db.transaction as jest.MockedFunction<typeof db.transaction>;

const req = { url: "http://localhost/api/admin/circles", method: "GET" } as never;
const ok = () => jest.fn(async () => NextResponse.json({ ok: true }));

// ─────────────────────────────────────────────────────────────────────────────
// A: resolveUser — identity extraction edge cases
// ─────────────────────────────────────────────────────────────────────────────
describe("resolveUser — edge cases", () => {
  it("returns null for null session", () => {
    expect(resolveUser(null)).toBeNull();
  });

  it("returns null for session without user", () => {
    expect(resolveUser({})).toBeNull();
  });

  it("returns null for user with numeric id", () => {
    expect(resolveUser({ user: { id: 42 } })).toBeNull();
  });

  it("returns null for user with empty-string id", () => {
    expect(resolveUser({ user: { id: "" } })).toBeNull();
  });

  it("returns null for user with whitespace-only id", () => {
    expect(resolveUser({ user: { id: "   " } })).toBeNull();
  });

  it("defaults role to member when role is missing", () => {
    expect(resolveUser({ user: { id: "u1" } })).toEqual({
      id: "u1",
      role: DEFAULT_ROLE,
    });
  });

  it("defaults role to member when role is empty string", () => {
    expect(resolveUser({ user: { id: "u1", role: "" } })).toEqual({
      id: "u1",
      role: DEFAULT_ROLE,
    });
  });

  it("preserves explicit role", () => {
    expect(resolveUser({ user: { id: "u1", role: "admin" } })).toEqual({
      id: "u1",
      role: "admin",
    });
  });

  it("returns null for non-string role with missing id", () => {
    expect(resolveUser({ user: { role: "admin" } })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B: withAuthorization — 401 / 403 paths
// ─────────────────────────────────────────────────────────────────────────────
describe("withAuthorization — authentication boundary", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 when no session exists", async () => {
    session.mockResolvedValue(null);
    const res = (await withAuthorization(ok())(req)) as any;
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 when session has no user", async () => {
    session.mockResolvedValue({});
    const res = (await withAuthorization(ok())(req)) as any;
    expect(res.status).toBe(401);
  });

  it("returns 401 when user id is blank", async () => {
    session.mockResolvedValue({ user: { id: "  " } });
    const res = (await withAuthorization(ok())(req)) as any;
    expect(res.status).toBe(401);
  });

  it("fails closed (401) when session lookup throws", async () => {
    session.mockRejectedValue(new Error("Redis down"));
    const handler = ok();
    const res = (await withAuthorization(handler)(req)) as any;
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it("logs authz.denied for unauthenticated requests", async () => {
    session.mockResolvedValue(null);
    await withAuthorization(ok())(req);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ msg: "authz.denied", reason: "unauthenticated" }),
    );
  });
});

describe("withAuthorization — role-based access control", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 403 when caller lacks required role", async () => {
    session.mockResolvedValue({ user: { id: "u1", role: "member" } });
    const res = (await withAuthorization(ok(), { roles: ["admin"] })(req)) as any;
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("returns 403 when caller has different admin-tier role", async () => {
    session.mockResolvedValue({ user: { id: "u1", role: "moderator" } });
    const res = (await withAuthorization(ok(), { roles: ["admin", "superadmin"] })(req)) as any;
    expect(res.status).toBe(403);
  });

  it("allows when caller has any of the listed roles", async () => {
    session.mockResolvedValue({ user: { id: "u1", role: "moderator" } });
    const res = (await withAuthorization(ok(), { roles: ["admin", "moderator"] })(req)) as any;
    expect(res.status).toBe(200);
  });

  it("allows any authenticated user when no roles specified", async () => {
    session.mockResolvedValue({ user: { id: "u1", role: "member" } });
    const res = (await withAuthorization(ok())(req)) as any;
    expect(res.status).toBe(200);
  });

  it("logs role denial with userId", async () => {
    session.mockResolvedValue({ user: { id: "u42", role: "member" } });
    await withAuthorization(ok(), { roles: ["admin"] })(req);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ msg: "authz.denied", reason: "role", userId: "u42" }),
    );
  });
});

describe("withAuthorization — resource-level check", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 403 when check returns false", async () => {
    session.mockResolvedValue({ user: { id: "u1", role: "admin" } });
    const res = (await withAuthorization(ok(), { check: () => false })(req)) as any;
    expect(res.status).toBe(403);
  });

  it("returns 403 when check throws", async () => {
    session.mockResolvedValue({ user: { id: "u1", role: "admin" } });
    const throwing = () => {
      throw new Error("db down");
    };
    const res = (await withAuthorization(ok(), { check: throwing })(req)) as any;
    expect(res.status).toBe(403);
    expect(logger.error).toHaveBeenCalled();
  });

  it("allows when async check resolves to true", async () => {
    session.mockResolvedValue({ user: { id: "owner-1", role: "admin" } });
    const check = jest.fn(async (user: { id: string }, _r: unknown, ctx: any) =>
      ctx.params?.circleId === "c1" && user.id === "owner-1",
    );
    const res = (await withAuthorization(ok(), { check })(req, {
      params: { circleId: "c1" },
    })) as any;
    expect(res.status).toBe(200);
  });

  it("merges the resolved user into ctx before calling check", async () => {
    session.mockResolvedValue({ user: { id: "u99", role: "admin" } });
    let capturedCtx: any;
    await withAuthorization(ok(), {
      check: (_u, _r, ctx) => {
        capturedCtx = ctx;
        return true;
      },
    })(req, { params: { x: "1" } });
    expect(capturedCtx.user).toEqual({ id: "u99", role: "admin" });
    expect(capturedCtx.params).toEqual({ x: "1" });
  });

  it("passes user object to check correctly", async () => {
    session.mockResolvedValue({ user: { id: "u1", role: "admin" } });
    const check = jest.fn().mockResolvedValue(true);
    await withAuthorization(ok(), { check })(req, {});
    expect(check).toHaveBeenCalledWith(
      { id: "u1", role: "admin" },
      expect.anything(),
      expect.anything(),
    );
  });
});

describe("withAuthorization — combined roles + check", () => {
  beforeEach(() => jest.clearAllMocks());

  it("checks role before resource check (403 on role, check not called)", async () => {
    session.mockResolvedValue({ user: { id: "u1", role: "member" } });
    const check = jest.fn().mockResolvedValue(true);
    const res = (await withAuthorization(ok(), { roles: ["admin"], check })(req)) as any;
    expect(res.status).toBe(403);
    expect(check).not.toHaveBeenCalled();
  });

  it("calls check after passing role validation", async () => {
    session.mockResolvedValue({ user: { id: "u1", role: "admin" } });
    const check = jest.fn().mockResolvedValue(false);
    const res = (await withAuthorization(ok(), { roles: ["admin"], check })(req)) as any;
    expect(res.status).toBe(403);
    expect(check).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C: admin.service.ts — admin operations authorization boundary
// ─────────────────────────────────────────────────────────────────────────────
describe("adminListCircles", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns rows from DB", async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: "c1", name: "Test", memberCount: 5 }] } as any);
    const result = await adminListCircles();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("c1");
  });

  it("passes includeDeleted flag to query", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);
    await adminListCircles(true);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.any(String),
      [true],
    );
  });

  it("defaults includeDeleted to false", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);
    await adminListCircles();
    expect(mockQuery).toHaveBeenCalledWith(
      expect.any(String),
      [false],
    );
  });

  it("propagates DB errors", async () => {
    mockQuery.mockRejectedValue(new Error("DB error"));
    await expect(adminListCircles()).rejects.toThrow("DB error");
  });
});

describe("adminListDeletedCircles", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns only deleted circles from DB", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: "c2", deletedAt: new Date() }],
    } as any);
    const result = await adminListDeletedCircles();
    expect(result).toHaveLength(1);
  });
});

describe("adminSoftDeleteUser", () => {
  beforeEach(() => jest.clearAllMocks());

  it("calls UPDATE with correct userId", async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 } as any);
    await adminSoftDeleteUser("user-123");
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE users"),
      ["user-123"],
    );
  });

  it("propagates DB errors", async () => {
    mockQuery.mockRejectedValue(new Error("Constraint violation"));
    await expect(adminSoftDeleteUser("bad-id")).rejects.toThrow();
  });
});

describe("adminListUsers", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns users from DB", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: "u1", displayName: "Alice", role: "member" }],
    } as any);
    const users = await adminListUsers();
    expect(users[0].id).toBe("u1");
  });

  it("passes search term as parameter when provided", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);
    await adminListUsers("alice");
    expect(mockQuery).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(["%alice%"]),
    );
  });

  it("passes empty params when no search term", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);
    await adminListUsers();
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), []);
  });
});

describe("adminGetPlatformStats", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns aggregated platform stats", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: 10, active: 3 }] } as any)
      .mockResolvedValueOnce({ rows: [{ total: 50 }] } as any)
      .mockResolvedValueOnce({ rows: [{ total: "500.0000000" }] } as any)
      .mockResolvedValueOnce({ rows: [{ total: 2 }] } as any);

    const stats = await adminGetPlatformStats();
    expect(stats.totalCircles).toBe(10);
    expect(stats.activeCircles).toBe(3);
    expect(stats.totalUsers).toBe(50);
    expect(stats.totalSavedUsdc).toBe("500.0000000");
    expect(stats.openDisputes).toBe(2);
  });

  it("propagates DB errors", async () => {
    mockQuery.mockRejectedValue(new Error("DB unavailable"));
    await expect(adminGetPlatformStats()).rejects.toThrow();
  });
});

describe("adminListPayouts", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns payout rows joined with circle and user info", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: "p1",
          circleId: "c1",
          recipientMemberId: "m1",
          cycleNumber: 1,
          amountUsdc: "50.0000000",
          txHash: "hash1",
          paidAt: new Date(),
          circleName: "Savings Club",
          recipientUserId: "u1",
        },
      ],
    } as any);
    const payouts = await adminListPayouts();
    expect(payouts).toHaveLength(1);
    expect(payouts[0].circleName).toBe("Savings Club");
  });
});

describe("adminRemoveMember", () => {
  beforeEach(() => jest.clearAllMocks());

  it("calls transaction and marks member as rejected", async () => {
    mockTransaction.mockImplementation(async (fn: (q: typeof db.query) => Promise<unknown>) => {
      const mockQ = jest.fn()
        .mockResolvedValueOnce({ rows: [{ creator_id: "creator-1", status: "active" }] })
        .mockResolvedValueOnce({ rows: [{ user_id: "other-user", status: "active" }] })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rows: [] });
      return fn(mockQ as unknown as typeof db.query);
    });
    await expect(adminRemoveMember("c1", "m1")).resolves.toBeUndefined();
  });

  it("throws when circle not found", async () => {
    mockTransaction.mockImplementation(async (fn: (q: typeof db.query) => Promise<unknown>) => {
      const mockQ = jest.fn().mockResolvedValueOnce({ rows: [] });
      return fn(mockQ as unknown as typeof db.query);
    });
    await expect(adminRemoveMember("bad-circle", "m1")).rejects.toThrow("Circle not found");
  });

  it("throws when member not found", async () => {
    mockTransaction.mockImplementation(async (fn: (q: typeof db.query) => Promise<unknown>) => {
      const mockQ = jest.fn()
        .mockResolvedValueOnce({ rows: [{ creator_id: "creator-1", status: "active" }] })
        .mockResolvedValueOnce({ rows: [] });
      return fn(mockQ as unknown as typeof db.query);
    });
    await expect(adminRemoveMember("c1", "bad-member")).rejects.toThrow("Member not found");
  });

  it("throws when trying to remove the creator", async () => {
    mockTransaction.mockImplementation(async (fn: (q: typeof db.query) => Promise<unknown>) => {
      const mockQ = jest.fn()
        .mockResolvedValueOnce({ rows: [{ creator_id: "creator-1", status: "active" }] })
        .mockResolvedValueOnce({ rows: [{ user_id: "creator-1", status: "active" }] });
      return fn(mockQ as unknown as typeof db.query);
    });
    await expect(adminRemoveMember("c1", "m1")).rejects.toThrow("Cannot remove the circle creator");
  });

  it("throws when member is already rejected", async () => {
    mockTransaction.mockImplementation(async (fn: (q: typeof db.query) => Promise<unknown>) => {
      const mockQ = jest.fn()
        .mockResolvedValueOnce({ rows: [{ creator_id: "creator-1", status: "active" }] })
        .mockResolvedValueOnce({ rows: [{ user_id: "other-user", status: "rejected" }] });
      return fn(mockQ as unknown as typeof db.query);
    });
    await expect(adminRemoveMember("c1", "m1")).rejects.toThrow("already removed");
  });

  it("throws when circle is in terminal state", async () => {
    mockTransaction.mockImplementation(async (fn: (q: typeof db.query) => Promise<unknown>) => {
      const mockQ = jest.fn()
        .mockResolvedValueOnce({ rows: [{ creator_id: "creator-1", status: "completed" }] });
      return fn(mockQ as unknown as typeof db.query);
    });
    await expect(adminRemoveMember("c1", "m1")).rejects.toThrow(
      "Cannot remove members from a completed or cancelled circle",
    );
  });
});

describe("adminGetPayoutRecipientKey", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns recipient key info when circle is active with eligible member", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          stellarPublicKey: "GCBVPTGYLOELZOOOLS4W765VOL3CCXWCTTTGWIYSAFPRLJLRG6VWAEB5",
          displayName: "Alice",
          cycleNumber: 1,
        },
      ],
    } as any);
    const result = await adminGetPayoutRecipientKey("c1");
    expect(result).not.toBeNull();
    expect(result?.stellarPublicKey).toContain("G");
    expect(result?.recipientName).toBe("Alice");
    expect(result?.cycleNumber).toBe(1);
  });

  it("returns null when circle is not active", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);
    const result = await adminGetPayoutRecipientKey("inactive-circle");
    expect(result).toBeNull();
  });

  it("returns null when recipient has no Stellar key", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ stellarPublicKey: null, displayName: "Bob", cycleNumber: 2 }],
    } as any);
    const result = await adminGetPayoutRecipientKey("c1");
    expect(result).toBeNull();
  });
});
