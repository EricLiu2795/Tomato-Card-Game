import { describe, expect, it, vi } from "vitest";
import { ddzStrength, makeDeck, seededRandom } from "../shared/cards";
import type { Card, Suit } from "../shared/cards";
import { applyDoudizhu, createDoudizhu } from "../shared/doudizhu";
import type { DoudizhuState, GameAction } from "../shared/types";

const card = (rank: number, suit: Suit = "C") =>
  makeDeck().find((c) => c.rank === rank && c.suit === suit)!;
const play = (cards: Card[]): GameAction => ({
  type: "PLAY_CARDS",
  cardIds: cards.map((c) => c.id),
});

function invariant(state: DoudizhuState) {
  const owned = [
    ...state.hands.flat(),
    ...state.played,
    ...state.removed,
    ...(state.phase === "bidding" ? state.bottom : []),
  ];
  expect(owned).toHaveLength(54);
  expect(new Set(owned.map((c) => c.id)).size).toBe(54);
  expect(owned.map((c) => c.id).sort()).toEqual(
    makeDeck()
      .map((c) => c.id)
      .sort(),
  );
  expect(state.scores.reduce((a, b) => a + b, 0)).toBe(0);
}

function playing(seed = 42): DoudizhuState {
  const state = createDoudizhu({ random: seededRandom(seed) });
  return applyDoudizhu(state, state.turn, { type: "BID", value: 3 });
}

function scripted(hands: Card[][], turn = 0): DoudizhuState {
  const state = playing();
  const ids = new Set(hands.flat().map((c) => c.id));
  state.hands = hands;
  state.played = makeDeck().filter((c) => !ids.has(c.id));
  state.turn = turn;
  state.highBid = 1;
  state.playCounts = [1, 1, 1];
  return state;
}

function rejectsWithoutMutation(
  state: DoudizhuState,
  seat: number,
  action: GameAction,
) {
  const before = structuredClone(state);
  expect(() => applyDoudizhu(state, seat, action)).toThrow();
  expect(state).toEqual(before);
}

describe("Dou Dizhu bidding and deals", () => {
  it("deals a unique single deck as 17 / 17 / 17 + 3 and supports reproducible creation", () => {
    const state = createDoudizhu({ random: seededRandom(123) });
    expect(state.hands.map((h) => h.length)).toEqual([17, 17, 17]);
    expect(state.bottom).toHaveLength(3);
    expect(state.phase).toBe("bidding");
    expect(state.turn).toBe(0);
    expect(state).toEqual(createDoudizhu({ random: seededRandom(123) }));
    invariant(state);
  });

  it("awards all three bottom cards and first play immediately on a bid of 3", () => {
    const start = createDoudizhu({ random: seededRandom(4), handNumber: 2 });
    const before = structuredClone(start);
    const state = applyDoudizhu(start, 1, { type: "BID", value: 3 });
    expect(start).toEqual(before);
    expect(state).toMatchObject({
      phase: "playing",
      landlord: 1,
      highBid: 3,
      highBidder: 1,
      turn: 1,
      bidCount: 1,
    });
    expect(state.bids).toEqual([null, 3, null]);
    expect(state.hands.map((h) => h.length)).toEqual([17, 20, 17]);
    for (const c of state.bottom) expect(state.hands[1]).toContainEqual(c);
    invariant(state);
  });

  it("allows one increasing bid or pass each, then awards the highest bidder", () => {
    let state = createDoudizhu({ random: seededRandom(9) });
    state = applyDoudizhu(state, 0, { type: "BID", value: 1 });
    state = applyDoudizhu(state, 1, { type: "BID", value: 2 });
    state = applyDoudizhu(state, 2, { type: "BID", value: 0 });
    expect(state).toMatchObject({
      phase: "playing",
      landlord: 1,
      turn: 1,
      bidCount: 3,
      highBid: 2,
    });
    expect(state.bids).toEqual([1, 2, 0]);
    invariant(state);
  });

  it("redeals after all pass, rotates the first bidder, and supports deterministic injected randomness", () => {
    const start = createDoudizhu({ random: seededRandom(18) });
    const allPass = (initial: DoudizhuState) => {
      let state = initial;
      const random = seededRandom(981);
      for (let i = 0; i < 3; i++)
        state = applyDoudizhu(
          state,
          state.turn,
          { type: "BID", value: 0 },
          random,
        );
      return state;
    };
    const state = allPass(start);
    expect(state).toEqual(allPass(start));
    expect(state).toMatchObject({
      phase: "bidding",
      landlord: null,
      bidCount: 0,
      highBid: 0,
      highBidder: null,
      handNumber: 2,
      turn: 1,
    });
    expect(state.bids).toEqual([null, null, null]);
    expect(state.hands.map((h) => h.length)).toEqual([17, 17, 17]);
    expect(state.hands).not.toEqual(start.hands);
    expect(state.history.some((h) => h.text.includes("三家不叫"))).toBe(true);
    invariant(start);
    invariant(state);
    const again = allPass(state);
    expect(again.handNumber).toBe(3);
    expect(again.turn).toBe(2);
    invariant(again);
  });

  it("uses fresh random entropy on each production all-pass redeal", () => {
    let state = createDoudizhu({ random: seededRandom(18) });
    state = applyDoudizhu(state, 0, { type: "BID", value: 0 });
    state = applyDoudizhu(state, 1, { type: "BID", value: 0 });
    const entropy = vi.spyOn(crypto, "getRandomValues");
    try {
      const a = applyDoudizhu(state, 2, { type: "BID", value: 0 });
      expect(entropy).toHaveBeenCalled();
      entropy.mockClear();
      const b = applyDoudizhu(state, 2, { type: "BID", value: 0 });
      expect(entropy).toHaveBeenCalled();
      invariant(a);
      invariant(b);
    } finally {
      entropy.mockRestore();
    }
  });

  it("rejects illegal auction actions and invalid or non-increasing bids immutably", () => {
    const start = createDoudizhu({ random: seededRandom(1) });
    for (const value of [-1, 4, 1.5, NaN, Infinity])
      rejectsWithoutMutation(start, 0, { type: "BID", value });
    rejectsWithoutMutation(start, 1, { type: "BID", value: 1 });
    rejectsWithoutMutation(start, 0, { type: "PASS" });
    rejectsWithoutMutation(start, 0, play([start.hands[0][0]]));
    const state = applyDoudizhu(start, 0, { type: "BID", value: 2 });
    rejectsWithoutMutation(state, 1, { type: "BID", value: 1 });
    rejectsWithoutMutation(state, 1, { type: "BID", value: 2 });
    rejectsWithoutMutation(state, 0, { type: "BID", value: 3 });
    expect(() => createDoudizhu({ handNumber: 0 })).toThrow();
  });
});

