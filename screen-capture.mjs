import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');

// The server relays donation triggers only. Screenshots never enter this server.
export class ScreenCapture {
 constructor(store,{now=Date.now}={}){Object.assign(this,{store,now});}
 authorized(room){return !!this.store.db.prepare('SELECT 1 FROM tokens WHERE room=?').get(room);}
 status(room){const data=this.store.load(room)?.screenCapture;return {enabled:!!data&&data.expiresAt>this.now()&&this.authorized(room),expiresAt:data?.expiresAt||null};}
 issue(room){
  if(!this.authorized(room))throw Error('실제 DJ 계정을 먼저 연결해주세요.');
  const token=randomBytes(32).toString('base64url'),expiresAt=this.now()+12*3600000;
  this.store.transaction(room,r=>{r.screenCapture={tokenHash:hash(token),expiresAt,events:[],sequence:0};});
  return {token,expiresAt,dj:this.store.load(room).name};
 }
 revoke(room){this.store.transaction(room,r=>{delete r.screenCapture;});}
 prune(){for(const room of this.store.ids()){const config=this.store.load(room)?.screenCapture;if(!config)continue;if(config.expiresAt<=this.now()||!this.authorized(room)){this.revoke(room);continue;}if(config.events.some(event=>this.now()-event.receivedAt>120000))this.store.transaction(room,r=>{r.screenCapture.events=r.screenCapture.events.filter(event=>this.now()-event.receivedAt<=120000);});}}
 resolve(token){
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))return null;const key=hash(token);
  for(const room of this.store.ids()){const data=this.store.load(room)?.screenCapture;if(data?.expiresAt>this.now()&&typeof data.tokenHash==='string'&&data.tokenHash.length===64&&timingSafeEqual(Buffer.from(key),Buffer.from(data.tokenHash))&&this.authorized(room))return room;}
  return null;
 }
 record(room,frame){
  const data=frame?.data,time=Date.parse(data?.time),now=this.now();
  if(!this.status(room).enabled||typeof data?.user?.id!=='string'||!data.user.id||!Number.isSafeInteger(data.amount)||data.amount<=0||!Number.isFinite(time)||Math.abs(now-time)>120000)return false;
  const id=hash(frame.id||JSON.stringify(data));let recorded=false;
  this.store.transaction(room,r=>{const config=r.screenCapture;if(!config||config.expiresAt<=now)return;
   config.events=config.events.filter(event=>now-event.receivedAt<=120000);
   if(config.events.some(event=>event.id===id))return;
   config.events.push({id,sequence:++config.sequence,userId:data.user.id,nickname:String(data.user.nickname||'청취자').slice(0,40),amount:data.amount,time,receivedAt:now});config.events=config.events.slice(-100);recorded=true;
  });return recorded;
 }
 list(room,after=0){const r=this.store.load(room),config=r.screenCapture;return {dj:r.name,expiresAt:config.expiresAt,cursor:config.sequence,events:config.events.filter(event=>event.sequence>after&&this.now()-event.receivedAt<=120000).map(({userId,...event})=>event)};}
}
