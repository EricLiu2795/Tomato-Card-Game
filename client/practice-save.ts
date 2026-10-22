import type { Card } from "../shared/cards";
import { assertCardConservation } from "../shared/invariants";
import type {
  Combination,
  DoudizhuState,
  GameState,
  GuandanState,
  HistoryEntry,
  TributePair,
  TributeState,
  Trick,
} from "../shared/types";
import type { PracticeSession } from "./practice";

export type PracticePace = "relaxed" | "normal" | "quick";

export interface SavedPractice {
  version: 1;
  savedAt: number;
  session: PracticeSession;
  checkpoint: PracticeSession | null;
  pace: PracticePace;
}

export const PRACTICE_SAVE_KEY = "tomato-practice-v1";

// A normal game is only a few kilobytes. This guard keeps a pasted or corrupt
// localStorage value from becoming an accidental rendering or parsing DoS.
const MAX_SAVE_BYTES = 256 * 1024;
const MAX_NAME_LENGTH = 80;
const MAX_HISTORY = 1_000;
const MAX_TEXT_LENGTH = 240;
const PHASES = new Set([
  "bidding",
  "tribute",
  "return",
  "discard",
  "playing",
  "finished",
]);
const SUITS = new Set(["C", "D", "H", "S", "J"]);

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: JsonRecord,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  return (
    required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    keys.every((key) => allowed.has(key))
  );
}

function hasRequiredKeys(
  value: JsonRecord,
  required: readonly string[],
): boolean {
  return required.every((key) =>
    Object.prototype.hasOwnProperty.call(value, key),
  );
}

function isInt(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
  );
}

function isFiniteInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isString(
  value: unknown,
  maxLength = MAX_TEXT_LENGTH,
  minLength = 0,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= minLength &&
    value.length <= maxLength
  );
}

function isCard(value: unknown, maxDeck: number): value is Card {
  if (!isRecord(value) || !hasExactKeys(value, ["id", "rank", "suit", "deck"]))
    return false;
  if (
    !isString(value.id, 32, 1) ||
    !isInt(value.deck, 0, maxDeck) ||
    !isInt(value.rank, 2, 16) ||
    typeof value.suit !== "string" ||
    !SUITS.has(value.suit)
  ) {
    return false;
  }
  const suit = value.suit;
  if (value.rank >= 15 !== (suit === "J")) return false;
  return value.id === `${value.deck}-${suit}-${value.rank}`;
}

function isCardList(
  value: unknown,
  maxLength: number,
  maxDeck: number,
  seen?: Set<string>,
): value is Card[] {
  if (!Array.isArray(value) || value.length > maxLength) return false;
  const local = new Set<string>();
  for (const card of value) {
    if (!isCard(card, maxDeck) || local.has(card.id)) return false;
    local.add(card.id);
    if (seen) {
      if (seen.has(card.id)) return false;
      seen.add(card.id);
    }
  }
  return true;
}

function isCombination(value: unknown): value is Combination {
  if (
    !isRecord(value) ||
    !hasExactKeys(
      value,
      ["kind", "size", "power", "chain", "bomb", "label"],
      ["substitutions"],
    )
  )
    return false;
  if (
    !isString(value.kind, 40, 1) ||
    !isInt(value.size, 1, 20) ||
    !isFiniteInt(value.power) ||
    !isFiniteInt(value.chain) ||
    !isFiniteInt(value.bomb) ||
    !isString(value.label, MAX_TEXT_LENGTH)
  )
    return false;
  if (value.substitutions === undefined) return true;
  if (!isRecord(value.substitutions)) return false;
  return Object.values(value.substitutions).every((entry) => {
    if (!isRecord(entry) || !hasExactKeys(entry, ["rank"], ["suit"]))
      return false;
    return (
      isInt(entry.rank, 2, 16) &&
      (entry.suit === undefined ||
        (typeof entry.suit === "string" && SUITS.has(entry.suit)))
    );
  });
}