describe("Dou Dizhu authoritative turns", () => {
  it("rejects out-of-turn, unowned, duplicated, empty, invalid, and losing selections without mutation", () => {
    let state = scripted([
      [card(3), card(4), card(7)],
      [card(5), card(6), card(8)],
      [card(9), card(10)],
    ]);
    rejectsWithoutMutation(state, -1, { type: "PASS" });
    rejectsWithoutMutation(state, 1, play([card(5)]));
    rejectsWithoutMutation(state, 0, play([card(5)]));
    rejectsWithoutMutation(state, 0, play([card(3), card(3)]));
    rejectsWithoutMutation(state, 0, { type: "PLAY_CARDS", cardIds: [] });
    rejectsWithoutMutation(state, 0, play([card(3), card(4)]));
    rejectsWithoutMutation(state, 0, { type: "BID", value: 3 });
    rejectsWithoutMutation(state, 0, { type: "PASS" });
    state = applyDoudizhu(state, 0, play([card(7)]));
    rejectsWithoutMutation(state, 1, play([card(6)]));
    invariant(state);
  });

  it("returns leadership to the last successful player after exactly two passes", () => {
    let state = scripted([
      [card(3), card(4)],
      [card(5), card(6)],
      [card(7), card(8)],
    ]);
    state = applyDoudizhu(state, 0, play([card(3)]));
    state = applyDoudizhu(state, 1, { type: "PASS" });
    expect(state.turn).toBe(2);
    expect(state.passed).toEqual([1]);
    expect(state.trick?.seat).toBe(0);
    state = applyDoudizhu(state, 2, { type: "PASS" });
    expect(state.turn).toBe(0);
    expect(state.trick).toBeNull();
    expect(state.passed).toEqual([]);
    rejectsWithoutMutation(state, 0, { type: "PASS" });
    invariant(state);
  });

  it("clears earlier passes when a player beats the trick and permits re-entry next rotation", () => {
    let state = scripted([
      [card(3), card(7), card(10)],
      [card(4), card(8), card(11)],
      [card(5), card(9), card(12)],
    ]);
    state = applyDoudizhu(state, 0, play([card(3)]));
    state = applyDoudizhu(state, 1, { type: "PASS" });
    state = applyDoudizhu(state, 2, play([card(5)]));
    expect(state.passed).toEqual([]);
    state = applyDoudizhu(state, 0, { type: "PASS" });
    state = applyDoudizhu(state, 1, play([card(8)]));
    expect(state.trick?.seat).toBe(1);
    expect(state.passed).toEqual([]);
    invariant(state);
  });

  it("accepts a pure-looking airplane as legal single wings when answering that table pattern", () => {
    const triples = (ranks: number[]) =>
      ranks.flatMap((rank) => [card(rank), card(rank, "D"), card(rank, "H")]);
    const first = [...triples([3, 4, 5]), card(11), card(12), card(13)];
    const second = triples([6, 7, 8, 9]);
    let state = scripted([
      [...first, card(14)],
      [...second, card(2, "D")],
      [card(2)],
    ]);
    state = applyDoudizhu(state, 0, play(first));
    expect(state.trick?.combination).toMatchObject({
      kind: "airplane-single",
      chain: 3,
      power: 5,
    });
    state = applyDoudizhu(state, 1, play(second));
    expect(state.trick?.combination).toMatchObject({
      kind: "airplane-single",
      chain: 3,
      power: 9,
    });
    invariant(state);
  });
});

