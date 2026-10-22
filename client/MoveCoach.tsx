import type { Card } from "../shared/cards";
import type { Combination, Snapshot } from "../shared/types";

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
  if (!game || game.phase === "finished") return null;
  const seat =
    snapshot.players.find((player) => player.id === snapshot.selfId)?.seat ?? 0;
  const teammateLeading =
    game.trick &&
    game.trick.seat !== seat &&
    (game.kind === "guandan"
      ? game.trick.seat % 2 === seat % 2
      : game.landlord != null &&
        game.landlord !== seat &&
        game.trick.seat !== game.landlord);
  const remaining = snapshot.hand.length - selection.length;
  let title = isMyTurn ? "轮到你了，慢慢想。" : "看看牌，想想下一手。";
  let detail = "跟着桌面提示选一张牌，完成交换后就能继续。";
  if (game.phase === "bidding") {
    title = "好牌敢叫分";
    detail = "3 分直接成为地主，拿走 3 张底牌；也可以不叫，做农民与队友配合。";
  } else if (game.phase === "playing") {
    if (selection.length && combination && canPlay) {
      title = `${suggested ? "试试" : "已选"}${combination.label} · 出 ${selection.length} 张，剩 ${remaining} 张`;
      detail =
        remaining === 0
          ? "这手能出完全部手牌，可以收尾了！"
          : teammateLeading
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
                    : "先送走一张散牌。也可以点「提示」看看有没有适合一起出的组合。";
    } else if (selection.length) {
      title = combination
        ? "牌型成立，还需要更大一点。"
        : "这些牌还没组成一种牌型。";
      detail = combination
        ? "跟牌需要同类、同张数且更大，或能压过它的炸弹。可以试试「提示」。"
        : "试着选对子、三张或顺子；点「提示」也能自动选出一手合法牌。";
    } else if (teammateLeading) {
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
