import {touchQueue} from './song-queue.mjs';
import {unlinkSync} from 'node:fs';
import {join} from 'node:path';
function removeFile(dir,id){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('잘못된 파일 ID');try{unlinkSync(join(dir,id));}catch(e){if(e.code!=='ENOENT')throw e;}}
export function deleteListener(store,room,user){
  if(typeof user!=='string'||(!Object.hasOwn(store.load(room)?.users||{},user)&&!store.load(room)?.screenCapture?.events.some(event=>event.userId===user)))throw Error('등록된 청취자를 찾을 수 없습니다.');
  store.transaction(room,r=>{
    touchQueue(r);delete r.users[user];if(r.likeGreetings)delete r.likeGreetings[user];if(r.screenCapture)r.screenCapture.events=r.screenCapture.events.filter(event=>event.userId!==user);
    r.songs=r.songs.filter(s=>s.user!==user&&s.userId!==user);
    for(const key of ['current','previous'])if(r[key]?.user===user||r[key]?.userId===user)r[key]=null;
    r.special=r.special.filter(x=>x.user!==user);r.achievers=r.achievers.filter(x=>x.user!==user);
    if(r.lastRequester===user)r.lastRequester=null;
    store.db.prepare('DELETE FROM audit WHERE room=?').run(room);
    // Keep event IDs to prevent old reward events from being replayed after erasure.
    store.db.prepare("UPDATE events SET result='{}' WHERE room=?").run(room);
    store.db.prepare('DELETE FROM outbox WHERE room=?').run(room);
  });
}
export function deleteRoom(store,voice,room){
  const ids=store.db.prepare('SELECT id FROM voice_cards WHERE room=?').all(room);
  // Delete physical files first; a failure leaves the account available for retry.
  for(const {id} of ids)removeFile(voice.dir,id);
  store.db.exec('BEGIN IMMEDIATE');
  try{
    for(const table of ['voice_cards','voice_links','tokens','outbox','events','audit','backups'])store.db.prepare(`DELETE FROM ${table} WHERE room=?`).run(room);
    store.db.prepare('DELETE FROM rooms WHERE id=?').run(room);store.db.exec('COMMIT');
  }catch(e){store.db.exec('ROLLBACK');throw e;}
}
export function expireVoice(store,voice,days,now=Date.now()){
  if(!Number.isSafeInteger(days)||days<0)throw Error('음성 보관 일수를 확인하세요.');
  if(!days)return;
  const rows=store.db.prepare('SELECT id,room FROM voice_cards WHERE created<?').all(now-days*86400000);
  for(const row of rows)voice.action(row.room,row.id,'delete');
}