function isTrick(
  value: unknown,
  maxDeck: number,
  count: number,
  played: Set<string>,
): value is Trick {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["seat", "cards", "combination"]) ||
    !isInt(value.seat, 0, count - 1)
  )
    return false;
  if (
    !isCardList(value.cards, maxDeck === 1 ? 108 : 54, maxDeck) ||
    value.cards.length === 0 ||
    !isCombination(value.combination)
  )
    return false;
  return value.cards.every((card) => played.has(card.id));
}

function isHistoryEntry(
  value: unknown,
  maxDeck: number,
  count: number,
): value is HistoryEntry {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["text"], ["seat", "cards"]) ||
    !isString(value.text)
  )
    return false;
  if (value.seat !== undefined && !isInt(value.seat, 0, count - 1))
    return false;
  return value.cards === undefined || isCardList(value.cards, 20, maxDeck);
}

function isSeatList(
  value: unknown,
  count: number,
  maxLength = count,
): value is number[] {
  if (!Array.isArray(value) || value.length > maxLength) return false;
  const seats = new Set<number>();
  for (const seat of value) {
    if (!isInt(seat, 0, count - 1) || seats.has(seat)) return false;
    seats.add(seat);
  }
  return true;
}

function isTributePair(value: unknown): value is TributePair {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["from", "to"], ["tribute", "returnCard"])
  )
    return false;
  if (
    !isInt(value.from, 0, 3) ||
    !isInt(value.to, 0, 3) ||
    value.from === value.to
  )
    return false;
  return (
    (value.tribute === undefined || isCard(value.tribute, 1)) &&
    (value.returnCard === undefined || isCard(value.returnCard, 1))
  );
}

function isTribute(value: unknown): value is TributeState {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "kind",
      "pairs",
      "contributors",
      "selections",
      "returned",
      "discarded",
      "resisted",
    ])
  )
    return false;
  if (value.kind !== "single" && value.kind !== "double") return false;
  if (
    !Array.isArray(value.pairs) ||
    value.pairs.length !== (value.kind === "single" ? 1 : 2) ||
    !value.pairs.every((pair) => isTributePair(pair)) ||
    !isSeatList(value.contributors, 4) ||
    !isSeatList(value.returned, 4) ||
    !isSeatList(value.discarded, 4) ||
    typeof value.resisted !== "boolean" ||
    !isRecord(value.selections)
  )
    return false;
  return Object.entries(value.selections).every(
    ([seat, label]) => isInt(Number(seat), 0, 3) && isString(label, 40, 1),
  );
}

function validateBaseGame(
  value: JsonRecord,
  count: number,
  maxDeck: number,
): boolean {
  if (
    !hasRequiredKeys(value, [
      "kind",
      "phase",
      "hands",
      "turn",
      "trick",
      "passed",
      "played",
      "removed",
      "finishOrder",
      "history",
      "handNumber",
    ])
  )
    return false;
  if (
    typeof value.phase !== "string" ||
    !PHASES.has(value.phase) ||
    !isInt(value.turn, -1, count - 1) ||
    !isSeatList(value.passed, count) ||
    !isSeatList(value.finishOrder, count) ||
    !isInt(value.handNumber, 1, 1_000_000) ||
    !Array.isArray(value.hands) ||
    value.hands.length !== count ||
    !Array.isArray(value.history) ||
    value.history.length > MAX_HISTORY ||
    !value.history.every((entry) => isHistoryEntry(entry, maxDeck, count))
  )
    return false;

  const seen = new Set<string>();
  for (const hand of value.hands) {
    if (!isCardList(hand, maxDeck === 1 ? 108 : 54, maxDeck, seen))
      return false;
  }
  if (
    !isCardList(value.played, maxDeck === 1 ? 108 : 54, maxDeck, seen) ||
    !isCardList(value.removed, maxDeck === 1 ? 108 : 54, maxDeck, seen)
  )
    return false;
  if (value.phase !== "finished" && value.turn < 0) return false;
  if (
    value.trick !== null &&
    !isTrick(
      value.trick,
      maxDeck,
      count,
      new Set((value.played as Card[]).map((card) => card.id)),
    )
  )
    return false;
  if (
    value.phase !== "finished" &&
    (value.hands[value.turn as number]?.length === 0 ||
      value.finishOrder.includes(value.turn as number))
  )
    return false;
  return true;
}

