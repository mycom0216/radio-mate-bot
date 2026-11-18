import {randomBytes,randomUUID,createHash} from 'node:crypto';
const error=(text,status=400)=>Object.assign(Error(text),{status});
export class RoomChat{
 constructor(store,{now=Date.now}={}){this.store=store;this.now=now;this.rates=new Map();}
 state(room){return room.chat||{enabled:false,token:'',messages:[]};}
 list(room){const r=this.store.load(room);if(!r)throw error('방송이 없습니다.',404);const chat=this.state(r);return {name:r.name,enabled:chat.enabled,messages:chat.messages.filter(x=>x.time>this.now()-7*86400000).slice(-100)};}
 link(room,action){let token;this.store.transaction(room,r=>{r.chat=this.state(r);if(!['enable','disable','rotate'].includes(action))throw error('잘못된 채팅 설정입니다.');if(action!=='disable'&&(!r.chat.token||action==='rotate'))r.chat.token=randomBytes(32).toString('base64url');r.chat.enabled=action!=='disable';token=r.chat.token;});return token;}
 resolve(token){if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw error('채팅방 링크가 만료되었거나 닫혔습니다.',404);for(const id of this.store.ids()){const c=this.store.load(id).chat;if(c?.enabled&&c.token===token)return id;}throw error('채팅방 링크가 만료되었거나 닫혔습니다.',404);}
 send(room,{text,name,id},actor){
  if(typeof text!=='string'||!text.trim()||[...text].length>400)throw error('메시지는 1~400자로 입력해주세요.');
  if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw error('메시지 ID를 확인해주세요.');
  if(typeof name!=='string'||!name.trim()||[...name].length>30)throw error('표시 이름은 1~30자로 입력해주세요.');
  const key=createHash('sha256').update(room+'|'+actor).digest('hex'),now=this.now();let result;
  this.store.transaction(room,r=>{r.chat=this.state(r);if(actor!=='dj'&&!r.chat.enabled)throw error('닫힌 채팅방입니다.',404);
   if(r.chat.messages.some(m=>m.id===id&&m.actor===key)){result={ok:true,duplicate:true};return;}
   if(now-(this.rates.get(key)??-Infinity)<2000)throw error('2초 뒤에 다시 보내주세요.',429);
   const banned=r.settings.bannedWords||[];if(banned.some(word=>word&&text.includes(word)))throw error('방송에서 제한한 단어가 포함되어 있습니다.');
   r.chat.messages=r.chat.messages.filter(m=>m.time>now-7*86400000);r.chat.messages.push({id,actor:key,text:text.trim(),name:actor==='dj'?'DJ':name.trim(),role:actor==='dj'?'dj':'guest',time:now});r.chat.messages=r.chat.messages.slice(-100);result={ok:true};
  });if(!result.duplicate){if(this.rates.size>=5000)this.rates.delete(this.rates.keys().next().value);this.rates.set(key,now);}return result;
 }
 remove(room,id){this.store.transaction(room,r=>{if(r.chat)r.chat.messages=r.chat.messages.filter(m=>m.id!==id);});}
 publicList(room){const data=this.list(room);return {...data,messages:data.messages.map(({actor,...m})=>m)};}
}
