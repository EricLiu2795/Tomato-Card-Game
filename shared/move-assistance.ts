import { ddzStrength, isWild, type Card } from "./cards";
import { beatsDoudizhu, classifyDoudizhu } from "./doudizhu-combinations";
import {
  beatsGuandan,
  classifyGuandan,
  classifyGuandanResponse,
} from "./guandan-combinations";
import type { Combination, PublicGame } from "./types";

/** A playable selection and the engine's interpretation of that selection. */
export interface SuggestedMove {
  cards: Card[];
  combination: Combination;
}

/*
 * This module intentionally suggests a useful, bounded menu rather than
 * enumerating every subset of a hand.  A Guandan hand can contain 27 cards,
 * and enumerating its power set would make a harmless hint button expensive.
 * Every returned move is legal according to the combination engine; an empty
 * result only means that this bounded menu found no move, not that no legal
 * move exists.
 */
const MAX_SUGGESTIONS = 256;
const MAX_GENERATED_SETS = 3_000;
const MAX_BRANCHES_PER_PATTERN = 32;

const rankOrder = (card: Card) => card.rank;
const cardOrder = (a: Card, b: Card) =>
  rankOrder(a) - rankOrder(b) ||
  a.suit.localeCompare(b.suit) ||
  a.deck - b.deck ||
  a.id.localeCompare(b.id);

function sortedCards(cards: Card[]): Card[] {
  return [...cards].sort(cardOrder);
}

function keyOf(cards: Card[]): string {
  return cards
    .map((card) => card.id)
    .sort()
    .join("\u0000");
}

function combinations<T>(items: T[], count: number, limit = Infinity): T[][] {
  if (count < 0 || count > items.length || limit <= 0) return [];
  if (count === 0) return [[]];
  const result: T[][] = [];
  const current: T[] = [];
  const visit = (start: number): void => {
    if (result.length >= limit) return;
    if (current.length === count) {
      result.push([...current]);
      return;
    }
    const needed = count - current.length;
    for (let index = start; index <= items.length - needed; index++) {
      current.push(items[index]);
      visit(index + 1);
      current.pop();
      if (result.length >= limit) return;
    }
  };
  visit(0);
  return result;
}

function byRank(hand: Card[]): Map<number, Card[]> {
  const groups = new Map<number, Card[]>();
  for (const card of hand) {
    const group = groups.get(card.rank) ?? [];
    group.push(card);
    groups.set(card.rank, group);
  }
  for (const group of groups.values()) group.sort(cardOrder);
  return groups;
}

function addUnique(
  selected: Card[],
  add: (cards: Card[]) => void,
  seen: Set<string>,
): void {
  if (
    !selected.length ||
    new Set(selected.map((card) => card.id)).size !== selected.length
  )
    return;
  const cards = sortedCards(selected);
  const key = keyOf(cards);
  if (seen.has(key)) return;
  seen.add(key);
  add(cards);
}

function removeCards(hand: Card[], removed: Card[]): Card[] {
  const ids = new Set(removed.map((card) => card.id));
  return hand.filter((card) => !ids.has(card.id));
}

function pickPattern(
  groups: Map<number, Card[]>,
  wilds: Card[],
  slots: { rank: number; suit?: Card["suit"] }[],
  limit = MAX_BRANCHES_PER_PATTERN,
): Card[][] {
  const result: Card[][] = [];
  const selected: Card[] = [];
  const used = new Set<string>();
  const visit = (index: number, wildIndex: number): void => {
    if (result.length >= limit) return;
    if (index === slots.length) {
      result.push(sortedCards(selected));
      return;
    }
    const slot = slots[index];
    const fixed = (groups.get(slot.rank) ?? []).filter(
      (card) => slot.suit === undefined || card.suit === slot.suit,
    );
    // Fixed cards come first.  This keeps suggestions conservative and makes
    // wildcard interpretations available without requiring wildcard-only
    // branches to be explored first.
    for (const card of fixed) {
      if (used.has(card.id)) continue;
      used.add(card.id);
      selected.push(card);
      visit(index + 1, wildIndex);
      selected.pop();
      used.delete(card.id);
      if (result.length >= limit) return;
    }
    for (let wi = wildIndex; wi < wilds.length; wi++) {
      const wild = wilds[wi];
      if (used.has(wild.id)) continue;
      used.add(wild.id);
      selected.push(wild);
      visit(index + 1, wi + 1);
      selected.pop();
      used.delete(wild.id);
      if (result.length >= limit) return;
    }
  };
  visit(0, 0);
  return result;
}

function rankSlots(start: number, count: number, each = 1): { rank: number }[] {
  return Array.from({ length: count * each }, (_, index) => ({
    rank: start + Math.floor(index / each),
  }));
}

function guandanRankSlots(
  start: number,
  count: number,
  each = 1,
): { rank: number }[] {
  return Array.from({ length: count * each }, (_, index) => {
    const rank = start + Math.floor(index / each);
    return { rank: rank === 1 ? 14 : rank };
  });
}

