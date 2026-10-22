import { expect, test, type Page } from "@playwright/test";

async function openPractice(
  page: Page,
  kind: "guandan" | "doudizhu" = "guandan",
) {
  await page.goto("/");
  await expect(page.getByTestId("start-practice")).toBeVisible();
  if (kind === "doudizhu") {
    await page.getByTestId("game-doudizhu").click();
    await expect(page.getByTestId("game-doudizhu")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  }
  await page.getByTestId("start-practice").click();
  await expect(page.getByTestId("hand")).toBeVisible();
}

test("Guandan practice deals 27 cards and advances from a suggested play", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await openPractice(page);
  const hand = page.getByTestId("hand").locator("[data-card-id]");
  await expect(hand).toHaveCount(27);

  const hint = page.getByTestId("hint");
  await expect(hint).toBeEnabled();
  await hint.click();
  await expect(
    page.getByTestId("hand").locator('[data-card-id][aria-pressed="true"]'),
  ).not.toHaveCount(0);
  await expect(page.getByTestId("play-cards")).toBeEnabled();
  await page.getByTestId("play-cards").click();
  await expect.poll(() => hand.count()).toBeLessThan(27);
  expect(pageErrors).toEqual([]);

  await page.locator("button.brand").click();
  await expect(page.getByTestId("start-practice")).toBeVisible();
  await page.locator("button.text-link").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Dou Dizhu practice accepts a bid, hint, and play without page errors", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await openPractice(page, "doudizhu");
  const hand = page.getByTestId("hand").locator("[data-card-id]");
  await expect(hand).toHaveCount(17);
  await expect(page.getByTestId("bid-3")).toBeEnabled();
  await page.getByTestId("bid-3").click();
  await expect(hand).toHaveCount(20);

  const hint = page.getByTestId("hint");
  await expect(hint).toBeEnabled();
  await hint.click();
  await expect(
    page.getByTestId("hand").locator('[data-card-id][aria-pressed="true"]'),
  ).not.toHaveCount(0);
  await page.getByTestId("play-cards").click();
  await expect.poll(() => hand.count()).toBeLessThan(20);
  expect(pageErrors).toEqual([]);
});

test("practice hand remains usable on a 390px viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPractice(page);
  const hand = page.getByTestId("hand");
  const cards = hand.locator("[data-card-id]");
  await expect(cards).toHaveCount(27);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);

  for (let index = 0; index < 27; index += 1) {
    const card = cards.nth(index);
    await card.click();
    await expect(card).toHaveAttribute("aria-pressed", "true");
    await card.click();
    await expect(card).toHaveAttribute("aria-pressed", "false");
  }
});
