import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextResponse } from "next/server";
import { revokeAllUserTokens } from "@/lib/refresh-tokens";
import { clearRefreshTokenCookie } from "@/lib/cookies";
import type { ApiResponse } from "@/types";

/**
 * POST /api/auth/logout
 * Invalidates the session server-side by revoking all refresh tokens.
 * Clears the refresh token cookie.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Not authenticated" },
      { status: 401 }
    );
  }

  const userId = (session.user as { id?: string }).id;
  if (!userId) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "User ID not found in session" },
      { status: 401 }
    );
  }

  // Revoke all refresh tokens for this user
  await revokeAllUserTokens(userId);

  // Clear the refresh token cookie
  const response = NextResponse.json<ApiResponse<{ message: string }>>(
    { success: true, data: { message: "Logged out successfully" } },
    { status: 200 }
  );

  clearRefreshTokenCookie(response);

  return response;
}
