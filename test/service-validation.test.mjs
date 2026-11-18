import test from 'node:test';import assert from 'node:assert/strict';import {validateServices} from '../tools/service-validation.mjs';
import {naverSearchRequest} from '../naver-search-config.mjs';
test('API HUB and legacy credentials use separate official endpoints and header names',()=>{
 const input={clientId:'test-id',clientSecret:'test-secret',query:'광주 카페'};
 const hub=naverSearchRequest(input);assert.equal(hub.url.origin,'https://naverapihub.apigw.ntruss.com');assert.equal(hub.url.pathname,'/search/v1/local');assert.equal(hub.headers['X-NCP-APIGW-API-KEY'],'test-secret');assert.equal(hub.headers['X-Naver-Client-Secret'],undefined);
 const legacy=naverSearchRequest({...input,provider:'legacy'});assert.equal(legacy.url.hostname,'openapi.naver.com');assert.equal(legacy.headers['X-Naver-Client-Secret'],'test-secret');assert.throws(()=>naverSearchRequest({...input,provider:'maps'}),/hub 또는 legacy/);
});
test('invalid Naver credentials do not block saving a working OpenAI key or leak error bodies',async()=>{
 const result=await validateServices({naverId:'sample-id',naverSecret:'sample-secret',aiKey:'sk-'+'a'.repeat(30)},async url=>String(url).includes('ntruss.com')?{ok:false,status:401,json:async()=>({errorMessage:'sample-secret'})}:{ok:true,json:async()=>({output:[{type:'message'}]})});
 assert.deepEqual(result.success,['OpenAI']);assert.equal(result.values.NAVER_CLIENT_ID,undefined);assert.ok(result.values.OPENAI_API_KEY);assert.match(result.errors[0],/네이버 HTTP 401/);assert.ok(!result.errors[0].includes('sample-secret'));
});
test('Naver permission and quota failures have actionable separate messages',async()=>{
 for(const [status,hint]of [[403,/검색 API 권한/],[429,/호출 한도/]]){const result=await validateServices({naverId:'sample-id',naverSecret:'sample-secret'},async()=>({ok:false,status}));assert.equal(result.success.length,0);assert.match(result.errors[0],hint);}
});
