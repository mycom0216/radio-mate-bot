export function youtubeId(value){
  try{
    const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port)return null;
    const host=u.hostname.toLowerCase(),parts=u.pathname.split('/').filter(Boolean);
    let id;
    if(host==='youtu.be')id=parts.length===1?parts[0]:null;
    else if(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','www.youtube-nocookie.com'].includes(host))
      id=u.pathname==='/watch'?u.searchParams.get('v'):['shorts','live','embed'].includes(parts[0])&&parts.length===2?parts[1]:null;
    return /^[A-Za-z0-9_-]{11}$/.test(id||'')?id:null;
  }catch{return null;}
}
export function parseSongRequest(text){
  const urls=text.match(/https?:\/\/\S+/g)||[];
  if(!urls.length)return {title:text,videoId:null};
  if(urls.length!==1)throw Error('YouTube 링크는 한 곡에 하나만 입력하세요.');
  const videoId=youtubeId(urls[0]);if(!videoId)throw Error('지원하는 HTTPS YouTube 영상 링크를 입력하세요.');
  const title=text.replace(urls[0],'').trim()||`YouTube · ${videoId}`;
  if(title.length>150)throw Error('곡 제목은 150자 이내로 입력하세요.');
  return {title,videoId};
}
export function songVideoId(song){return song?.videoId||youtubeId(song?.title);}
export const keepName=value=>String(value).trim().normalize('NFC');
export function keepExpiryLabel(ms=Date.now()){
  const date=new Date(ms+9*3600000),year=date.getUTCFullYear(),month=date.getUTCMonth()+1;
  const day=new Date(Date.UTC(year,month,0)).getUTCDate();
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')} 23:59:59 (한국 시간)`;
}
export function groupKeeps(keeps=[]){const counts=new Map();for(const raw of keeps){const name=keepName(raw);counts.set(name,(counts.get(name)||0)+1);}return [...counts].map(([name,count])=>({name,count}));}
