import { NextRequest, NextResponse } from "next/server";
import { withAdminAuth, withErrorHandler } from "@/server/middleware";
import { getDeadLetterEvents } from "@/lib/outbox";

export const GET = withErrorHandler(
  withAdminAuth(async (req: NextRequest) => {
    const rawLimit = Number(req.nextUrl.searchParams.get("limit") ?? 50);
    const rawOffset = Number(req.nextUrl.searchParams.get("offset") ?? 0);
    const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 1000) : 50;
    const offset = Number.isInteger(rawOffset) ? Math.max(rawOffset, 0) : 0;
    const events = await getDeadLetterEvents(limit, offset);
    return NextResponse.json({ success: true, data: events });
  })
);
