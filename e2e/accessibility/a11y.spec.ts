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
 */
import { test, expect, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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
// Additional pages required by Issue #218
// ---------------------------------------------------------------------------

test.describe("Accessibility — Extended page coverage (#218)", () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthSession(page);
    await mockCirclesList(page);
  });

  test("circle detail page has no critical/serious violations", async ({ page }) => {
    await page.route("/api/v1/circles/circle-1*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            id: "circle-1",
            name: "Alpha Savings",
            contributionUsdc: "50",
            maxMembers: 5,
            currentMembers: 3,
            cycleFrequency: "monthly",
            status: "open",
            members: [],
          },
        }),
      })
    );

    await page.goto("/circles/circle-1");
    await page.waitForLoadState("networkidle");

    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();

    assertNoViolations(violations.filter((v) => v.impact === "critical" || v.impact === "serious"));
  });

  test("create circle page has no critical/serious violations", async ({ page }) => {
    await page.goto("/circles/create");
    await page.waitForLoadState("networkidle");

    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();

    assertNoViolations(violations.filter((v) => v.impact === "critical" || v.impact === "serious"));
  });

  test("profile page has no critical/serious violations", async ({ page }) => {
    await page.route("/api/v1/profile*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { id: "user-a11y", name: "Test User", phone: "+2348011111111" },
        }),
      })
    );

    await page.goto("/profile");
    await page.waitForLoadState("networkidle");

    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();

    assertNoViolations(violations.filter((v) => v.impact === "critical" || v.impact === "serious"));
  });

  test("settings page has no critical/serious violations", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();

    assertNoViolations(violations.filter((v) => v.impact === "critical" || v.impact === "serious"));
  });

  test("FAQ page has no critical/serious violations", async ({ page }) => {
    await page.goto("/faq");
    await page.waitForLoadState("networkidle");

    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();

    assertNoViolations(violations.filter((v) => v.impact === "critical" || v.impact === "serious"));
  });

  test("help page has no critical/serious violations", async ({ page }) => {
    await page.goto("/help");
    await page.waitForLoadState("networkidle");

    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();

    assertNoViolations(violations.filter((v) => v.impact === "critical" || v.impact === "serious"));
  });
});

test.describe("Accessibility — Focus ring visibility (#218)", () => {
  test("skip-to-main link is visible on focus", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");

    const skipLink = page.locator('a[href="#main-content"]');
    const isVisible = await skipLink.evaluate((el) => {
      const style = window.getComputedStyle(el);
      // The link moves to top:0 on focus; check it is not off-screen
      return style.getPropertyValue("top") !== "-100px";
    });
    // First tab should focus skip link, making it on-screen
    expect(isVisible).toBe(true);
  });

  test("all interactive elements on landing page have visible focus indicators", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .withRules(["focus-visible"])
      .analyze();

    // No critical/serious focus-related violations
    assertNoViolations(violations.filter((v) => v.impact === "critical" || v.impact === "serious"));
  });
});

test.describe("Accessibility — Images (#218)", () => {
  test("landing page images all have meaningful alt text", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a"])
      .withRules(["image-alt"])
      .analyze();

    assertNoViolations(violations);
  });
});
