"use client";

/**
 * Searchable FAQ component — Issue #216
 *
 * Features:
 *  - Debounced (200 ms) real-time search across question + answer text
 *  - Matching keywords highlighted inside question and answer
 *  - Non-matching items hidden via aria-hidden (not removed from DOM)
 *  - Empty state message when no items match
 *  - ?q= URL search param allows linking to a pre-filtered view
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "./FaqSearch.module.css";

// ─── Data types ────────────────────────────────────────────────────────────────

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

export interface FaqSection {
  id: string;
  title: string;
  items: FaqItem[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Wraps every occurrence of `query` in `text` with a <mark> element.
 * Returns an array of strings/elements suitable for React rendering.
 */
function highlight(text: string, query: string): React.ReactNode[] {
  if (!query.trim()) return [text];
  const regex = new RegExp(`(${escapeRegex(query.trim())})`, "gi");
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className={styles.highlight}>
        {part}
      </mark>
    ) : (
      part
    )
  );
}

function normalize(str: string): string {
  return str.toLowerCase();
}

// ─── Component ─────────────────────────────────────────────────────────────────

interface Props {
  sections: FaqSection[];
}

export default function FaqSearch({ sections }: Props) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialQuery = searchParams.get("q") ?? "";

  const [inputValue, setInputValue] = useState<string>(initialQuery);
  const [query, setQuery] = useState<string>(initialQuery);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync URL param when query changes
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (query.trim()) {
      params.set("q", query.trim());
    } else {
      params.delete("q");
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setInputValue(val);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        setQuery(val);
      }, 200);
    },
    []
  );

  const normalizedQuery = normalize(query.trim());

  // Determine which items match
  const matchingIds = useMemo<Set<string>>(() => {
    if (!normalizedQuery) return new Set(); // empty = show all
    const set = new Set<string>();
    for (const section of sections) {
      for (const item of section.items) {
        if (
          normalize(item.question).includes(normalizedQuery) ||
          normalize(item.answer).includes(normalizedQuery)
        ) {
          set.add(item.id);
        }
      }
    }
    return set;
  }, [normalizedQuery, sections]);

  const hasQuery = normalizedQuery.length > 0;
  const totalMatches = hasQuery ? matchingIds.size : null;

  return (
    <div>
      {/* ── Search input ── */}
      <div className={styles.searchWrapper} role="search">
        <label htmlFor="faq-search" className={styles.searchLabel}>
          Search FAQ
        </label>
        <input
          id="faq-search"
          type="search"
          className={styles.searchInput}
          placeholder="Search questions…"
          value={inputValue}
          onChange={handleInput}
          aria-label="Search FAQ questions"
          aria-controls="faq-results"
          autoComplete="off"
          spellCheck={false}
        />
        {hasQuery && (
          <p className={styles.resultCount} aria-live="polite" aria-atomic="true">
            {totalMatches === 0
              ? "No results — contact support"
              : `${totalMatches} result${totalMatches !== 1 ? "s" : ""} found`}
          </p>
        )}
      </div>

      {/* ── Empty state ── */}
      {hasQuery && totalMatches === 0 && (
        <div className={styles.emptyState} role="status">
          <p>
            No results for &ldquo;<strong>{query}</strong>&rdquo; — contact{" "}
            <a href="mailto:support@ajosave.app" className={styles.link}>
              support@ajosave.app
            </a>
          </p>
        </div>
      )}

      {/* ── FAQ sections ── */}
      <div id="faq-results">
        {sections.map((section) => {
          // When filtering, hide section if none of its items match
          const visibleItemCount = hasQuery
            ? section.items.filter((i) => matchingIds.has(i.id)).length
            : section.items.length;

          return (
            <section
              key={section.id}
              className={styles.section}
              aria-hidden={hasQuery && visibleItemCount === 0 ? "true" : undefined}
            >
              <h2 className={styles.sectionTitle}>{section.title}</h2>

              {section.items.map((item) => {
                const isVisible = !hasQuery || matchingIds.has(item.id);
                return (
                  <div
                    key={item.id}
                    className={styles.faqItem}
                    aria-hidden={!isVisible ? "true" : undefined}
                  >
                    <h3 className={styles.question}>
                      {highlight(item.question, query)}
                    </h3>
                    <p className={styles.answer}>
                      {highlight(item.answer, query)}
                    </p>
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
