import { describe, expect, it } from "vitest";
import { makeDeck, seededRandom, type Card } from "../shared/cards";
import type { GameAction, PublicGame } from "../shared/types";
import {
  applyPractice,
  createPractice,
  practiceSnapshot,
  stepPracticeBot,
} from "../client/practice";
import {
  choosePracticePlay,
  rankPracticeMoves,
} from "../client/practice-strategy";

function cardsAt(ranks: number[], deck = 0): Card[] {
  const deckCards = makeDeck(2).filter((card) => card.deck === deck);
  const used = new Set<string>();
  return ranks.map((rank) => {
    const card = deckCards.find(
      (candidate) =>
        candidate.rank === rank &&
        candidate.suit !== "J" &&
        !used.has(candidate.id),
    );
    if (!card) throw new Error(`missing rank ${rank}`);
    used.add(card.id);
    return card;
  });
}

function freshView(kind: "guandan" | "doudizhu"): PublicGame {
  return practiceSnapshot(createPractice(kind, "tester", true, seededRandom(4)))
    .game!;
}

function setPlaying(view: PublicGame): PublicGame {
  return {
    ...view,
    phase: "playing",
    trick: null,
    passed: [],
    turn: 0,
  };
}

function ids(action: GameAction): string[] {
  return action.type === "PLAY_CARDS" ? action.cardIds : [];
}

describe("practice bot strategy", () => {
  it("leads a useful group while preserving a bomb", () => {
    const hand = [
      ...cardsAt([3, 3, 3, 3]),
      ...cardsAt([4, 4]),
      ...cardsAt([5, 5]),
      ...cardsAt([6]),
    ];
    const view = setPlaying(freshView("doudizhu"));
    view.landlord = 0;
    const action = choosePracticePlay(hand, view, 0, {
      publicCounts: [hand.length, 10, 10],
    });
    expect(action?.type).toBe("PLAY_CARDS");
    const played = hand.filter((card) => ids(action!).includes(card.id));
    expect(played).toHaveLength(2);
    expect(new Set(played.map((card) => card.rank))).toEqual(new Set([4]));
  });

  it("holds a sole bomb until an opponent is threatening", () => {
    const hand = [...cardsAt([9, 9, 9, 9]), ...cardsAt([6])];
    const view = setPlaying(freshView("doudizhu"));
    view.landlord = 1;
    view.turn = 2;
    view.trick = {
      seat: 1,
      cards: cardsAt([5, 5, 6, 6, 7, 7], 1),
      combination: {
        kind: "pair-chain",
        size: 6,
        power: 7,
        chain: 3,
        bomb: 0,
        label: "pair",
      },
    };
    const safe = choosePracticePlay(hand, view, 2, {
      publicCounts: [10, 8, hand.length],
    });
    expect(safe).toEqual({ type: "PASS" });

    const urgent = choosePracticePlay(hand, view, 2, {
      publicCounts: [10, 1, hand.length],
    });
    expect(urgent?.type).toBe("PLAY_CARDS");
    expect(ids(urgent!)).toHaveLength(4);
  });

  it("passes a teammate's lead unless it can finish the hand", () => {
    const hand = cardsAt([3, 4]);
    const view = setPlaying(freshView("guandan"));
    view.turn = 2;
    view.trick = {
      seat: 0,
      cards: cardsAt([8, 8], 1),
      combination: {
        kind: "pair",
        size: 2,
        power: 8,
        chain: 1,
        bomb: 0,
        label: "pair",
      },
    };
    expect(choosePracticePlay(hand, view, 2)).toEqual({ type: "PASS" });

    const winningHand = cardsAt([9, 9], 1);
    const winningView = { ...view, turn: 2 };
    expect(choosePracticePlay(winningHand, winningView, 2)).toMatchObject({
      type: "PLAY_CARDS",
      cardIds: winningHand.map((card) => card.id),
    });
  });

  it("plays a full-hand Guandan bomb instead of conserving the winning finish", () => {
    const hand = [...cardsAt([9, 9, 9, 9]), ...cardsAt([9, 9], 1)];
    const view = setPlaying(freshView("guandan"));
    view.turn = 0;
    view.trick = {
      seat: 1,
      cards: [...cardsAt([8, 8, 8, 8], 1), ...cardsAt([8])],
      combination: {
        kind: "bomb",
        size: 5,
        power: 8,
        chain: 1,
        bomb: 5,
        label: "bomb",
      },
    };
    const action = choosePracticePlay(hand, view, 0, {
      publicCounts: [hand.length, 8, 8, 8],
    });
    expect(action?.type).toBe("PLAY_CARDS");
    expect(ids(action!)).toHaveLength(hand.length);
  });

  it("uses a stronger single when an opponent has one card left", () => {
    const hand = cardsAt([3, 13, 13]);
    const view = setPlaying(freshView("guandan"));
    view.currentLevel = 4;
    view.turn = 2;
    view.trick = {
      seat: 1,
      cards: cardsAt([2], 1),
      combination: {
        kind: "single",
        size: 1,
        power: 2,
        chain: 1,
        bomb: 0,
        label: "single",
      },
    };
    const response = choosePracticePlay(hand, view, 2, {
      publicCounts: [10, 1, hand.length, 8],
    });
    expect(response?.type).toBe("PLAY_CARDS");
    expect(ids(response!)).toEqual([hand[1].id]);

    const leadView = { ...view, trick: null, turn: 2 };
    const lead = choosePracticePlay(hand, leadView, 2, {
      publicCounts: [10, 1, hand.length, 8],
    });
    expect(lead?.type).toBe("PLAY_CARDS");
    expect(ids(lead!)).toEqual([hand[1].id, hand[2].id]);
  });

  it("is independent of hidden opponent card identities", () => {
    const hand = cardsAt([4, 4, 7]);
    const view = setPlaying(freshView("doudizhu"));
    view.landlord = 0;
    const first = rankPracticeMoves(hand, view, 1, {
      publicCounts: [8, hand.length, 8],
    }).map((move) => move.cards.map((card) => card.id));
    const hiddenView = structuredClone(view) as PublicGame & {
      hands: Card[][];
    };
    hiddenView.hands = [cardsAt([14, 14]), cardsAt([2, 2]), cardsAt([3, 3])];
    const second = rankPracticeMoves(hand, hiddenView, 1, {
      publicCounts: [8, hand.length, 8],
    }).map((move) => move.cards.map((card) => card.id));
    expect(second).toEqual(first);
  });

  it("keeps a deterministic practice hand progressing", () => {
    let session = createPractice("doudizhu", "tester", true, seededRandom(41));
    let steps = 0;
    while (session.game.phase !== "finished" && steps < 2500) {
      if (session.game.turn === 0) {
        if (session.game.phase === "bidding") {
          session = applyPractice(session, { type: "BID", value: 1 });
        } else {
          const view = practiceSnapshot(session).game!;
          const move = rankPracticeMoves(session.game.hands[0], view, 0)[0];
          session = applyPractice(
            session,
            move
              ? {
                  type: "PLAY_CARDS",
                  cardIds: move.cards.map((card) => card.id),
                }
              : { type: "PASS" },
          );
        }
      } else {
        session = stepPracticeBot(session);
      }
      steps += 1;
    }
    expect(session.game.phase).toBe("finished");
    expect(steps).toBeLessThan(2500);
  });
});
