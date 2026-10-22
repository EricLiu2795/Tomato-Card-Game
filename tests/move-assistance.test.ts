import { describe, expect, it } from "vitest";
import { makeDeck, type Card } from "../shared/cards";
import { classifyDoudizhu } from "../shared/doudizhu-combinations";
import { classifyGuandan } from "../shared/guandan-combinations";
import {
  selectionCanPlay,
  suggestMoves,
  type SuggestedMove,
} from "../shared/move-assistance";
import type { PublicGame, Trick } from "../shared/types";

function take(
  deck: Card[],
  rank: number,
  count: number,
  suit?: Card["suit"],
): Card[] {
  const selected: Card[] = [];
  for (const card of deck) {
    if (card.rank !== rank || (suit && card.suit !== suit)) continue;
    selected.push(card);
    if (selected.length === count) return selected;
  }
  throw new Error(`Not enough cards for ${rank}`);
}

function game(
  kind: PublicGame["kind"],
  trick: Trick | null = null,
): PublicGame {
  return {
    kind,
    phase: "playing",
    turn: 0,
    trick,
    passed: [],
    finishOrder: [],
    history: [],
    handNumber: 1,
    removed: [],
    currentLevel: kind === "guandan" ? 7 : undefined,
  };
}

function guandanTrick(cards: Card[], level = 7): Trick {
  const combination = classifyGuandan(cards, level);
  if (!combination) throw new Error("Invalid Guandan fixture");
  return { seat: 1, cards, combination };
}

function doudizhuTrick(cards: Card[]): Trick {
  const combination = classifyDoudizhu(cards);
  if (!combination) throw new Error("Invalid Dou Dizhu fixture");
  return { seat: 1, cards, combination };
}

function hasKind(moves: SuggestedMove[], kind: string): boolean {
  return moves.some((move) => move.combination.kind === kind);
}

