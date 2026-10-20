/**
 * Admin: manual payout trigger for stuck circles
 *
 * POST /api/admin/circles/:id/payout
 *
 * Acceptance criteria (Issue #225):
 *   - Admin-only auth guard (403 for non-admins)
 *   - Validates that the circle is in a payable state before proceeding
 *   - Uses the same idempotent payout logic as the cron job
 *   - Audit log entry created with admin user ID, circle ID, and reason
 *   - Returns 409 if a payout is already in progress for the circle
 *   - Rate-limited to 1 call per circle per 10 s to prevent accidental double-trigger
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { adminGetPayoutRecipientKey } from "@/server/services/admin.service";
import { processCyclePayout } from "@/server/services/payout.service";
import { PayoutLockError } from "@/server/services/payout-lock";
import { logAuditAction } from "@/server/services/audit.service";
import { withAdminAuth, withErrorHandler, rateLimit } from "@/server/middleware";
import { query } from "@/lib/db";
import type { ApiResponse, Payout } from "@/types";

/** Per-circle rate limit: 1 call per 10 seconds (Issue #225). */
const PAYOUT_RATE_LIMIT = 1;
const PAYOUT_RATE_WINDOW_MS = 10_000;

export const POST = withErrorHandler(
  withAdminAuth(async (req: NextRequest, ctx: unknown) => {
    const { params } = ctx as { params: { id: string } };
    const circleId = params.id;

    const session = await getServerSession(authOptions);
    const actorId = (session!.user as { id: string }).id;

    // ── Rate limit: 1 call per circle per 10 s (Issue #225) ──────────────────
    const rlKey = `admin:payout:${circleId}`;
    const rl = await rateLimit(rlKey, PAYOUT_RATE_LIMIT, PAYOUT_RATE_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json<ApiResponse<never>>(
        {
          success: false,
          error: "Too many payout requests for this circle. Please wait 10 seconds before retrying.",
          code: "RATE_LIMITED",
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
          },
        }
      );
    }

    // ── Optional: admin-supplied reason for audit trail ───────────────────────
    let reason = "Manual admin payout trigger";
    try {
      const body = await req.clone().json() as { reason?: string };
      if (body.reason && typeof body.reason === "string") {
        reason = body.reason.slice(0, 500); // cap length
      }
    } catch {
      // body is optional — ignore parse errors
    }

    // ── Validate circle is in a payable state (Issue #225) ───────────────────
    const { rows: circleRows } = await query<{
      id: string;
      status: string;
      current_cycle: number;
      max_members: number;
      name: string;
    }>(
      `SELECT id, status, current_cycle, max_members, name
       FROM circles
       WHERE id = $1`,
      [circleId]
    );

    if (!circleRows[0]) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Circle not found" },
        { status: 404 }
      );
    }

    const circle = circleRows[0];

    if (circle.status !== "active") {
      return NextResponse.json<ApiResponse<never>>(
        {
          success: false,
          error: `Circle is not in a payable state (status: '${circle.status}'). Only active circles can receive a payout.`,
          code: "NOT_PAYABLE",
        },
        { status: 409 }
      );
    }

    if (circle.current_cycle < 1 || circle.current_cycle > circle.max_members) {
      return NextResponse.json<ApiResponse<never>>(
        {
          success: false,
          error: `Circle cycle ${circle.current_cycle} is out of range [1, ${circle.max_members}].`,
          code: "NOT_PAYABLE",
        },
        { status: 409 }
      );
    }

    // ── Retrieve next payout recipient ────────────────────────────────────────
    const recipient = await adminGetPayoutRecipientKey(circleId);
    if (!recipient) {
      return NextResponse.json<ApiResponse<never>>(
        {
          success: false,
          error:
            "Cannot trigger payout: the next recipient has no Stellar key on file, or the circle has no eligible member at the current cycle position.",
          code: "NO_RECIPIENT",
        },
        { status: 409 }
      );
    }

    // ── Process payout (uses same idempotent logic as cron — Issue #225) ──────
    let payout: Payout;
    try {
      payout = await processCyclePayout(circleId, recipient.stellarPublicKey);
    } catch (err) {
      // 409 if a payout is already in progress (Issue #225)
      if (err instanceof PayoutLockError) {
        return NextResponse.json<ApiResponse<never>>(
          {
            success: false,
            error: "A payout is already in progress for this circle. Please wait for it to complete.",
            code: "PAYOUT_IN_PROGRESS",
          },
          { status: 409 }
        );
      }
      throw err; // let withErrorHandler produce a 500
    }

    // ── Audit log: admin user ID, circle ID, and reason (Issue #225) ─────────
    await logAuditAction(actorId, "FORCED_PAYOUT", "PAYOUT", payout.id, {
      details: {
        circleId,
        circleName: circle.name,
        cycleNumber: recipient.cycleNumber,
        recipientName: recipient.recipientName,
        amountUsdc: payout.amountUsdc,
        txHash: payout.txHash,
        reason,
        trigger: "admin_manual",
      },
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });

    return NextResponse.json<ApiResponse<Payout>>({ success: true, data: payout }, { status: 200 });
  })
);
