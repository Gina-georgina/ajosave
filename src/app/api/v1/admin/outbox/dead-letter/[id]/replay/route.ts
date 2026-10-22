import { NextRequest, NextResponse } from "next/server";
import { withAdminAuth, withErrorHandler } from "@/server/middleware";
import { replayDeadLetterEvent } from "@/lib/outbox";

export const POST = withErrorHandler(
  withAdminAuth(async (_req: NextRequest, { params }: { params: { id: string } }) => {
    const event = await replayDeadLetterEvent(params.id);
    if (!event) {
      return NextResponse.json({ success: false, error: "Dead-letter event not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: event });
  })
);
