import { describe, expect, it } from 'vitest';
import { makeDeck, seededRandom } from '../shared/cards';
import type { Card } from '../shared/cards';
import { applyGuandan, createGuandan, legalReturnCards, legalTributeCards } from '../shared/guandan';
import { classifyGuandanResponse } from '../shared/guandan-combinations';
import type { GameAction, GuandanState } from '../shared/types';

const deck = makeDeck(2);
const c = (rank: number, suit: Card['suit'] = 'C', copy = 0): Card => deck.find(card => card.rank === rank && card.suit === suit && card.deck === copy)!;
const play = (state: GuandanState, seat: number, cards: Card[]) => applyGuandan(state, seat, { type: 'PLAY_CARDS', cardIds: cards.map(card => card.id) });
const pass = (state: GuandanState, seat: number) => applyGuandan(state, seat, { type: 'PASS' });
const tribute = (state: GuandanState, seat: number, card: Card) => applyGuandan(state, seat, { type: 'SELECT_TRIBUTE', cardId: card.id });
const giveBack = (state: GuandanState, seat: number, card: Card) => applyGuandan(state, seat, { type: 'SELECT_RETURN_CARD', cardId: card.id });

function conserve(state: GuandanState): void {
  const cards = [...state.hands.flat(), ...state.played, ...state.removed];
  expect(cards).toHaveLength(108);
  expect(new Set(cards.map(card => card.id)).size).toBe(108);
  expect(cards.map(card => card.id).sort()).toEqual(deck.map(card => card.id).sort());
}

function unchangedAfterReject(state: GuandanState, seat: number, action: GameAction): void {
  const before = structuredClone(state);
  expect(() => applyGuandan(state, seat, action)).toThrow();
  expect(state).toEqual(before);
  conserve(state);
}

/** Legal late-hand positions keep already played physical cards in the played zone. */
function position(hands: Card[][], finishOrder: number[] = [], turn = 0): GuandanState {
  const state = createGuandan({ random: seededRandom(1) });
  const held = new Set(hands.flat().map(card => card.id));
  return { ...state, hands, played: deck.filter(card => !held.has(card.id)), finishOrder, turn };
}

function previous(order: number[] = [0, 2, 1, 3], levels: [number, number] = [5, 2]): GuandanState {
  const state = createGuandan({ random: seededRandom(3) });
  const last = order[3];
  state.played = state.hands.flatMap((hand, seat) => seat === last ? [] : hand);
  state.hands = state.hands.map((hand, seat) => seat === last ? hand : []);
  return { ...state, phase: 'finished', turn: -1, finishOrder: order, levels, winnerTeam: order[0] % 2 };
}

/** Construct a full 108-card fixture through the public shuffle dependency. */
function deal(required: Card[][]): () => number {
  const hands = required.map(hand => [...hand]);
  const selected = new Set(hands.flat().map(card => card.id));
  for (const card of deck) {
    if (!selected.has(card.id)) hands.find(hand => hand.length < 27)!.push(card);
  }
  const target = Array.from({ length: 108 }, (_, i) => hands[i % 4][Math.floor(i / 4)]);
  const working = [...deck];
  const draws: number[] = [];
  for (let i = working.length - 1; i > 0; i--) {
    const j = working.findIndex(card => card.id === target[i].id);
    expect(j).toBeLessThanOrEqual(i);
    draws.push((j + 0.5) / (i + 1));
    [working[i], working[j]] = [working[j], working[i]];
  }
  let index = 0;
  return () => draws[index++];
}

function doubleTribute(houseRule = true, order = [0, 2, 1, 3]): GuandanState {
  return createGuandan({
    previous: previous(order), houseRule,
    random: deal([
      [c(16, 'J'), c(16, 'J', 1), c(2, 'D')],
      [c(15, 'J'), c(5, 'H')],
      [c(3, 'D')],
      [c(15, 'J', 1)],
    ]),
  });
}

