import { expect, test, type Page } from "@playwright/test";

type PracticeKind = "guandan" | "doudizhu";

async function openPractice(page: Page, kind: PracticeKind) {
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
  await expect(page.getByTestId("room")).toBeVisible();
  await expect(page.getByTestId("hand")).toBeVisible();
}

function handIds(page: Page) {
  return page
    .getByTestId("hand")
    .locator("[data-card-id]")
    .evaluateAll((cards) =>
      cards.map((card) => card.getAttribute("data-card-id")),
    );
}

async function revision(page: Page) {
  return Number(await page.getByTestId("room").getAttribute("data-revision"));
}

async function pausePractice(page: Page) {
  const pause = page.getByTestId("practice-pause");
  if ((await pause.getAttribute("aria-pressed")) !== "true") {
    await pause.click();
  }
  await expect(pause).toHaveAttribute("aria-pressed", "true");
}

test("Dou Dizhu saves and undoes a bid checkpoint", async ({ page }) => {
  await openPractice(page, "doudizhu");
  await expect(page.getByTestId("hand").locator("[data-card-id]")).toHaveCount(
    17,
  );
  await expect(page.getByTestId("bid-3")).toBeEnabled();

  await page.getByTestId("bid-3").click();
  await expect(page.getByTestId("hand").locator("[data-card-id]")).toHaveCount(
    20,
  );
  await expect(page.getByTestId("practice-undo")).toBeEnabled();
  await expect(page.getByTestId("practice-save-status")).toBeVisible();

  await page.getByTestId("practice-undo").click();
  await expect(page.getByTestId("hand").locator("[data-card-id]")).toHaveCount(
    17,
  );
  await expect.poll(() => revision(page)).toBe(0);
  await expect(page.getByTestId("practice-undo")).toBeDisabled();

  await pausePractice(page);
  await expect(page.getByTestId("bid-3")).toBeDisabled();
  await expect(page.getByTestId("bid-0")).toBeDisabled();
  await page.getByTestId("practice-pause").click();
  await expect(page.getByTestId("practice-pause")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.getByTestId("bid-3")).toBeEnabled();
});

test("Guandan undo restores the turn before bot replies and clears selection", async ({
  page,
}) => {
  await openPractice(page, "guandan");
  await page.getByTestId("practice-pace").selectOption("quick");
  const before = await handIds(page);
  const beforeRevision = await revision(page);

  await page.getByTestId("hint").click();
  await expect(
    page.getByTestId("hand").locator('[data-card-id][aria-pressed="true"]'),
  ).not.toHaveCount(0);
  await page.getByTestId("play-cards").click();
  await expect(page.getByTestId("practice-undo")).toBeEnabled();

  await expect
    .poll(() => revision(page), { timeout: 10_000 })
    .toBeGreaterThan(beforeRevision + 1);
  await page.getByTestId("practice-undo").click();
  await expect.poll(() => revision(page)).toBe(beforeRevision);
  await expect.poll(() => handIds(page)).toEqual(before);
  await expect(
    page.getByTestId("hand").locator('[data-card-id][aria-pressed="true"]'),
  ).toHaveCount(0);

  // Only the player's own cards are rendered in the practice table.
  await expect(page.getByTestId("hand").locator("[data-card-id]")).toHaveCount(
    27,
  );
  await expect(
    page.locator('[data-player-id^="practice-bot-"] [data-card-id]'),
  ).toHaveCount(0);
  await pausePractice(page);
});

