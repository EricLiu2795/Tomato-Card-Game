import { makeDeck, shuffle, takeCards } from './cards';
import type { Card } from './cards';
import { beatsDoudizhu, classifyDoudizhu } from './doudizhu-combinations';
import type { DoudizhuState, GameAction } from './types';

export { beatsDoudizhu, classifyDoudizhu } from './doudizhu-combinations';

/** A fresh auction. handNumber also rotates the first bidder. */
export function createDoudizhu(options: { random?: () => number; handNumber?: number } = {}): DoudizhuState {
  const handNumber = options.handNumber ?? 1;
  if (!Number.isSafeInteger(handNumber) || handNumber < 1) throw new Error('局数必须为正整数');
  const deck = shuffle(makeDeck(), options.random);
  const hands: Card[][] = [[], [], []];
  for (let i = 0; i < 51; i++) hands[i % 3].push(deck[i]);
  const turn = (handNumber - 1) % 3;
  return {
    kind: 'doudizhu', phase: 'bidding', hands, turn, trick: null, passed: [], played: [], removed: [],
    finishOrder: [], history: [{ text: `第 ${handNumber} 局开始，${turn + 1} 号位叫分` }], handNumber,
    bottom: deck.slice(51), bids: [null, null, null], highBid: 0, highBidder: null, bidCount: 0,
    landlord: null, multiplier: 1, scores: [0, 0, 0], winnerTeam: null, playCounts: [0, 0, 0],
  };
}

function finishAuction(state: DoudizhuState): void {
  if (state.highBidder === null) throw new Error('尚未产生地主');
  state.landlord = state.highBidder;
  state.hands[state.landlord].push(...state.bottom);
  state.phase = 'playing';
  state.turn = state.landlord;
  state.history.push({ text: `${state.landlord + 1} 号位成为地主，底分 ${state.highBid}`, seat: state.landlord });
}

function finishHand(state: DoudizhuState, winner: number): void {
  const landlord = state.landlord;
  if (landlord === null) throw new Error('尚未产生地主');
  const landlordWon = winner === landlord;
  state.winnerTeam = landlordWon ? 'landlord' : 'farmers';
  state.phase = 'finished';
  state.finishOrder = [winner];
  const spring = landlordWon
    ? state.playCounts.every((count, seat) => seat === landlord || count === 0)
    : state.playCounts[landlord] === 1;
  if (spring) {
    state.multiplier *= 2;
    state.history.push({ text: landlordWon ? '春天：农民未出牌，倍数 ×2' : '反春天：地主仅出过一手，倍数 ×2' });
  }
  const unit = state.highBid * state.multiplier;
  state.scores = state.hands.map((_, seat) => seat === landlord
    ? (landlordWon ? 2 : -2) * unit
    : (landlordWon ? -1 : 1) * unit);
  state.history.push({ text: `${landlordWon ? '地主' : '农民'}获胜，底分 ${state.highBid} × ${state.multiplier} 倍`, seat: winner });
}

/** Apply an action immutably. Optional randomness makes an all-pass redeal reproducible in tests. */
export function applyDoudizhu(state: DoudizhuState, seat: number, action: GameAction, random?: () => number): DoudizhuState {
  if (!Number.isInteger(seat) || seat < 0 || seat >= 3) throw new Error('无效的座位');
  if (state.phase === 'finished') throw new Error('本局已经结束');
  if (seat !== state.turn) throw new Error('还没有轮到你');

  const next = structuredClone(state);
  if (next.phase === 'bidding') {
    if (action.type !== 'BID') throw new Error('请先叫分');
    if (next.bids[seat] !== null) throw new Error('每人只能叫分一次');
    if (!Number.isInteger(action.value) || action.value < 0 || action.value > 3
      || (action.value !== 0 && action.value <= next.highBid)) throw new Error('叫分须为不叫或高于当前最高分的 1、2、3 分');
    next.bids[seat] = action.value;
    next.bidCount += 1;
    next.history.push({ text: action.value === 0 ? `${seat + 1} 号位不叫` : `${seat + 1} 号位叫 ${action.value} 分`, seat });
    if (action.value > 0) {
      next.highBid = action.value;
      next.highBidder = seat;
    }
    if (action.value === 3) {
      finishAuction(next);
    } else if (next.bidCount === 3) {
      if (next.highBidder === null) {
        const redealt = createDoudizhu({ random, handNumber: next.handNumber + 1 });
        redealt.history = [...next.history, { text: '三家不叫，重新洗牌发牌并轮换首叫位' }, ...redealt.history];
        return redealt;
      }
      finishAuction(next);
    } else {
      next.turn = (seat + 1) % 3;
    }
    return next;
  }

  if (next.phase !== 'playing') throw new Error('当前阶段不能出牌');
  if (action.type === 'PASS') {
    if (!next.trick) throw new Error('领出时不能不出');
    next.passed.push(seat);
    next.history.push({ text: `${seat + 1} 号位不出`, seat });
    if (next.passed.length === 2) {
      next.turn = next.trick.seat;
      next.trick = null;
      next.passed = [];
    } else {
      next.turn = (seat + 1) % 3;
    }
    return next;
  }
  if (action.type !== 'PLAY_CARDS') throw new Error('当前阶段只能出牌或不出');
  const cards = takeCards(next.hands[seat], action.cardIds);
  const combination = classifyDoudizhu(cards, next.trick?.combination);
  if (!combination) throw new Error('不符合斗地主牌型');
  if (next.trick && !beatsDoudizhu(combination, next.trick.combination)) throw new Error('必须打出更大的同类牌型，或炸弹、王炸');
  const ids = new Set(action.cardIds);
  next.hands[seat] = next.hands[seat].filter(card => !ids.has(card.id));
  next.played.push(...cards);
  next.trick = { seat, cards, combination };
  next.passed = [];
  next.playCounts[seat] += 1;
  if (combination.bomb > 0) next.multiplier *= 2;
  next.history.push({ text: `${seat + 1} 号位出 ${combination.label}${combination.bomb > 0 ? '，倍数 ×2' : ''}`, seat, cards });
  next.turn = (seat + 1) % 3;
  if (next.hands[seat].length === 0) finishHand(next, seat);
  return next;
}
