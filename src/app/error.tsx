"use client";

import { useEffect, useId, useRef, useState } from "react";
import * as Sentry from "@sentry/nextjs";
import { Button } from "@/components/ui/Button";
import styles from "./error.module.css";

/**
 * Global error boundary component (Next.js App Router).
 *
 * Telemetry strategy:
 *  - Captures the error to Sentry with a rich set of contextual tags and
 *    extra metadata so on-call engineers can triage without needing to
 *    reproduce locally.
 *  - Tags are indexed by Sentry, making it easy to filter issues by page,
 *    component boundary level, and error digest.
 *  - Extra metadata (stack, digest, URL, viewport) is attached as
 *    non-indexed context for deeper investigation.
 *  - Each render of this boundary generates a stable `errorId` that is
 *    shown to the user — they can quote it in a support request and the
 *    ops team can look it up in Sentry.
 *  - Sentry's `withScope` is used to avoid polluting the global scope with
 *    boundary-specific tags that would bleed into other events.
 *
 * Edge cases handled:
 *  - Error object missing a `message` (non-Error rejections)
 *  - Missing `digest` (only set by Next.js for server-side errors)
 *  - Running in a non-browser environment (guards around `window` /
 *    `navigator` access)
 *  - Sentry SDK not initialised (calls are no-ops so the UI still renders)
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Stable ID for this particular boundary render, shown in the UI and
  // attached to the Sentry event for cross-referencing support tickets.
  const errorId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [errorReference, setErrorReference] = useState(errorId);
  const [isOnline, setIsOnline] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const [retryDelay, setRetryDelay] = useState<number | null>(null);
  const recovery = !isOnline ? "network" : classifyError(error);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    const updateOnlineStatus = () => setIsOnline(navigator.onLine);
    updateOnlineStatus();
    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);

    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
    };
  }, []);

  useEffect(() => {
    if (retryDelay === null) return;

    const timeout = window.setTimeout(() => {
      if (retryDelay <= 1) {
        setRetryDelay(null);
        reset();
      } else {
        setRetryDelay(retryDelay - 1);
      }
    }, 1000);

    return () => window.clearTimeout(timeout);
  }, [retryDelay, reset]);

  useEffect(() => {
    Sentry.withScope((scope) => {
      // ── Structured tags (indexed, filterable in Sentry) ─────────────────
      scope.setTag("boundary", "global");
      scope.setTag("error.type", error.name ?? "UnknownError");

      // Next.js server-side error digest — links client error to the
      // corresponding server-side log entry.
      if (error.digest) {
        scope.setTag("error.digest", error.digest);
      }

      // Runtime context
      if (typeof window !== "undefined") {
        scope.setTag("page.url", window.location.pathname);
        scope.setTag("page.search", window.location.search || "(none)");
      }

      // ── Extra context (non-indexed, shown in event detail) ───────────────
      scope.setExtra("errorId", errorId);
      scope.setExtra("errorMessage", error.message ?? "(no message)");
      scope.setExtra("errorStack", error.stack ?? "(no stack)");

      if (error.digest) {
        scope.setExtra("nextjsDigest", error.digest);
      }

      if (typeof window !== "undefined") {
        scope.setExtra("viewportWidth", window.innerWidth);
        scope.setExtra("viewportHeight", window.innerHeight);
        scope.setExtra("userAgent", navigator.userAgent);
        scope.setExtra("onLine", navigator.onLine);
        scope.setExtra("referrer", document.referrer || "(none)");
      }

      // ── Capture the event ────────────────────────────────────────────────
      const eventId = Sentry.captureException(error);
      setErrorReference(eventId ?? errorId);
    });
  }, [error, errorId]);

  return (
    <div className={styles.container}>
      <div className={styles.inner}>
        <h1 ref={headingRef} className={styles.title} tabIndex={-1}>
          {recovery === "session" ? "Your session has expired" : "Something went wrong"}
        </h1>
        <p className={styles.message}>{recoveryMessage(recovery)}</p>
        {/* Show the error ID so users can quote it in support requests */}
        <p className={styles.errorId} aria-label="Error reference ID">
          Reference ID: <code>{errorReference}</code>
        </p>
        <div className={styles.actions}>
          {recovery === "network" && (
            <Button
              onClick={() => {
                setRetryCount((count) => count + 1);
                setRetryDelay(Math.min(2 ** retryCount, 30));
              }}
              disabled={retryDelay !== null}
            >
              {retryDelay === null ? "Retry" : `Retrying in ${retryDelay}s`}
            </Button>
          )}
          {recovery === "session" && (
            <a className="btn btn--primary" href="/auth/login">
              Log in again
            </a>
          )}
          {recovery === "unknown" && (
            <>
              <a className="btn btn--primary" href="/">
                Go to homepage
              </a>
              <a
                className="btn btn--secondary"
                href={`mailto:support@ajosave.app?subject=Error%20${encodeURIComponent(errorReference)}`}
              >
                Contact support
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type Recovery = "session" | "network" | "unknown";

function classifyError(error: Error & { code?: string; digest?: string }): Recovery {
  const details = [error.name, error.code, error.digest, error.message]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/session.?expired|unauthenticated|jwt.?expired|token.?expired|auth_required/.test(details)) {
    return "session";
  }

  if (
    /network|failed to fetch|fetch failed|connection|offline|timed? ?out|aborterror/.test(details)
  ) {
    return "network";
  }

  return "unknown";
}

function recoveryMessage(recovery: Recovery): string {
  if (recovery === "session") {
    return "Please log in again to continue.";
  }
  if (recovery === "network") {
    return "Check your connection, then retry.";
  }
  return "You can return home or contact support with the reference ID below.";
}
