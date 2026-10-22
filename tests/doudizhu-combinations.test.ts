import { describe, expect, it } from "vitest";
import { makeDeck, type Card } from "../shared/cards";
import {
  beatsDoudizhu,
  classifyDoudizhu,
} from "../shared/doudizhu-combinations";

/** Select physical cards by rank; passing a fifth ordinary card fails the fixture. */
function cards(...ranks: number[]): Card[] {
  const deck = makeDeck();
  return ranks.map((rank) => {
    const index = deck.findIndex((card) => card.rank === rank);
    if (index < 0) throw new Error(`No unused card of rank ${rank}`);
    return deck.splice(index, 1)[0];
  });
}

function classified(...ranks: number[]) {
  const result = classifyDoudizhu(cards(...ranks));
  if (!result) throw new Error(`Expected a combination: ${ranks.join(",")}`);
  return result;
}

describe("Dou Dizhu combination classification", () => {
  it.each([
    ["single", [3], 3, 1, 0],
    ["single", [2], 15, 1, 0],
    ["single", [15], 16, 1, 0],
    ["single", [16], 17, 1, 0],
    ["pair", [2, 2], 15, 1, 0],
    ["triple", [14, 14, 14], 14, 1, 0],
    ["triple-single", [3, 3, 3, 16], 3, 1, 0],
    ["triple-pair", [3, 3, 3, 2, 2], 3, 1, 0],
    ["straight", [3, 4, 5, 6, 7], 7, 5, 0],
    ["straight", [10, 11, 12, 13, 14], 14, 5, 0],
    ["pair-chain", [3, 3, 4, 4, 5, 5], 5, 3, 0],
    ["pair-chain", [12, 12, 13, 13, 14, 14], 14, 3, 0],
    ["airplane", [3, 3, 3, 4, 4, 4], 4, 2, 0],
    ["airplane", [13, 13, 13, 14, 14, 14], 14, 2, 0],
    ["airplane-single", [3, 3, 3, 4, 4, 4, 7, 8], 4, 2, 0],
    ["airplane-single", [3, 3, 3, 4, 4, 4, 7, 7], 4, 2, 0],
    ["airplane-single", [3, 3, 3, 4, 4, 4, 15, 16], 4, 2, 0],
    ["airplane-single", [3, 3, 3, 4, 4, 4, 5, 5, 5, 9, 9, 9], 5, 3, 0],
    ["airplane-pair", [3, 3, 3, 4, 4, 4, 7, 7, 2, 2], 4, 2, 0],
    ["four-two-single", [3, 3, 3, 3, 7, 8], 3, 1, 0],
    ["four-two-single", [3, 3, 3, 3, 7, 7], 3, 1, 0],
    ["four-two-single", [3, 3, 3, 3, 15, 16], 3, 1, 0],
    ["four-two-pair", [3, 3, 3, 3, 7, 7, 8, 8], 3, 1, 0],
    ["bomb", [2, 2, 2, 2], 15, 1, 1],
    ["rocket", [16, 15], 17, 1, 2],
  ] as const)("classifies %s from %j", (kind, ranks, power, chain, bomb) => {
    const hand = cards(...ranks);
    const before = structuredClone(hand);
    expect(classifyDoudizhu(hand)).toMatchObject({
      kind,
      power,
      chain,
      bomb,
      size: ranks.length,
    });
    expect(classifyDoudizhu([...hand].reverse())).toEqual(
      classifyDoudizhu(hand),
    );
    expect(hand).toEqual(before);
  });

  it.each([
    [],
    [3, 4],
    [3, 3, 4],
    [3, 3, 4, 4],
    [3, 4, 5, 6],
    [3, 4, 5, 6, 8],
    [3, 4, 5, 6, 6],
    [2, 3, 4, 5, 6],
    [11, 12, 13, 14, 2],
    [12, 13, 14, 15, 16],
    [3, 3, 4, 4, 6, 6],
    [13, 13, 14, 14, 2, 2],
    [3, 3, 3, 5, 5, 5],
    [14, 14, 14, 2, 2, 2],
    [3, 3, 3, 4, 4, 4, 7],
    [3, 3, 3, 4, 4, 4, 7, 8, 9],
    [3, 3, 3, 4, 4, 4, 7, 7, 7, 7],
    [3, 3, 3, 4, 4, 4, 7, 7, 8, 9],
    [3, 3, 3, 3, 4, 4, 4, 5],
    [3, 3, 3, 3, 4, 4, 4, 4],
    [3, 3, 3, 3, 7],
    [3, 3, 3, 3, 7, 7, 8],
    [3, 3, 3, 3, 7, 7, 8, 9],
  ])("rejects an invalid near miss %j", (...ranks) => {
    expect(classifyDoudizhu(cards(...ranks))).toBeNull();
  });

  it("prefers the complete pure airplane when its cards also form single wings", () => {
    expect(classified(3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6)).toMatchObject({
      kind: "airplane",
      power: 6,
      chain: 4,
    });
  });

  it("uses the highest legal winged core when answering a matching airplane", () => {
    const response = cards(3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6);
    const target = classified(3, 3, 3, 4, 4, 4, 5, 5, 5, 7, 8, 9);
    const canonical = classifyDoudizhu(response)!;
    const contextual = classifyDoudizhu(response, target)!;
    expect(canonical).toMatchObject({ kind: "airplane", chain: 4, power: 6 });
    expect(contextual).toMatchObject({
      kind: "airplane-single",
      chain: 3,
      power: 6,
    });
    expect(beatsDoudizhu(canonical, target)).toBe(false);
    expect(beatsDoudizhu(contextual, target)).toBe(true);
  });

  it("ignores mismatched target kinds, sizes and chain lengths", () => {
    const response = cards(3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6);
    const target = classified(3, 3, 3, 4, 4, 4, 5, 5, 5, 7, 8, 9);
    const canonical = classifyDoudizhu(response);
    for (const invalidTarget of [
      { ...target, kind: "airplane-pair" },
      { ...target, size: 8 },
      { ...target, chain: 2 },
      { ...target, chain: 4 },
    ])
      expect(classifyDoudizhu(response, invalidTarget)).toEqual(canonical);
    expect(
      classifyDoudizhu(cards(3, 3, 3, 5, 5, 5, 7, 7, 7, 9, 9, 9), target),
    ).toBeNull();
  });

  it("does not mistake an attachment bomb for the airplane core", () => {
    expect(
      classified(3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 10, 10, 10, 10),
    ).toMatchObject({ kind: "airplane-single", power: 6, chain: 4, bomb: 0 });
  });

  it("rejects duplicate, impossible and mixed-deck physical cards", () => {
    const card = cards(3)[0];
    expect(classifyDoudizhu([card, card])).toBeNull();
    expect(
      classifyDoudizhu([card, { ...card, id: "different-id" }]),
    ).toBeNull();
    expect(classifyDoudizhu([{ ...card, rank: 1 }])).toBeNull();
    expect(classifyDoudizhu([{ ...card, rank: 3.5 }])).toBeNull();
    expect(classifyDoudizhu([{ ...card, rank: 15 }])).toBeNull();
    expect(classifyDoudizhu([{ ...card, suit: "J" }])).toBeNull();
    expect(classifyDoudizhu([{ ...card, deck: -1 }])).toBeNull();
    expect(classifyDoudizhu([card, { ...cards(4)[0], deck: 1 }])).toBeNull();
  });
});

