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
  // 대기열에서 보낼 메시지를 꺼내 보냅니다. 기본은 한 번에 1개이고, max를 늘리면 쌓여 있는 메시지를 이어서 보냅니다.
  // (이어 보낼 때 앞 메시지와의 간격은 send 함수가 알아서 기다립니다) 한 번이라도 '보냄'이 아니면 그 자리에서 멈춥니다.
  async flush(room,send,now=Date.now(),{max=1}={}) {
    if(this.locks.has(room))return;this.locks.add(room);
    try {
     for(let count=0;count<max;count++){
      const at=count?Date.now():now;
      this.db.prepare("UPDATE outbox SET status='expired' WHERE room=? AND status='pending' AND created<?").run(room,at-600000);
      const row=this.db.prepare("SELECT * FROM outbox WHERE room=? AND status='pending' AND due<=? ORDER BY created,rowid LIMIT 1").get(room,at);
      if(!row)return;
      // Reserve before awaiting: a crash or ambiguous delivery never silently resends a message.
      this.db.prepare("UPDATE outbox SET status='sending',attempts=attempts+1 WHERE id=?").run(row.id);
      let result;try{result=await send(row.text);}catch{result={kind:'ambiguous'};}
      const kind=result?.kind||'ambiguous';
      if(kind==='sent')this.db.prepare("UPDATE outbox SET status='sent' WHERE id=? AND status='sending'").run(row.id);
      else if(kind==='deferred')this.db.prepare("UPDATE outbox SET status='pending',attempts=attempts-1,due=? WHERE id=? AND status='sending'").run(now+5000,row.id);
      else if(kind==='retry'&&row.attempts<4)this.db.prepare("UPDATE outbox SET status='pending',due=? WHERE id=? AND status='sending'").run(now+Math.min(60000,5000*2**row.attempts),row.id);
      else this.db.prepare("UPDATE outbox SET status=? WHERE id=? AND status='sending'").run(kind==='ambiguous'?'uncertain':'failed',row.id);
      if(kind!=='sent')return;
     }
    }finally{this.locks.delete(room);}
  }
}
