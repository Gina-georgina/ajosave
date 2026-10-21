"use client";

/**
 * CircleProgressBar
 *
 * Displays how far through a circle's rotation the group is.
 * Shows:
 *  - A labelled progress bar tracking completed cycles out of total
 *  - Step dots (one per cycle) coloured past / current / upcoming
 *  - An accessible text summary for screen-readers
 *
 * Acceptance criteria covered:
 *  ✓ Progress bar renders percentage of completed cycles
 *  ✓ Component is responsive (mobile and desktop)
 *  ✓ WCAG AA colour contrast (brand primary is #0f7a4a on white/elevated bg)
 *
 * Usage:
 *   <CircleProgressBar
 *     currentCycle={3}
 *     totalCycles={8}
 *     status="active"
 *   />
 */

import styles from "./CircleProgressBar.module.css";

export interface CircleProgressBarProps {
  /** 1-indexed current cycle (0 means the circle has not started). */
  currentCycle: number;
  /** Total number of cycles == total number of members. */
  totalCycles: number;
  /** Circle status — bar is full when "completed". */
  status?: "open" | "active" | "completed" | "cancelled";
}

export function CircleProgressBar({
  currentCycle,
  totalCycles,
  status,
}: CircleProgressBarProps) {
  if (totalCycles <= 0) return null;

  // Completed cycles: if the circle is done every cycle is complete; otherwise
  // the *current* cycle is in progress, so completed = currentCycle - 1.
  const completedCycles =
    status === "completed"
      ? totalCycles
      : Math.max(0, currentCycle - 1);

  const percent =
    status === "completed"
      ? 100
      : totalCycles > 0
      ? Math.round((completedCycles / totalCycles) * 100)
      : 0;

  // Only show step dots when the total is small enough to be readable
  const showDots = totalCycles <= 12;

  const cycleSummary =
    status === "completed"
      ? "All cycles completed"
      : currentCycle > 0
      ? `Cycle ${currentCycle} of ${totalCycles}`
      : "Not started";

  return (
    <div className={styles.container}>
      {/* ── Label row ──────────────────────────────────────────────────── */}
      <div className={styles.labelRow}>
        <span className={styles.label} id="cpb-label">
          Rotation Progress
        </span>
        <span className={styles.cycleText} aria-hidden="true">
          {cycleSummary}
        </span>
        <span className={styles.percentText} aria-hidden="true">
          {percent}%
        </span>
      </div>

      {/* ── Progress track ─────────────────────────────────────────────── */}
      <div
        className={styles.track}
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-labelledby="cpb-label"
        aria-label={`${cycleSummary} — ${percent}% complete`}
      >
        <div
          className={styles.fill}
          style={{ width: `${percent}%` }}
          data-testid="cpb-fill"
        />
        {/* Segment dividers */}
        {showDots && totalCycles > 1 && (
          <div className={styles.segmentMarkers} aria-hidden="true">
            {Array.from({ length: totalCycles }).map((_, i) => (
              <div key={i} className={styles.segment} />
            ))}
          </div>
        )}
      </div>

      {/* ── Step dots ──────────────────────────────────────────────────── */}
      {showDots && (
        <div className={styles.stepsRow} aria-hidden="true">
          {Array.from({ length: totalCycles }).map((_, i) => {
            const cycleNumber = i + 1; // 1-indexed
            const isDone =
              status === "completed" || cycleNumber < currentCycle;
            const isCurrent =
              status !== "completed" && cycleNumber === currentCycle;

            const dotClass = [
              styles.stepDot,
              isDone ? styles.dotDone : "",
              isCurrent ? styles.dotCurrent : "",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <div key={cycleNumber} className={styles.step}>
                <div className={dotClass} />
                <span className={styles.stepLabel}>{cycleNumber}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Screen-reader summary ───────────────────────────────────────── */}
      <span className="sr-only">
        {cycleSummary}. {completedCycles} of {totalCycles} payouts completed.
      </span>
    </div>
  );
}
