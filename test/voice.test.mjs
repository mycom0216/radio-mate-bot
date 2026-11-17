import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {Store} from '../core.mjs';
import {VoiceInbox,audioType,MAX_VOICE_BYTES,voiceSlug,voiceToken} from '../voice.mjs';
function fixture(){const dir=mkdtempSync(join(tmpdir(),'radio-voice-test-')),store=new Store();store.create('a','A');store.create('b','B');const voice=new VoiceInbox(store.db,dir);return {dir,store,voice,close(){store.db.close();if(!resolve(dir).startsWith(resolve(tmpdir())+sep))throw Error('Unsafe test cleanup');rmSync(dir,{recursive:true,force:true});}};}
function wav(){const b=Buffer.alloc(60);b.write('RIFF');b.writeUInt32LE(52,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(16,40);return b;}
function request(data=wav(),id='voice-request-00001',ip='127.0.0.1'){const req=Readable.from([data]);req.headers={'x-voice-name':encodeURIComponent('청취자'),'x-voice-title':encodeURIComponent('안녕하세요'),'x-voice-request':id,'content-length':String(data.length)};req.socket={remoteAddress:ip};return req;}
test('voice uploads are private, idempotent and scoped to the receiving DJ',async()=>{
  const f=fixture();try{const link=f.voice.setLink('a','enable');assert.equal(audioType(wav()),'audio/wav');const one=await f.voice.upload(request(),link.token);const repeat=await f.voice.upload(request(),link.token);assert.equal(repeat.id,one.id);assert.equal(repeat.duplicate,true);assert.equal(f.voice.list('a').length,1);assert.equal(f.voice.list('b').length,0);assert.throws(()=>f.voice.file('b',one.id),/찾을 수/);assert.deepEqual(f.voice.file('a',one.id).data,wav());f.voice.action('a',one.id,'read');assert.equal(f.voice.list('a')[0].is_read,1);f.voice.action('a',one.id,'delete');assert.deepEqual(readdirSync(f.dir),[]);}finally{f.close();}
});
test('voice link rotation/disable invalidate old links and unsupported or oversized data is rejected',async()=>{
  const f=fixture();try{const link=f.voice.setLink('a','enable');await assert.rejects(f.voice.upload(request(Buffer.from('<script>alert(1)</script>')),link.token),/음성 파일/);const large=request();large.headers['content-length']=String(MAX_VOICE_BYTES+1);await assert.rejects(f.voice.upload(large,link.token),/8MB/);f.voice.setLink('a','rotate');assert.throws(()=>f.voice.resolve(link.token),/중지/);const current=f.voice.link('a');f.voice.setLink('a','disable');await assert.rejects(f.voice.upload(request(),current.token),/중지/);assert.equal(f.voice.list('a').length,0);}finally{f.close();}
});
test('an upload cannot finish after its intake link is revoked',async()=>{
  const f=fixture();try{const link=f.voice.setLink('a','enable'),data=wav();const req=request();const stream=Readable.from((async function*(){yield data.subarray(0,20);f.voice.setLink('a','disable');yield data.subarray(20);})());stream.headers=req.headers;stream.socket=req.socket;await assert.rejects(f.voice.upload(stream,link.token),/중지/);assert.equal(f.voice.list('a').length,0);assert.deepEqual(readdirSync(f.dir),[]);}finally{f.close();}
});
test('voice intake enforces room capacity and per-connection upload rate',async()=>{
  const f=fixture();try{const link=f.voice.setLink('a','enable');for(let i=0;i<5;i++)await f.voice.upload(request(wav(),`voice-request-0000${i}`),link.token);await assert.rejects(f.voice.upload(request(wav(),'voice-request-00006'),link.token),/10분/);f.store.db.prepare('UPDATE voice_cards SET bytes=? WHERE room=?').run(100*1024*1024,'a');await assert.rejects(f.voice.upload(request(wav(),'voice-request-00007','other'),link.token),/가득/);}finally{f.close();}
});

test('voice link uses current public origin and stays disabled after shutdown',()=>{
 const f=fixture();try{const link=f.voice.setLink('a','enable');assert.equal(f.voice.url('a','https://new.example'),'https://new.example/v/'+voiceSlug(link.token));f.voice.setLink('a','disable');assert.equal(f.voice.url('a','https://new.example'),null);}finally{f.close();}
});

test('compact voice links preserve the full token and share revocation and upload checks',async()=>{
 const f=fixture();try{
  const link=f.voice.setLink('a','enable'),slug=voiceSlug(link.token);
  assert.equal(slug.length,43);assert.equal(voiceToken(slug),link.token);assert.equal(f.voice.resolve(slug),'a');assert.equal(f.voice.resolve(link.token),'a');
  const upload=await f.voice.upload(request(),slug);assert.equal(f.voice.list('a')[0].id,upload.id);
  assert.equal(voiceToken(slug+'x'),null);assert.equal(voiceToken('!'.repeat(43)),null);
  f.voice.setLink('a','rotate');assert.throws(()=>f.voice.resolve(slug),/중지/);assert.throws(()=>f.voice.resolve(link.token),/중지/);
 }finally{f.close();}
});
