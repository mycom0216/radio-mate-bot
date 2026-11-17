const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
function complete(room,now){if(!room.current)return;room.previous=room.current;room.songHistory=[{...room.current,completedAt:now},...(room.songHistory||[])].slice(0,100);}
export function touchQueue(room){
  const next=(room.queueRevision||0)+1;if(!Number.isSafeInteger(next))fail('대기열 변경 한도에 도달했습니다.');
  room.queueRevision=next;delete room.songUndo;
}
export function applySongAction(room,request,now=Date.now()){
  const {action}=request;
  if(request.expectedQueueRevision!==undefined&&(!Number.isSafeInteger(request.expectedQueueRevision)||request.expectedQueueRevision!==(room.queueRevision||0)))fail('다른 탭이나 채팅에서 대기열이 변경되었습니다. 새로고침 후 다시 확인하세요.',409);
  if(Object.hasOwn(request,'expectedCurrentId')&&request.expectedCurrentId!==(room.current?.id||null))fail('현재곡이 이미 변경되었습니다. 새로고침 후 확인하세요.',409);
  if(action==='move'||action==='undo')if(!Number.isSafeInteger(request.expectedQueueRevision))fail('최신 대기열 정보를 확인한 뒤 다시 시도하세요.',409);
  if(action==='start'&&room.songSelection){
    const selected=room.songSelection;
    if(selected.kind==='queue')return applySongAction(room,{...request,action:'select',id:selected.id,expectedQueueRevision:request.expectedQueueRevision??room.queueRevision??0},now);
    if(selected.kind!=='previous'||room.previous?.id!==selected.id)fail('선택한 이전곡이 변경되었습니다. 다시 선택하세요.',409);
    const song=room.previous;touchQueue(room);complete(room,now);room.current=song;delete room.songSelection;return;
  }
  if(action==='select'){
    if(!Number.isSafeInteger(request.expectedQueueRevision))fail('최신 대기열을 확인한 뒤 다시 시도하세요.',409);
    const index=room.songs.findIndex(s=>s.id===request.id);if(index<0)fail('신청곡이 이미 변경되었습니다.',409);
    touchQueue(room);complete(room,now);
    room.current=room.songs.splice(index,1)[0];delete room.songSelection;
  }else if(action==='start'){
    if(room.current)return;
    if(!room.songs.length)fail('대기 중인 신청곡이 없습니다.');
    touchQueue(room);room.current=room.songs.shift();
  }else if(action==='ended'){
    if(!room.current||typeof request.expectedCurrentId!=='string')fail('현재곡이 이미 변경되었습니다. 새로고침 후 확인하세요.',409);
    if(typeof request.advance!=='boolean')fail('자동 전환 여부를 확인하세요.');
    touchQueue(room);complete(room,now);room.current=request.advance?(room.songs.shift()||null):null;delete room.songSelection;
  }else if(action==='next'){
    if(!room.songs.length)fail('대기 중인 신청곡이 없습니다.');
    touchQueue(room);complete(room,now);room.current=room.songs.shift();delete room.songSelection;
  }else if(action==='finish'){
    if(!room.current)fail('현재 재생 중인 곡이 없습니다.');
    touchQueue(room);complete(room,now);room.current=null;delete room.songSelection;
  }else if(action==='remove'){
    const index=room.songs.findIndex(x=>x.id===request.id);if(index<0)fail('신청곡을 찾을 수 없습니다.');
    const song=room.songs[index];touchQueue(room);room.songs.splice(index,1);
    if(room.songSelection?.id===song.id)delete room.songSelection;
    room.songUndo={song,index,expires:now+300000,revision:room.queueRevision,currentId:room.current?.id||null};
  }else if(action==='move'){
    if(![-1,1].includes(request.direction))fail('위 또는 아래 방향을 선택하세요.');
    const index=room.songs.findIndex(x=>x.id===request.id),target=index+request.direction;
    if(index<0)fail('신청곡을 찾을 수 없습니다.');if(target<0||target>=room.songs.length)fail('이 방향으로 더 이동할 수 없습니다.');
    touchQueue(room);[room.songs[index],room.songs[target]]=[room.songs[target],room.songs[index]];
  }else if(action==='undo'){
    const undo=room.songUndo;
    if(!undo||undo.expires<=now||undo.revision!==(room.queueRevision||0)||undo.currentId!==(room.current?.id||null))fail('삭제를 되돌릴 수 없습니다. 5분이 지났거나 대기열이 변경되었습니다.',409);
    if(room.songs.some(x=>x.id===undo.song.id))fail('이미 대기열에 있는 곡입니다.',409);
    touchQueue(room);room.songs.splice(Math.min(undo.index,room.songs.length),0,undo.song);
  }else fail('잘못된 동작입니다.');
}
