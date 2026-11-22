import {randomBytes,timingSafeEqual} from 'node:crypto';

// This capability can only retry one already-authorized broadcast connection.
// It cannot log in, read a DJ dashboard, send chat or choose another DJ.
export class BotCall {
  constructor(store,spoon,{now=Date.now}={}){Object.assign(this,{store,spoon,now});this.lastCalls=new Map();this.deviceCodes=new Map();}
  issue(room,{rotate=false}={}){
    if(!this.store.db.prepare('SELECT 1 FROM tokens WHERE room=?').get(room))throw Error('먼저 DJ 본인 계정으로 스푼 연결에 동의해주세요.');
    let token=this.store.load(room)?.botCall?.token;
    if(rotate||!token){token=randomBytes(32).toString('base64url');this.store.transaction(room,r=>{r.botCall={token,createdAt:this.now()};});}
    return token;
  }
  room(token){
    if(!/^[A-Za-z0-9_-]{43}$/.test(token))return null;
    for(const room of this.store.ids()){
      const stored=this.store.load(room)?.botCall?.token;
      if(typeof stored==='string'&&stored.length===token.length&&timingSafeEqual(Buffer.from(token),Buffer.from(stored))&&this.store.db.prepare('SELECT 1 FROM tokens WHERE room=?').get(room))return room;
    }
    return null;
  }
  status(room){const r=this.store.load(room),connected=!!r?.live;return {dj:r?.name||'연결된 DJ',connected,state:this.spoon.status.get(room)||(connected?'방송 연결됨':'방송 연결 대기')};}
  deviceCode(room){
    const token=this.store.load(room)?.botCall?.token;
    if(!token||this.room(token)!==room)throw Error('먼저 DJ 연결과 전용 호출 링크를 준비해주세요.');
    for(const [code,entry] of this.deviceCodes){
      if(entry.expiresAt<=this.now())this.deviceCodes.delete(code);
      else if(entry.token===token)return {code,expiresAt:entry.expiresAt,dj:this.store.load(room).name};
    }
    if(this.deviceCodes.size>=1000)throw Object.assign(Error('호출 코드 발급이 많습니다. 잠시 후 다시 시도해주세요.'),{status:429});
    const alphabet='23456789ABCDEFGHJKLMNPQRSTUVWXYZ';let code;
    do{code=[...randomBytes(10)].map(value=>alphabet[value%32]).join('');}while(this.deviceCodes.has(code));
    const expiresAt=this.now()+10*60000;this.deviceCodes.set(code,{token,expiresAt});return {code,expiresAt,dj:this.store.load(room).name};
  }
  resolveCode(value){
    const code=String(value||'').normalize('NFKC').toUpperCase().replace(/[\s-]/g,'');
    if(!/^[2-9A-HJ-NP-Z]{10}$/.test(code))return null;
    const entry=this.deviceCodes.get(code);if(!entry)return null;
    if(entry.expiresAt<=this.now()||!this.room(entry.token)){this.deviceCodes.delete(code);return null;}
    return entry.token;
  }
  async summon(room){
    const now=this.now(),last=this.lastCalls.get(room);
    if(last!==undefined&&now-last<15000)throw Object.assign(Error('연결을 확인하고 있습니다. 15초 뒤 다시 시도해주세요.'),{status:429});
    this.lastCalls.set(room,now);
    await this.spoon.summon(room);return this.status(room);
  }
}
