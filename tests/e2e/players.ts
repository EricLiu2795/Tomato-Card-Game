import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
  type WebSocket as ObservedWebSocket,
} from "@playwright/test";
import assert from "node:assert/strict";
import type { Card } from "../../shared/cards";
import { ddzStrength, gdStrength } from "../../shared/cards";
import { legalReturnCards, legalTributeCards } from "../../shared/guandan";
import type {
  GameKind,
  ReactionEvent,
  ServerMessage,
  Snapshot,
} from "../../shared/types";

const rootKeys = [
  "type",
  "roomCode",
  "kind",
  "revision",
  "selfId",
  "hostId",
  "players",
  "hand",
  "game",
  "houseRule",
];
const playerKeys = ["id", "name", "seat", "ready", "connected", "count"];
const commonGameKeys = [
  "kind",
  "phase",
  "turn",
  "trick",
  "passed",
  "finishOrder",
  "history",
  "handNumber",
  "removed",
];
const ddzKeys = [
  "bottom",
  "bids",
  "highBid",
  "landlord",
  "multiplier",
  "scores",
  "winnerTeam",
];
const gdKeys = [
  "levels",
  "currentLevel",
  "levelTeam",
  "tribute",
  "houseRule",
  "winnerTeam",
  "matchWinner",
  "advancement",
];
const privateKeys =
  /^(hands|tokenHash|connectionId|lastReaction|lastTomato|actionTimes|highBidder|bidCount|playCounts|previousFinish|played|schema|lastActive|.*(?:rng|seed|random|debug).*)$/i;

function exactKeys(value: object, expected: string[]): void {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
}

/** Run for every received snapshot, including lobby, transitions and reconnects. */
export function assertPrivateProjection(snapshot: Snapshot): void {
  exactKeys(snapshot, rootKeys);
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      assert.ok(
        !privateKeys.test(key),
        `Internal field ${key} escaped into a snapshot`,
      );
      visit(child);
    }
  };
  visit(snapshot);
  for (const player of snapshot.players) exactKeys(player, playerKeys);
  const self = snapshot.players.find((player) => player.id === snapshot.selfId);
  assert.ok(self);
  assert.equal(snapshot.hand.length, self.count);
  assert.equal(
    new Set(snapshot.hand.map((card) => card.id)).size,
    snapshot.hand.length,
  );
  for (const card of snapshot.hand)
    exactKeys(card, ["id", "rank", "suit", "deck"]);
  if (snapshot.game) {
    exactKeys(snapshot.game, [
      ...commonGameKeys,
      ...(snapshot.kind === "doudizhu" ? ddzKeys : gdKeys),
    ]);
    if (snapshot.game.kind === "doudizhu" && snapshot.game.phase === "bidding")
      assert.deepEqual(snapshot.game.bottom, []);
    if (snapshot.game.tribute) {
      assert.ok(
        Object.values(snapshot.game.tribute.selections).every(
          (value) => value === "selected",
        ),
      );
    }
  }
}

declare global {
  interface Window {
    __acceptanceSpeech: string[];
  }
}

export class PlayerBrowser {
  snapshot?: Snapshot;
  snapshots = 0;
  sockets = 0;
  activeSockets = new Set<ObservedWebSocket>();
  events: ReactionEvent[] = [];
  errors: string[] = [];
  pageErrors: string[] = [];
  privacyErrors: string[] = [];
  observedSelfId?: string;

