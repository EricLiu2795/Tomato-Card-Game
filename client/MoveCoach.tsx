import type { Card } from "../shared/cards";
import { classifyDoudizhu } from "../shared/doudizhu-combinations";
import { classifyGuandan } from "../shared/guandan-combinations";
import type { Combination, PublicGame, Snapshot } from "../shared/types";

export interface MoveCoachCopy {
  title: string;
  detail: string;
}

export interface MoveCoachCopyInput {
  game: PublicGame;
  seat: number;
  handSize: number;
  selection: Card[];
  combination: Combination | null;
  canPlay: boolean;
  isMyTurn: boolean;
  suggested: boolean;
  paused: boolean;
}

export function shouldRenderMoveCoach(game: PublicGame | null): boolean {
  return !!game && game.phase !== "finished";
}

function standaloneCombination(
  game: PublicGame,
  selection: Card[],
): Combination | null {
  if (!selection.length) return null;
  try {
    return game.kind === "guandan"
      ? classifyGuandan(selection, game.currentLevel ?? 2)
      : classifyDoudizhu(selection);
  } catch {
    return null;
  }
}

function teammateLeading(game: PublicGame, seat: number): boolean {
  if (!game.trick || game.trick.seat === seat) return false;
  return game.kind === "guandan"
    ? game.trick.seat % 2 === seat % 2
    : game.landlord != null &&
        game.landlord !== seat &&
        game.trick.seat !== game.landlord;
}

function eligibleForPhase(game: PublicGame, seat: number): boolean {
  if (game.phase === "bidding" || game.phase === "playing") {
    return game.turn === seat;
  }
  const tribute = game.tribute;
  if (!tribute) return false;
  if (game.phase === "tribute") {
    return (
      tribute.contributors.includes(seat) &&
      !Object.hasOwn(tribute.selections, seat)
    );
  }
  if (game.phase === "return") {
    return (
      tribute.pairs.some((pair) => pair.to === seat) &&
      !tribute.returned.includes(seat)
    );
  }
  if (game.phase === "discard") {
    return (
      tribute.contributors.includes(seat) && !tribute.discarded.includes(seat)
    );
  }
  return false;
}