function throughDoubleReturn(houseRule = true): GuandanState {
  let state = doubleTribute(houseRule);
  state = tribute(state, 1, c(15, 'J'));
  state = tribute(state, 3, c(15, 'J', 1));
  state = giveBack(state, 0, c(2, 'D'));
  return giveBack(state, 2, c(3, 'D'));
}

describe('Guandan deal and authoritative play', () => {
  it('deals 108 unique physical cards, 27 per seat; defaults house rule on', () => {
    const state = createGuandan({ random: seededRandom(42) });
    expect(state.hands.map(hand => hand.length)).toEqual([27, 27, 27, 27]);
    expect(state.levels).toEqual([2, 2]);
    expect(state.currentLevel).toBe(2);
    expect(state.houseRule).toBe(true);
    expect(state.phase).toBe('playing');
    expect(state.turn).toBe(0);
    conserve(state);
    expect(createGuandan({ random: seededRandom(42) }).hands).toEqual(state.hands);
  });

  it('rejects wrong turns, duplicate IDs, unowned cards, invalid shape and lead passes immutably', () => {
    const state = position([[c(3), c(4)], [c(5)], [c(6)], [c(7)]]);
    unchangedAfterReject(state, 1, { type: 'PLAY_CARDS', cardIds: [c(5).id] });
    unchangedAfterReject(state, 0, { type: 'PLAY_CARDS', cardIds: [c(3).id, c(3).id] });
    unchangedAfterReject(state, 0, { type: 'PLAY_CARDS', cardIds: [c(5).id] });
    unchangedAfterReject(state, 0, { type: 'PLAY_CARDS', cardIds: [c(3).id, c(4).id] });
    unchangedAfterReject(state, 0, { type: 'PASS' });
    unchangedAfterReject(state, -1, { type: 'PASS' });
    unchangedAfterReject(state, 0, { type: 'BID', value: 3 });
  });

  it('three passes reset the trick and permit a lower fresh lead', () => {
    let state = position([[c(9), c(3)], [c(5)], [c(6)], [c(7)]]);
    const before = structuredClone(state);
    state = play(state, 0, [c(9)]);
    expect(before.hands[0]).toHaveLength(2);
    state = pass(state, 1);
    state = pass(state, 2);
    expect(state.trick?.cards[0].id).toBe(c(9).id);
    state = pass(state, 3);
    expect(state.turn).toBe(0);
    expect(state.trick).toBeNull();
    expect(state.passed).toEqual([]);
    state = play(state, 0, [c(3)]);
    expect(state.finishOrder).toEqual([0]);
    conserve(state);
  });

  it('a passed player can respond again after another player raises the trick', () => {
    let state = position([[c(3), c(8)], [c(4), c(10)], [c(6), c(11)], [c(7), c(12)]]);
    state = play(state, 0, [c(3)]);
    state = pass(state, 1);
    state = play(state, 2, [c(6)]);
    expect(state.passed).toEqual([]);
    state = pass(state, 3);
    state = pass(state, 0);
    expect(state.turn).toBe(1);
    state = play(state, 1, [c(10)]);
    expect(state.trick?.seat).toBe(1);
    conserve(state);
  });

  it('a finished leader passes the next lead to the living partner (接风)', () => {
    let state = position([[c(9)], [c(5)], [c(3), c(6)], [c(7)]]);
    state = play(state, 0, [c(9)]);
    state = pass(state, 1);
    state = pass(state, 2);
    state = pass(state, 3);
    expect(state.turn).toBe(2);
    expect(state.trick).toBeNull();
    state = play(state, 2, [c(3)]);
    expect(state.turn).toBe(3);
    conserve(state);
  });

  it('when both leader and partner finished, the next living seat leads', () => {
    let state = position([[], [c(4)], [c(9)], [c(3), c(7)]], [0], 2);
    state = play(state, 2, [c(9)]);
    expect(state.finishOrder).toEqual([0, 2]);
    state = pass(state, 3);
    expect(state.turn).toBe(1);
    state = pass(state, 1);
    expect(state.turn).toBe(3);
    expect(state.trick).toBeNull();
    conserve(state);
  });
});

