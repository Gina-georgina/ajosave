import { resolveConsent, setConsent, DEFAULT_CONSENT } from "@/server/services/analytics-consent.service";
import * as db from "@/lib/db";

jest.mock("@/lib/db");
const mockQuery = db.query as jest.MockedFunction<typeof db.query>;

beforeEach(() => jest.clearAllMocks());

describe("analytics-consent.service", () => {
  it("defaults to essential-only", () => {
    expect(resolveConsent([])).toEqual(DEFAULT_CONSENT);
  });

  it("applies stored rows, ignores unknown categories and keeps essential granted", () => {
    expect(
      resolveConsent([
        { category: "performance", granted: true },
        { category: "essential", granted: false },
        { category: "ads", granted: true },
      ])
    ).toEqual({ essential: true, performance: true, marketing: false });
  });

  it("refuses to revoke essential consent without touching the database", async () => {
    await expect(setConsent("u1", { essential: false })).rejects.toThrow("Essential");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("writes only the categories provided", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);
    await setConsent("u1", { marketing: true });
    const writes = mockQuery.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO analytics_consents"));
    expect(writes).toHaveLength(1);
    expect(writes[0][1]).toEqual(["u1", "marketing", true]);
  });
});