/** Keep shape validity separate from whether that shape can beat the table. */
export function getMoveCoachCopy({
  game,
  seat,
  handSize,
  selection,
  combination,
  canPlay,
  isMyTurn,
  suggested,
  paused,
}: MoveCoachCopyInput): MoveCoachCopy {
  const selectedCombination = standaloneCombination(game, selection);
  const teammateHasLead = teammateLeading(game, seat);
  const remaining = handSize - selection.length;
  const canActInPhase = eligibleForPhase(game, seat);
  const canChoose =
    game.phase === "playing" || game.phase === "bidding"
      ? isMyTurn
      : canActInPhase;
  let title = canChoose ? "轮到你了，慢慢想。" : "还没轮到你，先看看牌。";
  let detail = canChoose
    ? "跟着桌面提示选一张牌，想好后再确认。"
    : "电脑和队友正在出牌，轮到你时再作决定。";

  if (game.phase === "bidding") {
    title = canActInPhase ? "轮到你叫分了" : "先看看大家怎么叫分";
    detail = canActInPhase
      ? "3 分直接成为地主并拿走底牌；也可以不叫，留意队友的牌力。"
      : "其他玩家正在叫分，等轮到你时再决定要不要加分。";
  } else if (game.phase === "tribute") {
    title = canActInPhase ? "轮到你选进贡牌" : "等其他玩家完成进贡";
    detail = canActInPhase
      ? "选一张符合规则的牌进贡；红桃级牌不能直接进贡。"
      : "进贡完成后才会进入还牌，先看看桌面提示。";
  } else if (game.phase === "return") {
    title = canActInPhase ? "轮到你选还贡牌" : "等上游玩家还牌";
    detail = canActInPhase
      ? "优先还一张不高于 10 的非级牌；如果没有，就还最小的非红桃级牌，实在没有再还最小牌。"
      : "还牌完成后，牌局才会继续出牌。";
  } else if (game.phase === "discard") {
    title = canActInPhase ? "轮到你处理双贡弃牌" : "等其他进贡方弃牌";
    detail = canActInPhase
      ? "可以弃一张手牌，也可以跳过这次双贡机会。"
      : "所有进贡方完成选择后，牌局就会重新开始。";
  } else if (game.phase === "playing") {
    if (!isMyTurn) {
      title = "还没轮到你，先看看牌。";
      detail = game.trick
        ? `桌面目标是${game.trick.combination.label}，轮到你时再决定跟牌或不出。`
        : "电脑正在领出，轮到你时再决定下一手。";
    } else if (selection.length && canPlay && combination) {
      title = `${suggested ? "试试" : "已选"}${combination.label} · 出 ${selection.length} 张，剩 ${remaining} 张`;
      detail =
        remaining === 0
          ? "这手能出完全部手牌，可以收尾了！"
          : teammateHasLead
            ? "现在是队友领牌，也可以选择「不出」，把牌权留给队友。"
            : combination.bomb > 0
              ? game.kind === "doudizhu"
                ? "炸弹能夺回牌权，也会让本局倍数翻倍，看看是否值得现在使用。"
                : "炸弹可以夺回牌权；若有普通牌能接上，也可以留到关键时刻。"
              : Object.keys(combination.substitutions ?? {}).length > 0
                ? "这手用了逢人配，红桃级牌会自动补成当前牌型。"
                : game.trick
                  ? `这手可以压过${game.trick.combination.label}。点「出牌」确认，也可以再点「提示」换个思路。`
                  : selection.length > 1
                    ? "成组出牌能一次送走更多手牌。留意剩下的牌，想好下一手怎么接。"
                    : "先送走一张散牌，也可以点「提示」看看有没有适合一起出的组合。";
    } else if (selection.length) {
      if (!selectedCombination) {
        title = "这些牌还没组成一种牌型。";
        detail = "试着选对子、三张或顺子；点「提示」也能自动选出一手合法牌。";
      } else {
        const sameShape =
          !game.trick ||
          (selectedCombination.kind === game.trick.combination.kind &&
            selectedCombination.size === game.trick.combination.size);
        const selectedBomb = selectedCombination.bomb > 0;
        if (game.trick && !sameShape && !selectedBomb) {
          title = "牌型成立，但牌型不匹配。";
          detail =
            "这组牌本身是合法牌型，但跟牌需要保持同类、同张数；也可以换炸弹压过桌面。";
        } else {
          title = "牌型成立，但还不够大。";
          detail =
            "这组牌本身是合法牌型，但还压不过桌面目标。可以换一手更大的同类牌，或使用炸弹。";
        }
      }
    } else if (teammateHasLead) {
      title = "队友掌握牌权，配合也是好牌。";
      detail = "如果不急着收尾，可以选择「不出」，让队友继续控制这一轮。";
    } else if (game.trick) {
      title = `跟牌目标：${game.trick.combination.label} · ${game.trick.cards.length} 张`;
      detail = "用更大的同类牌型，或炸弹来压；不想接时可以选择「不出」。";
    } else {
      title = "自由领出，组合一下更顺手。";
      detail = "试试对子、顺子等组合；点「提示」选一手，再点一次换个思路。";
    }
  }

  if (paused) {
    title = "练习已暂停";
    detail = "电脑和牌桌都在等你。可以整理手牌，点「继续」后再出牌。";
  }
  return { title, detail };
}

/** Coaching uses only the player's own cards and the public table. */
export function MoveCoach({
  snapshot,
  selection,
  combination,
  canPlay,
  isMyTurn,
  suggested,
  paused,
  onRules,
}: {
  snapshot: Snapshot;
  selection: Card[];
  combination: Combination | null;
  canPlay: boolean;
  isMyTurn: boolean;
  suggested: boolean;
  paused: boolean;
  onRules: () => void;
}) {
  const game = snapshot.game;
  if (!game || !shouldRenderMoveCoach(game)) return null;
  const seat =
    snapshot.players.find((player) => player.id === snapshot.selfId)?.seat ?? 0;
  const { title, detail } = getMoveCoachCopy({
    game,
    seat,
    handSize: snapshot.hand.length,
    selection,
    combination,
    canPlay,
    isMyTurn,
    suggested,
    paused,
  });
  return (
    <div
      className={`table-coach move-coach ${isMyTurn && !paused ? "coach-active" : ""}`}
      data-testid="move-coach"
    >
      <span className="coach-icon" aria-hidden="true">
        ✧
      </span>
      <div aria-live="polite">
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
      <button onClick={onRules} aria-label="查看详细玩法">
        ?
      </button>
    </div>
  );
}