describe("Dou Dizhu settlement", () => {
  it("settles a landlord win using the bid and multiplier with no spring after farmers played", () => {
    const state = scripted([[card(9)], [card(3)], [card(4)]]);
    state.highBid = 2;
    const end = applyDoudizhu(state, 0, play([card(9)]));
    expect(end).toMatchObject({
      phase: "finished",
      winnerTeam: "landlord",
      finishOrder: [0],
      multiplier: 1,
    });
    expect(end.scores).toEqual([4, -2, -2]);
    invariant(end);
    rejectsWithoutMutation(end, end.turn, { type: "PASS" });
    rejectsWithoutMutation(end, 0, play([card(9)]));
  });

  it("gives both farmers the win when either empties their hand", () => {
    const state = scripted(
      [[card(3), card(4)], [card(9)], [card(5), card(6)]],
      1,
    );
    state.playCounts[0] = 2;
    state.highBid = 3;
    const end = applyDoudizhu(state, 1, play([card(9)]));
    expect(end.winnerTeam).toBe("farmers");
    expect(end.finishOrder).toEqual([1]);
    expect(end.hands[2]).toHaveLength(2);
    expect(end.scores).toEqual([-6, 3, 3]);
    invariant(end);
  });

  it("doubles for each bomb and rocket, then doubles again for spring", () => {
    let state = scripted([
      [
        card(3),
        card(3, "D"),
        card(3, "H"),
        card(3, "S"),
        card(15, "J"),
        card(16, "J"),
      ],
      [card(4)],
      [card(5)],
    ]);
    state.highBid = 3;
    state.playCounts = [0, 0, 0];
    state = applyDoudizhu(state, 0, play(state.hands[0].slice(0, 4)));
    expect(state.multiplier).toBe(2);
    state = applyDoudizhu(state, 1, { type: "PASS" });
    state = applyDoudizhu(state, 2, { type: "PASS" });
    state = applyDoudizhu(state, 0, play(state.hands[0]));
    expect(state.multiplier).toBe(8);
    expect(state.scores).toEqual([48, -24, -24]);
    expect(state.history.some((h) => h.text.startsWith("春天"))).toBe(true);
    invariant(state);
  });

  it("doubles for anti-spring when farmers win after exactly one landlord play", () => {
    const state = scripted([[card(3)], [card(9)], [card(5)]], 1);
    state.playCounts = [1, 0, 0];
    const end = applyDoudizhu(state, 1, play([card(9)]));
    expect(end.multiplier).toBe(2);
    expect(end.scores).toEqual([-4, 2, 2]);
    expect(end.history.some((h) => h.text.startsWith("反春天"))).toBe(true);
    invariant(end);
  });

  it("does not treat four-with-two as a bomb", () => {
    const state = scripted([
      [card(3), card(3, "D"), card(3, "H"), card(3, "S"), card(4), card(5)],
      [card(6)],
      [card(7)],
    ]);
    const end = applyDoudizhu(state, 0, play(state.hands[0]));
    expect(end.multiplier).toBe(1);
    expect(end.scores).toEqual([2, -1, -1]);
    invariant(end);
  });

  it("plays a complete reproducible game and conserves all 54 cards after every legal action", () => {
    const simulate = () => {
      let state = playing(987654);
      let actions = 0;
      while (state.phase !== "finished" && actions < 1000) {
        const previous = state;
        const before = structuredClone(state);
        const hand = [...state.hands[state.turn]].sort(
          (a, b) =>
            ddzStrength(a.rank) - ddzStrength(b.rank) ||
            a.id.localeCompare(b.id),
        );
        const selected = hand.find(
          (c) =>
            !state.trick || ddzStrength(c.rank) > state.trick.combination.power,
        );
        const action: GameAction = selected
          ? play([selected])
          : { type: "PASS" };
        state = applyDoudizhu(state, state.turn, action);
        expect(previous).toEqual(before);
        expect(state).not.toBe(previous);
        invariant(state);
        actions += 1;
      }
      expect(actions).toBeLessThan(1000);
      expect(state.phase).toBe("finished");
      expect(state.hands[state.finishOrder[0]]).toEqual([]);
      expect(state.scores.some((score) => score > 0)).toBe(true);
      return state;
    };
    expect(simulate()).toEqual(simulate());
  });
});
