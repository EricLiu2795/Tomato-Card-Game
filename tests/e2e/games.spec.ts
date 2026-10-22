import { expect, test, type TestInfo } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { REACTIONS } from "../../shared/soundboard";
import {
  action,
  createRoom,
  finishByLegalSingles,
  newPlayers,
  PlayerBrowser,
  resolveTribute,
  screenshot,
  startHand,
} from "./players";

async function verifySocial(players: PlayerBrowser[], testInfo: TestInfo) {
  for (const player of players) {
    await player.page.getByTestId("toggle-sound").click();
    await expect(player.page.getByTestId("toggle-sound")).toHaveAttribute(
      "aria-label",
      "静音",
    );
  }
  const [speaker, emojiSender, tomatoSender] = players;
  await speaker.page.getByTestId("open-reactions").click();
  for (const reaction of REACTIONS)
    await expect(
      speaker.page.getByTestId(`reaction-${reaction.id}`),
    ).toBeVisible();
  await speaker.page.getByTestId("reaction-you-are-so-right").click();
  await Promise.all(
    players.map(async (player) => {
      await expect
        .poll(
          () =>
            player.events.filter(
              (event) => event.reactionId === "you-are-so-right",
            ).length,
        )
        .toBe(1);
      await expect(
        player.page
          .getByTestId("reaction-bubble")
          .filter({ hasText: "对，你说的太对了！" }),
      ).toBeVisible();
      await expect
        .poll(() => player.page.evaluate(() => window.__acceptanceSpeech))
        .toContain("对，你说的太对了！");
    }),
  );
  const voiceEvent = speaker.events.find(
    (event) => event.reactionId === "you-are-so-right",
  )!;
  for (const player of players)
    expect(
      player.events.some((event) => event.eventId === voiceEvent.eventId),
    ).toBe(true);
  await screenshot(players[1], testInfo, "synchronized-voice-bubble");
  await speaker.page
    .getByRole("button", { name: "关闭互动", exact: true })
    .click();

  await emojiSender.page.getByTestId("open-reactions").click();
  await emojiSender.page.getByTestId("reaction-laugh").click();
  await Promise.all(
    players.map(async (player) => {
      await expect
        .poll(() => player.events.some((event) => event.reactionId === "laugh"))
        .toBe(true);
      await expect(
        player.page.getByTestId("reaction-bubble").filter({ hasText: "😂" }),
      ).toBeVisible();
    }),
  );
  await emojiSender.page
    .getByRole("button", { name: "关闭互动", exact: true })
    .click();

  // Muting keeps the synchronized text visible while suppressing speech calls.
  await emojiSender.page.getByTestId("toggle-sound").click();
  const mutedCount = await emojiSender.page.evaluate(
    () => window.__acceptanceSpeech.length,
  );
  await tomatoSender.page.getByTestId("open-reactions").click();
  await tomatoSender.page.getByTestId("reaction-bro-really").click();
  await Promise.all(
    players.map((player) =>
      expect
        .poll(() =>
          player.events.some((event) => event.reactionId === "bro-really"),
        )
        .toBe(true),
    ),
  );
  await expect(
    emojiSender.page
      .getByTestId("reaction-bubble")
      .filter({ hasText: "不是哥们？" }),
  ).toBeVisible();
  expect(
    await emojiSender.page.evaluate(() => window.__acceptanceSpeech.length),
  ).toBe(mutedCount);

  await tomatoSender.page.getByTestId("throw-tomato").click();
  await tomatoSender.page.getByTestId(`avatar-${speaker.seat}`).click();
  await Promise.all(
    players.map(async (player) => {
      await expect
        .poll(
          () => player.events.filter((event) => event.kind === "tomato").length,
        )
        .toBe(1);
      await expect(player.page.locator(".tomato-flight")).toBeVisible();
      const event = player.events.find((item) => item.kind === "tomato")!;
      expect(event.senderId).toBe(tomatoSender.snapshot!.selfId);
      expect(event.targetId).toBe(speaker.snapshot!.selfId);
    }),
  );
  await screenshot(speaker, testInfo, "synchronized-tomato");
  const observation = await Promise.all(
    players.map(async (player) => ({
      name: player.name,
      speechInvocations: await player.page.evaluate(
        () => window.__acceptanceSpeech,
      ),
      receivedEventIds: player.events.map((event) => event.eventId),
    })),
  );
  await testInfo.attach("sound-observation", {
    body: JSON.stringify(observation, null, 2),
    contentType: "application/json",
  });
  return observation;
}

