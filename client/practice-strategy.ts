import { ddzStrength, gdStrength, type Card } from "../shared/cards";
import { suggestMoves, type SuggestedMove } from "../shared/move-assistance";
import type { GameAction, PublicGame } from "../shared/types";

/**
 * The practice opponent only receives this information from the caller:
 * its own cards, the public projection, and public hand counts.  Keeping the
 * strategy at this boundary makes it difficult to accidentally teach the bot
 * to peek at another player's cards.
 */
export interface PracticeStrategyContext {
  publicCounts?: readonly number[];
}

const moveKey = (move: SuggestedMove): string =>
  move.cards
    .map((card) => card.id)
    .sort()
    .join("\u0000");

function rankOf(card: Card, game: PublicGame): number {
  return game.kind === "guandan"
    ? gdStrength(card.rank, game.currentLevel ?? 2)
    : ddzStrength(card.rank);
}

function structuralPenalty(hand: Card[], move: SuggestedMove): number {
  const before = new Map<number, number>();
  const used = new Map<number, number>();
  for (const card of hand)
    before.set(card.rank, (before.get(card.rank) ?? 0) + 1);
  for (const card of move.cards)
    used.set(card.rank, (used.get(card.rank) ?? 0) + 1);

  let penalty = 0;
  for (const [rank, count] of used) {
    const remaining = (before.get(rank) ?? 0) - count;
    if (remaining <= 0 || count <= 0) continue;
    const original = before.get(rank) ?? 0;
    if (original >= 4 && count < original) penalty += 10;
    else if (original >= 3 && count < original) penalty += 4;
    // Leaving a singleton behind after breaking a pair/triple is costly. A
    // complete group, sequence, or single-card rank has no preservation cost.
    if (count === 1 && count < (before.get(rank) ?? 0)) penalty += 2;
    if (count < (before.get(rank) ?? 0) && remaining === 1) penalty += 4;
  }
  return penalty;
}

function isTeammate(game: PublicGame, left: number, right: number): boolean {
  if (game.kind === "guandan") return left % 2 === right % 2;
  if (game.landlord === undefined || game.landlord === null) return false;
  return (left === game.landlord) === (right === game.landlord);
}

function opponentThreat(
  game: PublicGame,
  seat: number,
  publicCounts: readonly number[],
): boolean {
  return publicCounts.some(
    (count, other) =>
      other !== seat &&
      !isTeammate(game, seat, other) &&
      Number.isInteger(count) &&
      count > 0 &&
      count <= 2,
  );
}

function criticalOpponentThreat(
  game: PublicGame,
  seat: number,
  publicCounts: readonly number[],
): boolean {
  return publicCounts.some(
    (count, other) =>
      other !== seat &&
      !isTeammate(game, seat, other) &&
      Number.isInteger(count) &&
      count === 1,
  );
}

function isBomb(move: SuggestedMove): boolean {
  return move.combination.bomb > 0;
}

function isSingle(move: SuggestedMove): boolean {
  return move.combination.kind === "single";
}

function isPressurePlay(move: SuggestedMove): boolean {
  return (
    move.combination.kind.includes("run") ||
    move.combination.kind.includes("straight") ||
    move.combination.kind === "fullhouse" ||
    move.combination.kind === "triple-single" ||
    move.combination.kind === "triple-pair" ||
    move.combination.kind === "airplane"
  );
}

function consumesBombCore(hand: Card[], move: SuggestedMove): boolean {
  if (isBomb(move)) return false;
  const before = new Map<number, number>();
  const used = new Map<number, number>();
  for (const card of hand)
    before.set(card.rank, (before.get(card.rank) ?? 0) + 1);
  for (const card of move.cards)
    used.set(card.rank, (used.get(card.rank) ?? 0) + 1);
  return [...used].some(
    ([rank, count]) => count >= 4 && (before.get(rank) ?? 0) >= 4,
  );
}

function leadScore(
  move: SuggestedMove,
  hand: Card[],
  game: PublicGame,
  publicCounts: readonly number[],
  seat: number,
): number {
  const threat = opponentThreat(game, seat, publicCounts);
  const critical = criticalOpponentThreat(game, seat, publicCounts);
  let score = 0;
  if (move.cards.length === hand.length) score += 100_000;
  score += move.cards.length * (threat ? 180 : 120);
  if (isPressurePlay(move)) score += 120;
  if (isSingle(move)) score -= 180;
  if (isBomb(move)) score -= threat ? 1_500 : 7_500;
  if (consumesBombCore(hand, move)) score -= threat ? 1_200 : 5_000;
  score -= structuralPenalty(hand, move) * 100;
  // Lower legal cards preserve the high cards needed for a later response.
  score -=
    move.cards.reduce((total, card) => total + rankOf(card, game), 0) * 0.45;
  if (critical && isSingle(move))
    score +=
      move.cards.reduce((total, card) => total + rankOf(card, game), 0) * 6;
  return score;
}

