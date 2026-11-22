export function levelProgress(exp,step){
  if(!Number.isSafeInteger(exp)||exp<0||!Number.isSafeInteger(step)||step<1)throw Error('레벨 경험치 설정을 확인하세요.');
  const current=exp%step;
  return {level:Math.floor(exp/step)+1,current,required:step,remaining:step-current,percent:Math.floor(current/step*100)};
}
export function sharedSettingsAction(current,next,{dirty=false,busy=false,editing=false}={}){
  if(!current||!next)return 'none';
  const changed=current.id!==next.id||current.name!==next.name||(current.settingsRevision||0)!==(next.settingsRevision||0)||JSON.stringify(current.settings)!==JSON.stringify(next.settings);
  if(!changed)return 'none';
  if(dirty)return 'conflict';
  return busy||editing?'defer':'reload';
}
export function commandWait(room,userId,dj,now=Date.now()){
  if(dj)return 0;
  const user=Object.hasOwn(room.users,userId)?room.users[userId]:null,settings=room.settings;
  return Math.ceil(Math.max(0,(room.lastResponse||0)+settings.responseGap*1000-now,user?(user.lastCommand||0)+settings.cooldown*1000-now:0)/1000);
}
export function suppressionMessage(out){
  if(out.suppressed==='quiet')return '조용 모드가 켜져 있어 게임 응답을 잠시 멈췄습니다. DJ가 조용 모드를 끄면 이용할 수 있어요.';
  if(out.suppressed==='disabled')return '이 게임이 꺼져 있습니다. 청취자도 !게임 on으로 게임을 켤 수 있어요.';
  if(out.suppressed==='cooldown')return `명령어 대기 중입니다. ${Math.max(1,Math.ceil(out.retryAfterMs/1000))}초 후 다시 보내 주세요. !게임 on은 청취자도 사용할 수 있습니다.`;
  return '응답이 없습니다. 명령어 안내에서 입력 형식과 사용 조건을 확인해 주세요.';
}
export function parseTestHistory(text){
  try{
    const data=JSON.parse(text);
    if(!data||!Array.isArray(data.chats))return null;
    const chats=data.chats.slice(-100).filter(x=>x&&typeof x.text==='string').map(x=>({text:x.text.slice(0,2000),bot:x.bot===true}));
    const identity=data.identity;
    return {chats,identity:identity&&typeof identity.user==='string'&&typeof identity.name==='string'?{user:identity.user.slice(0,100),name:identity.name.slice(0,40),dj:identity.dj===true}:null};
  }catch{return null;}
}
