import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, withErrorHandler } from "@/server/middleware";
import { canViewDispute, getDisputeTimeline, type DisputeEvent } from "@/server/services/dispute-timeline.service";
import type { ApiResponse } from "@/types";

export const GET = withErrorHandler(
  withAuth(async (_req, ctx) => {
    const id = z.string().uuid().safeParse(ctx.params?.id);
    if (!id.success) {
      return NextResponse.json({ success: false, error: "Invalid dispute id" }, { status: 400 });
    }
    if (!(await canViewDispute(id.data, ctx.user.id, ctx.user.role))) {
      return NextResponse.json({ success: false, error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
    }
    const data = await getDisputeTimeline(id.data);
    return NextResponse.json<ApiResponse<DisputeEvent[]>>({ success: true, data });
  })
);
