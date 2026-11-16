let apiPromise;
function loadApi(){
  if(globalThis.YT?.Player)return Promise.resolve();
  if(apiPromise)return apiPromise;
  apiPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';
    const timer=setTimeout(()=>reject(Error('YouTube에 연결하지 못했습니다. 네트워크를 확인한 후 다시 시도하세요.')),15000);
    globalThis.onYouTubeIframeAPIReady=()=>{clearTimeout(timer);resolve();};
    script.onerror=()=>{clearTimeout(timer);reject(Error('YouTube 플레이어를 불러오지 못했습니다.'));};
    document.head.append(script);
  }).catch(error=>{apiPromise=null;throw error;});return apiPromise;
}
export class YouTubePlayer {
  constructor({onEnd,onError,onStatus}){Object.assign(this,{onEnd,onError,onStatus});this.player=null;this.ready=null;this.guard=()=>false;this.playing=false;}
  async load(id,guard,songId){
    this.guard=guard;this.playing=false;await loadApi();if(!guard())return;
    if(!this.ready)this.ready=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.ready=null;this.player?.destroy();this.player=null;reject(Error('영상 플레이어 준비 시간이 초과되었습니다. 다시 시작해 주세요.'));},15000);
      this.player=new YT.Player('youtube-player',{width:'100%',height:'270',host:'https://www.youtube-nocookie.com',playerVars:{playsinline:1,origin:location.origin},events:{
        onReady:()=>{clearTimeout(timer);resolve();},
        onStateChange:event=>{
          if(!this.guard()||this.player.getVideoData()?.video_id!==this.videoId)return;
          if(event.data===YT.PlayerState.PLAYING){this.playing=true;this.onStatus('재생 중 · 영상이 끝나면 자동재생 설정에 따라 다음 곡으로 넘어갑니다.');}
          if(event.data===YT.PlayerState.ENDED&&this.playing){this.playing=false;this.onEnd();}
          if(event.data===YT.PlayerState.PAUSED)this.onStatus('영상이 일시정지되었습니다. 플레이어 또는 재생 시작 버튼으로 이어서 재생하세요.');
        },
        onAutoplayBlocked:()=>{if(this.guard())this.onStatus('브라우저가 자동재생을 막았습니다. 영상의 재생 버튼을 눌러 주세요.');},
        onError:event=>{if(this.guard())this.onError(({2:'잘못된 영상 링크입니다.',5:'영상을 재생할 수 없습니다.',100:'삭제되었거나 비공개인 영상입니다.',101:'외부 재생이 허용되지 않은 영상입니다.',150:'외부 재생이 허용되지 않은 영상입니다.',153:'YouTube에서 재생 출처를 확인하지 못했습니다.'})[event.data]||'영상 재생 오류가 발생했습니다. 다른 곡으로 넘기거나 링크를 확인하세요.');}
      }});
    });
    await this.ready;if(!guard())return;this.videoId=id;
    if(this.songId===songId&&this.player.getVideoData()?.video_id===id)this.player.playVideo();else{this.songId=songId;this.player.loadVideoById(id);}
  }
  pause(){this.playing=false;this.player?.pauseVideo?.();}
}
