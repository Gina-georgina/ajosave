import { evaluateFlag, isFeatureEnabled, rolloutBucket, upsertFeatureFlag } from "@/server/services/feature-flag.service";
import * as db from "@/lib/db";

jest.mock("@/lib/db");
const mockQuery = db.query as jest.MockedFunction<typeof db.query>;

beforeEach(() => jest.clearAllMocks());

describe("feature-flag.service", () => {
  it("treats missing or disabled flags as off", () => {
    expect(evaluateFlag(undefined, "u")).toBe(false);
    expect(evaluateFlag({ key: "a", enabled: false, rolloutPercent: 100 }, "u")).toBe(false);
  });

  it("handles rollout boundaries", () => {
    expect(evaluateFlag({ key: "a", enabled: true, rolloutPercent: 100 })).toBe(true);
    expect(evaluateFlag({ key: "a", enabled: true, rolloutPercent: 0 }, "u")).toBe(false);
    expect(evaluateFlag({ key: "a", enabled: true, rolloutPercent: 50 })).toBe(false);
  });

  it("buckets users deterministically within 0-99", () => {
    const b = rolloutBucket("flag", "user-1");
    expect(b).toBe(rolloutBucket("flag", "user-1"));
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(100);
    expect(evaluateFlag({ key: "flag", enabled: true, rolloutPercent: b + 1 }, "user-1")).toBe(true);
    expect(evaluateFlag({ key: "flag", enabled: true, rolloutPercent: b }, "user-1")).toBe(false);
  });

  it("fails closed when the database errors", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    expect(await isFeatureEnabled("a", "u")).toBe(false);
  });

  it("validates key and rollout before writing", async () => {
    await expect(upsertFeatureFlag({ key: "Bad Key", enabled: true, rolloutPercent: 10 }, "admin")).rejects.toThrow("Invalid flag key");
    await expect(upsertFeatureFlag({ key: "ok", enabled: true, rolloutPercent: 101 }, "admin")).rejects.toThrow("rolloutPercent");
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
