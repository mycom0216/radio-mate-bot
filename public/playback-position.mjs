// Local resume checkpoint only. Never schedules playback outside a visible page.
export class PlaybackPosition {
  constructor({storage,room,now=Date.now}){Object.assign(this,{storage,room,now});}
  key(){const id=this.room();return id?'radiomate-position:'+id:null;}
  read(song,video){try{
    const key=this.key(),data=key&&JSON.parse(this.storage().getItem(key));
    if(!data)return 0;
    if(!Number.isFinite(data.time)||this.now()-data.time>12*3600000||this.now()<data.time){this.storage().removeItem(key);return 0;}
    if(data.song!==song||data.video!==video)return 0;
    return Number.isFinite(data.seconds)&&data.seconds>=0&&data.seconds<=86400?data.seconds:0;
  }catch{return 0;}}
  write(song,video,seconds){try{
    const key=this.key();if(!key||!song||!video||!Number.isFinite(seconds)||seconds<0||seconds>86400)return;
    this.storage().setItem(key,JSON.stringify({song,video,seconds:Math.floor(seconds),time:this.now()}));
  }catch{}}
  clear(){try{const key=this.key();if(key)this.storage().removeItem(key);}catch{}}
}
