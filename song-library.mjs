import {songVideoId} from './public/song-utils.mjs';
const key=title=>String(title||'').normalize('NFKC').toLocaleLowerCase('ko').replace(/[\s\-–—]+/g,'');
export function savedSongVideo(room,title){
  const query=key(title);if(!query)return null;
  const saved=[room.current,...(room.songs||[]),room.previous,...(room.songLibrary||[])].find(song=>song&&key(song.title)===query&&/^[\w-]{11}$/.test(songVideoId(song)||''));
  return saved?songVideoId(saved):null;
}
export function rememberSongVideo(room,song,videoId){
  if(!/^[\w-]{11}$/.test(videoId||''))throw Error('올바른 영상 ID가 필요합니다.');
  room.songLibrary=[{title:song.title,videoId},...(room.songLibrary||[]).filter(x=>key(x.title)!==key(song.title))].slice(0,300);
}