  constructor(
    readonly context: BrowserContext,
    readonly page: Page,
    readonly name: string,
  ) {
    page.on("pageerror", (error) => this.pageErrors.push(error.message));
    // CDP can omit individual close events for sockets in a destroyed document.
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) this.activeSockets.clear();
    });
    page.on("websocket", (socket) => {
      if (!socket.url().includes("/api/rooms/")) return;
      this.sockets++;
      this.activeSockets.add(socket);
      socket.on("close", () => this.activeSockets.delete(socket));
      socket.on("framereceived", ({ payload }) => {
        if (String(payload) === "pong") return;
        const message = JSON.parse(String(payload)) as ServerMessage;
        if (message.type === "SNAPSHOT") {
          try {
            assertPrivateProjection(message);
            if (this.observedSelfId)
              assert.equal(message.selfId, this.observedSelfId);
            this.observedSelfId = message.selfId;
          } catch (error) {
            this.privacyErrors.push(String(error));
          }
          this.snapshot = message;
          this.snapshots++;
        } else if (message.type === "EVENT") this.events.push(message);
        else if (message.type === "ERROR")
          this.errors.push(`${message.code ?? "REJECTED"}: ${message.message}`);
      });
    });
  }

  get seat(): number {
    return this.snapshot!.players.find(
      (player) => player.id === this.snapshot!.selfId,
    )!.seat;
  }

  async revisionAfter(revision: number): Promise<void> {
    await expect
      .poll(() => this.snapshot?.revision ?? -1, {
        intervals: [10, 20, 50, 100],
      })
      .toBeGreaterThan(revision);
  }

  assertClean(): void {
    expect(this.privacyErrors, `${this.name}: private projection`).toEqual([]);
    expect(this.errors, `${this.name}: rejected UI commands`).toEqual([]);
    expect(this.pageErrors, `${this.name}: browser exceptions`).toEqual([]);
  }
}

export async function newPlayers(
  browser: Browser,
  names: string[],
  baseURL: string,
  mobilePlayer = -1,
): Promise<PlayerBrowser[]> {
  const players: PlayerBrowser[] = [];
  for (const name of names) {
    const mobile = players.length === mobilePlayer;
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 1440, height: 1000 },
      isMobile: mobile,
      hasTouch: mobile,
    });
    // This spy observes the browser's authorized speech fallback invocation.
    // It neither changes game state nor sends a network command.
    await context.addInitScript(() => {
      window.__acceptanceSpeech = [];
      Object.defineProperty(window.speechSynthesis, "speak", {
        configurable: true,
        value: (utterance: SpeechSynthesisUtterance) =>
          window.__acceptanceSpeech.push(utterance.text),
      });
    });
    const page = await context.newPage();
    players.push(new PlayerBrowser(context, page, name));
    await page.goto("/");
  }
  return players;
}

export async function syncPlayers(
  players: PlayerBrowser[],
  revision: number,
): Promise<void> {
  await Promise.all(
    players.map((player) =>
      expect
        .poll(() => player.snapshot?.revision ?? -1, {
          intervals: [10, 20, 50, 100],
        })
        .toBeGreaterThanOrEqual(revision),
    ),
  );
}

export async function createRoom(
  players: PlayerBrowser[],
  kind: GameKind,
): Promise<string> {
  const host = players[0];
  await host.page.getByTestId("nickname").fill(host.name);
  await host.page.getByTestId(`game-${kind}`).click();
  await host.page.getByTestId("create-room").click();
  await expect.poll(() => host.snapshot?.roomCode).toBeTruthy();
  const code = host.snapshot!.roomCode;
  for (const player of players.slice(1)) {
    await player.page.getByTestId("nickname").fill(player.name);
    await player.page.getByTestId("room-code-input").fill(code);
    await player.page.getByTestId("join-room").click();
    await expect.poll(() => player.snapshot?.roomCode).toBe(code);
  }
  await syncPlayers(players, players.at(-1)!.snapshot!.revision);
  for (const player of players) {
    expect(player.snapshot!.players).toHaveLength(players.length);
    expect(player.sockets).toBe(1);
  }
  return code;
}

