import { cardLabel, gdStrength, isWild, makeDeck, shuffle, takeCards } from './cards';
import type { Card } from './cards';
import { beatsGuandan, classifyGuandan, classifyGuandanResponse } from './guandan-combinations';
import { applyHouseRuleDiscard, shouldOfferHouseRule } from './house-rule';
import type { GameAction, GuandanState, TributePair, TributeState } from './types';

const partner = (seat: number) => (seat + 2) % 4;
const team = (seat: number) => seat % 2;

/** Highest card, excluding the heart-level wildcards. Equal physical cards are choices. */
export function legalTributeCards(hand: Card[], level: number): Card[] {
  const candidates = hand.filter(card => !isWild(card, level));
  const max = Math.max(...candidates.map(card => gdStrength(card.rank, level)));
  return candidates.filter(card => gdStrength(card.rank, level) === max);
}

/** Return an ordinary <=10; if none exists, return the weakest non-wild card. */
export function legalReturnCards(hand: Card[], level: number): Card[] {
  const low = hand.filter(card => card.rank <= 10 && card.rank !== level);
  if (low.length) return low;
  const ordinary = hand.filter(card => !isWild(card, level));
  const candidates = ordinary.length ? ordinary : hand;
  const min = Math.min(...candidates.map(card => gdStrength(card.rank, level)));
  return candidates.filter(card => gdStrength(card.rank, level) === min);
}

function nextLiveSeat(state: GuandanState, after: number): number {
  for (let offset = 1; offset <= 4; offset++) {
    const seat = (after + offset) % 4;
    if (state.hands[seat].length > 0 && !state.finishOrder.includes(seat)) return seat;
  }
  throw new Error('没有可继续出牌的玩家');
}

function validFinishOrder(order: number[]): boolean {
  return order.length === 4 && new Set(order).size === 4 &&
    order.every(seat => Number.isInteger(seat) && seat >= 0 && seat < 4);
}

function prepareTribute(state: GuandanState): void {
  const [first, second, third, last] = state.previousFinish;
  const double = team(first) === team(second);
  const contributors = double ? [third, last] : [last];
  const pairs: TributePair[] = double
    ? [{ from: third, to: first }, { from: last, to: second }]
    : [{ from: last, to: first }];
  const resisted = contributors.flatMap(seat => state.hands[seat]).filter(card => card.rank === 16).length === 2;
  state.tribute = {
    kind: double ? 'double' : 'single', pairs, contributors,
    selections: {}, returned: [], discarded: [], resisted,
  };
  if (resisted) {
    state.phase = 'playing';
    state.turn = first;
    state.history.push({ text: '进贡方合计持有两张大王，自动抗贡；上游先出，无双贡弃牌' });
  } else {
    state.phase = 'tribute';
    state.turn = contributors[0];
    state.history.push({ text: double ? '上一副双下：双方选择贡牌' : '末游向上游进贡' });
  }
}

export function createGuandan(options: {
  random?: () => number;
  houseRule?: boolean;
  previous?: GuandanState;
} = {}): GuandanState {
  const previous = options.previous;
  if (previous && (previous.phase !== 'finished' || !validFinishOrder(previous.finishOrder))) {
    throw new Error('上一副尚未结束，不能重新发牌');
  }
  if (previous?.matchWinner !== null && previous?.matchWinner !== undefined) {
    throw new Error('比赛已经结束，请开始新比赛');
  }
  const levels: [number, number] = previous ? [...previous.levels] : [2, 2];
  const levelTeam = previous?.winnerTeam ?? 0;
  const currentLevel = levels[levelTeam];
  const deck = shuffle(makeDeck(2), options.random);
  const hands: Card[][] = [[], [], [], []];
  deck.forEach((card, index) => hands[index % 4].push(card));
  const state: GuandanState = {
    kind: 'guandan', phase: 'playing', hands, turn: 0,
    trick: null, passed: [], played: [], removed: [], finishOrder: [],
    history: [{ text: `第 ${(previous?.handNumber ?? 0) + 1} 副：打 ${currentLevel === 14 ? 'A' : currentLevel}` }],
    handNumber: (previous?.handNumber ?? 0) + 1,
    levels, currentLevel, levelTeam, previousFinish: previous ? [...previous.finishOrder] : [],
    tribute: null, houseRule: options.houseRule ?? previous?.houseRule ?? true,
    winnerTeam: null, matchWinner: null, advancement: 0,
  };
  if (previous) prepareTribute(state);
  return state;
}

