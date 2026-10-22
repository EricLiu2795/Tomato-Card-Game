import type { Card } from "./cards";
export type GameKind = "guandan" | "doudizhu";
export interface Combination {
  kind: string;
  size: number;
  power: number;
  chain: number;
  bomb: number;
  label: string;
  substitutions?: Record<string, { rank: number; suit?: string }>;
}
export interface Trick {
  seat: number;
  cards: Card[];
  combination: Combination;
}
export interface HistoryEntry {
  text: string;
  seat?: number;
  cards?: Card[];
}
export type GamePhase =
  "bidding" | "tribute" | "return" | "discard" | "playing" | "finished";
export interface BaseGame {
  kind: GameKind;
  phase: GamePhase;
  hands: Card[][];
  turn: number;
  trick: Trick | null;
  passed: number[];
  played: Card[];
  removed: Card[];
  finishOrder: number[];
  history: HistoryEntry[];
  handNumber: number;
}
export interface TributePair {
  from: number;
  to: number;
  tribute?: Card;
  returnCard?: Card;
}
export interface TributeState {
  kind: "single" | "double";
  pairs: TributePair[];
  contributors: number[];
  selections: Record<number, string>;
  returned: number[];
  discarded: number[];
  resisted: boolean;
}
export interface GuandanState extends BaseGame {
  kind: "guandan";
  levels: [number, number];
  currentLevel: number;
  levelTeam: number;
  previousFinish: number[];
  tribute: TributeState | null;
  houseRule: boolean;
  winnerTeam: number | null;
  matchWinner: number | null;
  advancement: number;
}
export interface DoudizhuState extends BaseGame {
  kind: "doudizhu";
  bottom: Card[];
  bids: (number | null)[];
  highBid: number;
  highBidder: number | null;
  bidCount: number;
  landlord: number | null;
  multiplier: number;
  scores: number[];
  winnerTeam: "landlord" | "farmers" | null;
  playCounts: number[];
}
export type GameState = GuandanState | DoudizhuState;
export type GameAction =
  | { type: "PLAY_CARDS"; cardIds: string[] }
  | { type: "PASS" }
  | { type: "BID"; value: number }
  | { type: "SELECT_TRIBUTE"; cardId: string }
  | { type: "SELECT_RETURN_CARD"; cardId: string }
  | { type: "DISCARD_HOUSE_RULE"; cardId: string | null };
export type RoomAction =
  | GameAction
  | { type: "READY"; ready: boolean }
  | { type: "START_GAME" }
  | { type: "CHOOSE_SEAT"; seat: number }
  | { type: "SEND_REACTION"; reactionId: string }
  | { type: "THROW_TOMATO"; targetId: string };
export interface Command {
  id: string;
  expectedRevision: number;
  action: RoomAction;
}
export interface PublicPlayer {
  id: string;
  name: string;
  seat: number;
  ready: boolean;
  connected: boolean;
  count: number;
}
export interface PublicGame {
  kind: GameKind;
  phase: GamePhase;
  turn: number;
  trick: Trick | null;
  passed: number[];
  finishOrder: number[];
  history: HistoryEntry[];
  handNumber: number;
  removed: Card[];
  levels?: [number, number];
  currentLevel?: number;
  levelTeam?: number;
  tribute?: TributeState | null;
  houseRule?: boolean;
  winnerTeam?: number | "landlord" | "farmers" | null;
  matchWinner?: number | null;
  advancement?: number;
  bottom?: Card[];
  bids?: (number | null)[];
  highBid?: number;
  landlord?: number | null;
  multiplier?: number;
  scores?: number[];
}
export interface Snapshot {
  type: "SNAPSHOT";
  roomCode: string;
  kind: GameKind;
  revision: number;
  selfId: string;
  hostId: string;
  players: PublicPlayer[];
  hand: Card[];
  game: PublicGame | null;
  houseRule: boolean;
}
export interface ReactionEvent {
  type: "EVENT";
  eventId: string;
  kind: "reaction" | "tomato";
  senderId: string;
  targetId?: string;
  reactionId?: string;
  at: number;
}
export type ServerMessage =
  | Snapshot
  | ReactionEvent
  | { type: "ERROR"; message: string; commandId?: string; code?: string }
  | { type: "ACK"; commandId: string; revision: number };
