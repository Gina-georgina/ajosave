import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { revokeAllUserTokens } from "@/lib/refresh-tokens";
import { withErrorHandler, withRateLimit } from "@/server/middleware";
import { clearRefreshTokenCookie } from "@/lib/cookies";
import type { ApiResponse } from "@/types";

/**
 * POST /api/v1/auth/logout
 * Invalidates the session server-side by revoking all refresh tokens.
 * Clears the refresh token cookie.
 */
export const POST = withRateLimit(
  withErrorHandler(async (_req: NextRequest) => {
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

    await revokeAllUserTokens(userId);

    const response = NextResponse.json<ApiResponse<{ message: string }>>(
      { success: true, data: { message: "Logged out successfully" } },
      { status: 200 }
    );

    clearRefreshTokenCookie(response);

    return response;
  }),
  { limit: 5, windowMs: 60_000 }
);
