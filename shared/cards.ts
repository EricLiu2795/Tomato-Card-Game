export type Suit = 'C' | 'D' | 'H' | 'S' | 'J';
export interface Card { id: string; rank: number; suit: Suit; deck: number }
export const RANK_LABELS: Record<number, string> = {11:'J',12:'Q',13:'K',14:'A',15:'小王',16:'大王'};
export const SUIT_LABELS: Record<Suit,string> = {C:'♣',D:'♦',H:'♥',S:'♠',J:''};
export const cardLabel = (c: Card) => `${SUIT_LABELS[c.suit]}${RANK_LABELS[c.rank] ?? c.rank}`;
export function makeDeck(copies = 1): Card[] {
  const cards: Card[] = [];
  for (let d=0; d<copies; d++) {
    for (const suit of ['C','D','H','S'] as const) for (let rank=2; rank<=14; rank++) cards.push({id:`${d}-${suit}-${rank}`,rank,suit,deck:d});
    for (const rank of [15,16]) cards.push({id:`${d}-J-${rank}`,rank,suit:'J',deck:d});
  }
  return cards;
}
export function shuffle(cards: Card[], random: () => number = secureRandom): Card[] {
  const copy = [...cards];
  for(let i=copy.length-1; i>0; i--) {const j=Math.floor(random()*(i+1)); [copy[i],copy[j]]=[copy[j],copy[i]];}
  return copy;
}
export function secureRandom(): number {return crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;}
export function seededRandom(seed: number): () => number {return () => {seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296;};}
export const isWild = (c: Card, level: number) => c.suit === 'H' && c.rank === level;
export const gdStrength = (rank: number, level: number) => rank >= 15 ? rank + 10 : rank === level ? 20 : rank;
export const ddzStrength = (rank: number) => rank === 2 ? 15 : rank >= 15 ? rank + 1 : rank;
export function takeCards(hand: Card[], ids: string[]): Card[] {
  if (!ids.length || new Set(ids).size !== ids.length) throw new Error('请选择不同的手牌');
  const cards = ids.map(id => hand.find(c => c.id === id));
  if(cards.some(c => !c)) throw new Error('不能使用不属于你的牌');
  return cards as Card[];
}
