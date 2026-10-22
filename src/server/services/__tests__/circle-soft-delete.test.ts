/**
 * Integration tests for circle soft-delete lifecycle (issue #219).
 *
 * Covers:
 *  - deleteCircle soft-deletes the circle, cascades to members & contributions
 *  - getCircleById returns null for a soft-deleted circle (→ 404)
 *  - listCircles never returns soft-deleted circles
 *  - adminListDeletedCircles returns only soft-deleted circles
 *  - hardDeleteExpiredCircles respects the retention window
 */

import {
  deleteCircle,
  getCircleById,
  listCircles,
  hardDeleteExpiredCircles,
} from "@/server/services/circle.service";
import { adminListDeletedCircles } from "@/server/services/admin.service";
import * as db from "@/lib/db";
import * as redis from "@/lib/redis";

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock("@/lib/db", () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

jest.mock("@/lib/redis", () => ({
  getRedis: jest.fn(),
}));

// Stub soroban — not involved in delete path
jest.mock("@/lib/soroban", () => ({
  deployAjoContract: jest.fn().mockResolvedValue("CONTRACT_ID"),
}));

jest.mock("@/lib/fx", () => ({
  getFiatPerUsdc: jest.fn().mockResolvedValue(1600),
}));

jest.mock("@/lib/stellar", () => ({
  sendUsdcPayment: jest.fn(),
  validateStellarRecipient: jest.fn(),
}));

jest.mock("@/server/services/notification.service", () => ({
  notifyCircleCancelled: jest.fn().mockResolvedValue(undefined),
}));

const mockQuery = db.query as jest.MockedFunction<typeof db.query>;
const mockTransaction = db.transaction as jest.MockedFunction<typeof db.transaction>;
const mockGetRedis = redis.getRedis as jest.MockedFunction<typeof redis.getRedis>;

// Minimal redis stub (operations hit cache miss → fall to DB)
const mockRedisGet = jest.fn().mockResolvedValue(null);
const mockRedisSet = jest.fn().mockResolvedValue("OK");
const mockRedisDel = jest.fn().mockResolvedValue(1);
const mockRedisKeys = jest.fn().mockResolvedValue([]);
const mockRedisClient = { get: mockRedisGet, set: mockRedisSet, del: mockRedisDel, keys: mockRedisKeys };

// ── Constants ────────────────────────────────────────────────────────────────

const CIRCLE_ID = "circle-soft-test-1";
const CREATOR_ID = "creator-soft-1";

const ACTIVE_CIRCLE_ROW = {
  id: CIRCLE_ID,
  name: "Soft-delete test circle",
  creator_id: CREATOR_ID,
  contribution_usdc: "10.0000000",
  contribution_fiat: 16000,
  contribution_currency: "NGN",
  contribution_ngn: 16000,
  circle_type: "public",
  max_members: 5,
  cycle_frequency: "monthly",
  status: "active",
  contract_id: null,
  current_cycle: 1,
  next_payout_at: null,
  payout_method: "fixed",
  grace_period_hours: 24,
  randomization_seed: null,
  created_at: new Date("2025-01-01"),
  updated_at: new Date("2025-01-01"),
  deleted_at: null,
};

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockGetRedis.mockResolvedValue(mockRedisClient as any);
  // Default: transaction executes its callback with mockQuery
  mockTransaction.mockImplementation(async (cb) => cb(mockQuery));
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("circle soft-delete lifecycle (#219)", () => {
  // ────────────────────────────────────────────────────────────────────────
  describe("deleteCircle", () => {
    it("soft-deletes the circle and cascades to members and contributions", async () => {
      // transaction callback: SELECT FOR UPDATE, UPDATE circles, UPDATE members, UPDATE contributions
      mockQuery
        .mockResolvedValueOnce({ rows: [ACTIVE_CIRCLE_ROW], rowCount: 1 }) // SELECT … FOR UPDATE
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })                  // UPDATE circles
        .mockResolvedValueOnce({ rows: [], rowCount: 3 })                  // UPDATE members
        .mockResolvedValueOnce({ rows: [], rowCount: 7 })                  // UPDATE contributions
        // Redis cache invalidation keys + del
        .mockResolvedValue({ rows: [], rowCount: 0 } as any);

      const result = await deleteCircle(CIRCLE_ID, CREATOR_ID);

      expect(result.id).toBe(CIRCLE_ID);

      // Circle soft-delete
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE circles SET deleted_at"),
        expect.arrayContaining([CIRCLE_ID])
      );

      // Members cascade
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE members SET deleted_at"),
        expect.arrayContaining([CIRCLE_ID])
      );

      // Contributions cascade
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE contributions SET deleted_at"),
        expect.arrayContaining([CIRCLE_ID])
      );
    });

    it("throws 'Circle not found' when the circle does not exist", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      await expect(deleteCircle("nonexistent", CREATOR_ID)).rejects.toThrow("Circle not found");
    });

    it("throws 'Circle is already deleted' for a circle with deleted_at set", async () => {
      const deletedRow = { ...ACTIVE_CIRCLE_ROW, deleted_at: new Date() };
      mockQuery.mockResolvedValueOnce({ rows: [deletedRow], rowCount: 1 });
      await expect(deleteCircle(CIRCLE_ID, CREATOR_ID)).rejects.toThrow("Circle is already deleted");
    });

    it("throws when a non-creator attempts to delete", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [ACTIVE_CIRCLE_ROW], rowCount: 1 });
      await expect(deleteCircle(CIRCLE_ID, "other-user")).rejects.toThrow(
        "Only the circle creator can delete this circle"
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  describe("getCircleById — respects soft-delete", () => {
    it("returns null (→ 404) for a soft-deleted circle", async () => {
      // DB query returns 0 rows (deleted_at IS NULL filter excluded the row)
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await getCircleById(CIRCLE_ID);

      expect(result).toBeNull();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("deleted_at IS NULL"),
        [CIRCLE_ID]
      );
    });

    it("returns the circle when it is not soft-deleted", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [ACTIVE_CIRCLE_ROW], rowCount: 1 });

      const result = await getCircleById(CIRCLE_ID);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(CIRCLE_ID);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  describe("listCircles — excludes soft-deleted", () => {
    it("includes deleted_at IS NULL in the WHERE clause", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await listCircles({});

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("deleted_at IS NULL"),
        expect.anything()
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  describe("adminListDeletedCircles", () => {
    it("queries only rows where deleted_at IS NOT NULL", async () => {
      const deletedRow = {
        ...ACTIVE_CIRCLE_ROW,
        deleted_at: new Date(),
        memberCount: 2,
      };
      mockQuery.mockResolvedValueOnce({ rows: [deletedRow], rowCount: 1 });

      const result = await adminListDeletedCircles();

      expect(result).toHaveLength(1);
      const [sql] = mockQuery.mock.calls[0];
      expect(String(sql)).toContain("deleted_at IS NOT NULL");
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  describe("hardDeleteExpiredCircles — retention window", () => {
    it("deletes circles older than the retention window", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: "old-circle-1" }, { id: "old-circle-2" }],
        rowCount: 2,
      });

      const count = await hardDeleteExpiredCircles(90);

      expect(count).toBe(2);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM circles"),
        expect.arrayContaining([expect.any(Date)])
      );
    });

    it("uses default 90-day retention when no argument supplied", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await hardDeleteExpiredCircles();

      const [, params] = mockQuery.mock.calls[0];
      const cutoffDate = (params as Date[])[0];
      const daysAgo = (Date.now() - cutoffDate.getTime()) / (1000 * 60 * 60 * 24);
      expect(daysAgo).toBeGreaterThanOrEqual(89);
      expect(daysAgo).toBeLessThanOrEqual(91);
    });

    it("respects a custom retention window", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await hardDeleteExpiredCircles(30);

      const [, params] = mockQuery.mock.calls[0];
      const cutoffDate = (params as Date[])[0];
      const daysAgo = (Date.now() - cutoffDate.getTime()) / (1000 * 60 * 60 * 24);
      expect(daysAgo).toBeGreaterThanOrEqual(29);
      expect(daysAgo).toBeLessThanOrEqual(31);
    });
  });
});
