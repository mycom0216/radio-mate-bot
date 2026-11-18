import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';

// The callback code is useless without the app's locally held verifier.
// Only hashes of one-time codes are stored; no Spoon token reaches the app.
export class AndroidAuth {
  constructor({now=Date.now,lifetime=120000,limit=500}={}){this.now=now;this.lifetime=lifetime;this.limit=limit;this.codes=new Map();}
  static validChallenge(value){return typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);}
  static challenge(verifier){return createHash('sha256').update(verifier).digest('base64url');}
  key(code){return createHash('sha256').update(code).digest('hex');}
  prune(){for(const [key,value]of this.codes)if(value.expires<=this.now())this.codes.delete(key);}
  issue(room,challenge){
    this.prune();
    if(!AndroidAuth.validChallenge(challenge)||this.codes.size>=this.limit)throw Error('앱 연결 요청을 다시 시작해주세요.');
    const code=randomBytes(32).toString('base64url');
    this.codes.set(this.key(code),{room,challenge,expires:this.now()+this.lifetime});return code;
  }
  redeem(code,verifier){
    this.prune();
    if(!AndroidAuth.validChallenge(code)||typeof verifier!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(verifier))throw Error('앱 연결 요청이 올바르지 않습니다.');
    const key=this.key(code),entry=this.codes.get(key);
    if(!entry||!timingSafeEqual(Buffer.from(entry.challenge),Buffer.from(AndroidAuth.challenge(verifier))))throw Error('앱 연결이 만료되었거나 확인값이 일치하지 않습니다.');
    this.codes.delete(key);return entry.room;
  }
}
