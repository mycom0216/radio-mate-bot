import {applySongAction} from './song-queue.mjs';
const key=value=>String(value||'').normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/\s+/gu,'');
export function deletionCandidates(room,scope){
 const songs=scope==='previous'?[room.previous,...(room.songHistory||[])].filter(Boolean):room.songs;
 return [...new Map(songs.map(song=>[song.id,song])).values()];
}
function prompt(room,actor,scope,now,intro='삭제할 곡 번호 또는 가수·곡명을 입력하세요.'){
 const songs=deletionCandidates(room,scope);
 if(!songs.length){delete room.songDeletePrompt;delete room.songSelection;return `${scope==='previous'?'이전곡·완료':'신청 대기'} 목록이 비어 있습니다.`;}
 room.songDeletePrompt={actor,scope,ids:songs.map(song=>song.id),expires:now+120000};
 return `${intro}\n${scope==='previous'?'이전곡·완료':'신청 대기'} ${songs.length}곡: ${songs.slice(0,4).map((song,i)=>`${i+1}. ${[...song.title].slice(0,24).join('')}`).join(' / ')}\n1부터 선택 · !삭제 취소`;
}
export function deleteSongCommand(room,actor,input,scope,now){
 const arg=String(input||'').trim();
 if(arg==='취소'){delete room.songDeletePrompt;return {text:'신청곡 삭제 선택을 취소했습니다.'};}
 const pending=room.songDeletePrompt;
 const active=pending?.actor===actor&&pending.expires>now;
 scope=scope||(active?pending.scope:room.songSelection?.kind==='previous'?'previous':'queue');
 if(!arg)return {text:prompt(room,actor,scope,now)};
 const songs=deletionCandidates(room,scope);
 if(active&&pending.scope===scope&&JSON.stringify(pending.ids)!==JSON.stringify(songs.map(song=>song.id)))return {text:prompt(room,actor,scope,now,'목록이 변경되어 삭제하지 않았습니다. 새 번호를 확인하세요.')};
 let matches;
 if(/^\d+$/u.test(arg)){
   const index=Number(arg)-1;matches=Number.isSafeInteger(index)&&index>=0&&index<songs.length?[songs[index]]:[];
 }else{
   const query=key(arg),exact=songs.filter(song=>key(song.title)===query);matches=exact.length?exact:songs.filter(song=>query&&key(song.title).includes(query));
 }
 if(matches.length!==1)return {text:prompt(room,actor,scope,now,matches.length?'여러 곡이 일치합니다. 번호나 더 긴 곡명을 입력하세요.':'일치하는 곡이 없습니다. 목록의 번호나 곡명을 확인하세요.')};
 const song=matches[0],currentId=room.current?.id;
 applySongAction(room,{action:'purge',id:song.id,expectedQueueRevision:room.queueRevision||0},now);
 return {text:`신청곡 삭제: ${song.title} · 대기·이전곡·완료 기록에서 제거했습니다. 남은 대기 ${room.songs.length}곡 (1번부터).`,stopped:!!currentId&&!room.current};
}
