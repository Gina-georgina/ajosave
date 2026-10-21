import { NextRequest, NextResponse } from "next/server";
import { listTemplates } from "@/server/services/circle-template.service";
import { withErrorHandler, withRateLimit } from "@/server/middleware";
import type { ApiResponse } from "@/types";
import type { CircleTemplate } from "@/data/circleTemplates";

/**
 * GET /api/v1/circles/templates
 *
 * Returns the full list of circle templates. Each template carries the
 * `values` used to pre-populate the create-circle form; clients merge those
 * defaults with user input and submit the result to POST /api/v1/circles.
 */
export const GET = withRateLimit(
  withErrorHandler(async (_req: NextRequest) => {
    return NextResponse.json<ApiResponse<CircleTemplate[]>>({
      success: true,
      data: listTemplates(),
    });
  }),
  { limit: 60, windowMs: 60_000 }
);