function responseScore(
  move: SuggestedMove,
  hand: Card[],
  game: PublicGame,
  publicCounts: readonly number[],
  seat: number,
): number {
  const threat = opponentThreat(game, seat, publicCounts);
  const critical = criticalOpponentThreat(game, seat, publicCounts);
  let score = 0;
  if (move.cards.length === hand.length) score += 100_000;
  // A normal answer is preferred. Bombs are reserved for an urgent threat or
  // for the case where no ordinary answer exists at all.
  if (isBomb(move)) score -= threat ? 1_500 : 8_000;
  if (consumesBombCore(hand, move)) score -= threat ? 1_200 : 5_000;
  // When an opponent has one card left, preserving a pair is less important
  // than taking control with the strongest legal single. Bomb-core protection
  // above still applies to avoid throwing away an emergency answer.
  if (!(critical && isSingle(move)))
    score -= structuralPenalty(hand, move) * 100;
  score -= move.combination.power * 3;
  score -= move.cards.length;
  if (critical && isSingle(move))
    score +=
      move.cards.reduce((total, card) => total + rankOf(card, game), 0) * 6;
  return score;
}

/** Rank bounded legal suggestions by a conservative, team-aware heuristic. */
export function rankPracticeMoves(
  hand: Card[],
  game: PublicGame,
  seat: number,
  context: PracticeStrategyContext = {},
): SuggestedMove[] {
  const publicCounts = context.publicCounts ?? [];
  const moves = suggestMoves(hand, game);
  const scoring = game.trick
    ? (move: SuggestedMove) =>
        responseScore(move, hand, game, publicCounts, seat)
    : (move: SuggestedMove) => leadScore(move, hand, game, publicCounts, seat);
  return moves
    .map((move, index) => ({ move, index, score: scoring(move) }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.move.combination.power - right.move.combination.power ||
        left.move.cards.length - right.move.cards.length ||
        moveKey(left.move).localeCompare(moveKey(right.move)) ||
        left.index - right.index,
    )
    .map(({ move }) => ({ ...move, cards: [...move.cards] }));
}

/** Choose one legal play for a bot turn, including a deliberate teammate pass. */
export function choosePracticePlay(
  hand: Card[],
  game: PublicGame,
  seat: number,
  context: PracticeStrategyContext = {},
): GameAction | null {
  if (game.phase !== "playing" || !hand.length) return null;
  const moves = rankPracticeMoves(hand, game, seat, context);
  const finishingMove = moves.find((move) => move.cards.length === hand.length);
  if (game.trick && isTeammate(game, seat, game.trick.seat)) {
    return finishingMove
      ? {
          type: "PLAY_CARDS",
          cardIds: finishingMove.cards.map((card) => card.id),
        }
      : { type: "PASS" };
  }
  const threat = opponentThreat(game, seat, context.publicCounts ?? []);
  if (
    game.trick &&
    hand.length > 4 &&
    moves.length > 0 &&
    moves.every(isBomb) &&
    !finishingMove &&
    !threat
  )
    return { type: "PASS" };
  const move = moves[0];
  if (move)
    return { type: "PLAY_CARDS", cardIds: move.cards.map((card) => card.id) };
  if (game.trick) return { type: "PASS" };
  // The shared suggester is bounded. A single card is always a legal lead.
  return { type: "PLAY_CARDS", cardIds: [hand[0].id] };
}

/** Choose a legal, strength-aware Dou Dizhu bid for the practice bot. */
export function choosePracticeBid(hand: Card[], game: PublicGame): number {
  if (game.kind !== "doudizhu") return 0;
  const counts = new Map<number, number>();
  for (const card of hand)
    counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  const jokers = hand.filter((card) => card.rank >= 15).length;
  const twos = hand.filter((card) => card.rank === 2).length;
  const aces = hand.filter((card) => card.rank === 14).length;
  const pairs = [...counts.values()].filter((count) => count >= 2).length;
  const triples = [...counts.values()].filter((count) => count >= 3).length;
  const score =
    jokers * 2.75 + twos * 1.35 + aces * 0.8 + pairs + triples * 1.5;
  const preferred = score >= 10 ? 3 : score >= 6.2 ? 2 : score >= 3.2 ? 1 : 0;
  if (preferred > (game.highBid ?? 0)) return preferred;
  return game.highBid === 0 && score >= 3.2 ? 1 : 0;
}
