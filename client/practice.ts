import { gdStrength } from "../shared/cards";
import { applyDoudizhu, createDoudizhu } from "../shared/doudizhu";
import {
  applyGuandan,
  createGuandan,
  legalReturnCards,
  legalTributeCards,
} from "../shared/guandan";
import { choosePracticeBid, choosePracticePlay } from "./practice-strategy";
import type {
  GameAction,
  GameKind,
  GameState,
  PublicGame,
  PublicPlayer,
  RoomAction,
  Snapshot,
} from "../shared/types";

export interface PracticeSession {
  game: GameState;
  name: string;
  revision: number;
  houseRule: boolean;
}

const SELF_ID = "practice-you";
const BOT_NAMES = ["牛油果（电脑）", "小橘子（电脑）", "葡萄（电脑）"];

function playersFor(
  kind: GameKind,
  name: string,
  game: GameState,
): PublicPlayer[] {
  const count = kind === "guandan" ? 4 : 3;
  return Array.from({ length: count }, (_, seat) => ({
    id: seat === 0 ? SELF_ID : `practice-bot-${seat}`,
    name: seat === 0 ? name : BOT_NAMES[seat - 1],
    seat,
    ready: true,
    connected: true,
    count: game.hands[seat]?.length ?? 0,
  }));
}

/** Project a game with the same allowlist and hidden-card rules as the server. */
function publicGame(game: GameState): PublicGame {
  const base: PublicGame = {
    kind: game.kind,
    phase: game.phase,
    turn: game.turn,
    trick: structuredClone(game.trick),
    passed: [...game.passed],
    finishOrder: [...game.finishOrder],
    history: structuredClone(game.history.slice(-100)),
    handNumber: game.handNumber,
    removed: structuredClone(game.removed),
  };
  if (game.kind === "doudizhu") {
    return {
      ...base,
      bottom: game.phase === "bidding" ? [] : structuredClone(game.bottom),
      bids: [...game.bids],
      highBid: game.highBid,
      landlord: game.landlord,
      multiplier: game.multiplier,
      scores: [...game.scores],
      winnerTeam: game.winnerTeam,
    };
  }

  const tribute = game.tribute;
  const exchanged =
    game.phase === "discard" ||
    game.phase === "playing" ||
    game.phase === "finished";
  return {
    ...base,
    levels: [...game.levels] as [number, number],
    currentLevel: game.currentLevel,
    levelTeam: game.levelTeam,
    tribute: tribute
      ? {
          kind: tribute.kind,
          pairs: tribute.pairs.map((pair) => ({
            from: pair.from,
            to: pair.to,
            ...(pair.tribute ? { tribute: structuredClone(pair.tribute) } : {}),
            ...(exchanged && pair.returnCard
              ? { returnCard: structuredClone(pair.returnCard) }
              : {}),
          })),
          contributors: [...tribute.contributors],
          selections: Object.fromEntries(
            Object.keys(tribute.selections).map((seat) => [seat, "selected"]),
          ),
          returned: [...tribute.returned],
          discarded: [...tribute.discarded],
          resisted: tribute.resisted,
        }
      : null,
    houseRule: game.houseRule,
    winnerTeam: game.winnerTeam,
    matchWinner: game.matchWinner,
    advancement: game.advancement,
  };
}

function nextSession(
  session: PracticeSession,
  game: GameState,
): PracticeSession {
  return { ...session, game, revision: session.revision + 1 };
}

function actionIsGameAction(action: RoomAction): action is GameAction {
  return (
    action.type === "PLAY_CARDS" ||
    action.type === "PASS" ||
    action.type === "BID" ||
    action.type === "SELECT_TRIBUTE" ||
    action.type === "SELECT_RETURN_CARD" ||
    action.type === "DISCARD_HOUSE_RULE"
  );
}

export function createPractice(
  kind: GameKind,
  name: string,
  houseRule = true,
  random?: () => number,
): PracticeSession {
  const game =
    kind === "guandan"
      ? createGuandan({ houseRule, random })
      : createDoudizhu({ random });
  return {
    game,
    name: name.trim() || "番茄同学",
    revision: 0,
    houseRule,
  };
}

