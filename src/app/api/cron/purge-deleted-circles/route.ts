import { NextRequest, NextResponse } from "next/server";
import { hardDeleteExpiredCircles } from "@/server/services/circle.service";
import { serverConfig } from "@/server/config";
import type { ApiResponse } from "@/types";

/**
 * GET /api/cron/purge-deleted-circles
 *
 * Hard-deletes circle rows whose deleted_at timestamp is older than the
 * configurable retention window (default 90 days).
 *
 * This endpoint enforces the soft-delete retention policy described in
 * issue #219. It should be scheduled as a daily cron job.
 *
 * Requires a valid CRON_SECRET Bearer token.
 *
 * Query params:
 *   retentionDays  (optional, default 90) — override the retention window.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const cronSecret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!cronSecret || cronSecret !== serverConfig.cronSecret) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(req.url);
  const rawDays = searchParams.get("retentionDays");
  const retentionDays =
    rawDays && Number.isFinite(parseInt(rawDays, 10)) && parseInt(rawDays, 10) > 0
      ? parseInt(rawDays, 10)
      : 90;

  try {
    const purgedCount = await hardDeleteExpiredCircles(retentionDays);
    return NextResponse.json<ApiResponse<{ purgedCount: number; retentionDays: number }>>(
      { success: true, data: { purgedCount, retentionDays } },
      { status: 200 }
    );
  } catch (error) {
    console.error("[purge-deleted-circles] Error:", error);
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Failed to purge deleted circles" },
      { status: 500 }
    );
  }
}