describe('Guandan rankings, advancement and A', () => {
  function finish(order: number[], levels: [number, number] = [2, 2], level = 2): GuandanState {
    const hands: Card[][] = [[], [], [], []];
    hands[order[2]] = [c(3)];
    hands[order[3]] = [c(4), c(7)];
    const state = position(hands, order.slice(0, 2), order[2]);
    state.levels = levels;
    state.currentLevel = level;
    return play(state, order[2], [c(3)]);
  }

  it.each([
    [[0, 2, 1, 3], 3],
    [[0, 1, 2, 3], 2],
    [[0, 1, 3, 2], 1],
    [[1, 3, 0, 2], 3],
  ] as [number[], number][])('assigns four places for %j and advances %i', (order, advancement) => {
    const state = finish(order);
    expect(state.finishOrder).toEqual(order);
    expect(state.winnerTeam).toBe(order[0] % 2);
    expect(state.advancement).toBe(advancement);
    expect(state.levels[order[0] % 2]).toBe(2 + advancement);
    expect(state.phase).toBe('finished');
    expect(state.turn).toBe(-1);
    conserve(state);
    unchangedAfterReject(state, order[3], { type: 'PASS' });
  });

  it('caps levels at A without treating arrival at A as match victory', () => {
    const state = finish([0, 2, 1, 3], [13, 8], 13);
    expect(state.levels).toEqual([14, 8]);
    expect(state.matchWinner).toBeNull();
    const next = createGuandan({ previous: state, random: seededRandom(90) });
    expect(next.levels).toEqual([14, 8]);
    expect(next.currentLevel).toBe(14);
    expect(next.levelTeam).toBe(0);
    expect(next.handNumber).toBe(2);
    conserve(next);
  });

  it.each([[0, 2, 1, 3], [0, 1, 2, 3]])('wins at A with partner second or third: %j', (...order) => {
    const state = finish(order, [14, 10], 14);
    expect(state.matchWinner).toBe(0);
    expect(() => createGuandan({ previous: state })).toThrow();
  });

  it('does not pass A with a last-place partner or while playing the opponent’s lower level', () => {
    expect(finish([0, 1, 3, 2], [14, 10], 14).matchWinner).toBeNull();
    expect(finish([0, 2, 1, 3], [14, 10], 10).matchWinner).toBeNull();
    expect(finish([1, 3, 0, 2], [14, 10], 14).matchWinner).toBeNull();
  });

  it('retains A through repeated first/last failures; this dialect has no three-strike reset', () => {
    let levels: [number, number] = [14, 10];
    for (let attempt = 0; attempt < 4; attempt++) {
      const failed = finish([0, 1, 3, 2], levels, 14);
      const next = createGuandan({ previous: failed, random: seededRandom(attempt) });
      expect(failed.matchWinner).toBeNull();
      expect(next.currentLevel).toBe(14);
      expect(next.levels).toEqual([14, 10]);
      levels = next.levels;
      conserve(next);
    }
  });

  it('rejects dealing over an unfinished hand', () => {
    expect(() => createGuandan({ previous: createGuandan({ random: seededRandom(1) }) })).toThrow();
  });
});

