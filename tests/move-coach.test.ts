import { describe, expect, it } from "vitest";
import { makeDeck, type Card } from "../shared/cards";
import { classifyDoudizhu } from "../shared/doudizhu-combinations";
import { classifyGuandan } from "../shared/guandan-combinations";
import type { PublicGame } from "../shared/types";
import { getMoveCoachCopy, shouldRenderMoveCoach } from "../client/MoveCoach";

function card(rank: number, suit: Card["suit"] = "C"): Card {
  const found = makeDeck(2).find(
    (candidate) => candidate.rank === rank && candidate.suit === suit,
  );
  if (!found) throw new Error(`missing card ${rank}`);
  return found;
}

function tributeState() {
  return {
    kind: "single" as const,
    pairs: [{ from: 1, to: 0 }],
    contributors: [0],
    selections: {},
    returned: [],
    discarded: [],
    resisted: false,
  };
}

function playingGame(trick: PublicGame["trick"] = null): PublicGame {
  return {
    kind: "guandan",
    phase: "playing",
    turn: 0,
    trick,
    passed: [],
    finishOrder: [],
    history: [],
    handNumber: 1,
    removed: [],
    levels: [2, 2],
    currentLevel: 2,
    levelTeam: 0,
    tribute: null,
    houseRule: true,
    winnerTeam: null,
    matchWinner: null,
    advancement: 0,
  };
}

function doudizhuGame(trick: PublicGame["trick"] = null): PublicGame {
  return {
    kind: "doudizhu",
    phase: "playing",
    turn: 0,
    trick,
    passed: [],
    finishOrder: [],
    history: [],
    handNumber: 1,
    removed: [],
    bottom: [],
    bids: [3, null, null],
    highBid: 3,
    landlord: 0,
    multiplier: 1,
    scores: [0, 0, 0],
    winnerTeam: null,
  };
}

