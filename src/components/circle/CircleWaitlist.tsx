"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import styles from "./CircleWaitlist.module.css";

interface Props {
  circleId: string;
  circleName: string;
  initialIsOnWaitlist: boolean;
  initialPosition: number | null;
}

/** Poll interval in milliseconds (30 s) for real-time position updates. */
const POLL_INTERVAL_MS = 30_000;

export function CircleWaitlist({
  circleId,
  circleName,
  initialIsOnWaitlist,
  initialPosition,
}: Props) {
  const router = useRouter();
  const [isOnWaitlist, setIsOnWaitlist] = useState(initialIsOnWaitlist);
  const [position, setPosition] = useState<number | null>(initialPosition);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const prevPositionRef = useRef<number | null>(initialPosition);

  // ─── Real-time position polling ───────────────────────────────────────────
  const pollPosition = useCallback(async () => {
    if (!isOnWaitlist) return;
    try {
      const res = await fetch(`/api/circles/${circleId}/waitlist`);
      if (!res.ok) return;
      const json = await res.json();
      if (!json.success) return;

      const newPos: number | null = json.data?.position ?? null;
      const wasOnWaitlist: boolean = json.data?.isOnWaitlist ?? false;

      if (!wasOnWaitlist) {
        // User was moved off the waitlist — a spot opened
        setIsOnWaitlist(false);
        setPosition(null);
        setNotification("🎉 A spot just opened! Refresh or join the circle now.");
        router.refresh();
        return;
      }

      if (newPos !== null && prevPositionRef.current !== null && newPos < prevPositionRef.current) {
        setNotification(`Your position moved up to #${newPos}!`);
      }
      if (newPos === 1 && prevPositionRef.current !== 1) {
        setNotification("🎉 You are now #1 on the waitlist — a spot may open soon!");
      }

      prevPositionRef.current = newPos;
      setPosition(newPos);
    } catch {
      // Silent: network hiccup; retry next interval
    }
  }, [circleId, isOnWaitlist, router]);

  useEffect(() => {
    if (!isOnWaitlist) return;
    const id = setInterval(pollPosition, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isOnWaitlist, pollPosition]);

  // ─── Actions ──────────────────────────────────────────────────────────────
  const handleJoin = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    setNotification(null);
    try {
      const res = await fetch(`/api/circles/${circleId}/waitlist`, {
        method: "POST",
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      const newPos: number = json.data.position;
      setIsOnWaitlist(true);
      setPosition(newPos);
      prevPositionRef.current = newPos;
      setSuccess(`You joined the waitlist! You are #${newPos} in the queue.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join waitlist");
    } finally {
      setLoading(false);
    }
  };

  const handleLeave = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    setNotification(null);
    try {
      const res = await fetch(`/api/circles/${circleId}/waitlist`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      setIsOnWaitlist(false);
      setPosition(null);
      prevPositionRef.current = null;
      setSuccess("You have left the waitlist.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to leave waitlist");
    } finally {
      setLoading(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className={styles.card} role="region" aria-label="Circle waitlist">
      <div className={styles.header}>
        <div className={styles.badge}>Circle Full</div>
        <h3 className={styles.title}>Circle Waitlist</h3>
      </div>

      <p className={styles.description}>
        <strong>{circleName}</strong> is currently at maximum capacity. Join the
        waitlist and you will be notified the moment a spot opens.
      </p>

      {isOnWaitlist && position !== null && (
        <div className={styles.statusBox} aria-live="polite">
          <div className={styles.positionIndicator}>
            <span className={styles.positionLabel}>Your Waitlist Position</span>
            <span
              className={styles.positionNumber}
              aria-label={`Position number ${position} on the waitlist`}
            >
              #{position}
            </span>
          </div>
          <p className={styles.statusHelp}>
            {position === 1
              ? "You are next in line — you will be notified as soon as a spot opens."
              : `You are #${position} in the queue. We will contact you the moment a spot becomes available in ${circleName}.`}
          </p>
          <p className={styles.statusHint}>Position updates automatically every 30 seconds.</p>
        </div>
      )}

      {notification && (
        <div className={styles.notification} role="status" aria-live="assertive">
          {notification}
        </div>
      )}
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      {success && (
        <div className={styles.success} role="status">
          {success}
        </div>
      )}

      <div className={styles.actions}>
        {isOnWaitlist ? (
          <Button
            variant="ghost"
            className="btn--full"
            onClick={handleLeave}
            loading={loading}
            disabled={loading}
            aria-label="Leave the waitlist for this circle"
          >
            Leave Waitlist
          </Button>
        ) : (
          <Button
            variant="accent"
            className="btn--full"
            onClick={handleJoin}
            loading={loading}
            disabled={loading}
            aria-label={`Join the waitlist for ${circleName}`}
          >
            Join Waitlist
          </Button>
        )}
      </div>
    </div>
  );
}
