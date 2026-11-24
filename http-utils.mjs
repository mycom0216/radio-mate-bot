function invalid(message,status=400){return Object.assign(Error(message),{status});}

export function publicOrigin(value,{production=false}={}){
  let url;try{url=new URL(value);}catch{throw Error('PUBLIC_URL에 올바른 접속 주소를 입력하세요.');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('PUBLIC_URL은 경로·쿼리·계정 정보 없는 http(s) 주소여야 합니다.');
  if(production&&url.protocol!=='https:')throw Error('운영 환경 PUBLIC_URL에는 HTTPS가 필요합니다.');
  return url.origin;
}

// 이미지처럼 JSON이 아닌 원본 바이트 본문을 읽습니다. limit(바이트)을 넘으면 413으로 거절합니다.
export async function readBytes(req,{limit=8*1024*1024}={}){
  const declared=Number(req.headers?.['content-length']);
  if(Number.isFinite(declared)&&declared>limit)throw invalid('요청이 너무 큽니다.',413);
  const chunks=[];let size=0;
  const iterator=req.iterator?req.iterator({destroyOnReturn:false}):req;
  for await(const chunk of iterator){
    const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    size+=bytes.length;if(size>limit)throw invalid('요청이 너무 큽니다.',413);
    chunks.push(bytes);
  }
  return Buffer.concat(chunks,size);
}

export async function readJSON(req,{limit=256000}={}){
  const declared=Number(req.headers?.['content-length']);
  if(Number.isFinite(declared)&&declared>limit)throw invalid('요청이 너무 큽니다.',413);
  const chunks=[];let size=0;
  // Keep the stream alive on rejection so the HTTP handler can return a real 413.
  const iterator=req.iterator?req.iterator({destroyOnReturn:false}):req;
  for await(const chunk of iterator){
    const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    size+=bytes.length;if(size>limit)throw invalid('요청이 너무 큽니다.',413);
    chunks.push(bytes);
  }
  if(!size)return {};
  let value;
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)));}
  catch{throw invalid('올바른 UTF-8 JSON 요청이 필요합니다.');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw invalid('JSON 객체를 보내주세요.');
  return value;
}

// HTTP Range 헤더(예: "bytes=0-1023", "bytes=500-", "bytes=-500")를 해석해 {start,end}(끝 포함)를 돌려줍니다.
// 헤더가 없으면 null(전체), 올바르지 않거나 범위를 벗어나면 {invalid:true}를 돌려줍니다. 영상은 이 방식이 있어야 사파리(아이패드)에서 재생됩니다.
export function parseRange(header,size){
  if(header===undefined||header===null||header==='')return null;
  const match=/^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if(!match||(match[1]===''&&match[2]===''))return {invalid:true};
  let start,end;
  if(match[1]===''){const length=Number(match[2]);if(!(length>0))return {invalid:true};start=Math.max(0,size-length);end=size-1;}
  else{start=Number(match[1]);end=match[2]===''?size-1:Math.min(Number(match[2]),size-1);}
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size)return {invalid:true};
  return {start,end};
}
