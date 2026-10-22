/**
 * Tests for src/lib/telemetry-redaction.ts (#106)
 */
import {
  redact,
  redactHeaders,
  redactSentryEvent,
  REDACTED,
} from "../telemetry-redaction";
import type { Event as SentryEvent } from "@sentry/core";

describe("redact()", () => {
  it("returns primitives unchanged when no pattern match", () => {
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });

  it("masks sensitive keys in plain objects", () => {
    const input = {
      userId: "u_123",
      email: "alice@example.com",
      password: "hunter2",
      token: "tok_abc",
      amount: 5000,
    };
    const out = redact(input) as any;
    expect(out.userId).toBe("u_123");
    expect(out.amount).toBe(5000);
    expect(out.email).toBe(REDACTED);
    expect(out.password).toBe(REDACTED);
    expect(out.token).toBe(REDACTED);
  });

  it("masks nested sensitive keys", () => {
    const input = {
      user: {
        name: "Alice",
        phone: "+2348012345678",
        meta: { bvn: "12345678901" },
      },
    };
    const out = redact(input) as any;
    expect(out.user.name).toBe(REDACTED);
    expect(out.user.phone).toBe(REDACTED);
    expect(out.user.meta.bvn).toBe(REDACTED);
  });

  it("masks items inside arrays", () => {
    const input = [{ token: "t1" }, { safe: "yes" }];
    const out = redact(input) as any[];
    expect(out[0].token).toBe(REDACTED);
    expect(out[1].safe).toBe("yes");
  });

  it("redacts Stellar secret keys embedded in strings", () => {
    const key = "SABC" + "A".repeat(52); // 56-char Stellar S-key
    const out = redact(key);
    expect(out).toBe(REDACTED);
  });

  it("redacts email addresses embedded in strings", () => {
    const out = redact("Contact us at support@example.com for help");
    expect(out as string).not.toContain("support@example.com");
    expect(out as string).toContain(REDACTED);
  });

  it("handles circular references without throwing", () => {
    const obj: any = { a: 1 };
    obj.self = obj;
    expect(() => redact(obj)).not.toThrow();
  });
});

describe("redactHeaders()", () => {
  it("strips authorization and cookie headers", () => {
    const out = redactHeaders({
      authorization: "Bearer tok",
      cookie: "session=abc",
      "content-type": "application/json",
    });
    expect(out["authorization"]).toBe(REDACTED);
    expect(out["cookie"]).toBe(REDACTED);
    expect(out["content-type"]).toBe("application/json");
  });
});

describe("redactSentryEvent()", () => {
  it("strips email and IP from user context", () => {
    const event: SentryEvent = {
      user: { id: "u_1", email: "bob@example.com", ip_address: "1.2.3.4" },
    };
    const out = redactSentryEvent(event)!;
    expect(out.user?.email).toBeUndefined();
    expect(out.user?.ip_address).toBeUndefined();
    expect(out.user?.id).toBe("u_1");
  });

  it("redacts sensitive fields from request body", () => {
    const event: SentryEvent = {
      request: { data: { phone: "+2348012345678", amount: 100 } },
    };
    const out = redactSentryEvent(event)!;
    expect((out.request?.data as any).phone).toBe(REDACTED);
    expect((out.request?.data as any).amount).toBe(100);
  });

  it("redacts sensitive headers", () => {
    const event: SentryEvent = {
      request: {
        headers: {
          authorization: "Bearer secret",
          "content-type": "application/json",
        },
      },
    };
    const out = redactSentryEvent(event)!;
    expect((out.request?.headers as any)["authorization"]).toBe(REDACTED);
    expect((out.request?.headers as any)["content-type"]).toBe("application/json");
  });

  it("redacts breadcrumb data", () => {
    const event: SentryEvent = {
      breadcrumbs: {
        values: [
          { type: "http", data: { token: "tok_secret" } },
          { type: "navigation", data: { from: "/login" } },
        ],
      },
    };
    const out = redactSentryEvent(event)!;
    expect(out.breadcrumbs!.values![0].data!["token"]).toBe(REDACTED);
    expect(out.breadcrumbs!.values![1].data!["from"]).toBe("/login");
  });
});
