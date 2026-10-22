import { describe, expect, it } from "vitest";
import { seededRandom } from "../shared/cards";
import { suggestMoves } from "../shared/move-assistance";
import type { GameAction, GameKind } from "../shared/types";
import {
  applyPractice,
  createPractice,
  practiceSnapshot,
  stepPracticeBot,
  type PracticeSession,
} from "../client/practice";

function playAction(
  session: PracticeSession,
  action: GameAction,
): PracticeSession {
  return applyPractice(session, action);
}

function finishWithBots(kind: GameKind, seed: number): PracticeSession {
  let session = createPractice(kind, "练习者", true, seededRandom(seed));
  let steps = 0;
  while (session.game.phase !== "finished" && steps < 4000) {
    if (session.game.turn === 0) {
      if (
        session.game.kind === "doudizhu" &&
        session.game.phase === "bidding"
      ) {
        session = playAction(session, { type: "BID", value: 3 });
      } else if (
        session.game.kind === "guandan" &&
        session.game.phase === "tribute"
      ) {
        const card = session.game.tribute?.contributors.includes(0)
          ? session.game.hands[0].find((candidate) => candidate.rank < 15)
          : undefined;
        if (card)
          session = playAction(session, {
            type: "SELECT_TRIBUTE",
            cardId: card.id,
          });
        else session = stepPracticeBot(session);
      } else if (
        session.game.kind === "guandan" &&
        session.game.phase === "return"
      ) {
        const pair = session.game.tribute?.pairs.find(
          (candidate) => candidate.to === 0,
        );
        const card = pair ? session.game.hands[0][0] : undefined;
        if (card)
          session = playAction(session, {
            type: "SELECT_RETURN_CARD",
            cardId: card.id,
          });
        else session = stepPracticeBot(session);
      } else if (
        session.game.kind === "guandan" &&
        session.game.phase === "discard"
      ) {
        session = playAction(session, {
          type: "DISCARD_HOUSE_RULE",
          cardId: session.game.hands[0][0]?.id ?? null,
        });
      } else {
        const game = practiceSnapshot(session).game!;
        const moves = suggestMoves(session.game.hands[0], game);
        session = playAction(
          session,
          moves[0]
            ? {
                type: "PLAY_CARDS",
                cardIds: moves[0].cards.map((card) => card.id),
              }
            : { type: "PASS" },
        );
      }
    } else {
      const next = stepPracticeBot(session);
      expect(next.revision).toBe(session.revision + 1);
      session = next;
    }
    steps += 1;
  }
  expect(steps).toBeLessThan(4000);
  expect(session.game.phase).toBe("finished");
  return session;
}

describe("local practice sessions", () => {
  it.each([
    ["doudizhu", 17],
    ["guandan", 27],
  ] as const)(
    "keeps %s bot cards and hidden state private",
    (kind, handSize) => {
      const session = createPractice(kind, "练习者", true, seededRandom(11));
      const snapshot = practiceSnapshot(session);
      expect(snapshot.roomCode).toBe("PRACTICE");
      expect(snapshot.selfId).toBe("practice-you");
      expect(snapshot.hostId).toBe("practice-you");
      expect(snapshot.players.every((player) => player.ready)).toBe(true);
      expect(snapshot.hand).toHaveLength(handSize);
      expect(snapshot.game).not.toHaveProperty("hands");
      expect(snapshot.players.slice(1).map((player) => player.name)).toEqual(
        kind === "guandan"
          ? ["牛油果（电脑）", "小橘子（电脑）", "葡萄（电脑）"]
          : ["牛油果（电脑）", "小橘子（电脑）"],
      );
      if (kind === "doudizhu") {
        if (session.game.kind !== "doudizhu")
          throw new Error("expected Dou Dizhu");
        expect(session.game.bottom).toHaveLength(3);
        expect(snapshot.game?.bottom).toEqual([]);
      }
    },
  );

  it("never auto-acts for the human seat", () => {
    const session = createPractice("guandan", "练习者", true, seededRandom(4));
    const next = stepPracticeBot(session);
    expect(next).toBe(session);
    expect(next.revision).toBe(0);
    expect(next.game.turn).toBe(0);
  });

  it("forwards injected randomness through a human all-pass redeal", () => {
    const prepare = () => {
      const session = createPractice(
        "doudizhu",
        "练习者",
        true,
        seededRandom(8),
      );
      if (session.game.kind !== "doudizhu")
        throw new Error("expected Dou Dizhu");
      session.game.bids = [null, 0, 0];
      session.game.bidCount = 2;
      session.game.highBid = 0;
      session.game.highBidder = null;
      session.game.turn = 0;
      return session;
    };
    const first = applyPractice(
      prepare(),
      { type: "BID", value: 0 },
      seededRandom(900),
    );
    const second = applyPractice(
      prepare(),
      { type: "BID", value: 0 },
      seededRandom(900),
    );
    expect(first.game).toEqual(second.game);
    expect(first.game.handNumber).toBe(2);
    expect(first.game.phase).toBe("bidding");
  });

  it.each([
    ["doudizhu", 23],
    ["guandan", 29],
  ] as const)(
    "can complete a deterministic %s hand with one bot step at a time",
    (kind, seed) => {
      const first = finishWithBots(kind, seed);
      const second = finishWithBots(kind, seed);
      expect(first.game).toEqual(second.game);
    },
  );

  it("starts a Guandan next hand with level progress and tribute state", () => {
    const session = createPractice("guandan", "练习者", true, seededRandom(7));
    if (session.game.kind !== "guandan") throw new Error("expected Guandan");
    const previous = session.game;
    session.game.phase = "finished";
    session.game.turn = -1;
    session.game.finishOrder = [0, 2, 1, 3];
    session.game.winnerTeam = 0;
    session.game.matchWinner = null;
    const next = applyPractice(
      session,
      { type: "START_GAME" },
      seededRandom(31),
    );
    if (next.game.kind !== "guandan") throw new Error("expected Guandan");
    expect(next.game.handNumber).toBe(previous.handNumber + 1);
    expect(next.game.phase).toBe("tribute");
    expect(next.game.tribute).toMatchObject({
      kind: "double",
      contributors: [1, 3],
    });
    expect(next.game.previousFinish).toEqual([0, 2, 1, 3]);
    expect(next.game.levels[0]).toBeGreaterThanOrEqual(previous.levels[0]);
  });
});
