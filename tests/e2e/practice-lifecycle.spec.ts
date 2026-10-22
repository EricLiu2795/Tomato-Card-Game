import { expect, test, type Page } from "@playwright/test";

const SAVE_KEY = "tomato-practice-v1";
const PACE_DELAYS = {
  relaxed: 1800,
  normal: 1050,
  quick: 450,
} as const;

type Pace = keyof typeof PACE_DELAYS;

function hand(page: Page) {
  return page.getByTestId("hand").locator("[data-card-id]");
}

async function handIds(page: Page): Promise<string[]> {
  return hand(page).evaluateAll((cards) =>
    cards.map((card) => card.getAttribute("data-card-id") ?? ""),
  );
}

async function revision(page: Page): Promise<number> {
  return Number(await page.getByTestId("room").getAttribute("data-revision"));
}

async function openPractice(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("start-practice")).toBeVisible();
  await page.getByTestId("start-practice").click();
  await expect(page.getByTestId("room")).toBeVisible();
  await expect(hand(page)).toHaveCount(27);
}

async function playFirstHumanCard(page: Page): Promise<number> {
  const card = hand(page).first();
  await card.click();
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("play-cards").click();
  return revision(page);
}

async function flushClock(page: Page): Promise<void> {
  await page.clock.runFor(0);
  await page.evaluate(() => Promise.resolve());
}

async function pauseClockAtCurrentTime(page: Page): Promise<void> {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 60_000);
}

test("each practice pace waits its full bot delay", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install({ time: 0 });

  for (const [index, pace] of (Object.keys(PACE_DELAYS) as Pace[]).entries()) {
    if (index > 0) {
      await page.clock.resume();
      await page.goto("/");
      await page.evaluate(() => localStorage.clear());
    }
    await openPractice(page);
    await pauseClockAtCurrentTime(page);
    await page.getByTestId("practice-pace").selectOption(pace);
    const afterHuman = await playFirstHumanCard(page);
    const delay = PACE_DELAYS[pace];

    await page.clock.runFor(delay - 1);
    await flushClock(page);
    expect(await revision(page)).toBe(afterHuman);

    await page.clock.runFor(1);
    await flushClock(page);
    expect(await revision(page)).toBe(afterHuman + 1);

    await page.getByTestId("practice-pause").click();
    await expect(page.getByTestId("practice-pause")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  }
});