describe('Guandan single and double tribute', () => {
  it('single tribute transfers atomically; last-place player leads, no house discard', () => {
    let state = createGuandan({
      previous: previous([0, 1, 2, 3]),
      random: deal([[c(16, 'J'), c(2, 'D')], [], [], [c(16, 'J', 1), c(5, 'H')]]),
    });
    expect(state.tribute?.kind).toBe('single');
    const originalHands = structuredClone(state.hands);
    unchangedAfterReject(state, 0, { type: 'SELECT_TRIBUTE', cardId: c(16, 'J').id });
    unchangedAfterReject(state, 3, { type: 'SELECT_TRIBUTE', cardId: c(5, 'H').id });
    state = tribute(state, 3, c(16, 'J', 1));
    expect(state.phase).toBe('return');
    expect(state.hands).toEqual(originalHands);
    unchangedAfterReject(state, 3, { type: 'SELECT_TRIBUTE', cardId: c(16, 'J', 1).id });
    unchangedAfterReject(state, 0, { type: 'SELECT_RETURN_CARD', cardId: c(16, 'J').id });
    unchangedAfterReject(state, 0, { type: 'SELECT_RETURN_CARD', cardId: c(16, 'J', 1).id });
    state = giveBack(state, 0, c(2, 'D'));
    expect(state.phase).toBe('playing');
    expect(state.turn).toBe(3);
    expect(state.hands[0].some(card => card.id === c(16, 'J', 1).id)).toBe(true);
    expect(state.hands[3].some(card => card.id === c(2, 'D').id)).toBe(true);
    expect(state.hands.map(hand => hand.length)).toEqual([27, 27, 27, 27]);
    unchangedAfterReject(state, 3, { type: 'DISCARD_HOUSE_RULE', cardId: null });
    conserve(state);
  });

  it('collective two big jokers resist double tribute without exchanges or house discard', () => {
    const state = createGuandan({
      previous: previous(),
      random: deal([[], [c(16, 'J')], [], [c(16, 'J', 1)]]),
    });
    expect(state.tribute?.resisted).toBe(true);
    expect(state.tribute?.returned).toEqual([]);
    expect(state.phase).toBe('playing');
    expect(state.turn).toBe(0);
    unchangedAfterReject(state, 1, { type: 'SELECT_TRIBUTE', cardId: c(16, 'J').id });
    unchangedAfterReject(state, 1, { type: 'DISCARD_HOUSE_RULE', cardId: null });
    conserve(state);
  });

  it('one single contributor holding both big jokers also resists', () => {
    const state = createGuandan({
      previous: previous([2, 1, 0, 3]),
      random: deal([[], [], [], [c(16, 'J'), c(16, 'J', 1)]]),
    });
    expect(state.tribute?.kind).toBe('single');
    expect(state.tribute?.resisted).toBe(true);
    expect(state.turn).toBe(2);
    conserve(state);
  });

  it('ties map next player of prior first to first, independent of ranking or submission order', () => {
    let state = doubleTribute(false, [0, 2, 3, 1]);
    state = tribute(state, 3, c(15, 'J', 1));
    state = tribute(state, 1, c(15, 'J'));
    expect(state.tribute?.pairs.map(({ from, to }) => [from, to])).toEqual([[1, 0], [3, 2]]);
    state = giveBack(state, 2, c(3, 'D'));
    state = giveBack(state, 0, c(2, 'D'));
    expect(state.turn).toBe(1);
    expect(state.phase).toBe('playing');
    conserve(state);
  });

  it('larger tribute goes to prior first and its contributor leads', () => {
    let state = createGuandan({
      previous: previous(), houseRule: false,
      random: deal([[c(16, 'J'), c(2, 'D')], [c(15, 'J')], [c(3, 'D')], [c(16, 'J', 1)]]),
    });
    state = tribute(state, 1, c(15, 'J'));
    state = tribute(state, 3, c(16, 'J', 1));
    expect(state.tribute?.pairs.map(({ from, to }) => [from, to])).toEqual([[3, 0], [1, 2]]);
    state = giveBack(state, 0, c(2, 'D'));
    state = giveBack(state, 2, c(3, 'D'));
    expect(state.turn).toBe(3);
    conserve(state);
  });

  it.each([0, 1, 2, 3])('tie mapping rotates correctly when prior first is seat %i', first => {
    const nextSeat = (first + 1) % 4;
    const teammate = (first + 2) % 4;
    const other = (first + 3) % 4;
    const required: Card[][] = [[], [], [], []];
    required[first] = [c(16, 'J'), c(16, 'J', 1), c(4, 'D')];
    required[teammate] = [c(3, 'D')];
    required[nextSeat] = [c(15, 'J')];
    required[other] = [c(15, 'J', 1)];
    let state = createGuandan({
      previous: previous([first, teammate, other, nextSeat], [5, 5]),
      houseRule: false, random: deal(required),
    });
    state = tribute(state, other, c(15, 'J', 1));
    state = tribute(state, nextSeat, c(15, 'J'));
    expect(state.tribute?.pairs.map(({ from, to }) => [from, to])).toEqual([[nextSeat, first], [other, teammate]]);
    state = giveBack(state, first, c(4, 'D'));
    state = giveBack(state, teammate, c(3, 'D'));
    expect(state.turn).toBe(nextSeat);
    conserve(state);
  });

  it('retains all original hands through partial choices, rejects replays and premature play', () => {
    let state = doubleTribute();
    const originalHands = structuredClone(state.hands);
    unchangedAfterReject(state, 0, { type: 'PLAY_CARDS', cardIds: [c(2, 'D').id] });
    unchangedAfterReject(state, 0, { type: 'SELECT_RETURN_CARD', cardId: c(2, 'D').id });
    state = tribute(state, 3, c(15, 'J', 1));
    expect(state.phase).toBe('tribute');
    expect(state.hands).toEqual(originalHands);
    unchangedAfterReject(state, 3, { type: 'SELECT_TRIBUTE', cardId: c(15, 'J', 1).id });
    state = tribute(state, 1, c(15, 'J'));
    expect(state.phase).toBe('return');
    expect(state.hands).toEqual(originalHands);
    state = giveBack(state, 0, c(2, 'D'));
    expect(state.phase).toBe('return');
    expect(state.hands).toEqual(originalHands);
    unchangedAfterReject(state, 0, { type: 'SELECT_RETURN_CARD', cardId: c(2, 'D').id });
    unchangedAfterReject(state, 1, { type: 'DISCARD_HOUSE_RULE', cardId: null });
    state = giveBack(state, 2, c(3, 'D'));
    expect(state.phase).toBe('discard');
    expect(state.hands).not.toEqual(originalHands);
    expect(state.hands[1].some(card => card.id === c(2, 'D').id)).toBe(true);
    expect(state.hands[3].some(card => card.id === c(3, 'D').id)).toBe(true);
    conserve(state);
  });

  it('tribute excludes heart-level; returns exclude level and prefer <=10, then weakest non-wild', () => {
    expect(legalTributeCards([c(5, 'H'), c(5), c(14)], 5).map(card => card.id)).toEqual([c(5).id]);
    expect(legalTributeCards([c(5, 'H'), c(14), c(14, 'D')], 5)).toHaveLength(2);
    expect(legalReturnCards([c(5, 'H'), c(5), c(4), c(11)], 5).map(card => card.id)).toEqual([c(4).id]);
    expect(legalReturnCards([c(5, 'H'), c(5), c(12), c(11), c(11, 'D')], 5).map(card => card.id)).toEqual([c(11).id, c(11, 'D').id]);
  });
});