function addGroupChoices(
  group: Card[],
  wilds: Card[],
  count: number,
  add: (cards: Card[]) => void,
  seen: Set<string>,
  fixedLimit = 24,
): void {
  for (
    let wildCount = 0;
    wildCount <= Math.min(count, wilds.length);
    wildCount++
  ) {
    const fixedCount = count - wildCount;
    if (fixedCount > group.length) continue;
    for (const fixed of combinations(group, fixedCount, fixedLimit)) {
      for (const wild of combinations(wilds, wildCount, 8)) {
        addUnique([...fixed, ...wild], add, seen);
      }
    }
  }
}

function validGame(game: PublicGame): boolean {
  return Boolean(
    game &&
    game.phase === "playing" &&
    (game.kind === "guandan" || game.kind === "doudizhu"),
  );
}

function classifySelection(
  cards: Card[],
  game: PublicGame,
): Combination | null {
  if (!validGame(game) || !cards.length) return null;
  if (game.kind === "guandan") {
    const level = game.currentLevel ?? 2;
    return game.trick
      ? classifyGuandanResponse(cards, level, game.trick.combination)
      : classifyGuandan(cards, level);
  }
  return classifyDoudizhu(cards, game.trick?.combination);
}

/** Return whether a selection is a legal lead or a strict response. */
export function selectionCanPlay(cards: Card[], game: PublicGame): boolean {
  const combination = classifySelection(cards, game);
  if (!combination) return false;
  if (!game.trick) return true;
  return game.kind === "guandan"
    ? beatsGuandan(combination, game.trick.combination)
    : beatsDoudizhu(combination, game.trick.combination);
}

function addGuandanCandidates(
  hand: Card[],
  game: PublicGame,
  add: (cards: Card[]) => void,
  seen: Set<string>,
): void {
  const level = game.currentLevel ?? 2;
  const groups = byRank(hand.filter((card) => !isWild(card, level)));
  const wilds = sortedCards(hand.filter((card) => isWild(card, level)));

  // Singles and repeated groups, including the longer Guandan bombs.
  for (const card of hand) addUnique([card], add, seen);
  for (const rank of Array.from(groups.keys()).sort((a, b) => a - b)) {
    const group = groups.get(rank)!;
    for (const count of [2, 3]) addGroupChoices(group, wilds, count, add, seen);
    if (rank < 15) {
      for (
        let count = 4;
        count <= Math.min(10, group.length + wilds.length);
        count++
      )
        addGroupChoices(group, wilds, count, add, seen, 12);
    }
  }
  // A four-joker bomb is a distinct Guandan pattern.
  const jokers = hand.filter((card) => card.rank === 15 || card.rank === 16);
  if (jokers.length >= 4) {
    for (const selected of combinations(jokers, 4, 8))
      addUnique(selected, add, seen);
  }

  // Full houses, with wildcards assigned to either the triple or pair.
  for (let tripleRank = 2; tripleRank <= 14; tripleRank++) {
    for (let pairRank = 2; pairRank <= 14; pairRank++) {
      if (tripleRank === pairRank) continue;
      const triples = groups.get(tripleRank) ?? [];
      const pairs = groups.get(pairRank) ?? [];
      for (let tripleWilds = 0; tripleWilds <= 2; tripleWilds++) {
        for (let pairWilds = 0; pairWilds <= 2; pairWilds++) {
          if (tripleWilds + pairWilds > wilds.length) continue;
          for (const triple of combinations(triples, 3 - tripleWilds, 4))
            for (const pair of combinations(pairs, 2 - pairWilds, 4))
              for (const ws of combinations(wilds, tripleWilds + pairWilds, 4))
                addUnique([...triple, ...pair, ...ws], add, seen);
        }
      }
    }
  }

  // Five-card straights and the two six-card chain forms supported by the
  // classifier.  Pattern picking is capped per window and suit.
  for (let start = 1; start <= 10; start++) {
    for (const selected of pickPattern(
      groups,
      wilds,
      guandanRankSlots(start, 5),
    ))
      addUnique(selected, add, seen);
    for (const suit of ["C", "D", "H", "S"] as const)
      for (const selected of pickPattern(
        groups,
        wilds,
        guandanRankSlots(start, 5).map((slot) => ({ ...slot, suit })),
      ))
        addUnique(selected, add, seen);
  }
  for (const each of [2, 3]) {
    const count = each === 2 ? 3 : 2;
    for (let start = 1; start <= 15 - count; start++) {
      for (const selected of pickPattern(
        groups,
        wilds,
        guandanRankSlots(start, count, each),
      ))
        addUnique(selected, add, seen);
    }
  }
}

