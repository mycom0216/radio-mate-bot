function invalid(message,status=400){return Object.assign(Error(message),{status});}

export function publicOrigin(value,{production=false}={}){
  let url;try{url=new URL(value);}catch{throw Error('PUBLIC_URL에 올바른 접속 주소를 입력하세요.');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('PUBLIC_URL은 경로·쿼리·계정 정보 없는 http(s) 주소여야 합니다.');
  if(production&&url.protocol!=='https:')throw Error('운영 환경 PUBLIC_URL에는 HTTPS가 필요합니다.');
  return url.origin;
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