function selectTribute(state: GuandanState, seat: number, cardId: string): void {
  const tribute = state.tribute;
  if (state.phase !== 'tribute' || !tribute || tribute.resisted) throw new Error('当前不是进贡阶段');
  if (!tribute.contributors.includes(seat) || tribute.selections[seat] !== undefined) {
    throw new Error('只有尚未选择的进贡方可以提交贡牌');
  }
  const card = takeCards(state.hands[seat], [cardId])[0];
  if (!legalTributeCards(state.hands[seat], state.currentLevel).some(c => c.id === card.id)) {
    throw new Error('必须进贡除红桃级牌外最大的牌');
  }
  tribute.selections[seat] = card.id;
  state.history.push({ seat, text: `座位 ${seat + 1} 已选择贡牌`, cards: [card] });
  const pending = tribute.contributors.find(s => tribute.selections[s] === undefined);
  if (pending !== undefined) {
    state.turn = pending;
    return;
  }

  // Increasing seat IDs are the play direction. Equal tributes are passed
  // in the opposite direction: previous first's next player gives to first.
  const first = state.previousFinish[0];
  const ordered = [...tribute.contributors].sort((a, b) => {
    const aCard = state.hands[a].find(c => c.id === tribute.selections[a])!;
    const bCard = state.hands[b].find(c => c.id === tribute.selections[b])!;
    return gdStrength(bCard.rank, state.currentLevel) - gdStrength(aCard.rank, state.currentLevel) ||
      ((a - first + 4) % 4) - ((b - first + 4) % 4);
  });
  tribute.pairs = ordered.map((from, index) => ({
    from, to: state.previousFinish[index],
    tribute: state.hands[from].find(c => c.id === tribute.selections[from])!,
  }));
  state.phase = 'return';
  state.turn = tribute.pairs[0].to;
  state.history.push({ text: '贡牌已确定，请上游方选择还牌；全部选择后同时交换' });
}

function completeExchange(state: GuandanState, tribute: TributeState): void {
  // Build all outgoing IDs before adding incoming cards: no partial transfer,
  // no opportunity to return the freshly received tribute.
  const outgoing = new Set(tribute.pairs.flatMap(pair => [pair.tribute!.id, pair.returnCard!.id]));
  state.hands = state.hands.map(hand => hand.filter(card => !outgoing.has(card.id)));
  for (const pair of tribute.pairs) {
    state.hands[pair.to].push(pair.tribute!);
    state.hands[pair.from].push(pair.returnCard!);
    state.history.push({
      text: `座位 ${pair.from + 1} 向座位 ${pair.to + 1} 进贡 ${cardLabel(pair.tribute!)}，还牌 ${cardLabel(pair.returnCard!)}`,
      cards: [pair.tribute!, pair.returnCard!],
    });
  }
  if (shouldOfferHouseRule(state)) {
    state.phase = 'discard';
    state.turn = tribute.contributors[0];
    state.history.push({ text: '双贡弃牌已开启：每名进贡者可弃一张牌，或跳过' });
  } else {
    state.phase = 'playing';
    state.turn = tribute.pairs[0].from;
  }
}

function selectReturn(state: GuandanState, seat: number, cardId: string): void {
  const tribute = state.tribute;
  if (state.phase !== 'return' || !tribute || tribute.resisted) throw new Error('当前不是还牌阶段');
  const pair = tribute.pairs.find(p => p.to === seat);
  if (!pair || tribute.returned.includes(seat)) throw new Error('只有尚未还牌的受贡方可以还牌');
  const card = takeCards(state.hands[seat], [cardId])[0];
  if (!legalReturnCards(state.hands[seat], state.currentLevel).some(c => c.id === card.id)) {
    throw new Error('有非级牌且不大于10时必须还此类牌，否则还最小的非红桃级牌');
  }
  pair.returnCard = card;
  tribute.returned.push(seat);
  const pending = tribute.pairs.find(p => !tribute.returned.includes(p.to));
  if (pending) state.turn = pending.to;
  else completeExchange(state, tribute);
}

