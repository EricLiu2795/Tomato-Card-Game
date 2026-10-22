import {makeDeck} from './cards';
import type {GameState} from './types';
/** Physical ownership zones only. Trick/history/bottom after auction are public references. */
export function assertCardConservation(game:GameState):void{
  const expected=makeDeck(game.kind==='guandan'?2:1);
  const zones=[...game.hands.flat(),...game.played,...game.removed,...(game.kind==='doudizhu'&&game.phase==='bidding'?game.bottom:[])];
  const canonical=new Map(expected.map(card=>[card.id,card]));
  if(zones.length!==expected.length||new Set(zones.map(card=>card.id)).size!==expected.length||zones.some(card=>{const original=canonical.get(card.id);return !original||original.rank!==card.rank||original.suit!==card.suit||original.deck!==card.deck;}))throw new Error('牌局完整性检查失败');
}
