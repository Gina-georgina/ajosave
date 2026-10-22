/**
 * Structured Query Logger — Issue #228
 *
 * Integrates the query-metrics module with structured JSON logging and
 * Sentry performance tracing so slow queries (> 500 ms) generate alerts.
 *
 * Every DB query emits a structured log entry with:
 *   - query hash (normalised SQL, no PII)
 *   - duration ms
 *   - table name
 *   - row count
 *
 * Queries exceeding the slow-query threshold are captured as Sentry
 * performance transactions.
 *
 * Env:
 *   DB_SLOW_QUERY_MS — threshold for slow-query alerts (default 500)
 */

import * as Sentry from "@sentry/nextjs";
import { recordQuery, slowQueryThresholdMs, getQueryStats, type QueryStat } from "./query-metrics";
import logger from "./logger";

/**
 * Extract table name from a SQL query (best-effort, first table referenced).
 */
function extractTable(sql: string): string | null {
  const match = sql.match(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([\w]+)/i);
  return match ? match[1] : null;
}

/**
 * Wrap a query function to emit structured logs and Sentry traces.
 */
export function withQueryLogging<T extends { text: string; params?: unknown[] }>(
  queryFn: (args: T) => Promise<{ rowCount: number; rows: unknown[] }>
) {
  return async (args: T): Promise<{ rowCount: number; rows: unknown[] }> => {
    const start = Date.now();
    let result: { rowCount: number; rows: unknown[] };

    try {
      result = await queryFn(args);
    } catch (err) {
      const durationMs = Date.now() - start;
      recordQuery(args.text, durationMs, true);
      logger.error(
        {
          queryHash: require("crypto").createHash("sha256").update(args.text).digest("hex").slice(0, 16),
          durationMs,
          table: extractTable(args.text),
          error: err instanceof Error ? err.message : String(err),
        },
        "[db] query error"
      );
      throw err;
    }

    const durationMs = Date.now() - start;
    const queryHash = require("crypto")
      .createHash("sha256")
      .update(args.text)
      .digest("hex")
      .slice(0, 16);
    const table = extractTable(args.text);

    // Record in metrics
    recordQuery(args.text, durationMs, false);

    // Emit structured log entry
    logger.info(
      {
        queryHash,
        durationMs,
        table,
        rowCount: result.rowCount,
      },
      "[db] query"
    );

    // Capture slow queries as Sentry performance transactions
    if (durationMs >= slowQueryThresholdMs()) {
      Sentry.startTransaction(
        {
          name: `slow_query:${table ?? "unknown"}`,
          op: "db.query",
          tags: {
            queryHash,
            table: table ?? "unknown",
            durationMs: durationMs.toString(),
          },
        },
        () => {
          Sentry.captureException(
            new Error(`Slow query (${durationMs}ms) on table ${table ?? "unknown"}`),
            {
              tags: { queryHash, table: table ?? "unknown", durationMs: durationMs.toString() },
              extra: { queryHash, durationMs, table, rowCount: result.rowCount },
            }
          );
        }
      );
    }

    return result;
  };
}

/**
 * Get top-N slowest queries for the admin metrics endpoint.
 */
export function getTopSlowQueries(limit = 10): QueryStat[] {
  return getQueryStats(limit);
}