function addDoudizhuCandidates(
  hand: Card[],
  add: (cards: Card[]) => void,
  seen: Set<string>,
): void {
  const groups = byRank(hand);
  const ranks = Array.from(groups.keys()).sort(
    (a, b) => ddzStrength(a) - ddzStrength(b),
  );
  for (const card of hand) addUnique([card], add, seen);
  for (const rank of ranks) {
    const group = groups.get(rank)!;
    for (const count of [2, 3, 4])
      for (const selected of combinations(group, count, 24))
        addUnique(selected, add, seen);
  }
  const smallJoker = groups.get(15) ?? [];
  const bigJoker = groups.get(16) ?? [];
  if (smallJoker.length && bigJoker.length)
    addUnique([smallJoker[0], bigJoker[0]], add, seen);

  // Wings and ordinary groups.
  for (const tripleRank of ranks) {
    const triple = groups.get(tripleRank)!;
    if (triple.length < 3) continue;
    for (const core of combinations(triple, 3, 8)) {
      const remaining = removeCards(hand, core);
      for (const wing of remaining) addUnique([...core, wing], add, seen);
      for (const wingRank of Array.from(byRank(remaining).keys())) {
        const wingGroup = byRank(remaining).get(wingRank)!;
        if (wingGroup.length >= 2)
          for (const wingPair of combinations(wingGroup, 2, 8))
            addUnique([...core, ...wingPair], add, seen);
      }
    }
  }

  for (const fourRank of ranks) {
    const four = groups.get(fourRank)!;
    if (four.length < 4) continue;
    for (const core of combinations(four, 4, 8)) {
      const remaining = removeCards(hand, core);
      for (const wings of combinations(remaining, 2, 16))
        addUnique([...core, ...wings], add, seen);
      const remainingGroups = byRank(remaining);
      const pairRanks = Array.from(remainingGroups.keys());
      for (let i = 0; i < pairRanks.length; i++) {
        for (let j = i + 1; j < pairRanks.length; j++) {
          const left = remainingGroups.get(pairRanks[i])!;
          const right = remainingGroups.get(pairRanks[j])!;
          if (left.length >= 2 && right.length >= 2)
            for (const a of combinations(left, 2, 4))
              for (const b of combinations(right, 2, 4))
                addUnique([...core, ...a, ...b], add, seen);
        }
      }
    }
  }

  // Consecutive one-, two-, and three-card rank patterns.  Twos and jokers
  // are deliberately absent from sequences, as required by Dou Dizhu rules.
  for (let length = 5; length <= 12; length++) {
    for (let start = 3; start <= 15 - length; start++)
      for (const selected of pickPattern(groups, [], rankSlots(start, length)))
        addUnique(selected, add, seen);
  }
  for (let length = 3; length <= 10; length++) {
    for (let start = 3; start <= 15 - length; start++)
      for (const selected of pickPattern(
        groups,
        [],
        rankSlots(start, length, 2),
      ))
        addUnique(selected, add, seen);
  }
  for (let length = 2; length <= 6; length++) {
    if (length * 3 > hand.length) break;
    for (let start = 3; start <= 15 - length; start++)
      for (const selected of pickPattern(
        groups,
        [],
        rankSlots(start, length, 3),
      ))
        addUnique(selected, add, seen);
  }
}

function compareSuggestions(
  left: SuggestedMove,
  right: SuggestedMove,
  responding: boolean,
): number {
  const leftBomb = left.combination.bomb > 0;
  const rightBomb = right.combination.bomb > 0;
  if (responding && leftBomb !== rightBomb) return leftBomb ? 1 : -1;
  if (!responding && leftBomb !== rightBomb) return leftBomb ? 1 : -1;
  const leftSingle = left.combination.kind === "single";
  const rightSingle = right.combination.kind === "single";
  if (!responding && leftSingle !== rightSingle) return leftSingle ? 1 : -1;
  return (
    left.combination.power - right.combination.power ||
    left.cards.length - right.cards.length ||
    left.combination.kind.localeCompare(right.combination.kind) ||
    keyOf(left.cards).localeCompare(keyOf(right.cards))
  );
}

/**
 * Suggest bounded, deterministic legal moves for either game.  Suggestions
 * are drawn from common groups, runs, attachments, and special bombs.  They
 * are deliberately not an exhaustive power-set search; callers should keep a
 * normal play action available when this list is empty or incomplete.
 */
export function suggestMoves(hand: Card[], game: PublicGame): SuggestedMove[] {
  if (!validGame(game) || !Array.isArray(hand) || !hand.length) return [];
  const source = sortedCards(hand);
  const seen = new Set<string>();
  const candidates: SuggestedMove[] = [];
  const add = (cards: Card[]): void => {
    if (candidates.length >= MAX_GENERATED_SETS) return;
    const combination = classifySelection(cards, game);
    if (!combination) return;
    if (game.trick) {
      const beats =
        game.kind === "guandan"
          ? beatsGuandan(combination, game.trick.combination)
          : beatsDoudizhu(combination, game.trick.combination);
      if (!beats) return;
    }
    candidates.push({ cards: [...cards], combination });
  };
  if (game.kind === "guandan") addGuandanCandidates(source, game, add, seen);
  else addDoudizhuCandidates(source, add, seen);
  const responding = Boolean(game.trick);
  candidates.sort((a, b) => compareSuggestions(a, b, responding));
  return candidates.slice(0, MAX_SUGGESTIONS).map((move) => ({
    cards: [...move.cards],
    combination: move.combination,
  }));
}
