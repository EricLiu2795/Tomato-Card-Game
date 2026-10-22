import type {
  GameKind,
  GameState,
  PublicGame,
  Snapshot,
} from "../shared/types";
export interface Player {
  id: string;
  name: string;
  seat: number;
  ready: boolean;
  tokenHash: string;
  connectionId: string | null;
  lastReaction: number;
  lastTomato: number;
  actionTimes: number[];
}
export interface RoomState {
  schema: 1;
  code: string;
  kind: GameKind;
  revision: number;
  hostId: string;
  players: Player[];
  game: GameState | null;
  houseRule: boolean;
  lastActive: number;
  commandCount?: number;
}
/** An explicit allowlist: never serialize a GameState or Player into a client message. */
export function publicGame(game: GameState): PublicGame {
  const base: PublicGame = {
    kind: game.kind,
    phase: game.phase,
    turn: game.turn,
    trick: game.trick,
    passed: game.passed,
    finishOrder: game.finishOrder,
    history: game.history.slice(-100),
    handNumber: game.handNumber,
    removed: game.removed,
  };
  if (game.kind === "doudizhu")
    return {
      ...base,
      bottom: game.phase === "bidding" ? [] : game.bottom,
      bids: game.bids,
      highBid: game.highBid,
      landlord: game.landlord,
      multiplier: game.multiplier,
      scores: game.scores,
      winnerTeam: game.winnerTeam,
    };
  const tribute = game.tribute;
  const exchanged =
    game.phase === "discard" ||
    game.phase === "playing" ||
    game.phase === "finished";
  return {
    ...base,
    levels: game.levels,
    currentLevel: game.currentLevel,
    levelTeam: game.levelTeam,
    tribute: tribute
      ? {
          kind: tribute.kind,
          pairs: tribute.pairs.map((p) => ({
            from: p.from,
            to: p.to,
            tribute: p.tribute,
            ...(exchanged ? { returnCard: p.returnCard } : {}),
          })),
          contributors: tribute.contributors,
          selections: Object.fromEntries(
            Object.keys(tribute.selections).map((seat) => [seat, "selected"]),
          ),
          returned: tribute.returned,
          discarded: tribute.discarded,
          resisted: tribute.resisted,
        }
      : null,
    houseRule: game.houseRule,
    winnerTeam: game.winnerTeam,
    matchWinner: game.matchWinner,
    advancement: game.advancement,
  };
}
export function snapshot(
  room: RoomState,
  playerId: string,
  connected: Set<string>,
): Snapshot {
  const self = room.players.find((p) => p.id === playerId);
  if (!self) throw new Error("会话无效");
  return {
    type: "SNAPSHOT",
    roomCode: room.code,
    kind: room.kind,
    revision: room.revision,
    selfId: playerId,
    hostId: room.hostId,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      seat: p.seat,
      ready: p.ready,
      connected: connected.has(p.id),
      count: room.game?.hands[p.seat].length ?? 0,
    })),
    hand: room.game?.hands[self.seat] ?? [],
    game: room.game ? publicGame(room.game) : null,
    houseRule: room.houseRule,
  };
}
