import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, withErrorHandler } from "@/server/middleware";
import { getConsent, setConsent, type ConsentState } from "@/server/services/analytics-consent.service";
import type { ApiResponse } from "@/types";

const schema = z
  .object({ essential: z.boolean(), performance: z.boolean(), marketing: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Provide at least one category");

export const GET = withErrorHandler(
  withAuth(async (_req, ctx) => {
    const data = await getConsent(ctx.user.id);
    return NextResponse.json<ApiResponse<ConsentState>>({ success: true, data });
  })
);

export const PUT = withErrorHandler(
  withAuth(async (req, ctx) => {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.errors[0].message }, { status: 400 });
    }
    try {
      const data = await setConsent(ctx.user.id, parsed.data);
      return NextResponse.json<ApiResponse<ConsentState>>({ success: true, data });
    } catch (err) {
      return NextResponse.json({ success: false, error: (err as Error).message }, { status: 400 });
    }
  })
);
