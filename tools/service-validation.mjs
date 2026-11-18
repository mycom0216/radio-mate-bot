import {naverSearchRequest} from '../naver-search-config.mjs';
// Never expose provider response bodies or submitted credentials in errors.
async function checkedJSON(url,options,provider,fetcher){
 let response;try{response=await fetcher(url,{...options,signal:AbortSignal.timeout(25000)});}catch{throw Error(provider+' 네트워크 연결 실패. 인터넷 연결을 확인하고 다시 시도해주세요.');}
 if(!response.ok){
  const status=response.status;
  const hint=provider==='네이버'?(status===401?'Client ID·Secret 또는 검색 API 사용 권한을 확인해주세요.':status===403?'선택한 서비스의 검색 API 권한을 확인해주세요. API HUB에서는 지역을 선택해야 합니다.':status===429?'검색 API 호출 한도를 초과했습니다. 잠시 후 다시 시도해주세요.':'검색 API 서비스 상태를 확인해주세요.'):(status===401?'API 키를 확인해주세요.':status===429?'API 크레딧·사용 한도를 확인해주세요.':'모델 사용 권한과 서비스 상태를 확인해주세요.');
  throw Error(`${provider} HTTP ${Number(status)} · ${hint}`);
 }
 let data;try{data=await response.json();}catch{throw Error(provider+' 응답 형식을 확인하지 못했습니다.');}return data;
}
export async function validateServices({naverId='',naverSecret='',aiKey='',naverProvider='hub'},fetcher=fetch){
 const values={},errors=[],success=[];
 if(!naverId&&!naverSecret&&!aiKey)throw Error('설정할 키를 입력해주세요.');
 if(naverId||naverSecret)try{
  if(!/^[\w-]{5,200}$/.test(naverId)||!/^[\w-]{5,200}$/.test(naverSecret))throw Error('네이버 Client ID·Secret을 모두 입력해주세요.');
  const {url,headers}=naverSearchRequest({provider:naverProvider,clientId:naverId,clientSecret:naverSecret,query:'서울 카페',display:1});
  const data=await checkedJSON(url,{headers},'네이버',fetcher);
  if(!Array.isArray(data.items))throw Error('네이버 검색 응답 형식을 확인하지 못했습니다.');
  Object.assign(values,{NAVER_CLIENT_ID:naverId,NAVER_CLIENT_SECRET:naverSecret,NAVER_SEARCH_PROVIDER:naverProvider});success.push('네이버');
 }catch(error){errors.push(error.message);}
 if(aiKey)try{
  if(!/^sk-[\w-]{20,400}$/.test(aiKey))throw Error('OpenAI 키 형식을 확인해주세요.');
  const data=await checkedJSON('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+aiKey,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-4.1-mini',store:false,max_output_tokens:20,input:'Reply with OK.'})},'OpenAI',fetcher);
  if(!data.output?.length)throw Error('OpenAI 응답을 확인하지 못했습니다.');
  Object.assign(values,{OPENAI_API_KEY:aiKey,OPENAI_MODEL:'gpt-4.1-mini'});success.push('OpenAI');
 }catch(error){errors.push(error.message);}
 return {values,errors,success};
}