describe('seeded complete Guandan lifecycles', () => {
  it.each([7, 19, 41, 103])('conserves every card after every accepted action over three hands (seed %i)', seed => {
    let state = createGuandan({ random: seededRandom(seed) });
    for (let hand = 0; hand < 3; hand++) {
      let steps = 0;
      while (state.phase !== 'finished') {
        const seat = state.turn;
        let action: GameAction;
        if (state.phase === 'tribute') {
          action = { type: 'SELECT_TRIBUTE', cardId: legalTributeCards(state.hands[seat], state.currentLevel)[0].id };
        } else if (state.phase === 'return') {
          action = { type: 'SELECT_RETURN_CARD', cardId: legalReturnCards(state.hands[seat], state.currentLevel)[0].id };
        } else if (state.phase === 'discard') {
          action = { type: 'DISCARD_HOUSE_RULE', cardId: (seed + seat) % 2 ? state.hands[seat][0].id : null };
        } else {
          const chosen = state.hands[seat].find(card => !state.trick || classifyGuandanResponse([card], state.currentLevel, state.trick.combination));
          action = chosen ? { type: 'PLAY_CARDS', cardIds: [chosen.id] } : { type: 'PASS' };
        }
        const before = structuredClone(state);
        const next = applyGuandan(state, seat, action);
        expect(state).toEqual(before);
        state = next;
        conserve(state);
        expect(++steps).toBeLessThan(500);
      }
      expect(new Set(state.finishOrder).size).toBe(4);
      expect(state.hands.filter(cards => cards.length === 0)).toHaveLength(3);
      if (hand < 2) {
        state = createGuandan({ previous: state, random: seededRandom(seed + hand + 1) });
        conserve(state);
      }
    }
  });
});