function finishHand(state: GuandanState): void {
  if (state.finishOrder.length === 3) {
    state.finishOrder.push([0, 1, 2, 3].find(seat => !state.finishOrder.includes(seat))!);
  }
  const first = state.finishOrder[0];
  const winningTeam = team(first);
  const partnerPosition = state.finishOrder.indexOf(partner(first));
  const advancement = 4 - partnerPosition; // partner index 1 / 2 / 3 => +3 / +2 / +1
  state.winnerTeam = winningTeam;
  state.advancement = advancement;
  const winsAtA = state.levels[winningTeam] === 14 && state.currentLevel === 14 && partnerPosition < 3;
  state.levels[winningTeam] = Math.min(14, state.levels[winningTeam] + advancement);
  state.matchWinner = winsAtA ? winningTeam : null;
  state.phase = 'finished';
  state.turn = -1;
  state.passed = [];
  state.history.push({ text: `${winningTeam === 0 ? '一、三座' : '二、四座'}获胜，升 ${advancement} 级；名次：${state.finishOrder.map(s => s + 1).join('、')}` });
  if (winsAtA) state.history.push({ text: '成功打过 A，整场比赛结束' });
}

function playCards(state: GuandanState, seat: number, cardIds: string[]): void {
  const cards = takeCards(state.hands[seat], cardIds);
  const combination = state.trick
    ? classifyGuandanResponse(cards, state.currentLevel, state.trick.combination)
    : classifyGuandan(cards, state.currentLevel);
  if (!combination) throw new Error('所选牌不构成可出的掼蛋牌型，或不能压过当前牌');
  if (state.trick && !beatsGuandan(combination, state.trick.combination)) throw new Error('所选牌不能压过当前牌');
  const ids = new Set(cardIds);
  state.hands[seat] = state.hands[seat].filter(card => !ids.has(card.id));
  state.played.push(...cards);
  state.trick = { seat, cards, combination };
  state.passed = [];
  state.history.push({ seat, text: `座位 ${seat + 1} 出${combination.label}`, cards });
  if (state.hands[seat].length === 0) {
    state.finishOrder.push(seat);
    state.history.push({ seat, text: `座位 ${seat + 1} 第 ${state.finishOrder.length} 名出完` });
    if (state.finishOrder.length === 3) {
      finishHand(state);
      return;
    }
  }
  state.turn = nextLiveSeat(state, seat);
}

function pass(state: GuandanState, seat: number): void {
  if (!state.trick || state.trick.seat === seat) throw new Error('领出时不能不出');
  if (state.passed.includes(seat)) throw new Error('本圈已经不出');
  state.passed.push(seat);
  state.history.push({ seat, text: `座位 ${seat + 1} 不出` });
  const leader = state.trick.seat;
  const responders = [0, 1, 2, 3].filter(s => s !== leader && state.hands[s].length > 0 && !state.finishOrder.includes(s));
  if (responders.every(s => state.passed.includes(s))) {
    const liveLeader = state.hands[leader].length > 0 && !state.finishOrder.includes(leader);
    const livePartner = state.hands[partner(leader)].length > 0 && !state.finishOrder.includes(partner(leader));
    state.turn = liveLeader ? leader : livePartner ? partner(leader) : nextLiveSeat(state, leader);
    state.trick = null;
    state.passed = [];
    state.history.push({ text: liveLeader ? `座位 ${state.turn + 1} 重新领出` : `座位 ${state.turn + 1} 接风领出` });
  } else {
    state.turn = nextLiveSeat(state, seat);
  }
}

/** Authoritative pure transition. Throws on rejection without touching the input. */
export function applyGuandan(state: GuandanState, seat: number, action: GameAction): GuandanState {
  if (!Number.isInteger(seat) || seat < 0 || seat > 3) throw new Error('座位无效');
  if (state.phase === 'finished') throw new Error('本副已经结束');
  if (action.type === 'DISCARD_HOUSE_RULE') return applyHouseRuleDiscard(state, seat, action.cardId);
  const next = structuredClone(state);
  if (action.type === 'SELECT_TRIBUTE') selectTribute(next, seat, action.cardId);
  else if (action.type === 'SELECT_RETURN_CARD') selectReturn(next, seat, action.cardId);
  else {
    if (next.phase !== 'playing') throw new Error('请先完成进贡、还牌及弃牌选择');
    if (next.turn !== seat || next.finishOrder.includes(seat) || next.hands[seat].length === 0) {
      throw new Error('尚未轮到你出牌');
    }
    if (action.type === 'PLAY_CARDS') playCards(next, seat, action.cardIds);
    else if (action.type === 'PASS') pass(next, seat);
    else throw new Error('掼蛋不支持此操作');
  }
  return next;
}
