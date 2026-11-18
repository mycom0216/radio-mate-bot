const weatherPoints=[[37.5665,126.978],[35.1796,129.0756],[35.8714,128.6014],[37.4563,126.7052],[35.1595,126.8526],[36.3504,127.3845],[35.5384,129.3114],[36.48,127.289],[37.2636,127.0286],[37.8813,127.73],[36.6424,127.489],[36.6588,126.6728],[35.8242,127.148],[34.8161,126.4629],[36.5684,128.7294],[35.2285,128.6811],[33.4996,126.5312]];
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
export function validTunnel(value){try{const url=new URL(value);return url.protocol==='https:'&&url.hostname.endsWith('.trycloudflare.com')&&!url.username&&!url.password&&!url.port&&url.pathname==='/'&&!url.search&&!url.hash?url.origin:null;}catch{return null;}}
async function readSmall(request){const reader=request.body?.getReader();if(!reader)return '';const chunks=[];let length=0;while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>4096){await reader.cancel();throw Error('too large');}chunks.push(value);}const bytes=new Uint8Array(length);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}return new TextDecoder().decode(bytes);}
export async function gateway(request,env,fetcher=fetch,now=Date.now){
 const url=new URL(request.url);
 if(['/__radiomate/route','/__radiomate/weather'].includes(url.pathname)){
  if(request.method!=='POST')return json({error:'method'},405);if(!env.ROUTER_KEY||!env.DB)return json({error:'not configured'},503);
  const timestamp=Number(request.headers.get('x-radiomate-time')),signature=request.headers.get('x-radiomate-signature')||'';
  if(!Number.isSafeInteger(timestamp)||Math.abs(now()-timestamp)>120000||!/^[a-f0-9]{64}$/.test(signature))return json({error:'unauthorized'},401);
  let text;try{text=await readSmall(request);}catch{return json({error:'too large'},413);}
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.ROUTER_KEY),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const valid=await crypto.subtle.verify('HMAC',key,Uint8Array.from(signature.match(/../g),n=>parseInt(n,16)),new TextEncoder().encode(timestamp+'\n'+text));if(!valid)return json({error:'unauthorized'},401);
  let body;try{body=JSON.parse(text);}catch{return json({error:'invalid body'},400);}
  if(url.pathname==='/__radiomate/weather'){
   if(!['current','tomorrow','thisWeek','nextWeek'].includes(body.period))return json({error:'invalid period'},400);
   const today=new Date(now()+32400000).toISOString().slice(0,10),shift=n=>new Date(Date.parse(today+'T00:00:00Z')+n*86400000).toISOString().slice(0,10),weekday=(new Date(today+'T00:00:00Z').getUTCDay()+6)%7;
   const target=new URL('https://api.open-meteo.com/v1/forecast');const query={latitude:weatherPoints.map(p=>p[0]).join(','),longitude:weatherPoints.map(p=>p[1]).join(','),timezone:'Asia/Seoul',temperature_unit:'celsius'};
   if(body.period==='current')Object.assign(query,{current:'temperature_2m,weather_code',forecast_days:'1'});else{const start=body.period==='tomorrow'?1:body.period==='thisWeek'?-weekday:7-weekday;Object.assign(query,{daily:'weather_code,temperature_2m_min,temperature_2m_max,precipitation_probability_max',start_date:shift(start),end_date:shift(start+(body.period==='tomorrow'?0:6))});}
   target.search=new URLSearchParams(query);
   try{const upstream=await fetcher(target,{signal:AbortSignal.timeout(20000)});if(!upstream.ok)return json({error:'weather provider unavailable'},503);const data=await upstream.json();if(!Array.isArray(data)||data.length!==17)return json({error:'weather response invalid'},503);return json(data);}catch{return json({error:'weather provider unavailable'},503);}
  }
  const origin=validTunnel(body.origin);if(!origin||!Number.isSafeInteger(body.sequence)||body.sequence<1)return json({error:'invalid route'},400);
  const result=await env.DB.prepare('INSERT INTO gateway_route(id,origin,sequence,updated_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET origin=excluded.origin,sequence=excluded.sequence,updated_at=excluded.updated_at WHERE excluded.sequence>gateway_route.sequence').bind(origin,body.sequence,now()).run();
  return json({ok:true,changed:result.meta?.changes>0});
 }
 if(!env.DB)return json({ok:false},503);
 const route=await env.DB.prepare('SELECT origin FROM gateway_route WHERE id=1').first();
 if(url.pathname==='/__radiomate/health')return json({ok:!!route,service:'radiomate-gateway'},route?200:503);
 if(!route)return json({error:'연결 준비 중입니다.'},503);
 const origin=validTunnel(route.origin);if(!origin)return json({error:'연결 확인 중입니다.'},503);
 const target=new URL(origin);
 target.pathname=url.pathname;
 target.search=url.search;
 const headers=new Headers(request.headers);headers.delete('host');
 for(const name of [...headers.keys()])if(name.toLowerCase().startsWith('oai-'))headers.delete(name);
 try{
  const upstream=await fetcher(new Request(target,{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:request.body,redirect:'manual',...(request.body?{duplex:'half'}:{})}));
  const output=new Headers(upstream.headers);output.set('Cache-Control','no-store');return new Response(upstream.body,{status:upstream.status,statusText:upstream.statusText,headers:output});
 }catch{return json({error:'방송 도우미 연결을 복구하고 있습니다. 잠시 후 다시 열어주세요.'},503);}
}
export default {fetch:(request,env)=>gateway(request,env)};
