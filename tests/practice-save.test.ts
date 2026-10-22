import { describe, expect, it } from "vitest";
import {
  applyPractice,
  createPractice,
  practiceSnapshot,
  stepPracticeBot,
  type PracticeSession,
} from "../client/practice";
import {
  clearSavedPractice,
  PRACTICE_SAVE_KEY,
  readSavedPractice,
  savePractice,
} from "../client/practice-save";
import { seededRandom } from "../shared/cards";
import { legalReturnCards, legalTributeCards } from "../shared/guandan";
import { suggestMoves } from "../shared/move-assistance";
import type { RoomAction } from "../shared/types";

function memoryStorage() {
  let value: string | null = null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
    removeItem: () => {
      value = null;
    },
    raw: () => value,
  };
}

function restoreAfterStep(
  session: PracticeSession,
  checkpoint: PracticeSession | null,
  store: ReturnType<typeof memoryStorage>,
): PracticeSession {
  expect(savePractice(session, checkpoint, "normal", store)).toBe(true);
  const restored = readSavedPractice(store);
  expect(restored).not.toBeNull();
  expect(restored?.session).toEqual(session);
  expect(restored?.checkpoint).toEqual(checkpoint);
  return restored!.session;
}

function humanPracticeAction(session: PracticeSession): RoomAction | null {
  if (session.game.turn !== 0) return null;
  const game = session.game;
  if (game.kind === "doudizhu") {
    if (game.phase === "bidding") return { type: "BID", value: 3 };
  } else {
    if (game.phase === "tribute") {
      if (!game.tribute?.contributors.includes(0)) return null;
      const card = legalTributeCards(game.hands[0], game.currentLevel)[0];
      return card ? { type: "SELECT_TRIBUTE", cardId: card.id } : null;
    }
    if (game.phase === "return") {
      const pair = game.tribute?.pairs.find((candidate) => candidate.to === 0);
      if (!pair || game.tribute?.returned.includes(0)) return null;
      const card = legalReturnCards(game.hands[0], game.currentLevel)[0];
      return card ? { type: "SELECT_RETURN_CARD", cardId: card.id } : null;
    }
    if (game.phase === "discard") {
      if (
        !game.tribute?.contributors.includes(0) ||
        game.tribute.discarded.includes(0)
      )
        return null;
      return {
        type: "DISCARD_HOUSE_RULE",
        cardId: game.hands[0][0]?.id ?? null,
      };
    }
  }
  if (game.phase !== "playing") return null;
  const view = practiceSnapshot(session).game;
  const moves = view ? suggestMoves(game.hands[0], view) : [];
  return moves[0]
    ? { type: "PLAY_CARDS", cardIds: moves[0].cards.map((card) => card.id) }
    : { type: "PASS" };
}

