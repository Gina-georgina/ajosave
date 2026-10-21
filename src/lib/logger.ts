import pino from "pino";
import { getCorrelationId } from "./correlation";
import { redact } from "./telemetry-redaction";

const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
type LogLevel = (typeof LOG_LEVELS)[number];

const base = pino(
  { level: process.env.LOG_LEVEL ?? "info" },
  process.env.NODE_ENV !== "production"
    ? pino.transport({ target: "pino-pretty", options: { colorize: true } })
    : undefined
);

/**
 * Proxy that:
 *  1. Injects the correlationId from AsyncLocalStorage on every log call.
 *  2. Redacts PII / financial / operational fields before they leave the process (#106).
 */
const logger = new Proxy(base, {
  get(target, prop) {
    const val = (target as any)[prop];
    if (typeof val !== "function") return val;
    if (!(LOG_LEVELS as readonly string[]).includes(prop as string)) {
      return val.bind(target);
    }
    return (...args: unknown[]) => {
      const correlationId = getCorrelationId();

      // pino log methods: (obj, msg, ...args) or (msg, ...args)
      if (args.length > 0 && typeof args[0] === "object" && args[0] !== null) {
        const obj = redact({ correlationId, ...(args[0] as object) }) as object;
        const rest = args.slice(1);
        return (val as Function).apply(target, [obj, ...rest]);
      } else {
        const obj = redact(correlationId ? { correlationId } : {}) as object;
        return (val as Function).apply(target, [obj, ...args]);
      }
    };
  },
});

export default logger;
