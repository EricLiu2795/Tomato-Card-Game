import {describe,it,expect,vi} from 'vitest';
import {createDoudizhu} from '../shared/doudizhu';
import {createGuandan} from '../shared/guandan';
import {seededRandom} from '../shared/cards';
import {snapshot,publicGame,type RoomState} from '../server/state';
import {parseCommand,nickname,readJson} from '../server/validation';
import {assertCardConservation} from '../shared/invariants';
const room=(kind:'guandan'|'doudizhu'):RoomState=>({schema:1,code:'ABCDEFGH',kind,revision:5,hostId:'player-0',houseRule:true,lastActive:0,game:kind==='guandan'?createGuandan({random:seededRandom(1)}):createDoudizhu({random:seededRandom(1)}),players:Array.from({length:kind==='guandan'?4:3},(_,seat)=>({id:`player-${seat}`,name:`玩家${seat}`,seat,ready:true,tokenHash:`SECRET-HASH-${seat}`,connectionId:`SECRET-CONNECTION-${seat}`,actionTimes:[1],lastReaction:0,lastTomato:0}))});
describe('private state projection',()=>{
  it.each(['guandan','doudizhu'] as const)('%s sends only the authenticated seat hand',kind=>{
    const state=room(kind);
    for(const player of state.players){
      const projected=snapshot(state,player.id,new Set(['player-0']));
      expect(projected.hand).toEqual(state.game!.hands[player.seat]);
      const serialized=JSON.stringify(projected);
      for(const card of state.game!.hands.filter((_,seat)=>seat!==player.seat).flat())expect(serialized).not.toContain(`"${card.id}"`);
      for(const forbidden of ['hands','tokenHash','connectionId','actionTimes','SECRET','highBidder','playCounts','previousFinish'])expect(serialized).not.toContain(forbidden);
      expect(projected.players[0].connected).toBe(true);
      expect(projected.players[1].connected).toBe(false);
      if(kind==='doudizhu')expect(projected.game!.bottom).toEqual([]);
    }
  });
  it('rejects unknown sessions instead of choosing a default seat',()=>{expect(()=>snapshot(room('guandan'),'forged',new Set())).toThrow();});
  it('hides pending return card and private tribute choice identifiers',()=>{
    const g=createGuandan({random:seededRandom(2)});
    g.phase='return';g.tribute={kind:'double',pairs:[{from:1,to:0,tribute:g.hands[1][0],returnCard:g.hands[0][0]}],contributors:[1,3],selections:{1:g.hands[1][0].id},returned:[0],discarded:[],resisted:false};
    const result=publicGame(g);
    expect(result.tribute!.selections).toEqual({1:'selected'});
    expect(result.tribute!.pairs[0].returnCard).toBeUndefined();
    g.phase='discard';expect(publicGame(g).tribute!.pairs[0].returnCard).toEqual(g.hands[0][0]);
  });
});
describe('command boundary',()=>{
  it('strips forged actor/seat/state fields rather than trusting them',()=>{expect(parseCommand({id:'valid-id-123',expectedRevision:2,seat:1,hands:[[]],action:{type:'PASS',seat:2,playerId:'victim'}})).toEqual({id:'valid-id-123',expectedRevision:2,action:{type:'PASS'}});});
  it.each([null,[],{}, {id:'x',expectedRevision:0,action:{type:'PASS'}},{id:'valid-id',expectedRevision:-1,action:{type:'PASS'}},{id:'valid-id',expectedRevision:1.2,action:{type:'PASS'}},{id:'valid-id',expectedRevision:0,action:{type:'DEBUG_WIN'}},{id:'valid-id',expectedRevision:0,action:{type:'PLAY_CARDS',cardIds:[]}},{id:'valid-id',expectedRevision:0,action:{type:'DISCARD_HOUSE_RULE'}},{id:'valid-id',expectedRevision:0,action:{type:'BID',value:Infinity}}])('rejects malformed payload %#',value=>expect(()=>parseCommand(value)).toThrow());
  it('normalizes nickname and removes invisible controls',()=>{expect(nickname('  Ａ\u200b\nB  ')).toBe('AB');expect(()=>nickname(' '.repeat(10))).toThrow();expect(()=>nickname('a'.repeat(21))).toThrow();});
  it('bounds streamed request bytes even without Content-Length',async()=>{
    const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(3000));controller.close();}});
    const request=new Request('https://example.invalid',{method:'POST',body,duplex:'half'} as RequestInit);
    await expect(readJson(request)).rejects.toThrow('请求过大');
  });
  it('ends a stalled request at five seconds',async()=>{
    vi.useFakeTimers();
    try{
      const request=new Request('https://example.invalid',{method:'POST',body:new ReadableStream<Uint8Array>(),duplex:'half'} as RequestInit);
      const result=expect(readJson(request)).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(5000);await result;
    }finally{vi.useRealTimers();}
  });
  it('accepts small JSON objects and rejects arrays',async()=>{
    expect(await readJson(new Request('https://example.invalid',{method:'POST',body:'{"name":"小番茄"}'}))).toEqual({name:'小番茄'});
    await expect(readJson(new Request('https://example.invalid',{method:'POST',body:'[]'}))).rejects.toThrow('请求格式错误');
  });
});
describe('runtime conservation guard',()=>{
  it.each(['guandan','doudizhu'] as const)('%s rejects missing, duplicate, and altered physical cards',kind=>{
    const game=room(kind).game!;
    expect(()=>assertCardConservation(game)).not.toThrow();
    const missing=structuredClone(game);missing.hands[0].pop();expect(()=>assertCardConservation(missing)).toThrow();
    const duplicate=structuredClone(game);duplicate.hands[0][0]=duplicate.hands[1][0];expect(()=>assertCardConservation(duplicate)).toThrow();
    const altered=structuredClone(game);altered.hands[0][0].rank=99;expect(()=>assertCardConservation(altered)).toThrow();
  });
});
