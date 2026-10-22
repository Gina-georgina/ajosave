import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { toggleSmsNotifications } from "@/server/services/notification.service";
import { smsPreferencesSchema } from "@/types/schemas";
import { withSanitizedBody } from "@/server/middleware";
import type { ApiResponse } from "@/types";

export const POST = withSanitizedBody(async (req: NextRequest): Promise<NextResponse<ApiResponse<{ enabled: boolean }>>> => {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const parsed = smsPreferencesSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0].message },
        { status: 400 }
      );
    }

    const { enabled } = parsed.data;
    await toggleSmsNotifications(session.user.id, enabled);

    return NextResponse.json({ 
      success: true, 
      data: { enabled } 
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update SMS preferences";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
});

export const PATCH = POST;