function isGuandan(value: JsonRecord): value is JsonRecord & GuandanState {
  if (
    !hasExactKeys(value, [
      "kind",
      "phase",
      "hands",
      "turn",
      "trick",
      "passed",
      "played",
      "removed",
      "finishOrder",
      "history",
      "handNumber",
      "levels",
      "currentLevel",
      "levelTeam",
      "previousFinish",
      "tribute",
      "houseRule",
      "winnerTeam",
      "matchWinner",
      "advancement",
    ])
  )
    return false;
  if (value.kind !== "guandan" || !validateBaseGame(value, 4, 1)) return false;
  if (value.phase === "bidding") return false;
  if (
    value.phase === "finished" &&
    ((value.finishOrder as number[]).length !== 4 || value.winnerTeam === null)
  )
    return false;
  if (
    !Array.isArray(value.levels) ||
    value.levels.length !== 2 ||
    !value.levels.every((level) => isInt(level, 2, 14)) ||
    !isInt(value.currentLevel, 2, 14) ||
    !isInt(value.levelTeam, 0, 1) ||
    !isSeatList(value.previousFinish, 4) ||
    (value.tribute !== null && !isTribute(value.tribute)) ||
    typeof value.houseRule !== "boolean" ||
    (value.winnerTeam !== null && !isInt(value.winnerTeam, 0, 1)) ||
    (value.matchWinner !== null && !isInt(value.matchWinner, 0, 1)) ||
    !isInt(value.advancement, 0, 4)
  )
    return false;
  return true;
}

function isDoudizhu(value: JsonRecord): value is JsonRecord & DoudizhuState {
  if (
    !hasExactKeys(value, [
      "kind",
      "phase",
      "hands",
      "turn",
      "trick",
      "passed",
      "played",
      "removed",
      "finishOrder",
      "history",
      "handNumber",
      "bottom",
      "bids",
      "highBid",
      "highBidder",
      "bidCount",
      "landlord",
      "multiplier",
      "scores",
      "winnerTeam",
      "playCounts",
    ])
  )
    return false;
  if (value.kind !== "doudizhu" || !validateBaseGame(value, 3, 0)) return false;
  if (
    value.phase !== "bidding" &&
    value.phase !== "playing" &&
    value.phase !== "finished"
  )
    return false;
  if (
    !isCardList(value.bottom, 3, 0) ||
    (value.phase === "bidding" &&
      (value.bottom as Card[]).some(
        (card) =>
          (value.hands as Card[][]).some((hand) =>
            hand.some((owned) => owned.id === card.id),
          ) ||
          (value.played as Card[]).some((played) => played.id === card.id) ||
          (value.removed as Card[]).some((removed) => removed.id === card.id),
      )) ||
    !Array.isArray(value.bids) ||
    value.bids.length !== 3 ||
    !value.bids.every((bid) => bid === null || isInt(bid, 0, 3)) ||
    !isInt(value.highBid, 0, 3) ||
    (value.highBidder !== null && !isInt(value.highBidder, 0, 2)) ||
    !isInt(value.bidCount, 0, 3) ||
    (value.landlord !== null && !isInt(value.landlord, 0, 2)) ||
    ((value.phase === "playing" || value.phase === "finished") &&
      value.landlord === null) ||
    (value.phase === "finished" &&
      ((value.finishOrder as number[]).length !== 1 ||
        value.winnerTeam === null)) ||
    !isInt(value.multiplier, 1, 1_000_000) ||
    !Array.isArray(value.scores) ||
    value.scores.length !== 3 ||
    !value.scores.every(
      (score) => isFiniteInt(score) && Math.abs(score) <= 1_000_000_000,
    ) ||
    (value.winnerTeam !== null &&
      value.winnerTeam !== "landlord" &&
      value.winnerTeam !== "farmers") ||
    !Array.isArray(value.playCounts) ||
    value.playCounts.length !== 3 ||
    !value.playCounts.every((count) => isInt(count, 0, 1_000_000))
  )
    return false;
  return true;
}

