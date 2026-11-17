import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Sessions} from '../sessions.mjs';
test('DJ sessions survive recreation, are encrypted and still expire and revoke',()=>{
 const db=new DatabaseSync(':memory:');let now=1000;const options={key:'a'.repeat(64),now:()=>now};const session={room:'DJ',csrf:'private-csrf',expires:2000};
 try{
  new Sessions(db,options).set('hashed-cookie',session);const restored=new Sessions(db,options);assert.deepEqual(restored.get('hashed-cookie'),session);
  assert.ok(!db.prepare('SELECT data FROM studio_sessions').get().data.includes('private-csrf'));
  assert.equal(new Sessions(db,{...options,key:'b'.repeat(64)}).get('hashed-cookie'),undefined);
  now=2001;assert.equal(restored.get('hashed-cookie'),undefined);for(const [key,s]of restored)if(s.expires<now)restored.delete(key);assert.equal(db.prepare('SELECT COUNT(*) n FROM studio_sessions').get().n,0);
  now=1000;restored.set('new',session);restored.delete('new');assert.equal(new Sessions(db,options).get('new'),undefined);
 }finally{db.close();}
});
test('public demo sessions remain volatile and room revocation removes durable sessions',()=>{
 const db=new DatabaseSync(':memory:');const options={key:'a'.repeat(64),volatile:room=>room.startsWith('demo')};const sessions=new Sessions(db,options),base={csrf:'test',expires:Date.now()+60000};
 try{
  sessions.set('preview',{...base,room:'demo-private'});sessions.set('dj',{...base,room:'DJ'});
  assert.ok(sessions.get('preview'));assert.equal(new Sessions(db,options).get('preview'),undefined);assert.equal(db.prepare('SELECT COUNT(*) n FROM studio_sessions').get().n,1);
  for(const [key,s]of sessions)if(s.room==='DJ')sessions.delete(key);assert.equal(new Sessions(db,options).get('dj'),undefined);
 }finally{db.close();}
});
