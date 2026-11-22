export async function requestJSON(path,data,{csrf='',fetchImpl=globalThis.fetch,timeoutMs=15000,onUnauthorized=()=>{}}={}){
 let response;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{
 try{
  response=await fetchImpl(path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:data===undefined?undefined:JSON.stringify(data),signal:controller.signal,cache:'no-store',credentials:'same-origin'});
 }catch(error){
  const message=['TimeoutError','AbortError'].includes(error.name)?'서버 응답 시간이 초과되었습니다. 지급·사용 요청은 기록을 확인한 뒤 다시 시도해 주세요.':'서버에 연결하지 못했습니다. 연결 상태와 처리 기록을 확인해 주세요.';
  throw Object.assign(Error(message),{cause:error});
 }
 if(response.status===401)onUnauthorized();
 let json;try{json=await response.json();}catch(error){if(controller.signal.aborted)throw Object.assign(Error('서버 응답 시간이 초과되었습니다. 처리 기록을 확인한 뒤 다시 시도해 주세요.'),{cause:error});throw Object.assign(Error('서버 응답을 읽지 못했습니다. 처리 기록을 확인한 뒤 다시 시도해 주세요.'),{status:response.status});}
 if(!response.ok){throw Object.assign(Error(json.error||`요청을 처리하지 못했습니다. (${response.status})`),{status:response.status});}
 return json;
 }finally{clearTimeout(timer);}
}
