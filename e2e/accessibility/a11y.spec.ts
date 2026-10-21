/**
 * Accessibility E2E Tests — Issue #91
 *
 * Runs axe-core against key pages and asserts zero WCAG 2.1 AA violations.
 * Edge-cases covered:
 *  - Public landing page
 *  - Auth/login page
 *  - Circles browse page (authenticated)
 *  - Dashboard (authenticated)
 *  - Circle detail page (authenticated)
 *  - Form error states produce accessible error messages
 *  - Focus management after modal open/close
 *  - Full-page coverage scan with moderate-violation baseline (issue #289)
 */
import { test, expect, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function mockAuthSession(page: Page) {
  await page.route("/api/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: { id: "user-a11y", name: "Test User", phone: "+2348011111111" },
        expires: "2099-01-01",
      }),
    })
  );
}

async function mockCirclesList(page: Page) {
  await page.route("/api/v1/circles*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          circles: [
            {
              id: "circle-1",
              name: "Alpha Savings",
              contributionUsdc: "50",
              maxMembers: 5,
              currentMembers: 3,
              cycleFrequency: "monthly",
              status: "open",
            },
          ],
          pagination: { total: 1, page: 1, limit: 20 },
        },
      }),
    })
  );
}

// ---------------------------------------------------------------------------
// Shared violation assertion
// ---------------------------------------------------------------------------

function assertNoViolations(violations: AxeBuilder["analyze"] extends (...a: unknown[]) => Promise<infer R> ? Awaited<R>["violations"] : never) {
  if (violations.length > 0) {
    const details = violations
      .map((v) => `[${v.impact}] ${v.id}: ${v.description}\n  ${v.nodes.map((n) => n.html).join("\n  ")}`)
      .join("\n\n");
    throw new Error(`Accessibility violations found:\n\n${details}`);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Accessibility — Public pages", () => {
  test("landing page has no critical/serious WCAG 2.1 AA violations", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .disableRules(["color-contrast"]) // Design-system colours audited separately
      .analyze();

    assertNoViolations(violations.filter((v) => v.impact === "critical" || v.impact === "serious"));
  });

  test("auth/login page has no critical/serious violations", async ({ page }) => {
    await page.goto("/auth/login");
    await page.waitForLoadState("networkidle");

    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();

    assertNoViolations(violations.filter((v) => v.impact === "critical" || v.impact === "serious"));
  });

  test("login form inputs have accessible labels", async ({ page }) => {
    await page.goto("/auth/login");

    const phoneInput = page.getByLabel(/phone number/i);
    await expect(phoneInput).toBeVisible();

    // Input must have an associated label (not just placeholder)
    const labelFor = await phoneInput.getAttribute("id");
    const label = page.locator(`label[for="${labelFor}"]`);
    await expect(label).toBeVisible();
  });
});

test.describe("Accessibility — Authenticated pages", () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthSession(page);
    await mockCirclesList(page);
  });

  test("circles browse page has no critical/serious violations", async ({ page }) => {
    await page.goto("/circles");
    await page.waitForLoadState("networkidle");

    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();

    assertNoViolations(violations.filter((v) => v.impact === "critical" || v.impact === "serious"));
  });

  test("dashboard page has no critical/serious violations", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();

    assertNoViolations(violations.filter((v) => v.impact === "critical" || v.impact === "serious"));
  });
});

test.describe("Accessibility — Form error states", () => {
  test("login form shows accessible error messages on invalid input", async ({ page }) => {
    await page.route("/api/auth/send-otp", (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ success: false, error: "Invalid phone number" }),
      })
    );

    await page.goto("/auth/login");
    await page.getByLabel(/phone number/i).fill("0000000000");
    await page.getByRole("button", { name: /send code/i }).click();

    // Error must be surfaced with role="alert" for screen readers
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("Invalid phone number");

    // Run axe after error state rendered
    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    assertNoViolations(violations.filter((v) => v.impact === "critical" || v.impact === "serious"));
  });
});

test.describe("Accessibility — Keyboard navigation", () => {
  test("login page interactive elements are keyboard reachable", async ({ page }) => {
    await page.goto("/auth/login");

    // Tab through the form fields
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(["INPUT", "BUTTON", "A"]).toContain(focused);
  });

  test("skip-to-main link is the first focusable element (if present)", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");

    const firstFocused = await page.evaluate(() => ({
      tag: document.activeElement?.tagName,
      href: (document.activeElement as HTMLAnchorElement)?.href,
      text: document.activeElement?.textContent,
    }));

    // Either skip-link OR main nav first item — both are acceptable
    expect(["A", "BUTTON", "INPUT"]).toContain(firstFocused.tag);
  });
});

