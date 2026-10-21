import { canViewDispute, getDisputeTimeline, recordDisputeEvent } from "@/server/services/dispute-timeline.service";
import * as db from "@/lib/db";

jest.mock("@/lib/db");
jest.mock("@/lib/logger", () => ({ __esModule: true, default: { error: jest.fn(), info: jest.fn() } }));
const mockQuery = db.query as jest.MockedFunction<typeof db.query>;

beforeEach(() => jest.clearAllMocks());

describe("dispute-timeline.service", () => {
  it("records an event with nullable actor and detail", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    await recordDisputeEvent("d1", "created");
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO dispute_events"), ["d1", "created", null, null]);
  });

  it("swallows write failures so the dispute action is not blocked", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    await expect(recordDisputeEvent("d1", "resolved", "admin", "done")).resolves.toBeUndefined();
  });

  it("returns events oldest first", async () => {
    const events = [{ id: "e1" }, { id: "e2" }];
    mockQuery.mockResolvedValueOnce({ rows: events } as any);
    expect(await getDisputeTimeline("d1")).toEqual(events);
    expect(String(mockQuery.mock.calls[0][0])).toContain("ORDER BY created_at ASC");
  });

  it("lets admins in without a query and checks membership for others", async () => {
    expect(await canViewDispute("d1", "u1", "admin")).toBe(true);
    expect(mockQuery).not.toHaveBeenCalled();
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    expect(await canViewDispute("d1", "u1", "member")).toBe(false);
    mockQuery.mockResolvedValueOnce({ rows: [{}] } as any);
    expect(await canViewDispute("d1", "u2", "member")).toBe(true);
  });
});