test("pausing freezes a scheduled bot and unpausing resumes it", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install({ time: 0 });
  await openPractice(page);
  await pauseClockAtCurrentTime(page);
  await page.getByTestId("practice-pace").selectOption("quick");
  const afterHuman = await playFirstHumanCard(page);
  const delay = PACE_DELAYS.quick;

  await page.getByTestId("practice-pause").click();
  await expect(page.getByTestId("practice-pause")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.clock.runFor(delay * 2);
  await flushClock(page);
  expect(await revision(page)).toBe(afterHuman);

  await page.getByTestId("practice-pause").click();
  await expect(page.getByTestId("practice-pause")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.clock.runFor(delay - 1);
  await flushClock(page);
  expect(await revision(page)).toBe(afterHuman);
  await page.clock.runFor(1);
  await flushClock(page);
  expect(await revision(page)).toBe(afterHuman + 1);
});

test("leaving practice releases ownership across multiplayer reloads and preserves the exact save", async ({
  page,
  context,
}) => {
  const roomSnapshots: Array<{ roomCode?: string; revision?: number }> = [];
  page.on("websocket", (socket) => {
    if (!socket.url().includes("/api/rooms/")) return;
    socket.on("framereceived", ({ payload }) => {
      try {
        const message = JSON.parse(String(payload)) as {
          type?: string;
          roomCode?: string;
          revision?: number;
        };
        if (message.type === "SNAPSHOT") roomSnapshots.push(message);
      } catch {
        // The production client ignores malformed frames too.
      }
    });
  });

  await openPractice(page);
  await page.getByTestId("practice-pace").selectOption("relaxed");
  const afterHuman = await playFirstHumanCard(page);
  await page.getByTestId("practice-pause").click();
  await expect(page.getByTestId("practice-pause")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const savedHand = await handIds(page);
  const savedRevision = afterHuman;
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), SAVE_KEY))
    .not.toBeNull();
  await expect
    .poll(async () =>
      page.evaluate((key) => {
        const raw = localStorage.getItem(key);
        return raw
          ? (JSON.parse(raw) as { session?: { revision?: number } }).session
              ?.revision
          : null;
      }, SAVE_KEY),
    )
    .toBe(savedRevision);

  await page.locator("button.brand").click();
  await expect(page.getByTestId("start-practice")).toBeVisible();
  await expect(page.getByTestId("saved-practice")).toBeVisible();

  await page.getByTestId("nickname").fill("Lifecycle tester");
  await page.getByTestId("create-room").click();
  await expect(page.getByTestId("room")).toBeVisible();
  await expect(page.getByTestId("connection-status")).toHaveClass(/online/);
  const roomCode = await page.getByTestId("room-code").textContent();
  expect(roomCode).toMatch(/^#/);
  const multiplayerCode = roomCode!.slice(1);
  await expect.poll(() => roomSnapshots.length).toBeGreaterThan(0);
  const multiplayerRevision = await revision(page);

  // A bot timer from the practice page must not mutate the save or the room
  // after the app has switched ownership to multiplayer.
  const savedWhileRoom = await page.evaluate(
    (key) => localStorage.getItem(key),
    SAVE_KEY,
  );
  await page.waitForTimeout(1_250);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY),
  ).toBe(savedWhileRoom);
  expect(await revision(page)).toBeGreaterThanOrEqual(multiplayerRevision);

  await page.reload();
  await expect(page.getByTestId("room")).toBeVisible();
  await expect(page.getByTestId("connection-status")).toHaveClass(/online/);
  await expect(page.getByTestId("room-code")).toHaveText(`#${multiplayerCode}`);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY),
  ).toBe(savedWhileRoom);
  const observedRoomSnapshots = roomSnapshots.filter(
    (snapshot) => snapshot.roomCode === multiplayerCode,
  );
  expect(observedRoomSnapshots.length).toBeGreaterThan(0);
  for (let index = 1; index < observedRoomSnapshots.length; index += 1)
    expect(observedRoomSnapshots[index].revision).toBeGreaterThanOrEqual(
      observedRoomSnapshots[index - 1].revision!,
    );
  expect(
    roomSnapshots.every((snapshot) => snapshot.roomCode === multiplayerCode),
  ).toBe(true);

  // The original tab remains in multiplayer while another same-context tab
  // resumes the saved practice. This proves enterRoom released the writer.
  const practiceTab = await context.newPage();
  await practiceTab.goto("/");
  await expect(practiceTab.getByTestId("resume-practice")).toBeVisible();
  await practiceTab.getByTestId("resume-practice").click();
  await expect(practiceTab.getByTestId("room")).toBeVisible();
  await expect(practiceTab.getByTestId("practice-pace")).toHaveValue("relaxed");
  await expect.poll(() => handIds(practiceTab)).toEqual(savedHand);
  await expect.poll(() => revision(practiceTab)).toBe(savedRevision);
  await practiceTab.close();

  await page.locator("button.brand").click();
  await expect(page.getByTestId("start-practice")).toBeVisible();
  await expect(page.getByTestId("saved-practice")).toBeVisible();
  await page.getByTestId("resume-practice").click();
  await expect(page.getByTestId("room")).toBeVisible();
  await expect(page.getByTestId("practice-pace")).toHaveValue("relaxed");
  await expect.poll(() => handIds(page)).toEqual(savedHand);
  await expect.poll(() => revision(page)).toBe(savedRevision);
});
