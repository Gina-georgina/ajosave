import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { withErrorHandler } from "@/server/middleware";
import { getThreadReplies } from "@/server/services/chat.service";
import type { ApiResponse, CircleMessage } from "@/types";

type RouteCtx = { params: { id: string; messageId: string } };

/**
 * GET /api/circles/[id]/chat/[messageId]/thread
 *
 * Returns all replies for a top-level message (one level deep only).
 * Response includes the parent message's reaction counts on each reply.
 */
export const GET = withErrorHandler(async (_req: NextRequest, ctx: unknown) => {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { params } = ctx as RouteCtx;
  const { id: circleId, messageId } = params;
  const userId = (session.user as { id: string }).id;

  // Must be an active member to read threads
  const { rows: memberRows } = await query<{ id: string }>(
    `SELECT id FROM members WHERE circle_id = $1 AND user_id = $2 AND status = 'active'`,
    [circleId, userId]
  );
  if (memberRows.length === 0) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Forbidden" },
      { status: 403 }
    );
  }

  const replies = await getThreadReplies(circleId, messageId, userId);

  return NextResponse.json<ApiResponse<CircleMessage[]>>(
    { success: true, data: replies },
    { status: 200 }
  );
});
