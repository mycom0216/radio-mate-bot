import {randomUUID} from 'node:crypto';
import {Store,Engine} from './core.mjs';
import {Spoon} from './spoon.mjs';
import {VoiceInbox} from './voice.mjs';
import {deleteRoom} from './privacy.mjs';

// Public previews never share the production database or OAuth credentials.
export class PublicSandbox {
  constructor(voiceDir,{now=()=>Date.now(),limit=30,region='kr'}={}){
    this.now=now;this.limit=limit;this.rooms=new Map();
    const store=new Store(),engine=new Engine(store,{region}),spoon=new Spoon(store,engine,{});
    const voice=new VoiceInbox(store.db,voiceDir);this.services={store,engine,spoon,voice};
  }
  create(){
    this.expire();if(this.rooms.size>=this.limit)throw Object.assign(Error('테스트 공간이 가득 찼습니다. 잠시 후 다시 열어주세요.'),{status:503});
    const id='preview-'+randomUUID();this.rooms.set(id,this.now()+3600000);
    this.services.store.create(id,'나만의 테스트 라디오');
    this.services.store.transaction(id,r=>{r.demo=true;});return id;
  }
  has(id){return typeof id==='string'&&id.startsWith('preview-');}
  remove(id){if(this.services.store.load(id))deleteRoom(this.services.store,this.services.voice,id);this.rooms.delete(id);}
  expire(){for(const [id,expires] of this.rooms)if(expires<=this.now())this.remove(id);}
  close(){this.services.store.db.close();}
}
