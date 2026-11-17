import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {readJSON,publicOrigin} from '../http-utils.mjs';

test('JSON parsing preserves Korean and emoji when every UTF-8 byte arrives separately',async()=>{
  const value={name:'라디오 💗',message:'!출석'};
  const req=Readable.from([...Buffer.from(JSON.stringify(value))].map(x=>Buffer.from([x])));
  assert.deepEqual(await readJSON(req),value);
});

test('oversized requests return 413; malformed UTF-8, JSON and non-object bodies return 400',async()=>{
  const large=Readable.from([Buffer.alloc(80),Buffer.alloc(80)]);
  await assert.rejects(readJSON(large,{limit:100}),e=>e.status===413);assert.equal(large.destroyed,false);large.destroy();
  const declared=Readable.from([]);declared.headers={'content-length':'999'};
  await assert.rejects(readJSON(declared,{limit:10}),e=>e.status===413);
  for(const bytes of [Buffer.from('{'),Buffer.from('null'),Buffer.from('[]'),Buffer.from('42'),Buffer.from([123,34,120,34,58,34,0xff,34,125])])await assert.rejects(readJSON(Readable.from([bytes])),e=>e.status===400);
  assert.deepEqual(await readJSON(Readable.from([])),{});
});

test('PUBLIC_URL is a normalized origin with HTTPS required in production',()=>{
  assert.equal(publicOrigin('https://Radio.Example.com:443/'), 'https://radio.example.com');
  assert.equal(publicOrigin('http://localhost:4310'), 'http://localhost:4310');
  for(const value of ['invalid','ftp://radio.example.com','https://user:password@radio.example.com','https://radio.example.com/path','https://radio.example.com/?x=1','https://radio.example.com/#a'])assert.throws(()=>publicOrigin(value));
  assert.throws(()=>publicOrigin('http://radio.example.com',{production:true}),/HTTPS/);
});
