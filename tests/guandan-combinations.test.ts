import { describe, expect, it } from "vitest";
import { makeDeck } from "../shared/cards";
import type { Card, Suit } from "../shared/cards";
import {
  beatsGuandan,
  classifyGuandan,
  classifyGuandanResponse,
} from "../shared/guandan-combinations";
import type { Combination } from "../shared/types";

const deck = makeDeck(2);
const card = (rank: number, suit: Suit = "C", copy = 0): Card =>
  deck.find((c) => c.rank === rank && c.suit === suit && c.deck === copy)!;
const copies = (rank: number, count: number): Card[] =>
  deck.filter((c) => c.rank === rank).slice(0, count);
const wilds = (level = 7): Card[] => [card(level, "H"), card(level, "H", 1)];
const classify = (cards: Card[], level = 7): Combination => {
  const result = classifyGuandan(cards, level);
  expect(result).not.toBeNull();
  return result!;
};
const rainbow = (ranks: number[]): Card[] =>
  ranks.map((rank, index) =>
    card(rank, (["C", "D", "S", "H"] as const)[index % 4]),
  );

describe("Guandan normal groups", () => {
  it("orders ordinary singles, level cards, small jokers, and big jokers", () => {
    const singles = [
      card(2),
      card(14),
      card(7),
      card(15, "J"),
      card(16, "J"),
    ].map((c) => classify([c]));
    expect(singles.map((c) => c.power)).toEqual([2, 14, 20, 25, 26]);
    for (let i = 1; i < singles.length; i++)
      expect(beatsGuandan(singles[i], singles[i - 1])).toBe(true);
    expect(classify([wilds()[0]]).power).toBe(20);
    expect(classify([wilds()[0]]).substitutions).toBeUndefined();
  });

  it("recognizes ordinary and joker pairs", () => {
    expect(classify(copies(8, 2))).toMatchObject({
      kind: "pair",
      size: 2,
      power: 8,
      bomb: 0,
    });
    expect(classify(copies(15, 2))).toMatchObject({ kind: "pair", power: 25 });
    expect(classify(copies(16, 2))).toMatchObject({ kind: "pair", power: 26 });
    expect(classifyGuandan([card(15, "J"), card(16, "J")], 7)).toBeNull();
  });

  it("recognizes triples and raises the current level above aces", () => {
    const levelTriple = classify(copies(7, 3));
    expect(levelTriple).toMatchObject({ kind: "triple", power: 20 });
    expect(beatsGuandan(levelTriple, classify(copies(14, 3)))).toBe(true);
  });

  it("makes the strongest natural level pair from the two wildcards", () => {
    expect(classify(wilds())).toMatchObject({ kind: "pair", power: 20 });
    expect(classify(wilds()).substitutions).toBeUndefined();
    expect(classify([card(8), wilds()[0]])).toMatchObject({
      kind: "pair",
      power: 8,
    });
  });

  it("uses two wildcards to complete a triple and reports assignments", () => {
    expect(classify([card(8), ...wilds()])).toMatchObject({
      kind: "triple",
      power: 8,
      substitutions: { "0-H-7": { rank: 8 }, "1-H-7": { rank: 8 } },
    });
  });

  it("never uses a wildcard as either joker", () => {
    for (const rank of [15, 16]) {
      expect(classifyGuandan([card(rank, "J"), wilds()[0]], 7)).toBeNull();
      expect(classifyGuandan([...copies(rank, 2), wilds()[0]], 7)).toBeNull();
      expect(classifyGuandan([card(rank, "J"), ...wilds()], 7)).toBeNull();
    }
  });

  it("compares full houses only by the triple", () => {
    const low = classify([...copies(8, 3), ...copies(14, 2)]);
    const high = classify([...copies(9, 3), ...copies(2, 2)]);
    expect(low).toMatchObject({ kind: "fullhouse", power: 8 });
    expect(beatsGuandan(high, low)).toBe(true);
    expect(
      beatsGuandan(classify([...copies(8, 3), ...copies(16, 2)]), low),
    ).toBe(false);
  });

  it("allows a natural same-rank joker pair in a full house", () => {
    expect(classify([...copies(8, 3), ...copies(15, 2)])).toMatchObject({
      kind: "fullhouse",
      power: 8,
    });
    expect(
      classifyGuandan([...copies(8, 3), card(15, "J"), card(16, "J")], 7),
    ).toBeNull();
  });

  it("selects the stronger triple when a wildcard completes either pair", () => {
    const result = classify([...copies(8, 2), ...copies(9, 2), wilds()[0]]);
    expect(result).toMatchObject({
      kind: "fullhouse",
      power: 9,
      substitutions: { "0-H-7": { rank: 9 } },
    });
    expect(
      classify([card(7, "C"), card(7, "D"), ...copies(9, 2), wilds()[0]]),
    ).toMatchObject({ kind: "fullhouse", power: 20 });
  });

  it("rejects unsupported ordinary groups and attachments", () => {
    expect(classifyGuandan([...copies(8, 3), card(9)], 7)).toBeNull();
    expect(classifyGuandan([...copies(8, 4), card(9)], 7)).toBeNull();
    expect(classifyGuandan([...copies(8, 3), card(9), card(10)], 7)).toBeNull();
    expect(classifyGuandan([...copies(8, 2), ...copies(11, 2)], 7)).toBeNull();
  });
});