function isGameState(value: unknown): value is GameState {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  const valid =
    value.kind === "guandan"
      ? isGuandan(value)
      : value.kind === "doudizhu"
        ? isDoudizhu(value)
        : false;
  if (!valid) return false;
  try {
    assertCardConservation(value as unknown as GameState);
    return true;
  } catch {
    return false;
  }
}

function isSession(value: unknown): value is PracticeSession {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["game", "name", "revision", "houseRule"])
  )
    return false;
  return (
    isGameState(value.game) &&
    isString(value.name, MAX_NAME_LENGTH, 1) &&
    value.name.trim().length > 0 &&
    isInt(value.revision, 0, 1_000_000_000) &&
    typeof value.houseRule === "boolean" &&
    value.houseRule ===
      (value.game.kind === "guandan" ? value.game.houseRule : value.houseRule)
  );
}

function isSavedPractice(value: unknown): value is SavedPractice {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "version",
      "savedAt",
      "session",
      "checkpoint",
      "pace",
    ])
  )
    return false;
  if (
    value.version !== 1 ||
    !isInt(value.savedAt, 0, 100_000_000_000_000) ||
    !isSession(value.session) ||
    (value.checkpoint !== null && !isSession(value.checkpoint)) ||
    (value.pace !== "relaxed" &&
      value.pace !== "normal" &&
      value.pace !== "quick")
  )
    return false;
  if (value.checkpoint === null) return true;
  const sameKind = value.checkpoint.game.kind === value.session.game.kind;
  const compatibleHand =
    value.session.game.kind === "doudizhu"
      ? value.checkpoint.game.handNumber <= value.session.game.handNumber
      : value.checkpoint.game.handNumber === value.session.game.handNumber;
  return (
    sameKind &&
    value.checkpoint.name === value.session.name &&
    value.checkpoint.houseRule === value.session.houseRule &&
    compatibleHand &&
    value.checkpoint.revision <= value.session.revision
  );
}

function defaultStorage(): Storage | undefined {
  try {
    return typeof globalThis.localStorage === "undefined"
      ? undefined
      : globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readSavedPractice(
  storage?: Pick<Storage, "getItem">,
): SavedPractice | null {
  try {
    const raw = (storage ?? defaultStorage())?.getItem(PRACTICE_SAVE_KEY);
    if (!raw || raw.length > MAX_SAVE_BYTES) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSavedPractice(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function savePractice(
  session: PracticeSession,
  checkpoint: PracticeSession | null,
  pace: PracticePace,
  storage?: Pick<Storage, "setItem">,
): boolean {
  if (
    !isSession(session) ||
    (checkpoint !== null && !isSession(checkpoint)) ||
    (pace !== "relaxed" && pace !== "normal" && pace !== "quick")
  ) {
    return false;
  }
  try {
    const record = {
      version: 1,
      savedAt: Date.now(),
      session,
      checkpoint,
      pace,
    } satisfies SavedPractice;
    if (!isSavedPractice(record)) return false;
    const encoded = JSON.stringify(record);
    if (encoded.length > MAX_SAVE_BYTES) return false;
    const target = storage ?? defaultStorage();
    if (!target) return false;
    target.setItem(PRACTICE_SAVE_KEY, encoded);
    return true;
  } catch {
    return false;
  }
}

export function clearSavedPractice(
  storage?: Pick<Storage, "removeItem">,
): boolean {
  try {
    const target = storage ?? defaultStorage();
    if (!target) return false;
    target.removeItem(PRACTICE_SAVE_KEY);
    return true;
  } catch {
    return false;
  }
}