describe("Dou Dizhu combination comparison", () => {
  it("orders 3 through ace, 2, small joker, big joker", () => {
    const ranks = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 2, 15, 16];
    for (let index = 1; index < ranks.length; index++) {
      const lower = classified(ranks[index - 1]);
      const higher = classified(ranks[index]);
      expect(beatsDoudizhu(higher, lower)).toBe(true);
      expect(beatsDoudizhu(lower, higher)).toBe(false);
      expect(beatsDoudizhu(higher, higher)).toBe(false);
    }
  });

  it.each([
    [
      [4, 4],
      [3, 3],
    ],
    [
      [4, 4, 4],
      [3, 3, 3],
    ],
    [
      [4, 4, 4, 3],
      [3, 3, 3, 16],
    ],
    [
      [4, 4, 4, 3, 3],
      [3, 3, 3, 2, 2],
    ],
    [
      [4, 5, 6, 7, 8],
      [3, 4, 5, 6, 7],
    ],
    [
      [4, 4, 5, 5, 6, 6],
      [3, 3, 4, 4, 5, 5],
    ],
    [
      [4, 4, 4, 5, 5, 5],
      [3, 3, 3, 4, 4, 4],
    ],
    [
      [4, 4, 4, 5, 5, 5, 3, 3],
      [3, 3, 3, 4, 4, 4, 15, 16],
    ],
    [
      [4, 4, 4, 5, 5, 5, 3, 3, 6, 6],
      [3, 3, 3, 4, 4, 4, 2, 2, 14, 14],
    ],
    [
      [4, 4, 4, 4, 3, 3],
      [3, 3, 3, 3, 15, 16],
    ],
    [
      [4, 4, 4, 4, 3, 3, 5, 5],
      [3, 3, 3, 3, 2, 2, 14, 14],
    ],
    [
      [4, 4, 4, 4],
      [3, 3, 3, 3],
    ],
  ])(
    "compares the core, ignoring attachment strength",
    (higherRanks, lowerRanks) => {
      const higher = classified(...higherRanks);
      const lower = classified(...lowerRanks);
      expect(beatsDoudizhu(higher, lower)).toBe(true);
      expect(beatsDoudizhu(lower, higher)).toBe(false);
      expect(beatsDoudizhu(higher, higher)).toBe(false);
    },
  );

  it("requires the same ordinary pattern and sequence length", () => {
    const examples = [
      classified(16),
      classified(2, 2),
      classified(14, 14, 14),
      classified(13, 13, 13, 3),
      classified(12, 12, 12, 3, 3),
      classified(10, 11, 12, 13, 14),
      classified(9, 10, 11, 12, 13, 14),
      classified(12, 12, 13, 13, 14, 14),
      classified(11, 11, 12, 12, 13, 13, 14, 14),
      classified(13, 13, 13, 14, 14, 14),
      classified(12, 12, 12, 13, 13, 13, 14, 14, 14),
      classified(13, 13, 13, 14, 14, 14, 3, 4),
      classified(13, 13, 13, 14, 14, 14, 3, 3, 4, 4),
      classified(14, 14, 14, 14, 3, 4),
      classified(14, 14, 14, 14, 3, 3, 4, 4),
    ];
    for (const a of examples)
      for (const b of examples) expect(beatsDoudizhu(a, b)).toBe(false);
  });

  it("bombs beat ordinary hands and rocket beats every other type", () => {
    const bomb = classified(3, 3, 3, 3);
    const higherBomb = classified(2, 2, 2, 2);
    const rocket = classified(15, 16);
    const ordinary = [
      classified(16),
      classified(2, 2),
      classified(2, 2, 2),
      classified(2, 2, 2, 16),
      classified(2, 2, 2, 14, 14),
      classified(10, 11, 12, 13, 14),
      classified(12, 12, 13, 13, 14, 14),
      classified(13, 13, 13, 14, 14, 14),
      classified(13, 13, 13, 14, 14, 14, 15, 16),
      classified(13, 13, 13, 14, 14, 14, 2, 2, 3, 3),
      classified(2, 2, 2, 2, 15, 16),
      classified(2, 2, 2, 2, 13, 13, 14, 14),
    ];
    for (const hand of ordinary) {
      expect(beatsDoudizhu(bomb, hand)).toBe(true);
      expect(beatsDoudizhu(hand, bomb)).toBe(false);
      expect(beatsDoudizhu(rocket, hand)).toBe(true);
      expect(beatsDoudizhu(hand, rocket)).toBe(false);
    }
    expect(beatsDoudizhu(higherBomb, bomb)).toBe(true);
    expect(beatsDoudizhu(rocket, higherBomb)).toBe(true);
    expect(beatsDoudizhu(higherBomb, rocket)).toBe(false);
    expect(beatsDoudizhu(rocket, rocket)).toBe(false);
  });
});
