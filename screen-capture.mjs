import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {mkdirSync,writeFileSync,renameSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {buildZip} from './zip-store.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');

// 서버는 후원 알림(트리거)을 확장 기능에 전달하고, 확장 기능이 올려 보낸 PNG 화면을 이 서버가 돌아가는 PC의 data/captures 폴더에 보관합니다.
// DJ는 관리 화면에서 보관된 캡처를 보고(태블릿·폰 브라우저 포함) 기기에 내려받습니다. 파일 이름은 서버가 만든 영문·숫자뿐이라 경로를 속일 수 없고,
// 파일은 그 DJ 방(room)에만 속하며 로그인한 해당 DJ에게만 보여 줍니다.
const PNG_SIGNATURE=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),PNG_END=Buffer.from([0,0,0,0,0x49,0x45,0x4e,0x44,0xae,0x42,0x60,0x82]);
const fail=(message,status=400)=>Object.assign(Error(message),{status});
// PNG 한 장이 정말 PNG인지(서명·IHDR 크기·IEND 끝)와 화면 크기가 상식적인지 확인하고 가로·세로를 돌려줍니다.
export function inspectPng(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length<1000||bytes.length>8*1024*1024)throw fail('PNG 크기가 올바르지 않습니다. (1KB~8MB)',bytes?.length>8*1024*1024?413:400);
 if(!bytes.subarray(0,8).equals(PNG_SIGNATURE)||bytes.readUInt32BE(8)!==13||bytes.toString('latin1',12,16)!=='IHDR'||!bytes.subarray(-12).equals(PNG_END))throw fail('올바른 PNG 이미지가 아닙니다.',415);
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
 if(width<100||height<100||width>10000||height>10000)throw fail('화면 크기가 올바르지 않습니다.');
 return {width,height};
}
export class ScreenCapture {
 constructor(store,{now=Date.now}={}){
  Object.assign(this,{store,now,dir:null,maxFiles:1000,retentionDays:30,maxBytes:3*1024**3,hits:new Map(),lastPoll:new Map(),lastDonation:new Map()});
  // 서버에 보관한 캡처 목록(파일 내용은 data/captures 폴더, 여기에는 정보만)
  store.db.exec('CREATE TABLE IF NOT EXISTS capture_files(id TEXT PRIMARY KEY,room TEXT NOT NULL,created INTEGER NOT NULL,event_id TEXT NOT NULL,frame INTEGER NOT NULL,nickname TEXT NOT NULL,amount INTEGER NOT NULL,size INTEGER NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,path TEXT NOT NULL,UNIQUE(room,event_id,frame))');
  store.db.exec('CREATE INDEX IF NOT EXISTS capture_files_room ON capture_files(room,created)');
 }
 // 보관 폴더와 한도를 정합니다. 설정하지 않으면(공개 체험 등) 업로드를 받지 않습니다.
 configure({dir,maxFiles=1000,retentionDays=30,maxBytes=3*1024**3}={}){
  this.dir=dir?resolve(dir):null;Object.assign(this,{maxFiles,retentionDays,maxBytes});
  if(this.dir)mkdirSync(this.dir,{recursive:true});
 }
 authorized(room){return !!this.store.db.prepare('SELECT 1 FROM tokens WHERE room=?').get(room);}
 status(room){const data=this.store.load(room)?.screenCapture;return {enabled:!!data&&data.expiresAt>this.now()&&this.authorized(room),expiresAt:data?.expiresAt||null};}
 // 관리 화면용 진단: 확장이 서버에 마지막으로 접속한 시각과, 마지막으로 받은 후원이 왜 캡처 대상이 되었는지(되지 않았는지)를 보여 줍니다.
 // 둘 다 서버를 다시 시작하면 초기화되는 메모리 값입니다. 서버에 보관된 캡처 장수도 함께 돌려줍니다.
 diagnostics(room){return {...this.status(room),lastPollAt:this.lastPoll.get(room)||null,lastDonation:this.lastDonation.get(room)||null,stored:this.usage(room)};}
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
 // 후원 알림에서 후원 시각(밀리초)을 찾습니다. 스푼 알림마다 필드 이름이 다를 수 있어 time·sentTime·createdAt 등을 차례로 보고(초 단위·문자열 날짜도 인식),
 // 어느 것도 없으면 서버가 받은 시각을 씁니다. 반환: {ms, fromEvent}
 static eventTime(data,now){
  for(const value of [data?.time,data?.sentTime,data?.createdAt,data?.created,data?.timestamp]){
   if(value===undefined||value===null||value==='')continue;
   let ms=typeof value==='number'?value:/^\d+(\.\d+)?$/.test(String(value).trim())?Number(value):Date.parse(value);
   if(Number.isFinite(ms)&&ms>0&&ms<1e11)ms*=1000; // 초 단위 값
   if(Number.isFinite(ms))return {ms,fromEvent:true};
  }
  return {ms:now,fromEvent:false};
 }
 record(room,frame){
  const data=frame?.data,now=this.now(),min=this.store.load(room)?.settings?.screenCaptureMin??300;
  const rawId=data?.user?.id,userId=typeof rawId==='string'?rawId:Number.isSafeInteger(rawId)?String(rawId):'',amount=Number(data?.amount),nickname=String(data?.user?.nickname||'청취자').slice(0,40);
  // 어떤 이유로 대상이 되었는지(되지 않았는지)를 방마다 기억해 관리 화면에서 보여 줍니다.
  const note=result=>{this.lastDonation.set(room,{at:now,amount:Number.isFinite(amount)?amount:null,nickname,result,min});if(this.lastDonation.size>500)this.lastDonation.delete(this.lastDonation.keys().next().value);return result==='recorded';};
  if(!this.status(room).enabled)return note('not-connected');
  if(!userId)return note('bad-user');
  if(!Number.isSafeInteger(amount)||amount<1)return note('bad-amount');
  // 기준 스푼(설정 screenCaptureMin, 기본 300) 미만의 후원은 캡처 대상으로 기록하지 않습니다.
  if(amount<min)return note('below-min');
  const {ms:time,fromEvent}=ScreenCapture.eventTime(data,now);
  if(fromEvent&&Math.abs(now-time)>120000)return note('stale');
  const id=hash(frame.id||JSON.stringify(data));let result='duplicate';
  this.store.transaction(room,r=>{const config=r.screenCapture;if(!config||config.expiresAt<=now){result='not-connected';return;}
   config.events=config.events.filter(event=>now-event.receivedAt<=120000);
   if(config.events.some(event=>event.id===id))return;
   config.events.push({id,sequence:++config.sequence,userId,nickname,amount,time,receivedAt:now});config.events=config.events.slice(-100);result='recorded';
  });
  return note(result);
 }
 list(room,after=0){const r=this.store.load(room),config=r.screenCapture;this.lastPoll.set(room,this.now());if(this.lastPoll.size>500)this.lastPoll.delete(this.lastPoll.keys().next().value);return {dj:r.name,expiresAt:config.expiresAt,cursor:config.sequence,events:config.events.filter(event=>event.sequence>after&&this.now()-event.receivedAt<=120000).map(({userId,...event})=>event)};}
 // ── 서버 보관 ──
 // 확장 기능이 올린 PNG 한 장을 검사해 보관합니다. 같은 (후원, 장 번호)는 한 번만 받고, 방마다 분당 30장까지만 받습니다.
 save(room,meta,bytes){
  if(!this.dir)throw fail('이 서버에는 캡처를 보관할 폴더가 설정되어 있지 않습니다.',503);
  const eventId=String(meta?.eventId||''),frame=Number(meta?.frame),amount=Number(meta?.amount),time=Number(meta?.time),nickname=String(meta?.nickname||'').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,40)||'청취자';
  if(!/^[A-Za-z0-9_-]{1,80}$/.test(eventId)||!Number.isInteger(frame)||frame<1||frame>9||!Number.isSafeInteger(amount)||amount<0||!Number.isFinite(time))throw fail('캡처 정보가 올바르지 않습니다.');
  const now=this.now(),recent=(this.hits.get(room)||[]).filter(at=>now-at<60000);
  if(recent.length>=30)throw fail('캡처 업로드가 너무 많습니다. 잠시 후 다시 시도해주세요.',429);
  const {width,height}=inspectPng(bytes);
  const existing=this.store.db.prepare('SELECT id FROM capture_files WHERE room=? AND event_id=? AND frame=?').get(room,eventId,frame);
  if(existing)return {id:existing.id,duplicate:true};
  recent.push(now);this.hits.set(room,recent);if(this.hits.size>500)this.hits.delete(this.hits.keys().next().value);
  const id=randomBytes(12).toString('hex'),stamp=new Date(time+9*3600000).toISOString(),day=stamp.slice(0,10),roomKey=hash(room).slice(0,16);
  const file=`${stamp.slice(11,19).replaceAll(':','')}_${amount}spoon_${eventId.slice(0,8)}_f${frame}_${id.slice(0,6)}.png`,relative=`${roomKey}/${day}/${file}`,full=join(this.dir,...relative.split('/'));
  mkdirSync(join(this.dir,roomKey,day),{recursive:true});
  const temporary=full+'.tmp';writeFileSync(temporary,bytes,{mode:0o600});renameSync(temporary,full);
  this.store.db.prepare('INSERT INTO capture_files(id,room,created,event_id,frame,nickname,amount,size,width,height,path) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,room,Math.min(Math.floor(time),now),eventId,frame,nickname,amount,bytes.length,width,height,relative);
  this.pruneFiles(room);
  return {id,duplicate:false,size:bytes.length};
 }
 // 보관 목록(최근 것부터). 파일 내용은 포함하지 않습니다.
 files(room,limit=300){
  return this.store.db.prepare('SELECT id,event_id AS eventId,frame,nickname,amount,created AS time,size,width,height FROM capture_files WHERE room=? ORDER BY created DESC,frame ASC LIMIT ?').all(room,Math.max(1,Math.min(1000,limit)));
 }
 usage(room){const row=this.store.db.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(size),0) AS bytes FROM capture_files WHERE room=?').get(room);return {count:row.count,bytes:row.bytes};}
 // 파일 한 장을 읽습니다. 다른 방의 파일이거나 없으면 404입니다.
 file(room,id){
  const row=/^[a-f0-9]{24}$/.test(String(id))?this.store.db.prepare('SELECT * FROM capture_files WHERE id=? AND room=?').get(id,room):null;
  if(!row||!this.dir)throw fail('보관된 캡처를 찾을 수 없습니다.',404);
  const full=resolve(this.dir,...row.path.split('/'));
  if(!full.startsWith(this.dir+sep)||!existsSync(full))throw fail('캡처 파일이 서버에서 삭제되었습니다.',404);
  return {data:readFileSync(full),row};
 }
 // 후원 한 건의 모든 장을 ZIP 하나로 묶습니다. (태블릿에서 한 번에 내려받기 위함)
 zip(room,eventId){
  const rows=this.store.db.prepare('SELECT * FROM capture_files WHERE room=? AND event_id=? ORDER BY frame').all(room,String(eventId||''));
  if(!rows.length)throw fail('보관된 캡처를 찾을 수 없습니다.',404);
  const entries=rows.map(row=>({name:`${new Date(row.created+9*3600000).toISOString().slice(0,10)}_${row.amount}spoon_frame${String(row.frame).padStart(2,'0')}.png`,data:this.file(room,row.id).data,date:new Date(row.created)}));
  return {data:buildZip(entries),name:`RadioMate-${new Date(rows[0].created+9*3600000).toISOString().slice(0,10)}-${rows[0].amount}spoon.zip`};
 }
 // 선택한 캡처(ids) 또는 전부(ids 생략)를 지웁니다. 지운 개수를 돌려줍니다.
 remove(room,ids=null){
  const rows=ids===null?this.store.db.prepare('SELECT id,path FROM capture_files WHERE room=?').all(room)
   :[...new Set(ids.filter(id=>/^[a-f0-9]{24}$/.test(String(id))))].slice(0,1000).map(id=>this.store.db.prepare('SELECT id,path FROM capture_files WHERE id=? AND room=?').get(id,room)).filter(Boolean);
  for(const row of rows){
   try{if(this.dir){const full=resolve(this.dir,...row.path.split('/'));if(full.startsWith(this.dir+sep))rmSync(full,{force:true});}}catch{/* 파일이 이미 없어도 목록은 정리합니다 */}
   this.store.db.prepare('DELETE FROM capture_files WHERE id=?').run(row.id);
  }
  return rows.length;
 }
 // 보관 기간(기본 30일)·개수(1000장)·용량(3GB) 한도를 넘는 오래된 캡처부터 지웁니다.
 pruneFiles(room){
  const old=this.store.db.prepare('SELECT id FROM capture_files WHERE room=? AND created<?').all(room,this.now()-this.retentionDays*86400000).map(row=>row.id);
  if(old.length)this.remove(room,old);
  let {count,bytes}=this.usage(room);
  while(count>this.maxFiles||bytes>this.maxBytes){
   // 넘친 만큼만(개수 초과분, 용량 초과면 한 장씩) 가장 오래된 것부터 지웁니다.
   const oldest=this.store.db.prepare('SELECT id,size FROM capture_files WHERE room=? ORDER BY created ASC,rowid ASC LIMIT ?').all(room,Math.max(1,count-this.maxFiles));
   if(!oldest.length)break;
   this.remove(room,oldest.map(row=>row.id));({count,bytes}=this.usage(room));
  }
 }
}