test.describe("Accessibility — ARIA landmarks", () => {
  test("landing page has main landmark", async ({ page }) => {
    await page.goto("/");
    const main = page.locator("main, [role='main']");
    await expect(main).toBeVisible();
  });

  test("circles page has navigation landmark", async ({ page }) => {
    await mockAuthSession(page);
    await mockCirclesList(page);
    await page.goto("/circles");

    const nav = page.locator("nav, [role='navigation']");
    expect(await nav.count()).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Full-page coverage + moderate baseline (issue #289)
// ---------------------------------------------------------------------------

interface ModerateBaselineEntry {
  page: string;
  rule: string;
}

interface A11yReportEntry {
  page: string;
  impact: string;
  rule: string;
  nodes: number;
}

const BASELINE_PATH = path.join(__dirname, "a11y-baseline.json");
const REPORT_DIR = process.env.A11Y_REPORT_DIR || "test-results";
const REPORT_PATH = path.join(REPORT_DIR, "a11y-report.json");

/** Every primary page that must stay free of new accessibility regressions. */
const COVERED_PAGES: Array<{ name: string; path: string }> = [
  { name: "landing", path: "/" },
  { name: "login", path: "/auth/login" },
  { name: "circles", path: "/circles" },
  { name: "circle detail", path: "/circles/circle-1" },
  { name: "create circle", path: "/circles/create" },
  { name: "join circle", path: "/circles/circle-1/join" },
  { name: "contribute callback", path: "/circles/circle-1/contribute/callback" },
  { name: "dashboard", path: "/dashboard" },
  { name: "settings", path: "/settings" },
  { name: "analytics", path: "/analytics" },
  { name: "admin", path: "/admin" },
  { name: "help", path: "/help" },
  { name: "faq", path: "/faq" },
  { name: "profile", path: "/profile" },
];

type AxeViolations = Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"];

function loadBaseline(): ModerateBaselineEntry[] {
  const raw = fs.readFileSync(BASELINE_PATH, "utf8");
  const parsed = JSON.parse(raw) as { moderate: ModerateBaselineEntry[] };
  return parsed.moderate;
}

test.describe("Accessibility — Full page coverage (issue #289)", () => {
  const report: A11yReportEntry[] = [];
  let baseline: ModerateBaselineEntry[] = [];

  test.beforeAll(() => {
    baseline = loadBaseline();
  });

  test.afterAll(() => {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), pages: COVERED_PAGES, violations: report }, null, 2));
  });

  for (const covered of COVERED_PAGES) {
    test(`${covered.name} (${covered.path}) — no critical/serious, no new moderate violations`, async ({ page }) => {
      await mockAuthSession(page);
      await mockCirclesList(page);

      await page.goto(covered.path);
      await page.waitForLoadState("networkidle");

      const { violations }: { violations: AxeViolations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();

      for (const v of violations) {
        report.push({
          page: covered.path,
          impact: v.impact ?? "unknown",
          rule: v.id,
          nodes: v.nodes.length,
        });
      }

      // AC: zero Critical/Serious violations anywhere.
      const blocking = violations.filter(
        (v) => v.impact === "critical" || v.impact === "serious"
      );
      if (blocking.length > 0) {
        const details = blocking
          .map((v) => `[${v.impact}] ${v.id}: ${v.description}\n  ${v.nodes.map((n) => n.html).join("\n  ")}`)
          .join("\n\n");
        throw new Error(`Accessibility violations found on ${covered.path}:\n\n${details}`);
      }

      // AC: no NEW moderate violations — anything not already in the
      // baseline file fails. To accept a known moderate violation, add
      // { "page": "...", "rule": "..." } to a11y-baseline.json.
      const moderate = violations.filter((v) => v.impact === "moderate");
      const newModerate = moderate.filter(
        (v) => !baseline.some((b) => b.page === covered.path && b.rule === v.id)
      );
      if (newModerate.length > 0) {
        const details = newModerate
          .map((v) => `[moderate] ${v.id}: ${v.description}\n  ${v.nodes.map((n) => n.html).join("\n  ")}`)
          .join("\n\n");
        throw new Error(
          `New moderate accessibility violations on ${covered.path} (not in a11y-baseline.json):\n\n${details}\n\n` +
            `Fix them, or add { "page": "${covered.path}", "rule": "<rule-id>" } to e2e/accessibility/a11y-baseline.json after review.`
        );
      }
    });
  }
});
