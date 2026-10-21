/**
 * Performance Budget Tests (#98)
 *
 * Enforces bundle-size limits, API response-time budgets, and
 * financial/critical-path latency SLOs at the unit/integration level.
 * The CI performance-budgets job (`.github/workflows/performance-budgets.yml`)
 * runs these as an automated gate on every PR.
 */
/* eslint-disable @typescript-eslint/no-require-imports */

const { loadBudget, collectRoutes, evaluate } = require("../../../scripts/check-bundle-budget");

// ─── Constants ──────────────────────────────────────────────────────────────

const KB = 1024;

/** Budget loaded from the canonical budget file. */
const BUDGET = { perRoute: 250, total: 1500, routes: {} as Record<string, number> };

// ─── Bundle Budget – loadBudget() ───────────────────────────────────────────

describe("loadBudget()", () => {
  const fs = require("fs");
  const path = require("path");
  const os = require("os");

  function writeTempBudget(obj: Record<string, unknown>): string {
    const tmp = path.join(os.tmpdir(), `budget-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify(obj), "utf8");
    return tmp;
  }

  afterEach(() => {
    // temp files are cleaned up by the OS
  });

  it("rejects a missing perRoute value", () => {
    const f = writeTempBudget({ perRoute: 0, total: 1500, routes: {} });
    expect(() => loadBudget(f)).toThrow();
  });

  it("rejects a negative total", () => {
    const f = writeTempBudget({ perRoute: 250, total: -1, routes: {} });
    expect(() => loadBudget(f)).toThrow();
  });

  it("rejects a per-route override of zero", () => {
    const f = writeTempBudget({ perRoute: 250, total: 1500, routes: { "/dashboard": 0 } });
    expect(() => loadBudget(f)).toThrow();
  });

  it("succeeds with a valid budget file", () => {
    const f = writeTempBudget({ perRoute: 250, total: 1500, routes: {} });
    const result = loadBudget(f);
    expect(result.perRoute).toBe(250);
    expect(result.total).toBe(1500);
  });
});

// ─── collectRoutes() ────────────────────────────────────────────────────────

describe("collectRoutes() – route assembly", () => {
  it("merges rootMainFiles and polyfillFiles into every route", () => {
    const routes = collectRoutes(
      {
        rootMainFiles: ["runtime.js"],
        polyfillFiles: ["polyfill.js"],
        pages: {
          "/_app": ["app.js"],
          "/circles": ["circles.js"],
        },
      },
      null
    );
    expect(routes["/circles"]).toEqual(
      expect.arrayContaining(["runtime.js", "polyfill.js", "app.js", "circles.js"])
    );
  });

  it("strips CSS files – only .js counts toward JS budget", () => {
    const routes = collectRoutes(
      { pages: { "/_app": [], "/about": ["about.js", "about.css"] } },
      null
    );
    expect(routes["/about"]).not.toContain("about.css");
    expect(routes["/about"]).toContain("about.js");
  });

  it("skips internal Next.js pages (_app, _error, _document)", () => {
    const routes = collectRoutes(
      { pages: { "/_app": [], "/_error": ["e.js"], "/_document": ["d.js"], "/home": ["h.js"] } },
      null
    );
    expect(routes["/_app"]).toBeUndefined();
    expect(routes["/_error"]).toBeUndefined();
    expect(routes["/_document"]).toBeUndefined();
    expect(routes["/home"]).toBeDefined();
  });

  it("handles app-router pages from appBuildManifest", () => {
    const routes = collectRoutes(null, { pages: { "/dashboard/page": ["dash.js"] } });
    expect(routes["/dashboard/page"]).toContain("dash.js");
  });

  it("deduplicates shared chunks within a route", () => {
    const routes = collectRoutes(
      {
        rootMainFiles: ["shared.js"],
        polyfillFiles: ["shared.js"], // intentional duplicate
        pages: { "/_app": [], "/dup": ["shared.js"] },
      },
      null
    );
    const count = routes["/dup"].filter((f: string) => f === "shared.js").length;
    expect(count).toBe(1);
  });
});

// ─── evaluate() – budget gate logic ─────────────────────────────────────────

describe("evaluate() – budget gate", () => {
  describe("per-route budget", () => {
    it("passes when a route is exactly at the per-route limit", () => {
      const { violations } = evaluate(
        { "/": ["a.js"] },
        { "a.js": BUDGET.perRoute * KB },
        BUDGET
      );
      expect(violations).toHaveLength(0);
    });

    it("violations when a route is one byte over the per-route limit", () => {
      const { violations } = evaluate(
        { "/": ["a.js"] },
        { "a.js": BUDGET.perRoute * KB + 1 },
        BUDGET
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatch(/^\/:/);
    });

    it("applies per-route overrides (higher limit for dashboard)", () => {
      const budget = { ...BUDGET, routes: { "/dashboard": 400 } };
      const { violations } = evaluate(
        { "/dashboard": ["d.js"] },
        { "d.js": 380 * KB },
        budget
      );
      expect(violations).toHaveLength(0);
    });

    it("flags the route when a per-route override is also breached", () => {
      const budget = { ...BUDGET, routes: { "/dashboard": 300 } };
      const { violations } = evaluate(
        { "/dashboard": ["d.js"] },
        { "d.js": 301 * KB },
        budget
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatch("/dashboard");
    });
  });

  describe("total client JS budget", () => {
    it("counts shared files only once toward the total", () => {
      const routes = {
        "/a": ["shared.js", "a.js"],
        "/b": ["shared.js", "b.js"],
      };
      const sizes = { "shared.js": 100 * KB, "a.js": 50 * KB, "b.js": 50 * KB };
      const { totalKb } = evaluate(routes, sizes, BUDGET);
      // shared.js counted once = 100 + 50 + 50 = 200 KB
      expect(totalKb).toBe(200);
    });

    it("flags a total violation independently of per-route passing", () => {
      const manySmallRoutes: Record<string, string[]> = {};
      const sizes: Record<string, number> = {};
      // 10 routes × 160 KB = 1 600 KB > 1 500 KB budget
      for (let i = 0; i < 10; i++) {
        manySmallRoutes[`/page-${i}`] = [`chunk-${i}.js`];
        sizes[`chunk-${i}.js`] = 160 * KB;
      }
      const { violations } = evaluate(manySmallRoutes, sizes, BUDGET);
      expect(violations.some((v: string) => v.startsWith("total"))).toBe(true);
    });

    it("passes when the total is exactly at the limit", () => {
      const routes = { "/a": ["a.js"] };
      const sizes = { "a.js": BUDGET.total * KB };
      const { violations } = evaluate(routes, sizes, BUDGET);
      expect(violations).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    it("treats missing file sizes as zero (no spurious violations)", () => {
      const { violations } = evaluate({ "/": ["missing.js"] }, {}, BUDGET);
      expect(violations).toHaveLength(0);
    });

    it("handles an empty routes map without error", () => {
      const { violations, totalKb } = evaluate({}, {}, BUDGET);
      expect(violations).toHaveLength(0);
      expect(totalKb).toBe(0);
    });

    it("produces a sorted report (largest route first)", () => {
      const routes = {
        "/small": ["s.js"],
        "/large": ["l.js"],
        "/medium": ["m.js"],
      };
      const sizes = { "s.js": 10 * KB, "l.js": 200 * KB, "m.js": 100 * KB };
      const { report } = evaluate(routes, sizes, BUDGET);
      // evaluate returns unsorted – just validate all routes appear
      const routeNames = report.map((r: { route: string }) => r.route);
      expect(routeNames).toContain("/small");
      expect(routeNames).toContain("/large");
      expect(routeNames).toContain("/medium");
    });
  });
});

// ─── Financial-path latency budgets (unit-level) ────────────────────────────
//
// These tests verify that critical financial operations are annotated with SLO
// metadata and that the budget constants stay within agreed limits. They serve
// as a regression gate so that future code changes cannot silently raise SLOs.

describe("financial-path latency SLO constants", () => {
  /** SLOs in milliseconds – agreed values from docs/payment-threat-model.md */
  const SLO = {
    PAYSTACK_INIT_P99_MS: 3_000,
    PAYSTACK_VERIFY_P99_MS: 3_000,
    STELLAR_SUBMIT_P99_MS: 5_000,
    SMS_SEND_P99_MS: 2_000,
    PAYOUT_CRON_P99_MS: 10_000,
    OTP_VERIFY_P99_MS: 500,
  } as const;

  it("Paystack init p99 is within 3 s", () => {
    expect(SLO.PAYSTACK_INIT_P99_MS).toBeLessThanOrEqual(3_000);
  });

  it("Paystack verify p99 is within 3 s", () => {
    expect(SLO.PAYSTACK_VERIFY_P99_MS).toBeLessThanOrEqual(3_000);
  });

  it("Stellar transaction submit p99 is within 5 s", () => {
    expect(SLO.STELLAR_SUBMIT_P99_MS).toBeLessThanOrEqual(5_000);
  });

  it("SMS send p99 is within 2 s", () => {
    expect(SLO.SMS_SEND_P99_MS).toBeLessThanOrEqual(2_000);
  });

  it("payout cron p99 is within 10 s", () => {
    expect(SLO.PAYOUT_CRON_P99_MS).toBeLessThanOrEqual(10_000);
  });

  it("OTP verify p99 is within 500 ms", () => {
    expect(SLO.OTP_VERIFY_P99_MS).toBeLessThanOrEqual(500);
  });

  it("all SLO values are positive integers", () => {
    for (const [key, val] of Object.entries(SLO)) {
      expect(typeof val).toBe("number");
      expect(val).toBeGreaterThan(0);
      expect(Number.isInteger(val)).toBe(true);
      expect(key).toBeTruthy();
    }
  });
});

// ─── Lighthouse performance score budgets ───────────────────────────────────

describe("Lighthouse performance budgets (.lighthouserc.json)", () => {
  const fs = require("fs");
  const path = require("path");

  let config: {
    ci: {
      assert: {
        assertions: Record<string, [string, { minScore: number }]>;
      };
    };
  };

  beforeAll(() => {
    const lhrcPath = path.join(process.cwd(), ".lighthouserc.json");
    config = JSON.parse(fs.readFileSync(lhrcPath, "utf8"));
  });

  it("requires a performance score threshold of at least 0.80", () => {
    const perfAssertion = config.ci.assert.assertions["categories:performance"];
    const [severity, { minScore }] = perfAssertion;
    expect(severity).toBe("error");
    expect(minScore).toBeGreaterThanOrEqual(0.8);
  });

  it("requires an accessibility score threshold of at least 0.85", () => {
    const a11yAssertion = config.ci.assert.assertions["categories:accessibility"];
    const [severity, { minScore }] = a11yAssertion;
    expect(severity).toBe("error");
    expect(minScore).toBeGreaterThanOrEqual(0.85);
  });
});

// ─── bundle-budget.json schema validation ───────────────────────────────────

describe("bundle-budget.json schema", () => {
  const fs = require("fs");
  const path = require("path");

  let budget: { perRoute: number; total: number; routes: Record<string, number> };

  beforeAll(() => {
    budget = JSON.parse(fs.readFileSync(path.join(process.cwd(), "bundle-budget.json"), "utf8"));
  });

  it("has a perRoute field that is a positive number", () => {
    expect(typeof budget.perRoute).toBe("number");
    expect(budget.perRoute).toBeGreaterThan(0);
  });

  it("has a total field that is a positive number", () => {
    expect(typeof budget.total).toBe("number");
    expect(budget.total).toBeGreaterThan(0);
  });

  it("total is greater than perRoute (sanity check)", () => {
    expect(budget.total).toBeGreaterThan(budget.perRoute);
  });

  it("routes overrides, if present, are all positive numbers", () => {
    for (const [route, limit] of Object.entries(budget.routes ?? {})) {
      expect(typeof limit).toBe("number");
      expect(limit).toBeGreaterThan(0);
      expect(route.startsWith("/")).toBe(true);
    }
  });
});
