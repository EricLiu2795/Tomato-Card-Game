import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

type PracticeKind = "guandan" | "doudizhu";

async function openPractice(page: Page, kind: PracticeKind) {
  await page.goto("/");
  if (kind === "doudizhu") await page.getByTestId("game-doudizhu").click();
  await page.getByTestId("start-practice").click();
  await expect(page.getByTestId("room")).toBeVisible();
  await expect(page.getByTestId("hand")).toBeVisible();
}

for (const [kind, orientation, width, height] of [
  ["guandan", "portrait", 390, 844],
  ["guandan", "landscape", 844, 390],
  ["doudizhu", "portrait", 390, 844],
  ["doudizhu", "landscape", 844, 390],
] as const) {
  test(`${kind} ${orientation} keeps mobile practice controls reachable`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openPractice(page, kind);
    await page.evaluate(() => window.scrollTo(0, 0));

    const options = page.getByTestId("practice-options");
    await expect(options).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("practice-pace")).toBeHidden();
    await options.click();
    await expect(options).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("practice-pace")).toBeVisible();
    await expect(page.getByTestId("practice-undo")).toBeVisible();
    await options.click();
    await expect(options).toHaveAttribute("aria-expanded", "false");

    const actionBar = page.locator(".hand-section > .action-bar");
    await expect(actionBar).toBeVisible();
    const actionBox = await actionBar.boundingBox();
    expect(actionBox).not.toBeNull();
    expect(actionBox!.y + actionBox!.height).toBeGreaterThanOrEqual(height - 1);
    expect(actionBox!.y).toBeGreaterThanOrEqual(height - 100);

    const hand = page.getByTestId("hand");
    const tableBox = await page.locator(".table-shell").boundingBox();
    const handBox = await hand.boundingBox();
    expect(tableBox).not.toBeNull();
    expect(handBox).not.toBeNull();
    if (orientation === "landscape") {
      expect(tableBox!.x + tableBox!.width).toBeLessThanOrEqual(
        actionBox!.x + 1,
      );
      expect(handBox!.x).toBeGreaterThanOrEqual(tableBox!.x + tableBox!.width);
    } else {
      await expect(page.locator(".table-center")).toBeVisible();
    }

    if (kind === "guandan") {
      await expect(page.getByTestId("hint")).toBeVisible();
      await expect(page.getByTestId("play-cards")).toBeVisible();
    } else {
      await expect(page.getByTestId("bid-0")).toBeVisible();
      await expect(page.getByTestId("bid-3")).toBeVisible();
      await page.getByTestId("bid-3").click();
      await expect(
        page.getByTestId("hand").locator("[data-card-id]"),
      ).toHaveCount(20);
      await expect(page.getByTestId("play-cards")).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByTestId("pass")).toBeVisible();
    }

    const cards = hand.locator("[data-card-id]");
    await page.evaluate(() => window.scrollTo(0, 0));
    const startingCards = await cards.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
      }),
    );
    const initialBar = await actionBar.boundingBox();
    expect(
      Math.min(...startingCards.map((card) => card.top)),
    ).toBeGreaterThanOrEqual(0);
    expect(
      Math.max(...startingCards.map((card) => card.bottom)),
    ).toBeLessThanOrEqual(initialBar!.y);

    await hand.scrollIntoViewIfNeeded();
    await expect(hand).toBeVisible();
    for (let index = 0; index < (await cards.count()); index += 1) {
      const card = cards.nth(index);
      await card.evaluate((element) =>
        element.scrollIntoView({ block: "center", inline: "nearest" }),
      );
      await card.focus();
      const focused = await card.boundingBox();
      const fixedBar = await actionBar.boundingBox();
      expect(focused).not.toBeNull();
      expect(fixedBar).not.toBeNull();
      expect(focused!.y + focused!.height).toBeLessThanOrEqual(fixedBar!.y + 1);
      const obstructed = await page.evaluate(
        ({ x, y }) =>
          document.elementFromPoint(x, y)?.closest(".action-bar") !== null,
        {
          x: focused!.x + focused!.width / 2,
          y: focused!.y + focused!.height / 2,
        },
      );
      expect(obstructed).toBe(false);
    }

    await page.getByTestId("settings").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toBeFocused();
    await expect(actionBar).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    const outputDir = "artifacts/mobile-fixes/after";
    await mkdir(outputDir, { recursive: true });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `${outputDir}/${kind}-${orientation}-viewport.png`,
      fullPage: false,
    });
    await page.screenshot({
      path: `${outputDir}/${kind}-${orientation}-full.png`,
      fullPage: true,
    });
    const metrics = await page.evaluate(() => {
      const measure = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return {
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rect.height,
        };
      };
      return {
        scrollY: window.scrollY,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        document: {
          scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight,
        },
        practiceTools: measure(".practice-tools"),
        actionBar: measure(".hand-section > .action-bar"),
        tableShell: measure(".table-shell"),
        hand: measure('[data-testid="hand"]'),
        handCount: document.querySelectorAll(
          '[data-testid="hand"] [data-card-id]',
        ).length,
      };
    });
    await writeFile(
      `${outputDir}/${kind}-${orientation}.json`,
      JSON.stringify(metrics, null, 2),
    );
    await testInfo.attach(`${kind}-${orientation}-metrics`, {
      body: JSON.stringify(metrics, null, 2),
      contentType: "application/json",
    });
    if (orientation === "portrait") {
      await page.clock.install();
      await page.clock.pauseAt(
        (await page.evaluate(() => Date.now())) + 60_000,
      );
      await page.getByTestId("hint").click();
      await page.getByTestId("play-cards").click();
      await expect(page.locator(".trick-label")).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 0));
      const trick = await page.locator(".trick").boundingBox();
      const ownSeat = await page.locator(".seat-self").boundingBox();
      expect(trick!.y + trick!.height).toBeLessThanOrEqual(ownSeat!.y);
      if (kind === "guandan") {
        const topSeat = await page.locator(".seat-top").boundingBox();
        expect(topSeat!.y + topSeat!.height).toBeLessThanOrEqual(trick!.y);
      }
      await page.screenshot({
        path: `${outputDir}/${kind}-portrait-trick.png`,
      });
    }
  });
}
