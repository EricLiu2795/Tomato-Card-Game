import { expect, test, type Page } from "@playwright/test";

const SAVE_KEY = "tomato-practice-v1";

const hand = (page: Page) => page.getByTestId("hand").locator("[data-card-id]");

async function startAndLeave(page: Page) {
  await page.goto("/");
  await page.getByTestId("game-doudizhu").click();
  await page.getByTestId("start-practice").click();
  await expect(hand(page)).toHaveCount(17);
  await page.locator("button.brand").click();
  await expect(page.getByTestId("resume-practice")).toBeVisible();
}

async function savedHandCount(page: Page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return (
      (JSON.parse(raw) as { session?: { game?: { hands?: unknown[][] } } })
        .session?.game?.hands?.[0]?.length ?? null
    );
  }, SAVE_KEY);
}

async function resume(page: Page) {
  await page.getByTestId("resume-practice").click();
  await expect(page.getByTestId("room")).toBeVisible();
}

test("a stale lobby cannot overwrite the active tab and resumes its latest save after ownership is released", async ({
  page: lobby,
  context,
}) => {
  await startAndLeave(lobby);

  const active = await context.newPage();
  await active.goto("/");
  await resume(active);
  await active.getByTestId("bid-3").click();
  await expect(hand(active)).toHaveCount(20);

  // A reload must reacquire the same save before the stale lobby can enter.
  await active.reload();
  await resume(active);
  await expect(hand(active)).toHaveCount(20);
  await lobby.getByTestId("resume-practice").click();
  await expect(lobby.getByTestId("room")).toHaveCount(0);
  await expect(lobby.getByTestId("toast")).toContainText("另一个标签页");
  await expect.poll(() => savedHandCount(lobby)).toBe(20);

  await active.locator("button.brand").click();
  await expect(active.getByTestId("start-practice")).toBeVisible();
  await resume(lobby);
  await expect(hand(lobby)).toHaveCount(20);
  await lobby.reload();
  await resume(lobby);
  await expect(hand(lobby)).toHaveCount(20);
  await active.close();
});

test("concurrent resume clicks grant ownership to one tab and leave the loser untouched", async ({
  page,
  context,
}) => {
  await startAndLeave(page);
  const first = await context.newPage();
  const second = await context.newPage();
  await Promise.all([first.goto("/"), second.goto("/")]);

  await Promise.all([
    first.getByTestId("resume-practice").click(),
    second.getByTestId("resume-practice").click(),
  ]);
  await expect
    .poll(
      async () =>
        Number(await first.getByTestId("room").count()) +
        Number(await second.getByTestId("room").count()),
    )
    .toBe(1);

  const loser =
    (await first.getByTestId("room").count()) === 0 ? first : second;
  const winner = loser === first ? second : first;
  await winner.getByTestId("bid-3").click();
  await expect(hand(winner)).toHaveCount(20);
  await loser.getByTestId("start-practice").click();
  await expect(loser.getByTestId("room")).toHaveCount(0);
  await expect(loser.getByTestId("toast")).toContainText("另一个标签页");
  await expect(loser.getByTestId("resume-practice")).toBeVisible();
  await winner.close();
  await resume(loser);
  await expect(hand(loser)).toHaveCount(20);
  await loser.close();
});

test("an external save replacement blocks future owner writes", async ({
  page: owner,
  context,
}) => {
  await owner.goto("/");
  await owner.getByTestId("start-practice").click();
  await expect(owner.getByTestId("practice-pause")).toBeVisible();
  await owner.getByTestId("practice-pause").click();
  const before = await owner.evaluate(
    (key) => localStorage.getItem(key),
    SAVE_KEY,
  );

  const external = await context.newPage();
  await external.goto("/");
  await external.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) throw new Error("practice save was not created");
    const save = JSON.parse(raw) as { savedAt: number; pace: string };
    save.savedAt += 1;
    save.pace = "quick";
    localStorage.setItem(key, JSON.stringify(save));
  }, SAVE_KEY);

  await expect(owner.getByTestId("practice-pause")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(owner.getByTestId("practice-conflict")).toBeVisible();
  if ((await owner.getByTestId("practice-pace").count()) === 0) {
    await owner.getByTestId("practice-options").click();
  }
  await owner.getByTestId("practice-pace").selectOption("relaxed");
  const replacement = await external.evaluate(
    (key) => localStorage.getItem(key),
    SAVE_KEY,
  );
  await expect
    .poll(() => owner.evaluate((key) => localStorage.getItem(key), SAVE_KEY))
    .toBe(replacement);
  expect(
    await owner.evaluate((key) => localStorage.getItem(key), SAVE_KEY),
  ).not.toBe(before);
  await external.close();
});

test("invalid practice data is recoverable and backed up before starting fresh", async ({
  page,
}) => {
  const original = "{not-json";
  await page.goto("/");
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [SAVE_KEY, original],
  );
  await page.reload();

  const recovery = page.getByTestId("practice-recovery");
  await expect(recovery).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await recovery.getByRole("button").first().click();
  await expect((await downloadPromise).suggestedFilename()).toBe(
    "tomato-practice-recovery.json",
  );
  await page.getByTestId("start-practice").click();
  await expect(page.getByTestId("room")).toBeVisible();

  const recoveryKeys = await page.evaluate(
    (prefix) =>
      Object.keys(localStorage).filter((key) => key.startsWith(prefix)),
    "tomato-practice-recovery-",
  );
  expect(recoveryKeys.length).toBeGreaterThan(0);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), recoveryKeys[0]),
  ).toBe(original);
});

test("unsupported practice versions show the same recovery path", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [SAVE_KEY, JSON.stringify({ version: 99, session: {} })],
  );
  await page.reload();
  await expect(page.getByTestId("practice-recovery")).toBeVisible();
  await expect(page.getByTestId("start-practice")).toBeVisible();
});

test("without Web Locks practice stays memory-only and preserves the existing save", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("start-practice").click();
  await expect(page.getByTestId("practice-pause")).toBeVisible();
  await page.locator("button.brand").click();
  const before = await page.evaluate(
    (key) => localStorage.getItem(key),
    SAVE_KEY,
  );
  expect(before).not.toBeNull();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    });
  });
  await page.reload();
  await page.getByTestId("start-practice").click();
  await expect(page.getByTestId("room")).toBeVisible();
  await expect(page.getByTestId("toast")).toContainText("暂不支持");

  await page.getByTestId("hint").click();
  await expect(page.getByTestId("play-cards")).toBeEnabled();
  await page.getByTestId("play-cards").click();
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), SAVE_KEY))
    .toBe(before);
});

test("a failed recovery backup refuses a fresh practice and keeps the original raw save", async ({
  page,
}) => {
  const original = "{not-json";
  await page.goto("/");
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [SAVE_KEY, original],
  );
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith("tomato-practice-recovery-")) {
        throw new Error("recovery backup blocked");
      }
      return setItem.call(this, key, value);
    };
  });
  await page.reload();
  await expect(page.getByTestId("practice-recovery")).toBeVisible();
  await page.getByTestId("start-practice").click();
  await expect(page.getByTestId("room")).toHaveCount(0);
  await expect(page.getByTestId("practice-recovery")).toBeVisible();
  await expect(page.getByTestId("toast")).toContainText("备份");
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), SAVE_KEY))
    .toBe(original);
});