export async function startHand(players: PlayerBrowser[]): Promise<void> {
  for (const player of players) {
    if (
      !player.snapshot!.players.find(
        (person) => person.id === player.snapshot!.selfId,
      )!.ready
    ) {
      const revision = player.snapshot!.revision;
      await player.page.getByTestId("ready").click();
      await player.revisionAfter(revision);
      await syncPlayers(players, player.snapshot!.revision);
    }
  }
  const host = players.find(
    (player) => player.snapshot!.selfId === player.snapshot!.hostId,
  )!;
  const revision = host.snapshot!.revision;
  await host.page
    .getByTestId(
      host.snapshot!.game?.phase === "finished" ? "next-game" : "start-game",
    )
    .click();
  await host.revisionAfter(revision);
  await syncPlayers(players, host.snapshot!.revision);
}

export async function action(
  players: PlayerBrowser[],
  player: PlayerBrowser,
  testId: string,
  card?: Card,
): Promise<void> {
  const revision = player.snapshot!.revision;
  if (card) await player.page.locator(`[data-card-id="${card.id}"]`).click();
  await player.page.getByTestId(testId).click();
  await player.revisionAfter(revision);
  await syncPlayers(players, player.snapshot!.revision);
}

/** Each decision uses ONLY the acting browser's private hand and its public snapshot. */
export async function finishByLegalSingles(
  players: PlayerBrowser[],
  maxActions = 900,
  cooperateForDoubleTribute = false,
): Promise<number> {
  let count = 0;
  while (players[0].snapshot!.game!.phase !== "finished") {
    if (++count > maxActions)
      throw new Error(
        `Game did not finish within ${maxActions} legal UI actions`,
      );
    const publicTurn = players[0].snapshot!.game!.turn;
    const actor = players.find((player) => player.seat === publicTurn)!;
    const { game, hand } = actor.snapshot!;
    expect(game!.phase).toBe("playing");
    const strength =
      game!.kind === "doudizhu"
        ? (card: Card) => ddzStrength(card.rank)
        : (card: Card) => gdStrength(card.rank, game!.currentLevel!);
    const ownCards = [...hand].sort(
      (left, right) =>
        strength(left) - strength(right) || left.id.localeCompare(right.id),
    );
    // Voluntary public passes let seats 0 and 2 finish first. This is a legal
    // cooperative strategy, producing double tribute without fixture injection.
    const cooperate = cooperateForDoubleTribute && game!.finishOrder.length < 2;
    const card = game!.trick
      ? cooperate
        ? undefined
        : ownCards.find(
            (candidate) => strength(candidate) > game!.trick!.combination.power,
          )
      : ownCards[0];
    if (card) await action(players, actor, "play-cards", card);
    else await action(players, actor, "pass");
    if (count % 50 === 0)
      console.log(
        `${game!.kind}: ${count} legal UI moves; revision ${actor.snapshot!.revision}`,
      );
  }
  players.forEach((player) => player.assertClean());
  return count;
}

export async function resolveTribute(
  players: PlayerBrowser[],
  afterChoice?: (phase: string, actor: PlayerBrowser) => Promise<void>,
): Promise<string[]> {
  const phases: string[] = [];
  for (
    let steps = 0;
    steps < 8 && players[0].snapshot!.game!.phase !== "playing";
    steps++
  ) {
    const actor = players.find(
      (player) => player.seat === players[0].snapshot!.game!.turn,
    )!;
    const { game, hand } = actor.snapshot!;
    phases.push(game!.phase);
    if (game!.phase === "tribute")
      await action(
        players,
        actor,
        "submit-tribute",
        legalTributeCards(hand, game!.currentLevel!)[0],
      );
    else if (game!.phase === "return")
      await action(
        players,
        actor,
        "submit-return",
        legalReturnCards(hand, game!.currentLevel!)[0],
      );
    else if (game!.phase === "discard") {
      if (game!.tribute!.discarded.length === 0)
        await action(players, actor, "submit-discard", hand[0]);
      else await action(players, actor, "skip-discard");
    } else throw new Error(`Unexpected next-hand phase ${game!.phase}`);
    await afterChoice?.(game!.phase, actor);
  }
  expect(players[0].snapshot!.game!.phase).toBe("playing");
  return phases;
}

export async function screenshot(
  player: PlayerBrowser,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await player.page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: "image/png" });
}
