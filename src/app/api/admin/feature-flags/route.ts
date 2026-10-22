import { NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth, withErrorHandler } from "@/server/middleware";
import { listFeatureFlags, upsertFeatureFlag, type FeatureFlag } from "@/server/services/feature-flag.service";
import type { ApiResponse } from "@/types";

const schema = z.object({
  key: z.string().min(1).max(100).regex(/^[a-z0-9_.-]+$/, "key may only contain a-z, 0-9, _, . and -"),
  enabled: z.boolean(),
  rolloutPercent: z.number().int().min(0).max(100).default(100),
  description: z.string().max(500).optional(),
});

export const GET = withErrorHandler(
  withAdminAuth(async () => {
    const data = await listFeatureFlags();
    return NextResponse.json<ApiResponse<FeatureFlag[]>>({ success: true, data });
  })
);

export const PUT = withErrorHandler(
  withAdminAuth(async (req, ctx) => {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.errors[0].message }, { status: 400 });
    }
    const data = await upsertFeatureFlag(parsed.data, ctx.user.id);
    return NextResponse.json<ApiResponse<FeatureFlag>>({ success: true, data });
  })
);
