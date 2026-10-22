import { gdStrength, isWild, RANK_LABELS } from './cards';
import type { Card, Suit } from './cards';
import type { Combination } from './types';

type Slot = { rank: number; suit?: Suit };
type Substitutions = NonNullable<Combination['substitutions']>;

const SUITS: Suit[] = ['C', 'D', 'H', 'S'];
const ordinaryPreference: Record<string, number> = {
  single: 1, pair: 2, triple: 3, fullhouse: 4, straight: 5,
  pair_run: 6, triple_run: 7,
};
const rankLabel = (rank: number) => RANK_LABELS[rank] ?? String(rank);
const textOrder = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Reject impossible physical cards before allowing any wildcard interpretation. */
function validCards(cards: Card[], level: number): boolean {
  if (!Number.isInteger(level) || level < 2 || level > 14 ||
      !Array.isArray(cards) || cards.length < 1 || cards.length > 10) return false;
  const ids = new Set<string>();
  const physical = new Set<string>();
  for (const card of cards) {
    if (!card || typeof card.id !== 'string' || !card.id ||
        !Number.isInteger(card.rank) || card.rank < 2 || card.rank > 16 ||
        !Number.isInteger(card.deck) || card.deck < 0 || card.deck > 1) return false;
    if (card.rank >= 15 ? card.suit !== 'J' : !SUITS.includes(card.suit)) return false;
    const location = `${card.deck}:${card.suit}:${card.rank}`;
    if (ids.has(card.id) || physical.has(location)) return false;
    ids.add(card.id);
    physical.add(location);
  }
  return cards.filter(card => isWild(card, level)).length <= 2;
}

/** Fill a pattern with fixed cards, then assign the remaining slots to wilds. */
function matchPattern(fixed: Card[], wilds: Card[], slots: Slot[]): Substitutions | null {
  const remaining = [...slots];
  for (const card of fixed) {
    const index = remaining.findIndex(slot => slot.rank === card.rank &&
      (slot.suit === undefined || slot.suit === card.suit));
    if (index < 0) return null;
    remaining.splice(index, 1);
  }
  if (remaining.length !== wilds.length || remaining.some(slot => slot.rank >= 15)) return null;
  remaining.sort((a, b) => b.rank - a.rank || textOrder(a.suit ?? '', b.suit ?? ''));
  const substitutions: Substitutions = {};
  wilds.forEach((card, index) => {
    const slot = remaining[index];
    if (slot.rank !== card.rank || (slot.suit !== undefined && slot.suit !== card.suit)) {
      // defineProperty also makes arbitrary external IDs such as "__proto__" safe.
      Object.defineProperty(substitutions, card.id, {
        value: slot.suit === undefined ? { rank: slot.rank } : { rank: slot.rank, suit: slot.suit },
        enumerable: true, configurable: true, writable: true,
      });
    }
  });
  return substitutions;
}

function strongestFirst(a: Combination, b: Combination): number {
  return b.bomb - a.bomb ||
    (ordinaryPreference[b.kind] ?? 0) - (ordinaryPreference[a.kind] ?? 0) ||
    b.power - a.power;
}

/**
 * Enumerate exact patterns instead of guessing replacements. Only the two heart
 * level cards are wild. Runs use natural rank, with A2345 / AA2233 / AAA222 low;
 * ace never wraps in the middle of a run. Normal groups use elevated level rank.
 */
