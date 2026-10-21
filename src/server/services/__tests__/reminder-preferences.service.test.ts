import { normalizePreferences, saveReminderPreferences, getReminderPreferences, DEFAULT_REMINDER_PREFERENCES } from "@/server/services/reminder-preferences.service";
import * as db from "@/lib/db";

jest.mock("@/lib/db");
const mockQuery = db.query as jest.MockedFunction<typeof db.query>;

beforeEach(() => jest.clearAllMocks());

describe("reminder-preferences.service", () => {
  it("sorts and de-duplicates lead times and channels", () => {
    expect(normalizePreferences({ enabled: true, leadHours: [2, 24, 2], channels: ["sms", "email", "sms"] })).toEqual({
      enabled: true,
      leadHours: [24, 2],
      channels: ["email", "sms"],
    });
  });

  it("rejects out-of-range values and empty enabled configs", () => {
    expect(() => normalizePreferences({ enabled: true, leadHours: [5], channels: ["email"] })).toThrow("leadHours");
    expect(() => normalizePreferences({ enabled: true, leadHours: [24], channels: ["push"] })).toThrow("channels");
    expect(() => normalizePreferences({ enabled: true, leadHours: [], channels: ["email"] })).toThrow("at least one");
  });

  it("allows disabling with empty selections", () => {
    expect(normalizePreferences({ enabled: false, leadHours: [], channels: [] }).enabled).toBe(false);
  });

  it("returns defaults when the user has no saved row", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    expect(await getReminderPreferences("u1")).toEqual(DEFAULT_REMINDER_PREFERENCES);
  });

  it("upserts normalised preferences", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    await saveReminderPreferences("u1", { enabled: true, leadHours: [2], channels: ["sms"] });
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("ON CONFLICT (user_id)"), ["u1", true, [2], ["sms"]]);
  });
});