describe('separate optional double-tribute house discard', () => {
  it('each contributor can discard one owned card exactly once after all exchanges', () => {
    let state = throughDoubleReturn();
    unchangedAfterReject(state, 0, { type: 'DISCARD_HOUSE_RULE', cardId: null });
    unchangedAfterReject(state, 1, { type: 'PLAY_CARDS', cardIds: [c(2, 'D').id] });
    unchangedAfterReject(state, 1, { type: 'DISCARD_HOUSE_RULE', cardId: c(16, 'J').id });
    state = applyGuandan(state, 1, { type: 'DISCARD_HOUSE_RULE', cardId: c(2, 'D').id });
    expect(state.phase).toBe('discard');
    expect(state.hands[1]).toHaveLength(26);
    expect(state.removed.map(card => card.id)).toEqual([c(2, 'D').id]);
    conserve(state);
    unchangedAfterReject(state, 1, { type: 'DISCARD_HOUSE_RULE', cardId: null });
    state = applyGuandan(state, 3, { type: 'DISCARD_HOUSE_RULE', cardId: c(3, 'D').id });
    expect(state.phase).toBe('playing');
    expect(state.turn).toBe(1);
    expect(state.hands[3]).toHaveLength(26);
    expect(state.removed).toHaveLength(2);
    unchangedAfterReject(state, 3, { type: 'DISCARD_HOUSE_RULE', cardId: null });
    conserve(state);
  });

  it('skipping is final, keeps the card count and can be chosen in either order', () => {
    let state = throughDoubleReturn();
    state = applyGuandan(state, 3, { type: 'DISCARD_HOUSE_RULE', cardId: null });
    expect(state.tribute?.discarded).toEqual([3]);
    expect(state.hands[3]).toHaveLength(27);
    unchangedAfterReject(state, 3, { type: 'DISCARD_HOUSE_RULE', cardId: c(3, 'D').id });
    state = applyGuandan(state, 1, { type: 'DISCARD_HOUSE_RULE', cardId: null });
    expect(state.phase).toBe('playing');
    expect(state.removed).toEqual([]);
    expect(state.hands.map(hand => hand.length)).toEqual([27, 27, 27, 27]);
    conserve(state);
  });

  it('disabled house rule skips discard and persists into the next hand', () => {
    const state = throughDoubleReturn(false);
    expect(state.houseRule).toBe(false);
    expect(state.phase).toBe('playing');
    unchangedAfterReject(state, 1, { type: 'DISCARD_HOUSE_RULE', cardId: null });
    const ended = previous();
    ended.houseRule = false;
    expect(createGuandan({ previous: ended, random: seededRandom(1) }).houseRule).toBe(false);
    conserve(state);
  });
});
