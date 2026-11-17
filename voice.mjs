import {randomBytes,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
export const MAX_VOICE_BYTES=8*1024*1024;
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
export function audioType(b){
  if(b.length<12)return null;
  if(b.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])))return 'audio/webm';
  if(b.subarray(0,4).toString()==='OggS')return 'audio/ogg';
  if(b.subarray(4,8).toString()==='ftyp')return 'audio/mp4';
  if(b.length>=44&&b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WAVE')return 'audio/wav';
  if(b.subarray(0,3).toString()==='ID3'||b[0]===255&&(b[1]&224)===224)return 'audio/mpeg';
  return null;
}
export class VoiceInbox {
  constructor(db,dir){
    this.db=db;this.dir=dir;mkdirSync(dir,{recursive:true});this.attempts=new Map();
    db.exec(`CREATE TABLE IF NOT EXISTS voice_links(room TEXT PRIMARY KEY,token TEXT UNIQUE NOT NULL,enabled INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS voice_cards(id TEXT PRIMARY KEY,room TEXT NOT NULL,nickname TEXT NOT NULL,title TEXT NOT NULL,mime TEXT NOT NULL,bytes INTEGER NOT NULL,created INTEGER NOT NULL,is_read INTEGER NOT NULL DEFAULT 0,request_id TEXT NOT NULL,UNIQUE(room,request_id));`);
  }
  link(room){const row=this.db.prepare('SELECT token,enabled FROM voice_links WHERE room=?').get(room);return {token:row?.token||null,enabled:!!row?.enabled};}
  setLink(room,action){
    if(!['enable','disable','rotate'].includes(action))fail('접수 링크 동작을 확인하세요.');
    const old=this.link(room),token=action==='rotate'||!old.token?randomBytes(32).toString('hex'):old.token;
    this.db.prepare('INSERT INTO voice_links VALUES(?,?,?) ON CONFLICT(room) DO UPDATE SET token=excluded.token,enabled=excluded.enabled').run(room,token,action==='disable'?0:1);return this.link(room);
  }
  resolve(token){if(!/^[a-f0-9]{64}$/.test(token))fail('접수 링크가 유효하지 않습니다.',404);const row=this.db.prepare('SELECT room FROM voice_links WHERE token=? AND enabled=1').get(token);if(!row)fail('접수가 중지되었거나 변경된 링크입니다.',404);return row.room;}
  list(room){return this.db.prepare('SELECT id,nickname,title,mime,bytes,created,is_read FROM voice_cards WHERE room=? ORDER BY created DESC').all(room);}
  file(room,id){if(!/^[a-f0-9-]{36}$/.test(id))fail('음성 메시지를 찾을 수 없습니다.',404);const row=this.db.prepare('SELECT * FROM voice_cards WHERE room=? AND id=?').get(room,id);if(!row)fail('음성 메시지를 찾을 수 없습니다.',404);return {row,data:readFileSync(join(this.dir,id))};}
  action(room,id,action){
    const row=this.db.prepare('SELECT id FROM voice_cards WHERE room=? AND id=?').get(room,id);if(!row)fail('음성 메시지를 찾을 수 없습니다.',404);
    if(action==='delete'){unlinkSync(join(this.dir,row.id));this.db.prepare('DELETE FROM voice_cards WHERE room=? AND id=?').run(room,id);}
    else if(['read','unread'].includes(action))this.db.prepare('UPDATE voice_cards SET is_read=? WHERE room=? AND id=?').run(action==='read'?1:0,room,id);
    else fail('메시지 처리 동작을 확인하세요.');
  }
  async upload(req,token){
    const room=this.resolve(token),name=decodeURIComponent(req.headers['x-voice-name']||'').trim(),title=decodeURIComponent(req.headers['x-voice-title']||'').trim()||'음성 메시지',requestId=req.headers['x-voice-request'];
    if(!name||name.length>40||title.length>80||typeof requestId!=='string'||!/^[\w-]{16,64}$/.test(requestId))fail('닉네임·제목을 확인하고 다시 시도하세요.');
    const previous=this.db.prepare('SELECT id FROM voice_cards WHERE room=? AND request_id=?').get(room,requestId);if(previous){req.resume();return {id:previous.id,duplicate:true};}
    if(Number(req.headers['content-length'])>MAX_VOICE_BYTES){req.resume();fail('음성 파일은 8MB 이하여야 합니다.',413);}
    const now=Date.now(),key=room+':'+req.socket.remoteAddress;
    for(const [k,v]of this.attempts)if(now-v.time>=600000)this.attempts.delete(k);
    const rate=this.attempts.get(key)||{time:now,count:0};if(rate.count>=5)fail('이 접속에서는 10분에 최대 5개까지 보낼 수 있습니다.',429);rate.count++;this.attempts.set(key,rate);
    const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>MAX_VOICE_BYTES)fail('음성 파일은 8MB 이하여야 합니다.',413);chunks.push(chunk);}
    const data=Buffer.concat(chunks),mime=audioType(data);if(!mime)fail('지원하는 음성 파일(MP3·WAV·M4A·WebM·Ogg)을 선택하세요.');
    // Revalidate after upload: the DJ may have disabled/rotated the link in flight.
    if(this.resolve(token)!==room)fail('접수 링크가 변경되었습니다.',409);
    const quota=this.db.prepare('SELECT COUNT(*) count,COALESCE(SUM(bytes),0) bytes FROM voice_cards WHERE room=?').get(room);
    if(quota.count>=100||quota.bytes+size>100*1024*1024)fail('DJ의 수신함이 가득 찼습니다. 잠시 후 다시 시도해 주세요.',409);
    const duplicate=this.db.prepare('SELECT id FROM voice_cards WHERE room=? AND request_id=?').get(room,requestId);if(duplicate)return {id:duplicate.id,duplicate:true};
    const id=randomUUID();writeFileSync(join(this.dir,id),data,{flag:'wx',mode:0o600});
    try{this.db.prepare('INSERT INTO voice_cards(id,room,nickname,title,mime,bytes,created,request_id) VALUES(?,?,?,?,?,?,?,?)').run(id,room,name,title,mime,size,now,requestId);}
    catch(error){unlinkSync(join(this.dir,id));throw error;}
    return {id,duplicate:false};
  }
}
