import { expect, type Page, test } from "@playwright/test";

type Role = "admin" | "cleric" | "member";

const routeChecks: {
  marker: RegExp | string;
  path: string;
  role?: Role;
  screenshot?: boolean;
}[] = [
  { marker: /RaidGuild accounting/i, path: "/", screenshot: true },
  { marker: /Current Treasury Balance/i, path: "/", role: "member", screenshot: true },
  { marker: /Quarter Reports|Member access required/i, path: "/reports", role: "member" },
  { marker: /Proposal-linked money movement/i, path: "/proposals", role: "member", screenshot: true },
  { marker: /Joins, dues, and ragequits/i, path: "/membership", role: "member", screenshot: true },
  { marker: /RIP links and tracked spend/i, path: "/rips", role: "member" },
  { marker: /Raid accounting/i, path: "/raids", role: "cleric", screenshot: true },
  { marker: /Q[1-4] \d{4}|No reporting periods yet/i, path: "/admin/quarters", role: "admin", screenshot: true },
  { marker: /Providers By Spend|No providers/i, path: "/admin/providers", role: "admin", screenshot: true },
  { marker: /Manage accounts|Treasury Accounts/i, path: "/admin/treasury-accounts", role: "admin", screenshot: true },
];

async function clearSession(page: Page) {
  await page.request.delete("/api/e2e/session");
}

async function setRole(page: Page, role: Role) {
  const response = await page.request.post("/api/e2e/session", {
    data: { role },
  });

  expect(response.ok()).toBeTruthy();
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const innerWidth = window.innerWidth;
    const offenders = Array.from(document.body.querySelectorAll("*"))
      .map((element) => {
        const rect = element.getBoundingClientRect();

        return {
          className: element.getAttribute("class") ?? "",
          right: Math.round(rect.right * 100) / 100,
          tagName: element.tagName.toLowerCase(),
          text: (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
          width: Math.round(rect.width * 100) / 100,
        };
      })
      .filter((item) => item.right > innerWidth + 1)
      .sort((left, right) => right.right - left.right)
      .slice(0, 5);

    window.scrollTo(10_000, window.scrollY);
    const scrollXAfterForcedScroll = window.scrollX;
    window.scrollTo(0, window.scrollY);

    return {
      bodyScrollWidth: document.body.scrollWidth,
      bodyComputedMargin: window.getComputedStyle(document.body).margin,
      bodyRect: {
        left: Math.round(document.body.getBoundingClientRect().left * 100) / 100,
        right: Math.round(document.body.getBoundingClientRect().right * 100) / 100,
        width: Math.round(document.body.getBoundingClientRect().width * 100) / 100,
      },
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      offenders,
      innerWidth,
      scrollXAfterForcedScroll,
    };
  });

  expect(
    Math.max(overflow.bodyScrollWidth, overflow.documentScrollWidth),
    JSON.stringify(overflow, null, 2),
  ).toBeLessThanOrEqual(overflow.innerWidth + 1);
  expect(overflow.scrollXAfterForcedScroll, JSON.stringify(overflow, null, 2)).toBe(0);
}

async function expectNoNextErrorOverlay(page: Page) {
  await expect(
    page.locator("nextjs-portal").getByText(/error|failed|unhandled/i),
  ).toHaveCount(0);
}

async function expectClickable(locator: ReturnType<Page["locator"]>) {
  await expect(locator.first()).toBeVisible();

  const box = await locator.first().boundingBox();

  expect(box?.height ?? 0).toBeGreaterThan(0);
  expect(box?.width ?? 0).toBeGreaterThan(0);
}

function collectConsoleErrors(page: Page) {
  const errors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });

  return errors;
}

test.describe("responsive dashboard smoke", () => {
  for (const check of routeChecks) {
    test(`${check.role ?? "public"} ${check.path}`, async ({ page }, testInfo) => {
      const errors = collectConsoleErrors(page);

      if (check.role) {
        await setRole(page, check.role);
      } else {
        await clearSession(page);
      }

      await page.goto(check.path);
      await expect(page.locator("main").getByText(check.marker).first()).toBeVisible();
      await expectNoNextErrorOverlay(page);
      await expectNoHorizontalOverflow(page);

      const main = page.locator("main");
      await expect(main).toBeVisible();

      if (check.role) {
        await expect(page.locator("header")).toBeVisible();
        await expectClickable(page.getByRole("button", { name: /0x0000/i }));

        if (
          testInfo.project.name === "mobile" ||
          testInfo.project.name === "small-mobile"
        ) {
          await page.getByRole("button", { name: "Menu" }).click();
          await expect(
            page.getByRole("navigation", { name: "Accounting sections" }),
          ).toBeVisible();
          await expect(
            page.getByRole("link", { name: "Dashboard" }).last(),
          ).toBeVisible();
          await page.keyboard.press("Escape");
          await expect(
            page.getByRole("navigation", { name: "Accounting sections" }),
          ).not.toBeVisible();
        }
      } else {
        await expectClickable(page.getByRole("button", { name: /connect wallet/i }));
      }

      if (
        check.screenshot &&
        (testInfo.project.name === "mobile" ||
          testInfo.project.name === "tablet" ||
          testInfo.project.name === "desktop")
      ) {
        await page.screenshot({
          fullPage: true,
          path: testInfo.outputPath(
            `${testInfo.project.name}-${check.role ?? "public"}-${check.path.replaceAll("/", "_") || "home"}.png`,
          ),
        });
      }

      expect(errors).toEqual([]);
    });
  }
});

