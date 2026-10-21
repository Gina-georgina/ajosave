import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, withErrorHandler } from "@/server/middleware";
import {
  ALLOWED_CHANNELS,
  ALLOWED_LEAD_HOURS,
  getReminderPreferences,
  saveReminderPreferences,
  type ReminderPreferences,
} from "@/server/services/reminder-preferences.service";
import type { ApiResponse } from "@/types";

const schema = z.object({
  enabled: z.boolean(),
  leadHours: z.array(z.union([z.literal(ALLOWED_LEAD_HOURS[0]), z.literal(ALLOWED_LEAD_HOURS[1])])),
  channels: z.array(z.enum(ALLOWED_CHANNELS)),
});

export const GET = withErrorHandler(
  withAuth(async (_req, ctx) => {
    const data = await getReminderPreferences(ctx.user.id);
    return NextResponse.json<ApiResponse<ReminderPreferences>>({ success: true, data });
  })
);

const updatePreferences = withErrorHandler(
  withAuth(async (req, ctx) => {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.errors[0].message }, { status: 400 });
    }
    try {
      const data = await saveReminderPreferences(ctx.user.id, parsed.data);
      return NextResponse.json<ApiResponse<ReminderPreferences>>({ success: true, data });
    } catch (err) {
      return NextResponse.json({ success: false, error: (err as Error).message }, { status: 400 });
    }
  })
);

export const PUT = updatePreferences;
export const PATCH = updatePreferences;