test("a paused bot turn persists its checkpoint and blocks stale timers after undo", async ({
  page,
}) => {
  await openPractice(page, "guandan");
  await page.getByTestId("practice-pace").selectOption("quick");
  const originalHand = await handIds(page);

  await page.getByTestId("hint").click();
  await expect(
    page.getByTestId("hand").locator('[data-card-id][aria-pressed="true"]'),
  ).not.toHaveCount(0);
  await page.getByTestId("play-cards").click();
  await expect(page.getByTestId("practice-undo")).toBeEnabled();

  // A revision beyond the human action proves at least one bot action ran.
  await expect
    .poll(() => revision(page), { timeout: 10_000 })
    .toBeGreaterThan(1);
  await pausePractice(page);
  const pausedRevision = await revision(page);
  const pausedHand = await handIds(page);
  await page.waitForTimeout(1_250);
  await expect.poll(() => revision(page)).toBe(pausedRevision);
  await expect.poll(() => handIds(page)).toEqual(pausedHand);

  // Persist a slower pace while paused, then reload the lobby directly.
  await page.getByTestId("practice-pace").selectOption("relaxed");
  await expect
    .poll(async () => {
      const raw = await page.evaluate(() =>
        localStorage.getItem("tomato-practice-v1"),
      );
      return raw ? (JSON.parse(raw) as { pace?: string }).pace : null;
    })
    .toBe("relaxed");
  await page.reload();
  await expect(page.getByTestId("resume-practice")).toBeVisible();
  await page.getByTestId("resume-practice").click();
  await expect(page.getByTestId("practice-pause")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.getByTestId("practice-pace")).toHaveValue("relaxed");
  await pausePractice(page);
  await expect(page.getByTestId("practice-undo")).toBeEnabled();

  await page.getByTestId("practice-undo").click();
  await expect.poll(() => revision(page)).toBe(0);
  await expect.poll(() => handIds(page)).toEqual(originalHand);
  await expect(
    page.getByTestId("hand").locator('[data-card-id][aria-pressed="true"]'),
  ).toHaveCount(0);

  // The timer scheduled before the reload must not mutate the restored game.
  await page.waitForTimeout(1_250);
  await expect.poll(() => revision(page)).toBe(0);
  await expect.poll(() => handIds(page)).toEqual(originalHand);
});

test("opening settings freezes practice bot timers until the panel closes", async ({
  page,
}) => {
  await openPractice(page, "guandan");
  await page.getByTestId("practice-pace").selectOption("quick");
  await page.getByTestId("hint").click();
  await page.getByTestId("play-cards").click();
  await expect(page.getByTestId("practice-undo")).toBeEnabled();

  await page.getByTestId("settings").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const frozen = await revision(page);
  await page.waitForTimeout(900);
  await expect.poll(() => revision(page)).toBe(frozen);

  await page.getByRole("dialog").getByRole("button", { name: /继续/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(() => revision(page), { timeout: 8_000 })
    .toBeGreaterThan(frozen);
  await pausePractice(page);
});

for (const kind of ["guandan", "doudizhu"] as const) {
  test(`${kind} practice persists its exact paused hand and pace across leaving and refresh`, async ({
    page,
  }) => {
    await openPractice(page, kind);
    await page.getByTestId("practice-pace").selectOption("relaxed");
    await pausePractice(page);

    const savedHand = await handIds(page);
    const savedRevision = await revision(page);
    await expect
      .poll(async () => {
        const raw = await page.evaluate(() =>
          localStorage.getItem("tomato-practice-v1"),
        );
        if (!raw) return null;
        const parsed = JSON.parse(raw) as {
          version?: number;
          pace?: string;
          session?: { revision?: number; game?: { kind?: string } };
        };
        return [
          parsed.version,
          parsed.pace,
          parsed.session?.revision,
          parsed.session?.game?.kind,
        ];
      })
      .toEqual([1, "relaxed", savedRevision, kind]);

    await page.locator("button.brand").click();
    await expect(page.getByTestId("start-practice")).toBeVisible();
    await expect(page.getByTestId("saved-practice")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("saved-practice")).toBeVisible();

    await page.getByTestId("resume-practice").click();
    await expect(page.getByTestId("room")).toBeVisible();
    await expect(page.getByTestId("practice-pause")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(page.getByTestId("practice-pace")).toHaveValue("relaxed");
    await expect.poll(() => revision(page)).toBe(savedRevision);
    await expect.poll(() => handIds(page)).toEqual(savedHand);
    await pausePractice(page);
  });
}

test("practice controls remain usable at a narrow viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await openPractice(page, "guandan");
  await expect(page.getByTestId("practice-pause")).toBeVisible();
  await page.getByTestId("practice-options").click();
  await expect(page.getByTestId("practice-options")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(page.getByTestId("practice-pace")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
});
