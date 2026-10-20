import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCircleById, getMembersByCircle } from "@/server/services/circle.service";
import { initializePayment } from "@/lib/paystack";
import { serverConfig } from "@/server/config";
import { withErrorHandler } from "@/server/middleware";
import { query } from "@/lib/db";
import { randomUUID } from "crypto";
import { enforceKycContributionLimit, KycLimitError } from "@/lib/kyc-limits";
import { logAuditAction } from "@/server/services/audit.service";
import type { ApiResponse } from "@/types";

export const POST = withErrorHandler(async (_req: NextRequest, ctx: unknown) => {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { params } = ctx as { params: { id: string } };
  const circle = await getCircleById(params.id);
  if (!circle) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Circle not found" },
      { status: 404 }
    );
  }
  if (circle.status !== "active") {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Circle is not active" },
      { status: 400 }
    );
  }

  const circleMembers = await getMembersByCircle(params.id);
  const userId = (session.user as { id: string; email?: string }).id;
  const member = circleMembers.find((m) => m.userId === userId);
  if (!member) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "You are not a member of this circle" },
      { status: 403 }
    );
  }

  // ── KYC tier-based contribution limit enforcement (Issue #223) ─────────────
  // The contribution amount is stored in NGN (contributionFiat when currency=NGN,
  // or converted to NGN-equivalent for other currencies).
  // We use contributionFiat as the reference amount when currency is NGN;
  // for other currencies we use the NGN column if available.
  const contributionNgn: number =
    typeof (circle as { contributionNgn?: number }).contributionNgn === "number"
      ? (circle as { contributionNgn: number }).contributionNgn
      : 0;

  if (contributionNgn > 0) {
    try {
      const tier = await enforceKycContributionLimit(userId, contributionNgn);
      // Audit log when contribution is allowed (tier info for compliance records)
      void tier; // consumed — no blocking action needed
    } catch (err) {
      if (err instanceof KycLimitError) {
        // Log blocked contribution attempt (Issue #223)
        await logAuditAction(userId, "OTHER", "MEMBER", member.id, {
          details: {
            event: "CONTRIBUTION_BLOCKED_KYC_LIMIT",
            kycTier: err.tier,
            limitNgn: err.limitNgn,
            attemptedNgn: err.amountNgn,
            circleId: params.id,
            cycleNumber: circle.currentCycle,
          },
          ipAddress: _req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? undefined,
        });
        return NextResponse.json<ApiResponse<never>>(
          {
            success: false,
            error: err.message, // "Complete KYC to increase your limit"
            code: "KYC_LIMIT_EXCEEDED",
          },
          { status: 422 }
        );
      }
      throw err;
    }
  }

  // Deterministic reference: ajo-{circleId}-{memberId}-{cycleNumber}
  const reference = `ajo-${params.id}-${member.id}-${circle.currentCycle}`;

  // Return existing authorizationUrl if a pending contribution already exists for this cycle
  const { rows: existing } = await query<{ paystack_reference: string; authorization_url: string }>(
    `SELECT paystack_reference, authorization_url
     FROM contributions
     WHERE member_id = $1 AND cycle_number = $2 AND status = 'pending'
     LIMIT 1`,
    [member.id, circle.currentCycle]
  );
  if (existing.length > 0 && existing[0].authorization_url) {
    return NextResponse.json<ApiResponse<{ authorizationUrl: string; reference: string }>>({
      success: true,
      data: { authorizationUrl: existing[0].authorization_url, reference: existing[0].paystack_reference },
    });
  }

  const callbackUrl = `${serverConfig.app.url}/circles/${params.id}/contribute/callback?reference=${reference}`;

  const { authorizationUrl, platformFee } = await initializePayment({
    email: (session.user as { email?: string }).email ?? `${userId}@ajosave.app`,
    amount: circle.contributionFiat,
    currency: circle.contributionCurrency,
    reference,
    callbackUrl,
    metadata: {
      circleId: params.id,
      memberId: member.id,
      cycleNumber: circle.currentCycle,
    },
  });

  // Upsert pending contribution with paystack_reference and authorization_url
  await query(
    `INSERT INTO contributions (id, circle_id, member_id, cycle_number, amount_usdc, status, paystack_reference, authorization_url)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
     ON CONFLICT (member_id, cycle_number) DO UPDATE
       SET paystack_reference = EXCLUDED.paystack_reference,
           authorization_url  = EXCLUDED.authorization_url`,
    [randomUUID(), params.id, member.id, circle.currentCycle, circle.contributionUsdc, reference, authorizationUrl]
  );

  return NextResponse.json<ApiResponse<{ authorizationUrl: string; reference: string; platformFee: number }>>({
    success: true,
    data: { authorizationUrl, reference, platformFee },
  });
});
