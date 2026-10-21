import * as Sentry from "@sentry/nextjs";
import { redactSentryEvent } from "@/lib/telemetry-redaction";

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,
  // Strip PII / financial / operational data before every event is sent (#106)
  beforeSend: redactSentryEvent,
  // Never attach user IP addresses
  sendDefaultPii: false,
});