async function verifyReconnect(player: PlayerBrowser): Promise<void> {
  const selfId = player.snapshot!.selfId;
  const seat = player.seat;
  const hand = player.snapshot!.hand.map((card) => card.id).sort();
  const observed = player.snapshots;
  const previousSockets = player.sockets;
  await player.page.reload();
  await expect.poll(() => player.snapshots).toBeGreaterThan(observed);
  expect(player.snapshot!.selfId).toBe(selfId);
  expect(player.seat).toBe(seat);
  expect(player.snapshot!.hand.map((card) => card.id).sort()).toEqual(hand);
  await expect(player.page.locator("[data-card-id]")).toHaveCount(hand.length);
  await expect(player.page.getByTestId("connection-status")).toHaveText(
    "已连接",
  );
  expect(player.sockets).toBeGreaterThan(previousSockets);
  // Development remounts and transient network retries may create canceled
  // sockets. Exactly one live UI connection must remain after restoration.
  await expect.poll(() => player.activeSockets.size).toBe(1);
}

async function verifyMobileHand(
  player: PlayerBrowser,
  testInfo: TestInfo,
): Promise<void> {
  for (const [label, viewport] of [
    ["portrait", { width: 390, height: 844 }],
    ["landscape", { width: 844, height: 390 }],
  ] as const) {
    await player.page.setViewportSize(viewport);
    await expect(player.page.locator("[data-card-id]")).toHaveCount(27);
    for (const card of player.snapshot!.hand) {
      const button = player.page.locator(`[data-card-id="${card.id}"]`);
      await button.tap();
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await button.tap();
      await expect(button).toHaveAttribute("aria-pressed", "false");
    }
    expect(
      await player.page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await screenshot(player, testInfo, `guandan-27-cards-${label}`);
  }
  await player.page.setViewportSize({ width: 1440, height: 1000 });
}

async function evidence(
  players: PlayerBrowser[],
  testInfo: TestInfo,
  extra: object,
): Promise<void> {
  players.forEach((player) => player.assertClean());
  const game = players[0].snapshot!.game!;
  const result = {
    status: "passed",
    ...extra,
    playerContexts: players.length,
    perPlayer: players.map((player) => ({
      name: player.name,
      seat: player.seat,
      inspectedSnapshots: player.snapshots,
      uiWebSockets: player.sockets,
      errors: player.errors,
      pageErrors: player.pageErrors,
      privacyErrors: player.privacyErrors,
    })),
    finalPublicGame: {
      kind: game.kind,
      phase: game.phase,
      handNumber: game.handNumber,
      finishOrder: game.finishOrder,
      winnerTeam: game.winnerTeam,
      levels: game.levels,
      currentLevel: game.currentLevel,
      advancement: game.advancement,
      scores: game.scores,
      removedCount: game.removed.length,
    },
    physicalAudioVerified: false,
    completedAt: new Date().toISOString(),
  };
  const destination = resolve("artifacts/e2e-results.json");
  let aggregate: Record<string, unknown> = {};
  try {
    aggregate = JSON.parse(await readFile(destination, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    /* First successful scenario creates this evidence file. */
  }
  aggregate[game.kind] = result;
  await mkdir(resolve("artifacts"), { recursive: true });
  await writeFile(destination, JSON.stringify(aggregate, null, 2));
  await testInfo.attach("acceptance-evidence", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });
}

test("three independent browsers finish Dou Dizhu and synchronize social events", async ({
  browser,
  baseURL,
}, testInfo) => {
  const players = await newPlayers(
    browser,
    ["地主小番茄", "农民牛油果", "农民小橘子"],
    baseURL!,
  );
  try {
    await screenshot(players[0], testInfo, "desktop-lobby");
    await createRoom(players, "doudizhu");
    await startHand(players);
    expect(players[0].snapshot!.game!.phase).toBe("bidding");
    for (const player of players)
      expect(player.snapshot!.hand).toHaveLength(17);
    const bidder = players.find(
      (player) => player.seat === players[0].snapshot!.game!.turn,
    )!;
    await action(players, bidder, "bid-3");
    expect(bidder.snapshot!.hand).toHaveLength(20);
    expect(bidder.snapshot!.game!.bottom).toHaveLength(3);
    await verifyReconnect(players[1]);
    const soundObservation = await verifySocial(players, testInfo);
    await screenshot(bidder, testInfo, "doudizhu-playing");
    const legalUiMoves = await finishByLegalSingles(players);
    const game = players[0].snapshot!.game!;
    expect(["landlord", "farmers"]).toContain(game.winnerTeam);
    expect(game.scores).toHaveLength(3);
    expect(game.scores!.reduce((sum, score) => sum + score, 0)).toBe(0);
    await screenshot(players[0], testInfo, "doudizhu-settlement");
    await evidence(players, testInfo, {
      legalUiMoves,
      completedHands: 1,
      soundObservation,
    });
  } finally {
    for (const player of players) await player.context.close();
  }
});

test("four independent browsers finish Guandan, advance and resolve the next tribute phase", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(1_200_000);
  const players = await newPlayers(
    browser,
    ["一座小番茄", "二座牛油果", "三座小橘子", "四座小葡萄"],
    baseURL!,
    0,
  );
  try {
    await createRoom(players, "guandan");
    expect(players[0].snapshot!.houseRule).toBe(true);
    await startHand(players);
    for (const player of players)
      expect(player.snapshot!.hand).toHaveLength(27);
    await verifyMobileHand(players[0], testInfo);
    await verifyReconnect(players[2]);
    const soundObservation = await verifySocial(players, testInfo);
    await screenshot(players[0], testInfo, "guandan-playing");
    let legalUiMoves = await finishByLegalSingles(players, 900, true);
    let settlement = players[0].snapshot!.game!;
    expect([...settlement.finishOrder].sort()).toEqual([0, 1, 2, 3]);
    expect(settlement.winnerTeam).toBe(settlement.finishOrder[0] % 2);
    const winningTeam = settlement.winnerTeam as number;
    expect(settlement.levels![winningTeam]).toBe(2 + settlement.advancement!);
    expect(settlement.finishOrder.slice(0, 2)).toEqual([0, 2]);
    await screenshot(players[0], testInfo, "guandan-settlement");
    let completedHands = 1;
    // Real random deals can legally resist tribute. Try up to three ordinary
    // next hands rather than introducing a seed, backdoor, or fabricated state.
    for (let attempt = 0; attempt < 3; attempt++) {
      await startHand(players);
      expect(players[0].snapshot!.game!.handNumber).toBe(completedHands + 1);
      expect(players[0].snapshot!.game!.currentLevel).toBe(
        settlement.levels![winningTeam],
      );
      if (!players[0].snapshot!.game!.tribute!.resisted || attempt === 2) break;
      legalUiMoves += await finishByLegalSingles(players, 900, true);
      completedHands++;
      settlement = players[0].snapshot!.game!;
    }
    const tribute = players[0].snapshot!.game!.tribute!;
    expect(tribute.kind).toBe("double");
    await screenshot(
      players.find(
        (player) => player.seat === players[0].snapshot!.game!.turn,
      )!,
      testInfo,
      "guandan-next-hand-tribute",
    );
    let reconnectedAfterTribute = false;
    let reconnectedAfterDiscard = false;
    const tributePhases = await resolveTribute(
      players,
      async (phase, actor) => {
        if (phase === "tribute" && !reconnectedAfterTribute) {
          await verifyReconnect(actor);
          expect(actor.snapshot!.game!.tribute!.selections[actor.seat]).toBe(
            "selected",
          );
          await expect(actor.page.getByTestId("submit-tribute")).toHaveCount(0);
          reconnectedAfterTribute = true;
        }
        if (phase === "discard" && !reconnectedAfterDiscard) {
          await verifyReconnect(actor);
          expect(actor.snapshot!.game!.tribute!.discarded).toContain(
            actor.seat,
          );
          await expect(actor.page.getByTestId("submit-discard")).toHaveCount(0);
          await expect(actor.page.getByTestId("skip-discard")).toHaveCount(0);
          reconnectedAfterDiscard = true;
        }
      },
    );
    if (tribute.resisted) expect(tributePhases).toEqual([]);
    else {
      expect(tributePhases).toContain("tribute");
      expect(tributePhases).toContain("return");
      expect(tributePhases.filter((phase) => phase === "discard")).toHaveLength(
        2,
      );
      expect(players[0].snapshot!.game!.removed).toHaveLength(1);
      expect(reconnectedAfterTribute).toBe(true);
      expect(reconnectedAfterDiscard).toBe(true);
    }
    await screenshot(players[0], testInfo, "guandan-next-hand-ready");
    await evidence(players, testInfo, {
      legalUiMoves,
      completedHands,
      soundObservation,
      mobile: {
        portrait: "390x844",
        landscape: "844x390",
        cardsReachableEach: 27,
        horizontalOverflow: false,
      },
      tributePhases,
      resisted: tribute.resisted,
      tributeKind: tribute.kind,
      reconnectedAfterTribute,
      reconnectedAfterDiscard,
      coverageNote: tribute.resisted
        ? "All three real next deals resisted tribute; discard path not observed in this run."
        : "Double tribute, both returns, one discard, one skip and mid-phase reconnects observed.",
    });
  } finally {
    for (const player of players) await player.context.close();
  }
});