describe("move coach copy", () => {
  it("distinguishes a valid response that is too small from an invalid pattern", () => {
    const target = card(9);
    const weak = card(3);
    const trick = {
      seat: 1,
      cards: [target],
      combination: classifyGuandan([target], 2)!,
    };
    const insufficient = getMoveCoachCopy({
      game: playingGame(trick),
      seat: 0,
      handSize: 5,
      selection: [weak],
      combination: null,
      canPlay: false,
      isMyTurn: true,
      suggested: false,
      paused: false,
    });
    expect(insufficient.title).toContain("牌型成立");
    expect(insufficient.title).not.toContain("还没组成");

    const invalid = getMoveCoachCopy({
      game: playingGame(trick),
      seat: 0,
      handSize: 5,
      selection: [card(3), card(4)],
      combination: null,
      canPlay: false,
      isMyTurn: true,
      suggested: false,
      paused: false,
    });
    expect(invalid.title).toContain("还没组成");
  });

  it("prioritizes the turn restriction over selection coaching", () => {
    const copy = getMoveCoachCopy({
      game: playingGame(),
      seat: 0,
      handSize: 5,
      selection: [card(3), card(4)],
      combination: null,
      canPlay: false,
      isMyTurn: false,
      suggested: false,
      paused: false,
    });
    expect(copy.title).toContain("还没轮到你");
    expect(copy.detail).not.toContain("还没组成");
  });

  it("does not encourage a playable selection while the bot has the turn", () => {
    const selected = card(10);
    const copy = getMoveCoachCopy({
      game: playingGame(),
      seat: 0,
      handSize: 5,
      selection: [selected],
      combination: classifyGuandan([selected], 2),
      canPlay: true,
      isMyTurn: false,
      suggested: false,
      paused: false,
    });
    expect(copy.title).toContain("还没轮到你");
    expect(copy.title).not.toContain("已选");
    expect(copy.detail).not.toContain("确认");
  });

  it("explains a valid but mismatched response separately from a weak response", () => {
    const target = [card(9), card(9, "D")];
    const trick = {
      seat: 1,
      cards: target,
      combination: classifyGuandan(target, 2)!,
    };
    const mismatch = getMoveCoachCopy({
      game: playingGame(trick),
      seat: 0,
      handSize: 5,
      selection: [card(13)],
      combination: null,
      canPlay: false,
      isMyTurn: true,
      suggested: false,
      paused: false,
    });
    expect(mismatch.title).toContain("牌型不匹配");
    expect(mismatch.title).not.toContain("更大");

    const weak = getMoveCoachCopy({
      game: playingGame({
        seat: 1,
        cards: [card(9)],
        combination: classifyGuandan([card(9)], 2)!,
      }),
      seat: 0,
      handSize: 5,
      selection: [card(3)],
      combination: null,
      canPlay: false,
      isMyTurn: true,
      suggested: false,
      paused: false,
    });
    expect(weak.title).toContain("还不够大");
  });

  it("uses the actual Dou Dizhu public shape when coaching a weak response", () => {
    const target = card(9);
    const copy = getMoveCoachCopy({
      game: doudizhuGame({
        seat: 1,
        cards: [target],
        combination: classifyDoudizhu([target])!,
      }),
      seat: 0,
      handSize: 5,
      selection: [card(3)],
      combination: null,
      canPlay: false,
      isMyTurn: true,
      suggested: false,
      paused: false,
    });
    expect(copy.title).toContain("牌型成立");
    expect(copy.title).not.toContain("还没组成");
  });

  it.each([
    ["bidding", "叫分"],
    ["tribute", "进贡"],
    ["return", "还贡"],
    ["discard", "弃牌"],
  ] as const)("gives phase-specific guidance during %s", (phase, label) => {
    const game =
      phase === "bidding"
        ? { ...playingGame(), phase, turn: 0 }
        : { ...playingGame(), phase, tribute: tributeState(), turn: 2 };
    const copy = getMoveCoachCopy({
      game,
      seat: 0,
      handSize: 5,
      selection: [],
      combination: null,
      canPlay: false,
      isMyTurn: phase === "bidding",
      suggested: false,
      paused: false,
    });
    expect(copy.title).toContain(label);
  });

  it("uses special-phase eligibility instead of the turn number", () => {
    const active = getMoveCoachCopy({
      game: {
        ...playingGame(),
        phase: "tribute",
        turn: 2,
        tribute: tributeState(),
      },
      seat: 0,
      handSize: 5,
      selection: [],
      combination: null,
      canPlay: false,
      isMyTurn: false,
      suggested: false,
      paused: false,
    });
    expect(active.title).toContain("轮到你选进贡牌");

    const waiting = getMoveCoachCopy({
      game: {
        ...playingGame(),
        phase: "tribute",
        turn: 0,
        tribute: tributeState(),
      },
      seat: 2,
      handSize: 5,
      selection: [],
      combination: null,
      canPlay: false,
      isMyTurn: true,
      suggested: false,
      paused: false,
    });
    expect(waiting.title).toContain("等其他玩家");
  });

  it("describes the return-card fallback used by the engine", () => {
    const copy = getMoveCoachCopy({
      game: { ...playingGame(), phase: "return", tribute: tributeState() },
      seat: 0,
      handSize: 5,
      selection: [],
      combination: null,
      canPlay: false,
      isMyTurn: false,
      suggested: false,
      paused: false,
    });
    expect(copy.detail).toContain("实在没有再还最小牌");
  });

  it("overrides active advice while paused and hides itself after finishing", () => {
    const paused = getMoveCoachCopy({
      game: playingGame(),
      seat: 0,
      handSize: 5,
      selection: [],
      combination: null,
      canPlay: false,
      isMyTurn: true,
      suggested: false,
      paused: true,
    });
    expect(paused.title).toContain("已暂停");
    expect(shouldRenderMoveCoach({ ...playingGame(), phase: "finished" })).toBe(
      false,
    );
    expect(shouldRenderMoveCoach(null)).toBe(false);
    expect(shouldRenderMoveCoach(playingGame())).toBe(true);
  });
});
