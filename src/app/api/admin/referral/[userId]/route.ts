/**
 * Admin: referral code management
 *
 * PATCH /api/admin/referral/:userId
 *   Activate or deactivate a referral code for the given user (Issue #227).
 *   Body: { active: boolean }
 *
 * Acceptance criteria (Issue #227):
 *   - Admin can deactivate a referral code via the admin API
 *   - 403 for non-admin callers
 *   - Audit log entry created with admin user ID
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { logAuditAction } from "@/server/services/audit.service";
import { withAdminAuth, withErrorHandler } from "@/server/middleware";
import { z } from "zod";
import type { ApiResponse } from "@/types";

const patchSchema = z.object({
  active: z.boolean({ required_error: "'active' (boolean) is required" }),
});

export const PATCH = withErrorHandler(
  withAdminAuth(async (req: NextRequest, ctx: unknown) => {
    const { params } = ctx as { params: { userId: string } };
    const session = await getServerSession(authOptions);
    const actorId = (session!.user as { id: string }).id;

    const body = await req.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: parsed.error.errors[0].message },
        { status: 400 }
      );
    }

    // Verify the target user exists
    const { rows: userRows } = await query<{
      id: string;
      referral_code: string | null;
      referral_code_active: boolean;
    }>(
      "SELECT id, referral_code, referral_code_active FROM users WHERE id = $1 AND deleted_at IS NULL",
      [params.userId]
    );

    if (!userRows[0]) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "User not found" },
        { status: 404 }
      );
    }

    if (!userRows[0].referral_code) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "This user does not have a referral code" },
        { status: 404 }
      );
    }

    const { active } = parsed.data;

    // Update the flag
    await query(
      "UPDATE users SET referral_code_active = $1 WHERE id = $2",
      [active, params.userId]
    );

    await logAuditAction(actorId, "OTHER", "USER", params.userId, {
      details: {
        event: active ? "REFERRAL_CODE_ACTIVATED" : "REFERRAL_CODE_DEACTIVATED",
        referralCode: userRows[0].referral_code,
        previousState: userRows[0].referral_code_active,
        newState: active,
      },
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });

    return NextResponse.json<ApiResponse<{ userId: string; referralCodeActive: boolean }>>({
      success: true,
      data: { userId: params.userId, referralCodeActive: active },
    });
  })
);
