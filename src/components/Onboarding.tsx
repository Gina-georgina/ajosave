"use client";

/**
 * Onboarding Tour — Issue #210
 *
 * A 4-step tooltip-based overlay for first-time users covering:
 *   1. Link wallet
 *   2. Browse circles
 *   3. Join a circle
 *   4. Make first contribution
 *
 * Behaviour:
 * - Shown only when localStorage flag "ajosave:onboarding_complete" is absent.
 * - Each step highlights the relevant UI element via a configurable selector.
 * - Users can skip at any step; completion persists the flag so it never re-shows.
 * - Fully keyboard-accessible (focus-trapped, Escape to skip).
 * - Respects prefers-reduced-motion (transitions disabled).
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import styles from "./Onboarding.module.css";

// ─── Constants ────────────────────────────────────────────────────────────────

const COMPLETE_KEY = "ajosave:onboarding_complete";

// ─── Step definitions ─────────────────────────────────────────────────────────

interface OnboardingStep {
  /** Heading shown in the tooltip card */
  title: string;
  /** Body text shown in the tooltip card */
  description: string;
  /**
   * CSS selector of the page element to highlight.
   * If the element is not found the tooltip is centred on screen.
   */
  targetSelector: string;
  /** Accessible label for the highlighted region */
  targetLabel: string;
}

const STEPS: OnboardingStep[] = [
  {
    title: "1 of 4 — Link your wallet",
    description:
      "Connect your Stellar (Freighter) wallet so payouts land directly in your account.",
    targetSelector: '[data-onboarding="wallet"]',
    targetLabel: "Wallet section",
  },
  {
    title: "2 of 4 — Browse circles",
    description:
      "Explore open savings circles and find one that fits your budget and schedule.",
    targetSelector: '[data-onboarding="browse-circles"]',
    targetLabel: "Browse circles link",
  },
  {
    title: "3 of 4 — Join a circle",
    description:
      'Click "Join Circle" on any open circle to reserve your spot in the rotation.',
    targetSelector: '[data-onboarding="join-circle"]',
    targetLabel: "Join circle button",
  },
  {
    title: "4 of 4 — Make your first contribution",
    description:
      "When your circle starts, contribute your share via Paystack to keep the cycle going.",
    targetSelector: '[data-onboarding="contribute"]',
    targetLabel: "Contribute button",
  },
];

const TOTAL = STEPS.length;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function getTargetRect(selector: string): TargetRect | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  /** Called after the tour completes or is skipped. */
  onDone?: () => void;
}

export function Onboarding({ onDone }: Props) {
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const reduceMotion = prefersReducedMotion();

  // ── Measure target element position ──────────────────────────────────────
  const measureTarget = useCallback(() => {
    const rect = getTargetRect(STEPS[step].targetSelector);
    setTargetRect(rect);
  }, [step]);

  useLayoutEffect(() => {
    measureTarget();
  }, [measureTarget]);

  useEffect(() => {
    window.addEventListener("resize", measureTarget);
    return () => window.removeEventListener("resize", measureTarget);
  }, [measureTarget]);

  // ── Focus management: move focus into dialog on step change ──────────────
  useEffect(() => {
    closeBtnRef.current?.focus();
  }, [step]);

  // ── Trap focus inside the dialog ─────────────────────────────────────────
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleSkip();
        return;
      }
      if (e.key !== "Tab") return;

      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ──────────────────────────────────────────────────────────────
  const persist = useCallback(() => {
    try {
      localStorage.setItem(COMPLETE_KEY, "true");
    } catch {
      /* storage unavailable — gracefully ignore */
    }
  }, []);

  const handleSkip = useCallback(() => {
    onDone?.();
  }, [onDone]);

  const handleComplete = useCallback(() => {
    persist();
    onDone?.();
  }, [persist, onDone]);

  const handleNext = useCallback(() => {
    if (step < TOTAL - 1) {
      setStep((s) => s + 1);
    } else {
      handleComplete();
    }
  }, [step, handleComplete]);

  const handleBack = useCallback(() => {
    setStep((s) => Math.max(0, s - 1));
  }, []);

  // ── Spotlight position ────────────────────────────────────────────────────
  const spotlightStyle = targetRect
    ? ({
        "--spot-top": `${targetRect.top + window.scrollY}px`,
        "--spot-left": `${targetRect.left}px`,
        "--spot-w": `${targetRect.width}px`,
        "--spot-h": `${targetRect.height}px`,
      } as React.CSSProperties)
    : undefined;

  const currentStep = STEPS[step];

  return (
    <>
      {/* Semi-transparent backdrop with spotlight cutout */}
      <div
        className={styles.backdrop}
        aria-hidden="true"
        style={spotlightStyle}
        data-has-target={!!targetRect}
        data-reduced-motion={reduceMotion || undefined}
      />

      {/* Spotlight highlight ring */}
      {targetRect && (
        <div
          className={styles.spotlight}
          aria-hidden="true"
          style={spotlightStyle}
          data-reduced-motion={reduceMotion || undefined}
        />
      )}

      {/* Tooltip dialog */}
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={`Onboarding tour — ${currentStep.title}`}
        data-reduced-motion={reduceMotion || undefined}
      >
        {/* Progress indicator */}
        <div className={styles.progress} aria-hidden="true">
          {Array.from({ length: TOTAL }).map((_, i) => (
            <span
              key={i}
              className={`${styles.dot} ${i === step ? styles.dotActive : ""} ${i < step ? styles.dotDone : ""}`}
            />
          ))}
        </div>

        {/* Visually-hidden progress for screen readers */}
        <p className="sr-only">
          Step {step + 1} of {TOTAL}
        </p>

        {/* Content */}
        <h2 className={styles.heading}>{currentStep.title}</h2>
        <p className={styles.body}>{currentStep.description}</p>

        {/* Controls */}
        <div className={styles.controls}>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={handleSkip}
            ref={closeBtnRef}
            aria-label="Skip onboarding tour"
          >
            Skip tour
          </button>

          <div className={styles.navButtons}>
            {step > 0 && (
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={handleBack}
                aria-label="Go to previous step"
              >
                Back
              </button>
            )}
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={handleNext}
              aria-label={step < TOTAL - 1 ? "Go to next step" : "Finish onboarding tour"}
            >
              {step < TOTAL - 1 ? "Next" : "Done"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Gate component ───────────────────────────────────────────────────────────

/**
 * Renders the Onboarding tour only on the user's first visit.
 * Checks localStorage for the completion flag before mounting the overlay.
 * Safe to render on any page — it's a no-op after the tour is complete.
 */
export function OnboardingGate() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(COMPLETE_KEY)) {
        setShow(true);
      }
    } catch {
      /* Private browsing / storage unavailable */
    }
  }, []);

  if (!show) return null;
  return <Onboarding onDone={() => setShow(false)} />;
}