export function practiceSnapshot(session: PracticeSession): Snapshot {
  return {
    type: "SNAPSHOT",
    roomCode: "PRACTICE",
    kind: session.game.kind,
    revision: session.revision,
    selfId: SELF_ID,
    hostId: SELF_ID,
    players: playersFor(session.game.kind, session.name, session.game),
    hand: structuredClone(session.game.hands[0]),
    game: publicGame(session.game),
    houseRule: session.houseRule,
  };
}

function startNextGame(
  session: PracticeSession,
  random?: () => number,
): PracticeSession {
  if (session.game.phase !== "finished") return session;
  const game =
    session.game.kind === "guandan"
      ? createGuandan({
          houseRule: session.houseRule,
          previous:
            session.game.matchWinner === null ? session.game : undefined,
          random,
        })
      : createDoudizhu({ handNumber: session.game.handNumber + 1, random });
  return nextSession(session, game);
}

/** Apply one human-seat action. Bot turns are advanced separately by stepPracticeBot. */
export function applyPractice(
  session: PracticeSession,
  action: RoomAction,
  random?: () => number,
): PracticeSession {
  if (action.type === "START_GAME") return startNextGame(session, random);
  if (
    action.type === "READY" ||
    action.type === "CHOOSE_SEAT" ||
    action.type === "SEND_REACTION" ||
    action.type === "THROW_TOMATO"
  )
    return session;
  if (!actionIsGameAction(action)) return session;

  const game =
    session.game.kind === "guandan"
      ? applyGuandan(session.game, 0, action)
      : applyDoudizhu(session.game, 0, action, random);
  return nextSession(session, game);
}

function weakestCard(
  hand: GameState["hands"][number],
  level?: number,
): GameState["hands"][number][number] | undefined {
  return [...hand].sort(
    (a, b) =>
      (level === undefined ? a.rank : gdStrength(a.rank, level)) -
        (level === undefined ? b.rank : gdStrength(b.rank, level)) ||
      a.id.localeCompare(b.id),
  )[0];
}

function botAction(game: GameState, seat: number): GameAction | null {
  const hand = game.hands[seat];
  if (!hand.length) return null;
  if (game.kind === "doudizhu") {
    if (game.phase === "bidding")
      return { type: "BID", value: choosePracticeBid(hand, publicGame(game)) };
    if (game.phase !== "playing") return null;
  } else {
    if (game.phase === "tribute" && game.tribute?.contributors.includes(seat)) {
      const card =
        legalTributeCards(hand, game.currentLevel)[0] ??
        weakestCard(hand, game.currentLevel);
      return card ? { type: "SELECT_TRIBUTE", cardId: card.id } : null;
    }
    if (game.phase === "return") {
      const pair = game.tribute?.pairs.find(
        (candidate) => candidate.to === seat,
      );
      if (pair && !game.tribute?.returned.includes(seat)) {
        const card =
          legalReturnCards(hand, game.currentLevel)[0] ??
          weakestCard(hand, game.currentLevel);
        return card ? { type: "SELECT_RETURN_CARD", cardId: card.id } : null;
      }
    }
    if (game.phase === "discard" && game.tribute?.contributors.includes(seat)) {
      return {
        type: "DISCARD_HOUSE_RULE",
        cardId: weakestCard(hand, game.currentLevel)?.id ?? null,
      };
    }
    if (game.phase !== "playing") return null;
  }

  return choosePracticePlay(hand, publicGame(game), seat, {
    publicCounts: game.hands.map((cards) => cards.length),
  });
}

/** Advance exactly one bot action. Seat 0 is deliberately never automated. */
export function stepPracticeBot(
  session: PracticeSession,
  _random?: () => number,
): PracticeSession {
  const seat = session.game.turn;
  if (seat <= 0 || session.game.phase === "finished") return session;
  const action = botAction(session.game, seat);
  if (!action) return session;
  const game =
    session.game.kind === "guandan"
      ? applyGuandan(session.game, seat, action)
      : applyDoudizhu(session.game, seat, action, _random);
  return nextSession(session, game);
}
