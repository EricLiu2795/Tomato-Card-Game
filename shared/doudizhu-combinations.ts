import { ddzStrength, type Card } from "./cards";
import type { Combination } from "./types";

type RankGroup = { rank: number; count: number };

const ordinarySuits = new Set(["C", "D", "H", "S"]);

function groupsFor(cards: Card[]): RankGroup[] | null {
  if (!cards.length) return null;
  const ids = new Set<string>();
  const physicalCards = new Set<string>();
  const ranks = new Map<number, number>();
  const deck = cards[0].deck;
  for (const card of cards) {
    if (
      !card.id ||
      ids.has(card.id) ||
      !Number.isInteger(card.rank) ||
      card.rank < 2 ||
      card.rank > 16 ||
      !Number.isInteger(card.deck) ||
      card.deck < 0 ||
      card.deck !== deck ||
      (card.rank >= 15 ? card.suit !== "J" : !ordinarySuits.has(card.suit))
    )
      return null;
    const physicalId = `${card.suit}-${card.rank}`;
    if (physicalCards.has(physicalId)) return null;
    ids.add(card.id);
    physicalCards.add(physicalId);
    ranks.set(card.rank, (ranks.get(card.rank) ?? 0) + 1);
  }
  return [...ranks]
    .map(([rank, count]) => ({ rank, count }))
    .sort((a, b) => ddzStrength(a.rank) - ddzStrength(b.rank));
}

function combination(
  kind: string,
  size: number,
  rank: number,
  label: string,
  chain = 1,
  bomb = 0,
): Combination {
  return { kind, size, power: ddzStrength(rank), chain, bomb, label };
}

function isSequence(
  groups: RankGroup[],
  count: number,
  minimum: number,
): boolean {
  return (
    groups.length >= minimum &&
    groups.every(
      (group, index) =>
        group.count === count &&
        group.rank >= 3 &&
        group.rank <= 14 &&
        (index === 0 || group.rank === groups[index - 1].rank + 1),
    )
  );
}

/**
 * Find the highest consecutive triple core whose remaining cards are valid wings.
 * A fourth card of a core rank is not a wing. Single wings may share a rank;
 * pair wings are separate pairs of distinct ranks. Neither wing form can reuse
 * a core rank. This also rejects four-of-a-kind pretending to be two pair wings.
 */
function airplaneCore(
  groups: RankGroup[],
  length: number,
  paired: boolean,
): number | null {
  if (length < 2 || length > 12) return null;
  const counts = new Map(groups.map((group) => [group.rank, group.count]));
  for (let highest = 14; highest >= length + 2; highest--) {
    const lowest = highest - length + 1;
    let validCore = true;
    for (let rank = lowest; rank <= highest; rank++) {
      if (counts.get(rank) !== 3) {
        validCore = false;
        break;
      }
    }
    if (!validCore) continue;
    const wings = groups.filter(
      (group) => group.rank < lowest || group.rank > highest,
    );
    if (paired) {
      if (wings.length === length && wings.every((group) => group.count === 2))
        return highest;
    } else if (wings.reduce((sum, group) => sum + group.count, 0) === length) {
      return highest;
    }
  }
  return null;
}

/**
 * Classify a legal one-deck Dou Dizhu play. Invalid card sets return null.
 * A matching target permits consecutive triples to answer a single-wing
 * airplane when some of those triples can legally serve as its wings.
 */
export function classifyDoudizhu(
  cards: Card[],
  target?: Combination,
): Combination | null {
  const groups = groupsFor(cards);
  if (!groups) return null;
  const size = cards.length;
  const first = groups[0];
  const highest = groups[groups.length - 1].rank;

  if (size === 1) return combination("single", size, first.rank, "单张");
  if (
    size === 2 &&
    groups.length === 2 &&
    groups.every((group) => group.rank >= 15)
  ) {
    return combination("rocket", size, 16, "王炸", 1, 2);
  }
  if (groups.length === 1) {
    if (size === 2) return combination("pair", size, first.rank, "对子");
    if (size === 3) return combination("triple", size, first.rank, "三张");
    if (size === 4) return combination("bomb", size, first.rank, "炸弹", 1, 1);
  }
  const triple = groups.find((group) => group.count === 3);
  if (size === 4 && triple)
    return combination("triple-single", size, triple.rank, "三带一");
  if (size === 5 && groups.length === 2 && triple) {
    return combination("triple-pair", size, triple.rank, "三带二");
  }
  if (isSequence(groups, 1, 5))
    return combination("straight", size, highest, "顺子", groups.length);
  if (isSequence(groups, 2, 3))
    return combination("pair-chain", size, highest, "连对", groups.length);
  if (
    target?.kind === "airplane-single" &&
    target.size === size &&
    size >= 8 &&
    size % 4 === 0 &&
    target.chain === size / 4
  ) {
    const core = airplaneCore(groups, size / 4, false);
    if (core !== null)
      return combination("airplane-single", size, core, "飞机带单", size / 4);
  }
  // A set consisting entirely of consecutive triples is canonically a pure
  // airplane, even if some triples could instead be interpreted as single wings.
  if (isSequence(groups, 3, 2))
    return combination("airplane", size, highest, "飞机", groups.length);

  if (size >= 8 && size % 4 === 0) {
    const core = airplaneCore(groups, size / 4, false);
    if (core !== null)
      return combination("airplane-single", size, core, "飞机带单", size / 4);
  }
  if (size >= 10 && size % 5 === 0) {
    const core = airplaneCore(groups, size / 5, true);
    if (core !== null)
      return combination("airplane-pair", size, core, "飞机带对", size / 5);
  }

  const four = groups.find((group) => group.count === 4);
  if (size === 6 && four)
    return combination("four-two-single", size, four.rank, "四带二");
  if (
    size === 8 &&
    four &&
    groups.length === 3 &&
    groups.filter((group) => group !== four).every((group) => group.count === 2)
  ) {
    return combination("four-two-pair", size, four.rank, "四带两对");
  }
  return null;
}

/** Whether a classified play strictly beats the current classified play. */
export function beatsDoudizhu(a: Combination, b: Combination): boolean {
  if (a.kind === "rocket") return b.kind !== "rocket";
  if (b.kind === "rocket") return false;
  if (a.kind === "bomb") return b.kind !== "bomb" || a.power > b.power;
  if (b.kind === "bomb") return false;
  return (
    a.kind === b.kind &&
    a.size === b.size &&
    a.chain === b.chain &&
    a.power > b.power
  );
}
