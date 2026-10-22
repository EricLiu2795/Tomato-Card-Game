import type { Command, RoomAction } from '../shared/types';
function record(x:unknown): x is Record<string,unknown> {return typeof x==='object'&&x!==null&&!Array.isArray(x);}
export function parseCommand(value:unknown):Command {
  if(!record(value)||typeof value.id!=='string'||!/^[a-zA-Z0-9_-]{8,80}$/.test(value.id)||!Number.isSafeInteger(value.expectedRevision)||(value.expectedRevision as number)<0||!record(value.action)) throw new Error('命令格式错误');
  const a=value.action;
  let action:RoomAction;
  switch(a.type){
    case 'READY': if(typeof a.ready!=='boolean') throw new Error('准备状态错误'); action={type:a.type,ready:a.ready};break;
    case 'START_GAME':case 'PASS': action={type:a.type};break;
    case 'CHOOSE_SEAT': if(!Number.isInteger(a.seat)||(a.seat as number)<0||(a.seat as number)>3) throw new Error('座位无效'); action={type:a.type,seat:a.seat as number};break;
    case 'PLAY_CARDS': if(!Array.isArray(a.cardIds)||a.cardIds.length<1||a.cardIds.length>27||!a.cardIds.every(id=>typeof id==='string'&&id.length<20)) throw new Error('手牌格式错误');action={type:a.type,cardIds:a.cardIds as string[]};break;
    case 'BID': if(!Number.isInteger(a.value)||(a.value as number)<0||(a.value as number)>3) throw new Error('叫分无效');action={type:a.type,value:a.value as number};break;
    case 'SELECT_TRIBUTE':case 'SELECT_RETURN_CARD': if(typeof a.cardId!=='string'||a.cardId.length>20) throw new Error('选牌无效');action={type:a.type,cardId:a.cardId};break;
    case 'DISCARD_HOUSE_RULE': if(a.cardId!==null&&(typeof a.cardId!=='string'||a.cardId.length>20)) throw new Error('弃牌无效');action={type:a.type,cardId:a.cardId as string|null};break;
    case 'SEND_REACTION': if(typeof a.reactionId!=='string'||a.reactionId.length>80) throw new Error('表情无效');action={type:a.type,reactionId:a.reactionId};break;
    case 'THROW_TOMATO': if(typeof a.targetId!=='string'||a.targetId.length>80) throw new Error('目标无效');action={type:a.type,targetId:a.targetId};break;
    default: throw new Error('未知命令');
  }
  return {id:value.id,expectedRevision:value.expectedRevision as number,action};
}
export function nickname(value:unknown):string {
  if(typeof value!=='string') throw new Error('请输入昵称');
  const name=value.normalize('NFKC').trim().replace(/[\p{Cc}\p{Cf}]/gu,'');
  if(name.length<1||name.length>20) throw new Error('昵称须为 1–20 个字符');
  return name;
}
export const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
export async function hash(text:string):Promise<string>{return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),x=>x.toString(16).padStart(2,'0')).join('');}
export function cookieName(code:string):string{return `tcc_${code}`;}
export function readCookie(request:Request,code:string):string|null{return request.headers.get('Cookie')?.split(';').map(c=>c.trim()).find(c=>c.startsWith(`${cookieName(code)}=`))?.slice(cookieName(code).length+1)??null;}
export function json(value:unknown,status=200,extra:Record<string,string>={}):Response{return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});}
export async function readJson(request:Request):Promise<Record<string,unknown>>{
  if(!request.body)throw new Error('请求格式错误');
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{void reader.cancel();reject(new Error('请求超时'));},5000);});
  try{while(true){const {done,value}=await Promise.race([reader.read(),deadline]);if(done)break;size+=value.byteLength;if(size>2048){await reader.cancel();throw new Error('请求过大');}chunks.push(value);}}finally{clearTimeout(timer);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const value:unknown=JSON.parse(new TextDecoder().decode(bytes));if(!record(value))throw new Error('请求格式错误');return value;
}