describe("Guandan natural-rank runs", () => {
  it("recognizes five-card straights and ace-high straights", () => {
    expect(classify(rainbow([2, 3, 4, 5, 6]))).toMatchObject({
      kind: "straight",
      power: 6,
      chain: 5,
    });
    expect(classify(rainbow([10, 11, 12, 13, 14]))).toMatchObject({
      kind: "straight",
      power: 14,
    });
  });

  it("supports A2345 as the lowest straight without wrapping ace in the middle", () => {
    const low = classify(rainbow([14, 2, 3, 4, 5]));
    expect(low).toMatchObject({ kind: "straight", power: 5 });
    expect(beatsGuandan(classify(rainbow([2, 3, 4, 5, 6])), low)).toBe(true);
    expect(classifyGuandan(rainbow([11, 12, 13, 14, 2]), 7)).toBeNull();
    expect(classifyGuandan(rainbow([12, 13, 14, 2, 3]), 7)).toBeNull();
  });

  it("uses the level card at its natural rank inside every run", () => {
    expect(classify(rainbow([5, 6, 7, 8, 9]))).toMatchObject({
      kind: "straight",
      power: 9,
    });
    expect(
      classify([6, 7, 8].flatMap((rank) => copies(rank, 2))),
    ).toMatchObject({ kind: "pair_run", power: 8 });
    expect(classify([...copies(7, 3), ...copies(8, 3)])).toMatchObject({
      kind: "triple_run",
      power: 8,
    });
  });

  it("requires exactly five cards for straights", () => {
    expect(classifyGuandan(rainbow([2, 3, 4, 5]), 7)).toBeNull();
    expect(classifyGuandan(rainbow([2, 3, 4, 5, 6, 7]), 7)).toBeNull();
    expect(
      classifyGuandan(
        [card(2), card(3, "D"), card(4, "S"), card(5, "H"), card(15, "J")],
        7,
      ),
    ).toBeNull();
  });

  it("recognizes three consecutive pairs including AA2233 and QQKKAA", () => {
    expect(
      classify([3, 4, 5].flatMap((rank) => copies(rank, 2))),
    ).toMatchObject({ kind: "pair_run", power: 5, chain: 3 });
    expect(
      classify([14, 2, 3].flatMap((rank) => copies(rank, 2))),
    ).toMatchObject({ kind: "pair_run", power: 3 });
    expect(
      classify([12, 13, 14].flatMap((rank) => copies(rank, 2))),
    ).toMatchObject({ kind: "pair_run", power: 14 });
    expect(
      classifyGuandan(
        [13, 14, 2].flatMap((rank) => copies(rank, 2)),
        7,
      ),
    ).toBeNull();
    expect(
      classifyGuandan(
        [3, 4, 5, 6].flatMap((rank) => copies(rank, 2)),
        7,
      ),
    ).toBeNull();
  });

  it("recognizes two consecutive triples including AAA222 and KKKAAA", () => {
    expect(classify([...copies(3, 3), ...copies(4, 3)])).toMatchObject({
      kind: "triple_run",
      power: 4,
      chain: 2,
    });
    expect(classify([...copies(14, 3), ...copies(2, 3)])).toMatchObject({
      kind: "triple_run",
      power: 2,
    });
    expect(classify([...copies(13, 3), ...copies(14, 3)])).toMatchObject({
      kind: "triple_run",
      power: 14,
    });
    expect(classifyGuandan([...copies(3, 3), ...copies(5, 3)], 7)).toBeNull();
    expect(
      classifyGuandan(
        [3, 4, 5].flatMap((rank) => copies(rank, 3)),
        7,
      ),
    ).toBeNull();
  });

  it("uses wildcards to fill missing ranks and chooses the higher valid straight", () => {
    const result = classify([card(4), card(5, "D"), card(6, "S"), ...wilds()]);
    expect(result).toMatchObject({ kind: "straight", power: 8 });
    expect(result.substitutions).toEqual({ "0-H-7": { rank: 8 } });
  });

  it("rejects a duplicate fixed rank in a straight", () => {
    expect(
      classifyGuandan(
        [card(3), card(3, "D"), card(4, "S"), card(5, "H"), wilds()[0]],
        7,
      ),
    ).toBeNull();
  });

  it("recognizes straight flushes including the ace-low flush", () => {
    expect(
      classify([3, 4, 5, 6, 7].map((rank) => card(rank, "S"))),
    ).toMatchObject({ kind: "straight_flush", power: 7, bomb: 5.5 });
    expect(
      classify([14, 2, 3, 4, 5].map((rank) => card(rank, "D"))),
    ).toMatchObject({ kind: "straight_flush", power: 5 });
  });

  it("lets wildcards change suit even when retaining their natural rank", () => {
    const result = classify(
      [3, 4, 5, 6].map((rank) => card(rank, "S")).concat(wilds()[0]),
    );
    expect(result).toMatchObject({
      kind: "straight_flush",
      power: 7,
      substitutions: { "0-H-7": { rank: 7, suit: "S" } },
    });
  });

  it("can fill two missing suit-and-rank slots for a straight flush", () => {
    const result = classify([
      card(4, "S"),
      card(5, "S"),
      card(6, "S"),
      ...wilds(),
    ]);
    expect(result).toMatchObject({ kind: "straight_flush", power: 8 });
    expect(result.substitutions).toEqual({
      "0-H-7": { rank: 8, suit: "S" },
      "1-H-7": { rank: 7, suit: "S" },
    });
  });
});

