import { randomUUID } from 'node:crypto';
export class Outbox {
  constructor(store) { this.store=store;this.db=store.db;this.locks=new Set(); }
  enqueue(room,key,text,now=Date.now()) {
    if(!text)return;
    this.db.prepare('INSERT OR IGNORE INTO outbox(id,room,event_key,text,created,due,attempts,status) VALUES(?,?,?,?,?,?,0,?)')
      .run(randomUUID(),room,key,[...text].slice(0,200).join(''),now,now,'pending');
  }
  list(room){return this.db.prepare("SELECT id,text,created,attempts,status,due FROM outbox WHERE room=? AND status!='sent' ORDER BY created LIMIT 100").all(room);}
  retry(room,id){this.db.prepare("UPDATE outbox SET status='pending',attempts=0,created=?,due=? WHERE room=? AND id=? AND status IN ('uncertain','failed','expired')").run(Date.now(),Date.now(),room,id);}
  cancel(room,id){this.db.prepare("UPDATE outbox SET status='cancelled' WHERE room=? AND id=? AND status IN ('pending','failed')").run(room,id);}
  async flush(room,send,now=Date.now()) {
    if(this.locks.has(room))return;this.locks.add(room);
    try {
      this.db.prepare("UPDATE outbox SET status='expired' WHERE room=? AND status='pending' AND created<?").run(room,now-600000);
      const row=this.db.prepare("SELECT * FROM outbox WHERE room=? AND status='pending' AND due<=? ORDER BY created,rowid LIMIT 1").get(room,now);
      if(!row)return;
      // Reserve before awaiting: a crash or ambiguous delivery never silently resends a message.
      this.db.prepare("UPDATE outbox SET status='sending',attempts=attempts+1 WHERE id=?").run(row.id);
      let result;try{result=await send(row.text);}catch{result={kind:'ambiguous'};}
      const kind=result?.kind||'ambiguous';
      if(kind==='sent')this.db.prepare("UPDATE outbox SET status='sent' WHERE id=? AND status='sending'").run(row.id);
      else if(kind==='deferred')this.db.prepare("UPDATE outbox SET status='pending',attempts=attempts-1,due=? WHERE id=? AND status='sending'").run(now+5000,row.id);
      else if(kind==='retry'&&row.attempts<4)this.db.prepare("UPDATE outbox SET status='pending',due=? WHERE id=? AND status='sending'").run(now+Math.min(60000,5000*2**row.attempts),row.id);
      else this.db.prepare("UPDATE outbox SET status=? WHERE id=? AND status='sending'").run(kind==='ambiguous'?'uncertain':'failed',row.id);
    }finally{this.locks.delete(room);}
  }
}