describe("practice persistence", () => {
  it.each([
    ["doudizhu", 12],
    ["guandan", 22],
  ] as const)("round-trips a %s session and checkpoint", (kind, seed) => {
    const store = memoryStorage();
    let session = createPractice(kind, "保存练习", true, seededRandom(seed));
    const checkpoint: PracticeSession = structuredClone(session);
    session = applyPractice(
      session,
      kind === "doudizhu"
        ? { type: "BID", value: 1 }
        : { type: "PLAY_CARDS", cardIds: [session.game.hands[0][0].id] },
    );
    expect(savePractice(session, checkpoint, "normal", store)).toBe(true);
    expect(store.raw()).toBeTruthy();
    const loaded = readSavedPractice(store);
    expect(loaded?.version).toBe(1);
    expect(loaded?.pace).toBe("normal");
    expect(loaded?.session).toEqual(session);
    expect(loaded?.checkpoint).toEqual(checkpoint);
    expect(loaded?.savedAt).toEqual(expect.any(Number));
  });

  it("round-trips every deterministic Dou Dizhu action", () => {
    const store = memoryStorage();
    let session = createPractice(
      "doudizhu",
      "逐步练习",
      true,
      seededRandom(23),
    );
    let checkpoint: PracticeSession | null = null;
    let steps = 0;
    while (session.game.phase !== "finished" && steps < 4000) {
      const action = humanPracticeAction(session);
      if (action) {
        checkpoint = session;
        session = applyPractice(session, action);
      } else {
        const next = stepPracticeBot(session);
        expect(next).not.toBe(session);
        session = next;
      }
      session = restoreAfterStep(session, checkpoint, store);
      steps += 1;
    }
    expect(session.game.phase).toBe("finished");
    expect(steps).toBeLessThan(4000);
    const invalidFinished = JSON.parse(store.raw()!);
    invalidFinished.session.game.finishOrder.pop();
    store.setItem(PRACTICE_SAVE_KEY, JSON.stringify(invalidFinished));
    expect(readSavedPractice(store)).toBeNull();
  });

  it("round-trips every Guandan action through the next hand's exchanges", () => {
    const store = memoryStorage();
    let session = createPractice("guandan", "逐步练习", true, seededRandom(29));
    let checkpoint: PracticeSession | null = null;
    const firstHand = session.game.handNumber;
    const nextHandPhases = new Set<string>();
    let finishedGuandan: PracticeSession | null = null;
    let steps = 0;
    while (steps < 9000) {
      if (session.game.handNumber > firstHand)
        nextHandPhases.add(session.game.phase);
      if (
        session.game.handNumber > firstHand &&
        session.game.phase === "playing" &&
        nextHandPhases.has("tribute") &&
        nextHandPhases.has("return") &&
        nextHandPhases.has("discard")
      )
        break;

      let action = humanPracticeAction(session);
      if (!action && session.game.phase === "finished") {
        if (
          session.game.handNumber === firstHand &&
          session.game.kind === "guandan"
        ) {
          finishedGuandan = structuredClone(session);
          // Pin the valid double-tribute finish order so this lifecycle test
          // deterministically exercises return and the house-rule discard.
          session.game.finishOrder = [0, 2, 1, 3];
          session.game.winnerTeam = 0;
          session.game.matchWinner = null;
        }
        checkpoint = null;
        action = { type: "START_GAME" };
      }
      if (action) {
        if (action.type === "START_GAME") checkpoint = null;
        else checkpoint = session;
        session = applyPractice(
          session,
          action,
          action.type === "START_GAME" ? seededRandom(1) : undefined,
        );
      } else {
        const next = stepPracticeBot(session);
        expect(next).not.toBe(session);
        session = next;
      }
      session = restoreAfterStep(session, checkpoint, store);
      steps += 1;
    }
    expect(steps).toBeLessThan(9000);
    expect(session.game.handNumber).toBe(firstHand + 1);
    expect(nextHandPhases).toEqual(
      new Set(["tribute", "return", "discard", "playing"]),
    );
    expect(finishedGuandan).not.toBeNull();
    expect(savePractice(finishedGuandan!, null, "normal", store)).toBe(true);
    const invalidFinished = JSON.parse(store.raw()!);
    invalidFinished.session.game.finishOrder.pop();
    store.setItem(PRACTICE_SAVE_KEY, JSON.stringify(invalidFinished));
    expect(readSavedPractice(store)).toBeNull();
  });

  it("accepts a missing checkpoint and clears a saved session", () => {
    const store = memoryStorage();
    const session = createPractice("doudizhu", "练习", false, seededRandom(3));
    expect(savePractice(session, null, "quick", store)).toBe(true);
    expect(readSavedPractice(store)?.checkpoint).toBeNull();
    expect(clearSavedPractice(store)).toBe(true);
    expect(readSavedPractice(store)).toBeNull();
  });

  it("rejects malformed JSON, unknown schema fields, invalid cards, and oversized saves", () => {
    const store = memoryStorage();
    const session = createPractice("doudizhu", "练习", true, seededRandom(5));
    expect(savePractice(session, null, "relaxed", store)).toBe(true);

    const valid = JSON.parse(store.raw()!);
    store.setItem("ignored", "not-json");
    store.setItem(PRACTICE_SAVE_KEY, "{broken");
    expect(readSavedPractice(store)).toBeNull();

    store.setItem(PRACTICE_SAVE_KEY, JSON.stringify({ ...valid, extra: true }));
    expect(readSavedPractice(store)).toBeNull();
    const invalidCard = structuredClone(valid);
    invalidCard.session.game.hands[0][0].id = "0-C-99";
    store.setItem(PRACTICE_SAVE_KEY, JSON.stringify(invalidCard));
    expect(readSavedPractice(store)).toBeNull();
    store.setItem(PRACTICE_SAVE_KEY, "x".repeat(300_000));
    expect(readSavedPractice(store)).toBeNull();
  });

  it("rejects impossible active turns, DDZ trick seats, missing cards, and bottom overlap", () => {
    const store = memoryStorage();
    const session = createPractice("doudizhu", "练习", true, seededRandom(15));
    expect(savePractice(session, null, "normal", store)).toBe(true);
    const valid = JSON.parse(store.raw()!);
    const invalidTurn = structuredClone(valid);
    invalidTurn.session.game.hands[0] = [];
    invalidTurn.session.game.turn = 0;
    store.setItem(PRACTICE_SAVE_KEY, JSON.stringify(invalidTurn));
    expect(readSavedPractice(store)).toBeNull();

    let played = createPractice("doudizhu", "练习", true, seededRandom(15));
    played = applyPractice(played, { type: "BID", value: 3 });
    played = applyPractice(played, {
      type: "PLAY_CARDS",
      cardIds: [played.game.hands[0][0].id],
    });
    expect(savePractice(played, null, "normal", store)).toBe(true);
    const invalidTrick = JSON.parse(store.raw()!);
    invalidTrick.session.game.trick.seat = 3;
    store.setItem(PRACTICE_SAVE_KEY, JSON.stringify(invalidTrick));
    expect(readSavedPractice(store)).toBeNull();

    const missingCard = structuredClone(valid);
    missingCard.session.game.hands[0].pop();
    store.setItem(PRACTICE_SAVE_KEY, JSON.stringify(missingCard));
    expect(readSavedPractice(store)).toBeNull();

    const overlappingBottom = structuredClone(valid);
    overlappingBottom.session.game.hands[0][0] =
      overlappingBottom.session.game.bottom[0];
    store.setItem(PRACTICE_SAVE_KEY, JSON.stringify(overlappingBottom));
    expect(readSavedPractice(store)).toBeNull();
  });

  it("rejects an undo checkpoint from another player, game, future hand, or revision", () => {
    const store = memoryStorage();
    const session = createPractice("doudizhu", "练习", true, seededRandom(6));
    expect(savePractice(session, session, "normal", store)).toBe(true);
    type CheckpointShape = {
      name: string;
      game: { kind: string; handNumber: number };
      revision: number;
    };
    const valid = JSON.parse(store.raw()!) as {
      session: { revision: number };
      checkpoint: CheckpointShape;
    };
    const mutators: Array<(checkpoint: CheckpointShape) => void> = [
      (checkpoint) => {
        checkpoint.name = "别人";
      },
      (checkpoint) => {
        checkpoint.game.kind = "guandan";
      },
      (checkpoint) => {
        checkpoint.game.handNumber += 1;
      },
      (checkpoint) => {
        checkpoint.revision = valid.session.revision + 1;
      },
    ];
    for (const mutate of mutators) {
      const candidate = structuredClone(valid);
      mutate(candidate.checkpoint);
      store.setItem(PRACTICE_SAVE_KEY, JSON.stringify(candidate));
      expect(readSavedPractice(store)).toBeNull();
    }
  });

  it("allows a Dou Dizhu checkpoint from the hand before an automatic redeal", () => {
    const store = memoryStorage();
    const session = createPractice("doudizhu", "练习", true, seededRandom(6));
    expect(savePractice(session, session, "normal", store)).toBe(true);
    const candidate = JSON.parse(store.raw()!);
    candidate.session.game.handNumber = 2;
    candidate.session.revision = 1;
    candidate.checkpoint.game.handNumber = 1;
    candidate.checkpoint.revision = 0;
    store.setItem(PRACTICE_SAVE_KEY, JSON.stringify(candidate));
    expect(readSavedPractice(store)).not.toBeNull();
  });

  it("turns throwing or unavailable storage into safe failures", () => {
    const session = createPractice("guandan", "练习", true, seededRandom(8));
    const readThrows = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    const writeThrows = {
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const removeThrows = {
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readSavedPractice(readThrows)).toBeNull();
    expect(savePractice(session, null, "normal", writeThrows)).toBe(false);
    expect(clearSavedPractice(removeThrows)).toBe(false);
  });

  it("does not write a structurally invalid session", () => {
    const store = memoryStorage();
    const invalid = {
      game: { kind: "unknown" },
      name: "x",
      revision: 0,
      houseRule: true,
    } as unknown as PracticeSession;
    expect(savePractice(invalid, null, "normal", store)).toBe(false);
    expect(store.raw()).toBeNull();
  });
});
