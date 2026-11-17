import {seal,unseal} from './spoon.mjs';
export class Sessions {
 constructor(db,{key,volatile=()=>false,now=Date.now}){Object.assign(this,{db,key,volatile,now});this.memory=new Map();db.exec('CREATE TABLE IF NOT EXISTS studio_sessions(key TEXT PRIMARY KEY,room TEXT NOT NULL,expires INTEGER NOT NULL,data TEXT NOT NULL)');}
 set(key,session){
  if(this.volatile(session.room)){this.memory.set(key,session);return this;}
  this.db.prepare('INSERT INTO studio_sessions VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET room=excluded.room,expires=excluded.expires,data=excluded.data').run(key,session.room,session.expires,seal(session,this.key));return this;
 }
 decode(row){try{const session=unseal(row.data,this.key);return session.room===row.room&&session.expires===row.expires&&typeof session.csrf==='string'?session:undefined;}catch{return undefined;}}
 get(key){const row=this.db.prepare('SELECT * FROM studio_sessions WHERE key=?').get(key),session=this.memory.get(key)||(row&&this.decode(row));return session&&session.expires>this.now()?session:undefined;}
 delete(key){const removed=this.memory.delete(key),result=this.db.prepare('DELETE FROM studio_sessions WHERE key=?').run(key);return removed||result.changes>0;}
 *[Symbol.iterator](){
  yield* this.memory;
  for(const row of this.db.prepare('SELECT * FROM studio_sessions').all()){const session=this.decode(row);if(session)yield [row.key,session];else this.delete(row.key);}
 }
}
