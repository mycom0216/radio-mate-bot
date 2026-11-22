import {randomBytes,createHash} from 'node:crypto';

// A short-lived, single-use login handoff issued only by an authenticated DJ.
// This is deliberately separate from public bot-call capabilities.
export class MobileLink {
  constructor({now=Date.now,lifetime=180000,limit=500,authorized=()=>true}={}){Object.assign(this,{now,lifetime,limit,authorized});this.codes=new Map();}
  key(value){const code=String(value||'').normalize('NFKC').toUpperCase().replace(/[\s-]/g,'');if(!/^M[2-9A-HJ-NP-Z]{10}$/.test(code))return null;return createHash('sha256').update(code).digest('hex');}
  prune(){for(const [key,entry] of this.codes)if(entry.expiresAt<=this.now()||!this.authorized(entry.room))this.codes.delete(key);}
  revoke(room){for(const [key,entry] of this.codes)if(entry.room===room)this.codes.delete(key);}
  issue(room){
    this.prune();if(!this.authorized(room))throw Error('PC에서 DJ 계정을 먼저 연결해주세요.');
    for(const [key,entry] of this.codes)if(entry.room===room)this.codes.delete(key);
    if(this.codes.size>=this.limit)throw Error('모바일 연결 요청이 많습니다. 잠시 후 다시 시도해주세요.');
    const alphabet='23456789ABCDEFGHJKLMNPQRSTUVWXYZ',raw='M'+[...randomBytes(10)].map(byte=>alphabet[byte%32]).join(''),code='M-'+raw.slice(1,6)+'-'+raw.slice(6),expiresAt=this.now()+this.lifetime;
    this.codes.set(this.key(code),{room,expiresAt});return {code,expiresAt};
  }
  preview(code){this.prune();const key=this.key(code),entry=key&&this.codes.get(key);if(!entry)throw Error('모바일 연결 코드가 올바르지 않거나 만료되었습니다. PC에서 새 모바일 연결 코드를 발급해주세요. 봇 호출 코드와는 다릅니다.');return {...entry};}
  redeem(code){const entry=this.preview(code);this.codes.delete(this.key(code));return entry.room;}
}
