import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  getCertificatesByUser,
  mintCertificate,
  deriveCertificateTokenId,
  buildVerificationUrl,
} from "@/server/services/certificate.service";
import { withErrorHandler, withRateLimit } from "@/server/middleware";
import type { ApiResponse } from "@/types";
import type { Certificate } from "@/server/services/certificate.service";

export const GET = withErrorHandler(async () => {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const userId = (session.user as { id: string }).id;

  // Resolve the user's Stellar public key from DB
  const { rows } = await query<{ stellar_public_key: string | null }>(
    "SELECT stellar_public_key FROM users WHERE id = $1",
    [userId]
  );
  const stellarKey = rows[0]?.stellar_public_key;
  if (!stellarKey) {
    return NextResponse.json<ApiResponse<Certificate[]>>({ success: true, data: [] });
  }

  const certificates = await getCertificatesByUser(stellarKey);
  return NextResponse.json<ApiResponse<Certificate[]>>({ success: true, data: certificates });
});

/**
 * POST /api/v1/users/me/certificates
 *
 * Mint a completion certificate for a circle the caller has finished.
 * Idempotent: an existing certificate with a confirmed on-chain transaction
 * is returned as-is; a row left behind by a previously failed mint is
 * completed in place.
 */
export const POST = withRateLimit(
  withErrorHandler(async (req: NextRequest) => {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const userId = (session.user as { id: string }).id;

    const body = (await req.json().catch(() => null)) as { circleId?: unknown } | null;
    const circleId = typeof body?.circleId === "string" ? body.circleId.trim() : "";
    if (!circleId) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "circleId is required" },
        { status: 400 }
      );
    }

    // The caller must be an active member of a completed circle.
    const membershipRes = await query<{
      circle_name: string;
      circle_status: string;
      contribution_usdc: string;
      has_received_payout: boolean;
      stellar_public_key: string | null;
    }>(
      `SELECT c.name AS circle_name, c.status AS circle_status, c.contribution_usdc,
              m.has_received_payout, u.stellar_public_key
         FROM members m
         JOIN circles c ON c.id = m.circle_id
         JOIN users u ON u.id = m.user_id
        WHERE m.circle_id = $1 AND m.user_id = $2
        LIMIT 1`,
      [circleId, userId]
    );

    if (membershipRes.rowCount === 0) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Not a member of this circle" },
        { status: 404 }
      );
    }

    const membership = membershipRes.rows[0];

    if (membership.circle_status !== "completed") {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Certificates are only issued after the circle completes" },
        { status: 409 }
      );
    }

    if (!membership.has_received_payout) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Certificate is available only after your payout" },
        { status: 409 }
      );
    }

    if (!membership.stellar_public_key) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Link a Stellar account before minting a certificate" },
        { status: 409 }
      );
    }

    const stellarKey = membership.stellar_public_key;

    // Idempotency: return an already-confirmed certificate unchanged.
    const existingRes = await query<{
      circle_id: string;
      circle_name: string;
      member_stellar_key: string;
      token_id: string;
      cycles_completed: number;
      total_saved_usdc: string;
      tx_hash: string;
      issued_at: Date;
    }>(
      `SELECT circle_id, circle_name, member_stellar_key, token_id,
              cycles_completed, total_saved_usdc, tx_hash, issued_at
         FROM certificates
        WHERE circle_id = $1 AND member_stellar_key = $2 AND tx_hash IS NOT NULL
        LIMIT 1`,
      [circleId, stellarKey]
    );

    if (existingRes.rowCount !== 0) {
      const row = existingRes.rows[0];
      return NextResponse.json<ApiResponse<Certificate>>({
        success: true,
        data: {
          circleId: row.circle_id,
          circleName: row.circle_name,
          memberAddress: row.member_stellar_key,
          tokenId: row.token_id,
          cyclesCompleted: row.cycles_completed,
          totalSavedUsdc: row.total_saved_usdc,
          txHash: row.tx_hash,
          verificationUrl: buildVerificationUrl(row.tx_hash),
          issuedAt: row.issued_at,
        },
      });
    }

    // Completion metrics: every member contributed every cycle.
    const countRes = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM members WHERE circle_id = $1`,
      [circleId]
    );
    const cyclesCompleted = parseInt(countRes.rows[0]?.count ?? "0", 10);
    const totalSavedUsdc = (
      parseFloat(membership.contribution_usdc) * cyclesCompleted
    ).toFixed(7);

    const result = await mintCertificate({
      memberStellarKey: stellarKey,
      circleId,
      circleName: membership.circle_name,
      cyclesCompleted,
      totalSavedUsdc,
    });

    if (!result.ok) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Certificate minting failed — try again shortly" },
        { status: 502 }
      );
    }

    const certificate: Certificate = {
      circleId,
      circleName: membership.circle_name,
      memberAddress: stellarKey,
      tokenId: deriveCertificateTokenId(stellarKey, circleId),
      cyclesCompleted,
      totalSavedUsdc,
      txHash: result.txHash ?? "",
      verificationUrl: buildVerificationUrl(result.txHash),
      issuedAt: new Date(),
    };

    return NextResponse.json<ApiResponse<Certificate>>(
      { success: true, data: certificate },
      { status: 201 }
    );
  }),
  { limit: 10, windowMs: 60_000 }
);
