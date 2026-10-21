import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler } from "@/server/middleware";
import { verifyRefreshToken, revokeRefreshToken, generateRefreshToken, getTokenExpiries } from "@/lib/refresh-tokens";
import { query } from "@/lib/db";
import { SignJWT } from "jose";
import { serverConfig } from "@/server/config";
import type { ApiResponse } from "@/types";
import { setRefreshTokenCookie } from "@/lib/cookies";

const SECRET = new TextEncoder().encode(serverConfig.authSecret);

/**
 * POST /api/auth/refresh
 * Exchanges a refresh token for a new access token and refresh token.
 * 
 * Request body:
 * {
 *   "refreshToken": "token_string"
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "accessToken": "new_jwt_token",
 *     "refreshToken": "new_refresh_token",
 *     "expiresIn": 900
 *   }
 * }
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  try {
    const body = await req.json();
    const refreshToken = body.refreshToken as string;

    if (!refreshToken) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Refresh token is required" },
        { status: 400 }
      );
    }

    // Verify the refresh token and get the user ID
    const userId = await verifyRefreshToken(refreshToken);
    if (!userId) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Invalid or expired refresh token" },
        { status: 401 }
      );
    }

    // Get user details
    const userResult = await query<{ id: string; phone: string; display_name: string; role: string }>(
      "SELECT id, phone, display_name, role FROM users WHERE id = $1",
      [userId]
    );

    const user = userResult.rows[0];
    if (!user) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "User not found" },
        { status: 401 }
      );
    }

    // Revoke the old refresh token
    await revokeRefreshToken(refreshToken);

    // Generate new refresh token
    const newRefreshToken = await generateRefreshToken(userId);

    // Get token expiries
    const expiries = getTokenExpiries();

    // Create new JWT access token
    const now = Math.floor(Date.now() / 1000);
    const accessToken = await new SignJWT({
      id: user.id,
      phone: user.phone,
      role: user.role,
      accessTokenExpires: expiries.accessTokenExpires,
      refreshTokenExpires: expiries.refreshTokenExpires,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(now)
      .setExpirationTime(now + 15 * 60) // 15 minutes
      .sign(SECRET);

    // Create response with httpOnly cookie for refresh token
    const response = NextResponse.json<ApiResponse<{
      accessToken: string;
      expiresIn: number;
    }>>(
      {
        success: true,
        data: {
          accessToken,
          expiresIn: 15 * 60, // 15 minutes in seconds
        },
      },
      { status: 200 }
    );

    // Set refresh token in httpOnly cookie
    setRefreshTokenCookie(response, newRefreshToken);

    return response;
  } catch (error) {
    console.error("[refresh] Error:", error);
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Failed to refresh token" },
      { status: 500 }
    );
  }
});