test.describe("responsive local data details", () => {
  test("published report detail when available", async ({ page }, testInfo) => {
    const errors = collectConsoleErrors(page);

    await setRole(page, "admin");
    await page.goto("/reports");

    const reportLink = page.getByRole("link", { name: /view report|preview report/i }).first();
    const reportCount = await reportLink.count();

    test.skip(reportCount === 0, "No local published or previewable reports found.");

    await Promise.all([
      page.waitForURL(/\/reports\/quarters\/[^/]+$/),
      reportLink.click(),
    ]);
    await expect(page.getByText("Quarter Report").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /Q[1-4] \d{4}/i }).first()).toBeVisible();
    await expectNoNextErrorOverlay(page);
    await expectNoHorizontalOverflow(page);

    if (
      testInfo.project.name === "mobile" ||
      testInfo.project.name === "tablet" ||
      testInfo.project.name === "desktop"
    ) {
      await page.screenshot({
        fullPage: true,
        path: testInfo.outputPath(`${testInfo.project.name}-report-detail.png`),
      });
    }

    expect(errors).toEqual([]);
  });

  test("quarter transaction review when available", async ({ page }, testInfo) => {
    const errors = collectConsoleErrors(page);

    await setRole(page, "admin");
    await page.goto("/admin/quarters");

    const reviewLink = page.getByRole("link", { name: /review transactions/i }).first();
    const reviewCount = await reviewLink.count();

    test.skip(reviewCount === 0, "No local quarter transaction review links found.");

    await reviewLink.click();
    await expect(page.getByRole("heading", { name: /transaction|quarter/i }).first()).toBeVisible();
    await expectNoNextErrorOverlay(page);
    await expectNoHorizontalOverflow(page);

    if (
      testInfo.project.name === "mobile" ||
      testInfo.project.name === "tablet" ||
      testInfo.project.name === "desktop"
    ) {
      await page.screenshot({
        fullPage: true,
        path: testInfo.outputPath(`${testInfo.project.name}-quarter-transactions.png`),
      });
    }

    expect(errors).toEqual([]);
  });

  test("quarter transaction review has no overflow at 450px", async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.setViewportSize({ height: 900, width: 450 });
    await setRole(page, "admin");
    await page.goto("/admin/quarters");

    const reviewLink = page.getByRole("link", { name: /review transactions/i }).first();
    const reviewCount = await reviewLink.count();

    test.skip(reviewCount === 0, "No local quarter transaction review links found.");

    await reviewLink.click();
    await expect(page.getByRole("heading", { name: /transaction|quarter/i }).first()).toBeVisible();
    await expectNoNextErrorOverlay(page);
    await expectNoHorizontalOverflow(page);

    await page.screenshot({
      fullPage: true,
      path: test.info().outputPath("edge-450-quarter-transactions.png"),
    });

    expect(errors).toEqual([]);
  });

  test("quarter transaction review has no overflow at 375px", async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.setViewportSize({ height: 900, width: 375 });
    await setRole(page, "admin");
    await page.goto("/admin/quarters");

    const reviewLink = page.getByRole("link", { name: /review transactions/i }).first();
    const reviewCount = await reviewLink.count();

    test.skip(reviewCount === 0, "No local quarter transaction review links found.");

    await reviewLink.click();
    await expect(page.getByRole("heading", { name: /transaction|quarter/i }).first()).toBeVisible();
    await expectNoNextErrorOverlay(page);
    await expectNoHorizontalOverflow(page);

    await page.screenshot({
      fullPage: true,
      path: test.info().outputPath("edge-375-quarter-transactions.png"),
    });

    expect(errors).toEqual([]);
  });

  test("quarter transaction review has no overflow at 350px", async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.setViewportSize({ height: 900, width: 350 });
    await setRole(page, "admin");
    await page.goto("/admin/quarters");

    const reviewLink = page.getByRole("link", { name: /review transactions/i }).first();
    const reviewCount = await reviewLink.count();

    test.skip(reviewCount === 0, "No local quarter transaction review links found.");

    await reviewLink.click();
    await expect(page.getByRole("heading", { name: /transaction|quarter/i }).first()).toBeVisible();
    await expectNoNextErrorOverlay(page);
    await expectNoHorizontalOverflow(page);

    await page.screenshot({
      fullPage: true,
      path: test.info().outputPath("edge-350-quarter-transactions.png"),
    });

    expect(errors).toEqual([]);
  });
});

test.describe("responsive modals", () => {
  test("RIP modal fits mobile viewport", async ({ page }, testInfo) => {
    await setRole(page, "cleric");
    await page.goto("/rips");

    const addRip = page.getByRole("link", { name: /add rip/i }).first();
    const addRipCount = await addRip.count();

    test.skip(addRipCount === 0, "Current role cannot open the RIP modal.");

    await addRip.click();

    const dialog = page.getByRole("dialog", { name: /add rip/i });

    await expect(dialog).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expect(dialog.getByLabel(/title/i)).toBeVisible();
    await expect(dialog.getByRole("link", { name: /close/i })).toBeVisible();

    if (testInfo.project.name === "mobile") {
      await page.screenshot({
        fullPage: true,
        path: testInfo.outputPath("mobile-rip-modal.png"),
      });
    }
  });
});