function interpretations(cards: Card[], level: number): Combination[] {
  if (!validCards(cards, level)) return [];
  const size = cards.length;
  if (size === 1) return [{
    kind: 'single', size, power: gdStrength(cards[0].rank, level), chain: 1,
    bomb: 0, label: `单张 ${rankLabel(cards[0].rank)}`,
  }];
  const fixed = cards.filter(card => !isWild(card, level));
  const wilds = cards.filter(card => isWild(card, level)).sort((a, b) => textOrder(a.id, b.id));
  const candidates: Combination[] = [];
  const ranks = Array.from({ length: 15 }, (_, index) => index + 2)
    .sort((a, b) => gdStrength(b, level) - gdStrength(a, level));
  const normalRanks = ranks.filter(rank => rank < 15);
  const add = (kind: string, slots: Slot[], power: number, chain: number, bomb: number, label: string) => {
    const substitutions = matchPattern(fixed, wilds, slots);
    if (substitutions === null) return;
    const combination: Combination = { kind, size, power, chain, bomb, label };
    if (Object.keys(substitutions).length) combination.substitutions = substitutions;
    candidates.push(combination);
  };
  const repeated = (rank: number, count: number): Slot[] => Array.from({ length: count }, () => ({ rank }));

  if (size === 4 && cards.filter(card => card.rank === 15).length === 2 &&
      cards.filter(card => card.rank === 16).length === 2) {
    candidates.push({ kind: 'joker_bomb', size, power: 0, chain: 1, bomb: 100, label: '四大天王' });
  }
  if (size >= 4) {
    for (const rank of normalRanks) {
      add('bomb', repeated(rank, size), gdStrength(rank, level), 1, size,
        `${size}张炸弹 ${rankLabel(rank)}`);
    }
  }
  if (size === 2 || size === 3) {
    for (const rank of ranks) {
      add(size === 2 ? 'pair' : 'triple', repeated(rank, size), gdStrength(rank, level), 1, 0,
        `${size === 2 ? '对子' : '三张'} ${rankLabel(rank)}`);
    }
  }
  if (size === 5) {
    for (const triple of normalRanks) for (const pair of ranks) {
      if (triple === pair) continue;
      add('fullhouse', [...repeated(triple, 3), ...repeated(pair, 2)],
        gdStrength(triple, level), 1, 0, `三带二 ${rankLabel(triple)}带${rankLabel(pair)}`);
    }
    for (let start = 1; start <= 10; start++) {
      const slots = Array.from({ length: 5 }, (_, index) => ({ rank: start + index === 1 ? 14 : start + index }));
      const high = start + 4;
      add('straight', slots, high, 5, 0, `顺子 ${rankLabel(high)}高`);
      for (const suit of SUITS) {
        add('straight_flush', slots.map(slot => ({ ...slot, suit })), high, 5, 5.5,
          `同花顺 ${rankLabel(high)}高`);
      }
    }
  }
  if (size === 6) {
    for (const groupSize of [2, 3]) {
      const chain = size / groupSize;
      for (let start = 1; start <= 15 - chain; start++) {
        const slots: Slot[] = [];
        for (let index = 0; index < chain; index++) {
          slots.push(...repeated(start + index === 1 ? 14 : start + index, groupSize));
        }
        const high = start + chain - 1;
        add(groupSize === 2 ? 'pair_run' : 'triple_run', slots, high, chain, 0,
          `${groupSize === 2 ? '三连对' : '钢板'} ${rankLabel(high)}高`);
      }
    }
  }
  return candidates.sort(strongestFirst);
}

/**
 * Return the strongest interpretation. Bombs always take precedence. The two
 * incomparable six-card shapes have a deterministic lead preference: triple_run
 * before pair_run. Use classifyGuandanResponse when answering an existing trick.
 */
export function classifyGuandan(cards: Card[], level: number): Combination | null {
  return interpretations(cards, level)[0] ?? null;
}

/** Strict comparison: ties, different ordinary shapes, and different lengths lose. */
export function beatsGuandan(a: Combination, b: Combination): boolean {
  if (a.bomb || b.bomb) {
    if (a.bomb !== b.bomb) return a.bomb > b.bomb;
    return a.power > b.power;
  }
  return a.kind === b.kind && a.size === b.size && a.chain === b.chain && a.power > b.power;
}

/** Select a legal stronger interpretation, including an ambiguous wildcard run. */
export function classifyGuandanResponse(cards: Card[], level: number, previous: Combination): Combination | null {
  return interpretations(cards, level).find(candidate => beatsGuandan(candidate, previous)) ?? null;
}