describe("move assistance", () => {
  it("finds a legal Dou Dizhu response and excludes weaker pairs", () => {
    const deck = makeDeck();
    const target = take(deck, 3, 2);
    const response = take(deck, 4, 2);
    const hand = [...response, ...take(deck, 5, 1)];
    const current = game("doudizhu", doudizhuTrick(target));

    expect(selectionCanPlay(response, current)).toBe(true);
    expect(selectionCanPlay(take(deck, 2, 1), current)).toBe(false);
    expect(
      suggestMoves(hand, current).some(
        (move) =>
          move.combination.kind === "pair" &&
          move.cards.every((card) => card.rank === 4),
      ),
    ).toBe(true);
  });

  it("uses a Guandan level wildcard to complete a pair", () => {
    const deck = makeDeck(2);
    const fixed = take(deck, 8, 1, "C")[0];
    const wild = take(deck, 7, 1, "H")[0];
    const hand = [fixed, wild];
    const before = structuredClone(hand);
    const moves = suggestMoves(hand, game("guandan"));

    expect(hasKind(moves, "pair")).toBe(true);
    expect(
      moves.some(
        (move) =>
          move.cards.length === 2 &&
          move.cards.some((card) => card.id === wild.id),
      ),
    ).toBe(true);
    expect(hand).toEqual(before);
  });

  it.each([
    {
      name: "ordinary consecutive pairs",
      ranks: [6, 7, 8],
      target: [2, 3, 4],
      power: 8,
    },
    {
      name: "the high QQKKAA boundary",
      ranks: [12, 13, 14],
      target: [9, 10, 11],
      power: 14,
    },
  ])("suggests $name over a lower pair run", ({ ranks, target, power }) => {
    const deck = makeDeck(2);
    const hand = ranks.flatMap((rank) => take(deck, rank, 2));
    const current = game(
      "guandan",
      guandanTrick(target.flatMap((rank) => take(deck, rank, 2))),
    );

    expect(selectionCanPlay(hand, current)).toBe(true);
    const moves = suggestMoves(hand, current);
    const response = moves.find((move) => move.combination.kind === "pair_run");
    expect(response?.combination).toMatchObject({ size: 6, chain: 3, power });
    expect(response?.cards.map((card) => card.id).sort()).toEqual(
      hand.map((card) => card.id).sort(),
    );
    expect(moves.every((move) => selectionCanPlay(move.cards, current))).toBe(
      true,
    );
  });

  it("uses a level wildcard to complete the third consecutive pair in a response", () => {
    const deck = makeDeck(2);
    const wild = take(deck, 7, 1, "H")[0];
    const hand = [
      ...take(deck, 8, 2),
      ...take(deck, 9, 2),
      ...take(deck, 10, 1),
      wild,
    ];
    const current = game(
      "guandan",
      guandanTrick([3, 4, 5].flatMap((rank) => take(deck, rank, 2))),
    );

    expect(selectionCanPlay(hand, current)).toBe(true);
    const response = suggestMoves(hand, current).find(
      (move) => move.combination.kind === "pair_run",
    );
    expect(response?.combination).toMatchObject({
      size: 6,
      chain: 3,
      power: 10,
    });
    expect(response?.combination.substitutions?.[wild.id]).toMatchObject({
      rank: 10,
    });
    expect(response?.cards.map((card) => card.id).sort()).toEqual(
      hand.map((card) => card.id).sort(),
    );
  });

  it("retains the documented low-ace AA2233 pair-run lead", () => {
    const deck = makeDeck(2);
    const hand = [14, 2, 3].flatMap((rank) => take(deck, rank, 2));
    const current = game("guandan");
    const response = suggestMoves(hand, current).find(
      (move) => move.combination.kind === "pair_run",
    );
    expect(response?.combination).toMatchObject({
      size: 6,
      chain: 3,
      power: 3,
    });
    expect(selectionCanPlay(response?.cards ?? [], current)).toBe(true);
  });

  it.each([
    {
      name: "ordinary consecutive triples",
      ranks: [5, 6],
      target: [2, 3],
      power: 6,
    },
    {
      name: "the high KKKAAA boundary",
      ranks: [13, 14],
      target: [10, 11],
      power: 14,
    },
    { name: "the low-ace AAA222 lead", ranks: [14, 2], target: [], power: 2 },
  ])("preserves $name", ({ ranks, target, power }) => {
    const deck = makeDeck(2);
    const hand = ranks.flatMap((rank) => take(deck, rank, 3));
    const current = game(
      "guandan",
      target.length
        ? guandanTrick(target.flatMap((rank) => take(deck, rank, 3)))
        : null,
    );
    const response = suggestMoves(hand, current).find(
      (move) => move.combination.kind === "triple_run",
    );
    expect(response?.combination).toMatchObject({ size: 6, chain: 2, power });
    expect(selectionCanPlay(response?.cards ?? [], current)).toBe(true);
  });

  it("offers special bombs when they are the only way over a trick", () => {
    const deck = makeDeck(2);
    const target = take(deck, 14, 3);
    const bomb = [...take(deck, 2, 4)];
    const current = game("guandan", guandanTrick(target));
    const moves = suggestMoves(bomb, current);
    expect(moves.some((move) => move.combination.kind === "bomb")).toBe(true);
    expect(moves.every((move) => selectionCanPlay(move.cards, current))).toBe(
      true,
    );

    const ddzDeck = makeDeck();
    const rocket = [...take(ddzDeck, 15, 1), ...take(ddzDeck, 16, 1)];
    const ddzMoves = suggestMoves(
      rocket,
      game("doudizhu", doudizhuTrick(take(ddzDeck, 2, 1))),
    );
    expect(ddzMoves.some((move) => move.combination.kind === "rocket")).toBe(
      true,
    );
  });

  it("returns deterministic bounded suggestions without mutating a large hand", () => {
    const hand = makeDeck(2);
    const before = structuredClone(hand);
    const moves = suggestMoves(hand, game("guandan"));
    const repeated = suggestMoves(hand, game("guandan"));
    expect(hand).toEqual(before);
    expect(moves.length).toBeLessThanOrEqual(256);
    expect(moves.map((move) => move.cards.map((card) => card.id))).toEqual(
      repeated.map((move) => move.cards.map((card) => card.id)),
    );
  });
});