describe("Guandan bombs and strict comparison", () => {
  it.each([4, 5, 6, 7, 8, 9, 10])(
    "supports a %i-card same-rank bomb",
    (size) => {
      const cards = [
        ...copies(8, Math.min(size, 8)),
        ...wilds().slice(0, Math.max(0, size - 8)),
      ];
      expect(classify(cards)).toMatchObject({
        kind: "bomb",
        size,
        bomb: size,
        power: 8,
      });
    },
  );

  it("prefers a five-card bomb to an alternative full house", () => {
    expect(classify([...copies(8, 3), ...wilds()])).toMatchObject({
      kind: "bomb",
      size: 5,
    });
  });

  it("recognizes exactly two small plus two big jokers as the highest bomb", () => {
    expect(classify([...copies(15, 2), ...copies(16, 2)])).toMatchObject({
      kind: "joker_bomb",
      bomb: 100,
    });
    expect(
      classifyGuandan([card(15, "J"), card(16, "J"), ...wilds()], 7),
    ).toBeNull();
  });

  it("orders four/five-card bombs, straight flushes, six-plus bombs, then four jokers", () => {
    const ordered = [
      classify(copies(14, 4)),
      classify(copies(2, 5)),
      classify([2, 3, 4, 5, 6].map((rank) => card(rank, "S"))),
      classify(copies(2, 6)),
      classify(copies(2, 7)),
      classify(copies(2, 8)),
      classify([...copies(2, 8), wilds()[0]]),
      classify([...copies(2, 8), ...wilds()]),
      classify([...copies(15, 2), ...copies(16, 2)]),
    ];
    ordered.forEach((high, index) =>
      ordered.slice(0, index).forEach((low) => {
        expect(beatsGuandan(high, low)).toBe(true);
        expect(beatsGuandan(low, high)).toBe(false);
      }),
    );
  });

  it("compares bomb size before rank and elevates level rank within the same size", () => {
    expect(beatsGuandan(classify(copies(2, 5)), classify(copies(14, 4)))).toBe(
      true,
    );
    expect(beatsGuandan(classify(copies(7, 4)), classify(copies(14, 4)))).toBe(
      true,
    );
    expect(beatsGuandan(classify(copies(14, 4)), classify(copies(13, 4)))).toBe(
      true,
    );
  });

  it("compares straight flushes by high card and ignores suits", () => {
    const low = classify([2, 3, 4, 5, 6].map((rank) => card(rank, "S")));
    const high = classify([3, 4, 5, 6, 7].map((rank) => card(rank, "D")));
    const same = classify([2, 3, 4, 5, 6].map((rank) => card(rank, "D")));
    expect(beatsGuandan(high, low)).toBe(true);
    expect(beatsGuandan(same, low)).toBe(false);
  });

  it("lets any bomb beat an ordinary shape and rejects all ties", () => {
    const bomb = classify(copies(2, 4));
    const king = classify([card(16, "J")]);
    expect(beatsGuandan(bomb, king)).toBe(true);
    expect(beatsGuandan(king, bomb)).toBe(false);
    for (const combination of [
      bomb,
      king,
      classify(copies(8, 2)),
      classify([...copies(15, 2), ...copies(16, 2)]),
    ]) {
      expect(beatsGuandan(combination, combination)).toBe(false);
    }
  });

  it("rejects comparison between different ordinary shapes or lengths", () => {
    const pair = classify(copies(14, 2));
    expect(beatsGuandan(pair, classify(copies(3, 3)))).toBe(false);
    const run = classify([3, 4, 5].flatMap((rank) => copies(rank, 2)));
    expect(
      beatsGuandan(run, classify([...copies(2, 3), ...copies(3, 3)])),
    ).toBe(false);
    expect(beatsGuandan(run, { ...run, size: 8, power: 4 })).toBe(false);
    expect(beatsGuandan(run, { ...run, chain: 4, power: 4 })).toBe(false);
  });
});

