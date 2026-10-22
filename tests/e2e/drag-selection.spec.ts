import { expect, test, type Locator, type Page } from "@playwright/test";

async function openPractice(page: Page, width = 1280) {
  await page.setViewportSize({ width, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("start-practice")).toBeVisible();
  await page.getByTestId("start-practice").click();
  await expect(page.getByTestId("hand")).toBeVisible();
}

function cards(page: Page): Locator {
  return page.getByTestId("hand").locator("[data-card-id]");
}

async function centers(page: Page) {
  await cards(page).first().scrollIntoViewIfNeeded();
  return cards(page).evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }),
  );
}

async function drag(page: Page, from: number, to: number, steps = 1) {
  const points = await centers(page);
  await page.mouse.move(points[from].x, points[from].y);
  await page.mouse.down();
  await page.mouse.move(points[to].x, points[to].y, { steps });
  await page.mouse.up();
}

async function selectedIndexes(page: Page) {
  return cards(page).evaluateAll((elements) =>
    elements.flatMap((element, index) =>
      element.getAttribute("aria-pressed") === "true" ? [index] : [],
    ),
  );
}

test("dragging across the hand selects an inclusive range and keeps outside clicks", async ({
  page,
}) => {
  await openPractice(page);
  await cards(page).nth(0).click();

  // One fast pointer move must still select every card between the endpoints.
  await drag(page, 2, 7);
  await expect.poll(() => selectedIndexes(page)).toEqual([0, 2, 3, 4, 5, 6, 7]);

  // Beginning on a selected card changes the same range back to unselected.
  await drag(page, 2, 7);
  await expect.poll(() => selectedIndexes(page)).toEqual([0]);
});

test("reversing within one held drag shrinks the range and preserves outside selections", async ({
  page,
}) => {
  await openPractice(page);
  await cards(page).nth(0).click();
  const points = await centers(page);
  await page.mouse.move(points[2].x, points[2].y);
  await page.mouse.down();
  await page.mouse.move(points[7].x, points[7].y, { steps: 1 });
  await page.mouse.move(points[4].x, points[4].y, { steps: 1 });
  await page.mouse.up();

  // The range is evaluated at release, while the pre-gesture selection stays intact.
  await expect.poll(() => selectedIndexes(page)).toEqual([0, 2, 3, 4]);
});

test("releasing outside the hand ends drag mode without an extra click toggle", async ({
  page,
}) => {
  await openPractice(page);
  const points = await centers(page);
  await page.mouse.move(points[1].x, points[1].y);
  await page.mouse.down();
  await page.mouse.move(points[5].x, points[5].y, { steps: 1 });
  await page.mouse.move(12, 120, { steps: 1 });
  await page.mouse.up();

  await expect.poll(() => selectedIndexes(page)).toEqual([1, 2, 3, 4, 5]);

  // A later ordinary click still toggles exactly one card.
  await cards(page).nth(7).click();
  await expect.poll(() => selectedIndexes(page)).toEqual([1, 2, 3, 4, 5, 7]);
});

test("drag selection follows DOM order when the Guandan hand wraps on mobile", async ({
  page,
}) => {
  await openPractice(page, 390);
  const handCards = cards(page);
  await expect(handCards).toHaveCount(27);

  const points = await centers(page);
  const firstRowY = points[0].y;
  const firstWrappedIndex = points.findIndex(
    (point) => point.y > firstRowY + 10,
  );
  expect(firstWrappedIndex).toBeGreaterThan(0);
  const endpoint = firstWrappedIndex + 1;
  await drag(page, 0, endpoint);
  await expect
    .poll(() => selectedIndexes(page))
    .toEqual(Array.from({ length: endpoint + 1 }, (_, index) => index));
});

test.describe("touch input", () => {
  test.use({ hasTouch: true });

  test("touch tap selects one card and vertical touch scrolling stays native", async ({
    page,
  }) => {
    await openPractice(page, 390);
    const handCards = cards(page);
    await expect(handCards).toHaveCount(27);

    const points = await centers(page);
    await page.touchscreen.tap(points[0].x, points[0].y);
    await expect(handCards.nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => selectedIndexes(page)).toEqual([0]);

    // Playwright's touchscreen facade exposes tap only, so use Chromium's real
    // touch input endpoint for a vertical swipe rather than mouse events.
    const cdp = await page.context().newCDPSession(page);
    const startX = points[0].x;
    const startY = points[0].y;
    const initialScrollY = await page.evaluate(() => window.scrollY);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: startX, y: startY, radiusX: 8, radiusY: 8 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: startX, y: Math.max(40, startY - 300), radiusX: 8, radiusY: 8 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });

    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(initialScrollY);
    await expect.poll(() => selectedIndexes(page)).toEqual([0]);
  });
});
