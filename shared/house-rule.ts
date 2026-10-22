import { cardLabel, takeCards } from './cards';
import type { GuandanState } from './types';

/** This local option is deliberately separate from the standard tribute rules. */
export function shouldOfferHouseRule(state: GuandanState): boolean {
  return state.houseRule && state.tribute?.kind === 'double' &&
    !state.tribute.resisted && state.tribute.returned.length === 2;
}

/** Each contributor resolves one opportunity: discard one owned card, or skip. */
export function applyHouseRuleDiscard(
  state: GuandanState,
  seat: number,
  cardId: string | null,
): GuandanState {
  const tribute = state.tribute;
  if (state.phase !== 'discard' || !shouldOfferHouseRule(state) || !tribute) {
    throw new Error('当前不能使用双贡弃牌规则');
  }
  if (!tribute.contributors.includes(seat) || tribute.discarded.includes(seat)) {
    throw new Error('只有尚未选择的进贡方可以弃牌或跳过');
  }
  if (cardId !== null && typeof cardId !== 'string') throw new Error('弃牌选择无效');
  const card = cardId === null ? null : takeCards(state.hands[seat], [cardId])[0];
  const next = structuredClone(state);
  const nextTribute = next.tribute!;
  if (card) {
    next.hands[seat] = next.hands[seat].filter(c => c.id !== card.id);
    next.removed.push(card);
    next.history.push({ seat, text: `座位 ${seat + 1} 使用双贡弃牌：${cardLabel(card)}`, cards: [card] });
  } else {
    next.history.push({ seat, text: `座位 ${seat + 1} 跳过双贡弃牌` });
  }
  nextTribute.discarded.push(seat);
  const pending = nextTribute.contributors.find(s => !nextTribute.discarded.includes(s));
  if (pending === undefined) {
    next.phase = 'playing';
    next.turn = nextTribute.pairs[0].from;
    next.history.push({ text: '双贡弃牌选择结束，开始出牌' });
  } else {
    next.turn = pending;
  }
  return next;
}
