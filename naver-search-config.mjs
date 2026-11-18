// New applications use NAVER API HUB; legacy credentials remain opt-in.
export function naverSearchRequest({provider='hub',clientId,clientSecret,query,display=5}){
 if(!['hub','legacy'].includes(provider))throw Error('NAVER_SEARCH_PROVIDER는 hub 또는 legacy여야 합니다.');
 const url=new URL(provider==='hub'?'https://naverapihub.apigw.ntruss.com/search/v1/local':'https://openapi.naver.com/v1/search/local.json');
 url.search=new URLSearchParams({query,display:String(display),start:'1',sort:'random',...(provider==='hub'?{format:'json'}:{})});
 const headers=provider==='hub'?{'X-NCP-APIGW-API-KEY-ID':clientId,'X-NCP-APIGW-API-KEY':clientSecret}:{'X-Naver-Client-Id':clientId,'X-Naver-Client-Secret':clientSecret};
 return {url,headers};
}
