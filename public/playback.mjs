import {songVideoId} from './song-utils.mjs';
// The server compares song IDs before advancing, so stale/duplicate ended events
// from another browser cannot consume another entry in the queue.
export class Playback {
  constructor({api,load,pause,onRoom,onStatus}){Object.assign(this,{api,load,pause,onRoom,onStatus});this.running=false;this.auto=true;this.song=null;this.pending=false;this.generation=0;}
  stop(message='일시정지했습니다. 재생 시작을 누르면 이어서 재생합니다.'){
    this.running=false;this.generation++;this.pause();this.onStatus(message);
  }
  async start(room){
    if(this.pending)return;this.pending=true;const generation=this.generation;
    if(!room.current&&Array.isArray(room.songs)&&!room.songs.length){this.running=true;this.pending=false;this.onStatus('신청곡을 기다리는 중입니다. 새 신청곡이 들어오면 재생합니다.');return;}
    try{if(!room.current){const result=await this.api('/api/song',{action:'start'});room=result.room;this.onRoom(room);}if(this.generation!==generation)return;this.running=true;await this.sync(room,true);}
    catch(e){this.stop(e.message);}finally{this.pending=false;}
  }
  async sync(room,force=false){
    if(!this.running)return;
    const song=room.current;if(!song){
      if(this.song){this.pause();this.generation++;}this.song=null;
      if(this.auto&&room.songs?.length){
        const generation=++this.generation;
        try{const result=await this.api('/api/song',{action:'start'});if(!this.running||generation!==this.generation)return;this.onRoom(result.room);await this.sync(result.room,true);}
        catch(e){if(generation===this.generation)this.stop(e.message);}return;
      }
      if(this.auto){this.onStatus('신청곡을 기다리는 중입니다. 새 신청곡이 들어오면 재생합니다.');return;}
      this.stop('대기열 재생이 끝났습니다.');return;
    }
    if(!force&&song.id===this.song?.id&&songVideoId(song)===songVideoId(this.song))return;
    this.song=song;const id=songVideoId(song);
    if(!id){
      const generation=++this.generation;this.onStatus('곡 제목으로 YouTube 영상을 검색하는 중입니다…');
      try{const result=await this.api('/api/song-resolve',{id:song.id});if(!this.running||generation!==this.generation)return;this.onRoom(result.room);await this.sync(result.room,true);}
      catch(e){if(generation===this.generation)this.stop(e.message);}return;
    }
    const generation=++this.generation;
    this.onStatus('YouTube 영상을 불러오는 중입니다…');
    try{await this.load(id,()=>this.running&&this.generation===generation,song.id);}
    catch(e){if(this.generation===generation)this.stop(e.message);}
  }
  async ended(songId){
    if(!this.running||this.pending||!this.song||songId!==this.song.id)return;
    this.pending=true;const generation=this.generation;
    try{
      const result=await this.api('/api/song',{action:'ended',expectedCurrentId:songId,advance:this.auto});
      this.onRoom(result.room);
      if(this.generation!==generation||!this.running)return;
      if(!this.auto){this.stop('현재곡 재생이 끝났습니다. 자동재생은 꺼져 있습니다.');return;}
      await this.sync(result.room);
    }catch(e){this.stop(`자동 전환을 멈췄습니다. ${e.message}`);}finally{this.pending=false;}
  }
}
