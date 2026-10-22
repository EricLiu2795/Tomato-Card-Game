import {afterAll,beforeAll,describe,it,expect} from 'vitest';
import WebSocket from 'ws';
import {randomUUID} from 'node:crypto';
import type {Command,RoomAction,ServerMessage,Snapshot} from '../../shared/types';
import {REACTIONS} from '../../shared/soundboard';
const base=process.env.TEST_API_URL??'http://127.0.0.1:8787';
class Client{
  ws!:WebSocket; messages:ServerMessage[]=[]; last!:Snapshot;
  constructor(readonly code:string,readonly cookie:string){}
  async connect(){
    this.ws=new WebSocket(`${base.replace(/^http/,'ws')}/api/rooms/${this.code}/ws`,{headers:{Cookie:this.cookie,Origin:base}});
    this.ws.on('message',data=>{const value=JSON.parse(String(data)) as ServerMessage;this.messages.push(value);if(value.type==='SNAPSHOT')this.last=value;});
    await this.wait(m=>m.type==='SNAPSHOT');return this;
  }
  async wait(predicate:(m:ServerMessage)=>boolean,from=0):Promise<ServerMessage>{
    const until=Date.now()+6000;
    while(Date.now()<until){const match=this.messages.slice(from).find(predicate);if(match)return match;await new Promise(r=>setTimeout(r,10));}
    throw new Error('Timed out waiting for server response');
  }
  async command(action:RoomAction,revision=this.last.revision,id=randomUUID()){
    const command:Command={id,expectedRevision:revision,action};
    return {command,response:await this.raw(command)};
  }
  async raw(command:unknown){const from=this.messages.length;this.ws.send(JSON.stringify(command));const id=(command as {id:string}).id;const response=await this.wait(m=>(m.type==='ACK'&&m.commandId===id)||(m.type==='ERROR'&&(!m.commandId||m.commandId===id)),from);if(response.type==='ACK'&&response.revision>this.last.revision)await this.wait(m=>m.type==='SNAPSHOT'&&m.revision>=response.revision,from);return response;}
  close(){this.ws?.close();}
}
async function post(path:string,body:unknown,cookie?:string){return fetch(`${base}${path}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});}
async function openRoom(kind:'guandan'|'doudizhu',count:number){
  const result=await post('/api/rooms',{kind,name:'房主',houseRule:true});expect(result.status).toBe(200);
  const body=await result.json() as {roomCode:string};
  const cookies=[result.headers.get('set-cookie')!.split(';')[0]];
  expect(result.headers.get('set-cookie')).toContain('HttpOnly');expect(result.headers.get('set-cookie')).toContain('SameSite=Strict');
  for(let i=1;i<count;i++){const r=await post(`/api/rooms/${body.roomCode}/join`,{name:`玩家${i}`});expect(r.status).toBe(200);cookies.push(r.headers.get('set-cookie')!.split(';')[0]);}
  return Promise.all(cookies.map(cookie=>new Client(body.roomCode,cookie).connect()));
}
async function readyStart(clients:Client[]){
  for(const client of clients){await new Promise(r=>setTimeout(r,30));const res=await client.command({type:'READY',ready:true});expect(res.response.type).toBe('ACK');}
  await new Promise(r=>setTimeout(r,30));expect((await clients[0].command({type:'START_GAME'})).response.type).toBe('ACK');
  await Promise.all(clients.map(c=>c.wait(m=>m.type==='SNAPSHOT'&&m.game!==null)));
}
async function rejectedUpgrade(code:string,cookie?:string,origin=base):Promise<number>{return new Promise((resolve,reject)=>{const ws=new WebSocket(`${base.replace(/^http/,'ws')}/api/rooms/${code}/ws`,{headers:{Origin:origin,...(cookie?{Cookie:cookie}:{})}});ws.on('unexpected-response',(_,r)=>{r.resume();resolve(r.statusCode!);});ws.on('open',()=>{ws.close();reject(new Error('Unexpected authorized websocket'));});ws.on('error',()=>{});});}
describe.sequential('real Wrangler authoritative security boundary',()=>{
  let clients:Client[]=[];let other:Client[]=[];
  beforeAll(async()=>{clients=await openRoom('doudizhu',3);other=await openRoom('guandan',1);await readyStart(clients);});
  afterAll(()=>[...clients,...other].forEach(c=>c.close()));
  it('keeps all opponent hands, unrevealed bottom cards and server credentials out of actual payloads',()=>{
    for(const client of clients){
      const s=client.last;expect(s.hand).toHaveLength(17);expect(s.game?.bottom).toEqual([]);
      const payload=JSON.stringify(s);
      for(const opponent of clients.filter(c=>c!==client))for(const card of opponent.last.hand)expect(payload).not.toContain(`"${card.id}"`);
      for(const secret of ['hands','tokenHash','connectionId','actionTimes','highBidder','randomSeed','playCounts'])expect(payload).not.toContain(secret);
      for(const cookie of clients.map(c=>c.cookie.split('=')[1]))expect(payload).not.toContain(cookie);
    }
  });
  it('rejects missing, forged, wrong-room cookies and cross-origin upgrades',async()=>{
    expect(await rejectedUpgrade(clients[0].code)).toBe(401);
    expect(await rejectedUpgrade(clients[0].code,`tcc_${clients[0].code}=${'0'.repeat(64)}`)).toBe(401);
    expect(await rejectedUpgrade(other[0].code,clients[0].cookie)).toBe(401);
    expect(await rejectedUpgrade(clients[0].code,clients[0].cookie,'https://evil.invalid')).toBe(403);
    for(const path of ['/api/debug',`/api/rooms/${clients[0].code}/state`,`/api/rooms/${clients[0].code}/hands`])expect((await fetch(`${base}${path}`)).status).toBe(404);
  });
  it('ignores forged seats and rejects out-of-turn commands without private error details',async()=>{
    const actor=clients.find(c=>c.last.players.find(p=>p.id===c.last.selfId)!.seat!==c.last.game!.turn)!;
    const result=await actor.raw({id:randomUUID(),expectedRevision:actor.last.revision,seat:actor.last.game!.turn,playerId:clients[0].last.selfId,action:{type:'BID',value:3,seat:actor.last.game!.turn}});
    expect(result.type).toBe('ERROR');expect(JSON.stringify(result)).not.toMatch(/0-[CDHSJ]-/);
  });
  it('commits at most one simultaneous same-version command and persistently deduplicates altered reuse',async()=>{
    const client=clients[clients[0].last.game!.turn],revision=client.last.revision;
    const first:Command={id:randomUUID(),expectedRevision:revision,action:{type:'BID',value:3}};
    const second:Command={id:randomUUID(),expectedRevision:revision,action:{type:'BID',value:2}};
    const from=client.messages.length;client.ws.send(JSON.stringify(first));client.ws.send(JSON.stringify(second));
    await client.wait(m=>m.type==='ACK'&&m.commandId===first.id,from);
    const stale=await client.wait(m=>m.type==='ERROR'&&m.commandId===second.id,from);expect(stale).toMatchObject({code:'STALE'});
    await client.wait(m=>m.type==='SNAPSHOT'&&m.revision===revision+1,from);
    expect(client.last.game!.phase).toBe('playing');expect(client.last.hand).toHaveLength(20);
    const before=client.last.revision;expect((await client.raw(first)).type).toBe('ACK');expect(client.last.revision).toBe(before);
    expect((await client.raw({...first,action:{type:'PASS'}})).type).toBe('ERROR');
  });
  it('rejects duplicate/unowned card IDs and passing on lead; stale rejection resyncs only own hand',async()=>{
    const client=clients[clients[0].last.game!.turn],id=client.last.hand[0].id;
    expect((await client.command({type:'PLAY_CARDS',cardIds:[id,id]})).response.type).toBe('ERROR');
    const foreign=clients.find(c=>c!==client)!.last.hand[0].id;
    expect((await client.command({type:'PLAY_CARDS',cardIds:[foreign]})).response.type).toBe('ERROR');
    expect((await client.command({type:'PASS'})).response.type).toBe('ERROR');
    const response=await client.command({type:'PLAY_CARDS',cardIds:[id]},0);expect(response.response).toMatchObject({type:'ERROR',code:'STALE'});
  });
  it('reconnects to the same seat and hand, retaining command receipts',async()=>{
    const old=clients[0],snapshot=old.last;
    old.close();const replacement=await new Client(old.code,old.cookie).connect();clients[0]=replacement;
    expect(replacement.last.selfId).toBe(snapshot.selfId);expect(replacement.last.hand).toEqual(snapshot.hand);expect(replacement.last.revision).toBe(snapshot.revision);
    const readyCommand=old.messages.find(m=>m.type==='ACK');expect(readyCommand).toBeDefined();
    // Replay a freshly accepted room command through a second authenticated socket.
    const reaction=await replacement.command({type:'SEND_REACTION',reactionId:REACTIONS[0].id});expect(reaction.response.type).toBe('ACK');
    replacement.close();const next=await new Client(old.code,old.cookie).connect();clients[0]=next;
    expect((await next.raw(reaction.command)).type).toBe('ACK');
    expect((await next.raw({...reaction.command,action:{type:'PASS'}})).type).toBe('ERROR');
  });
  it('broadcasts authorized events to everyone and enforces tomato cooldown without changing game',async()=>{
    const actor=clients[1],revision=actor.last.revision;
    const offsets=clients.map(c=>c.messages.length);
    const thrown=await actor.command({type:'THROW_TOMATO',targetId:clients[2].last.selfId});expect(thrown.response.type).toBe('ACK');
    const events=await Promise.all(clients.map((c,i)=>c.wait(m=>m.type==='EVENT'&&m.kind==='tomato',offsets[i])));
    expect(new Set(events.map(e=>e.type==='EVENT'?e.eventId:'')).size).toBe(1);
    expect(actor.last.revision).toBe(revision);
    expect((await actor.command({type:'THROW_TOMATO',targetId:clients[2].last.selfId})).response.type).toBe('ERROR');
    expect((await actor.command({type:'SEND_REACTION',reactionId:'not-in-manifest'})).response.type).toBe('ERROR');
  });
  it('limits WebSocket command floods even if every command is malformed',async()=>{
    const client=clients[2],from=client.messages.length;
    for(let i=0;i<28;i++)client.ws.send('{}');
    expect(await client.wait(m=>m.type==='ERROR'&&m.code==='RATE_LIMIT',from)).toMatchObject({type:'ERROR',code:'RATE_LIMIT'});
  });
});