describe("Guandan deterministic interpretations and physical validation", () => {
  it("prefers a triple run on a lead but can answer a pair run with the same cards", () => {
    const cards = [...copies(3, 2), ...copies(4, 2), ...wilds()];
    expect(classify(cards)).toMatchObject({ kind: "triple_run", power: 4 });
    const previousPairs = classify(
      [14, 2, 3].flatMap((rank) => copies(rank, 2)),
    );
    expect(classifyGuandanResponse(cards, 7, previousPairs)).toMatchObject({
      kind: "pair_run",
      power: 5,
    });
    const previousTriples = classify([...copies(2, 3), ...copies(3, 3)]);
    expect(classifyGuandanResponse(cards, 7, previousTriples)).toMatchObject({
      kind: "triple_run",
      power: 4,
    });
    expect(
      classifyGuandanResponse(
        cards,
        7,
        classify([3, 4, 5].flatMap((rank) => copies(rank, 2))),
      ),
    ).toBeNull();
  });

  it("can answer any ordinary trick with a bomb and returns null if no play beats it", () => {
    const previous = classify(copies(14, 3));
    expect(classifyGuandanResponse(copies(2, 4), 7, previous)).toMatchObject({
      kind: "bomb",
    });
    expect(classifyGuandanResponse(copies(2, 3), 7, previous)).toBeNull();
    expect(classifyGuandanResponse([], 7, previous)).toBeNull();
  });

  it("returns identical wildcard assignments regardless of input order, without mutation", () => {
    const cards = [card(4, "S"), card(5, "S"), card(6, "S"), ...wilds()];
    const before = structuredClone(cards);
    const expected = classify(cards);
    for (let shift = 0; shift < cards.length; shift++) {
      const shifted = [...cards.slice(shift), ...cards.slice(0, shift)];
      expect(classify(shifted)).toEqual(expected);
      expect(classify([...shifted].reverse())).toEqual(expected);
    }
    expect(cards).toEqual(before);
  });

  it("treats heart cards of other levels as ordinary fixed cards", () => {
    expect(classifyGuandan([card(8), card(6, "H")], 7)).toBeNull();
    expect(classify([card(8), card(6, "H")], 6)).toMatchObject({
      kind: "pair",
      power: 8,
    });
    expect(classify([card(2)], 2).power).toBe(20);
    expect(classify([card(14)], 14).power).toBe(20);
  });

  it("rejects duplicate IDs even when the nominal cards differ", () => {
    expect(
      classifyGuandan([card(8), { ...card(8, "D"), id: card(8).id }], 7),
    ).toBeNull();
    expect(classifyGuandan([wilds()[0], wilds()[0]], 7)).toBeNull();
  });

  it("rejects duplicate physical cards with forged distinct IDs", () => {
    expect(
      classifyGuandan([card(8), { ...card(8), id: "forged" }], 7),
    ).toBeNull();
    expect(
      classifyGuandan([...wilds(), { ...wilds()[0], id: "third-wild" }], 7),
    ).toBeNull();
  });

  it("rejects invalid deck, rank, suit, and current-level values", () => {
    for (const invalid of [
      { ...card(8), deck: 2 },
      { ...card(8), deck: -1 },
      { ...card(8), deck: 0.5 },
      { ...card(8), rank: 1 },
      { ...card(8), rank: 17 },
      { ...card(8), rank: 8.5 },
      { ...card(8), suit: "J" as Suit },
      { ...card(15, "J"), suit: "H" as Suit },
      { ...card(8), id: "" },
      { ...card(8), suit: "X" as Suit },
    ])
      expect(classifyGuandan([invalid], 7)).toBeNull();
    for (const level of [1, 15, 7.5, NaN, Infinity])
      expect(classifyGuandan([card(8)], level)).toBeNull();
  });

  it("rejects empty plays and plays larger than the largest possible rank bomb", () => {
    expect(classifyGuandan([], 7)).toBeNull();
    expect(classifyGuandan(deck.slice(0, 11), 7)).toBeNull();
  });

  it("keeps substitution records safe for arbitrary unique IDs", () => {
    const unusualWild = { ...wilds()[0], id: "__proto__" };
    const result = classify([card(8), unusualWild]);
    expect(Object.keys(result.substitutions!)).toEqual(["__proto__"]);
    expect(result.substitutions!["__proto__"]).toEqual({ rank: 8 });
    expect(Object.getPrototypeOf(result.substitutions)).toBe(Object.prototype);
  });
});
