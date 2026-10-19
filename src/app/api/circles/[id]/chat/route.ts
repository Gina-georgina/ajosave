import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { withErrorHandler, withRateLimit, withSanitizedBody } from "@/server/middleware";
import { getMessages, postMessage } from "@/server/services/chat.service";
import { broadcastChatMessage } from "@/server/websocket";
import type { ApiResponse, CircleMessage } from "@/types";

// ─── GET /api/circles/[id]/chat ───────────────────────────────────────────────

export const GET = withErrorHandler(async (req: NextRequest, ctx: unknown) => {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { params } = ctx as { params: { id: string } };
  const circleId = params.id;
  const userId = (session.user as { id: string }).id;

  // Verify the requesting user is an active member of this circle
  const { rows: memberRows } = await query<{ exists: boolean }>(
    `SELECT 1 FROM members WHERE circle_id = $1 AND user_id = $2 AND status = 'active'`,
    [circleId, userId]
  );
  if (memberRows.length === 0) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Forbidden" },
      { status: 403 }
    );
  }

  // Parse and validate `limit` query param (integer 1–100, default 50)
  const { searchParams } = new URL(req.url);
  const rawLimit = searchParams.get("limit");
  let limit = 50;
  if (rawLimit !== null) {
    const parsed = parseInt(rawLimit, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 100) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "limit must be an integer between 1 and 100" },
        { status: 400 }
      );
    }
    limit = parsed;
  }

  // Parse and validate `before` query param (must be valid ISO 8601 if provided)
  const rawBefore = searchParams.get("before");
  let before: string | undefined;
  if (rawBefore !== null) {
    if (!isNaN(Date.parse(rawBefore))) {
      before = rawBefore;
    } else {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "before must be a valid ISO 8601 timestamp" },
        { status: 400 }
      );
    }
  }

  const messages = await getMessages(circleId, { limit, before }, userId);

  return NextResponse.json<ApiResponse<CircleMessage[]>>(
    { success: true, data: messages },
    { status: 200 }
  );
});

// ─── POST /api/circles/[id]/chat ──────────────────────────────────────────────

export const POST = withErrorHandler(
  withRateLimit(
    withSanitizedBody(async (req: NextRequest, ctx: unknown) => {
      const session = await getServerSession(authOptions);
      if (!session?.user) {
        return NextResponse.json<ApiResponse<never>>(
          { success: false, error: "Unauthorized" },
          { status: 401 }
        );
      }

      const { params } = ctx as { params: { id: string } };
      const circleId = params.id;
      const userId = (session.user as { id: string }).id;

      // Verify the requesting user is an active member of this circle
      const { rows: memberRows } = await query<{ exists: boolean }>(
        `SELECT 1 FROM members WHERE circle_id = $1 AND user_id = $2 AND status = 'active'`,
        [circleId, userId]
      );
      if (memberRows.length === 0) {
        return NextResponse.json<ApiResponse<never>>(
          { success: false, error: "Forbidden" },
          { status: 403 }
        );
      }

      // Parse and validate request body
      const body = await req.json();
      const { content, parentMessageId } = body;

      if (!content || typeof content !== "string" || content.trim().length === 0) {
        return NextResponse.json<ApiResponse<never>>(
          { success: false, error: "content is required and must not be empty" },
          { status: 400 }
        );
      }

      if (content.length > 1000) {
        return NextResponse.json<ApiResponse<never>>(
          { success: false, error: "content must not exceed 1000 characters" },
          { status: 400 }
        );
      }

      const message = await postMessage(
        circleId,
        userId,
        content,
        typeof parentMessageId === "string" ? parentMessageId : undefined
      );

      // Fire-and-forget broadcast; a failed broadcast does not roll back the DB insert
      broadcastChatMessage(circleId, message);

      return NextResponse.json<ApiResponse<CircleMessage>>(
        { success: true, data: message },
        { status: 201 }
      );
    }),
    { limit: 30, windowMs: 60_000 }
  )
);
