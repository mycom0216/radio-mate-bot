import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDiagnostics} from '../diagnostics.mjs';
import {diagnosticsHTML} from '../public/diagnostics-ui.mjs';
test('diagnostics distinguish local practice, pending reward policies and limited delivery evidence',()=>{
 const result=buildDiagnostics({demo:true,configured:false,hasToken:false,room:{live:false,settings:{quiet:true,fishing:true,goldenPolicy:'pending'}},publicUrl:'http://localhost:4310',now:200000000,logs:[{type:'chat-send-failed',time:200000000},{type:'chat-send-failed',time:1}]});
 assert.equal(result.checks.find(c=>c.id==='account').status,'info');assert.equal(result.checks.find(c=>c.id==='quiet').status,'warn');assert.equal(result.checks.find(c=>c.id==='golden').status,'warn');assert.match(result.checks.find(c=>c.id==='delivery').title,/1건/);assert.match(result.checks.find(c=>c.id==='delivery').detail,/200/);
});
test('diagnostics expose a summary only and do not imply HTTPS or saved tokens prove deployment readiness',()=>{
 const room={live:true,settings:{quiet:false,fishing:false,goldenPolicy:'special'},users:{secret:{name:'private-name'}},voiceInboxUrl:'private-voice-token'};
 const result=buildDiagnostics({demo:false,configured:true,hasToken:true,room,publicUrl:'https://example.test',backups:3});
 assert.equal(result.checks.find(c=>c.id==='account').status,'pass');assert.match(result.checks.find(c=>c.id==='account').detail,/별도 확인/);assert.match(result.checks.find(c=>c.id==='public').detail,/형식만/);assert.match(result.checks.find(c=>c.id==='backups').detail,/잔액과 음성/);
 assert.doesNotMatch(JSON.stringify(result),/private-name|private-voice-token|secret/);assert.equal(result.checks.length,10);
});
test('diagnostics report where weather comes from and surface KMA failures without exposing keys',()=>{
 const base={demo:false,configured:true,hasToken:true,room:{live:true,settings:{quiet:false}}},collected=Date.parse('2026-11-19T01:06:00Z');
 const view=over=>({ok:true,lastOk:collected,failing:[],lastError:null,...over}),check=weather=>buildDiagnostics({...base,weather}).checks.find(c=>c.id==='weather');
 assert.equal(check(null),undefined);assert.equal(buildDiagnostics(base).checks.length,10);
 const ok=check({source:'kma',hourly:view(),mid:view({enabled:true}),collectedAt:collected});
 assert.equal(ok.status,'pass');assert.match(ok.title,/기상청 자료로/);assert.match(ok.detail,/11-19 10:06 KST/);assert.match(ok.detail,/중기예보 정상/);
 const noKey=check({source:'kma',hourly:view(),mid:view({enabled:false}),collectedAt:null});assert.equal(noKey.status,'pass');assert.match(noKey.detail,/서비스키가 없어/);assert.match(noKey.detail,/아직 없음|11-19/);
 const down=check({source:'kma',hourly:view({ok:false,failing:['서울','부산','광주','대구'],lastError:'기상청 서버가 응답하지 않습니다(HTTP 503).'}),mid:view({enabled:true}),collectedAt:collected});
 assert.equal(down.status,'warn');assert.match(down.title,/받지 못하고/);assert.match(down.detail,/서울·부산·광주/);assert.doesNotMatch(down.detail,/대구/);assert.match(down.detail,/HTTP 503/);
 const mid=check({source:'kma',hourly:view(),mid:view({enabled:true,ok:false,failing:['서울'],lastError:'중기예보 요청이 거절되었습니다(30 SERVICE_KEY_IS_NOT_REGISTERED_ERROR).'}),collectedAt:collected});
 assert.equal(mid.status,'warn');assert.match(mid.title,/중기예보/);assert.match(mid.detail,/거절/);
 assert.equal(check({source:'openmeteo'}).status,'info');assert.match(check({source:'openmeteo'}).title,/Open-Meteo/);
});
test('diagnostics rendering escapes displayed strings and offers a non-mutating refresh',()=>{
 const esc=x=>String(x).replaceAll('<','&lt;').replaceAll('>','&gt;');const html=diagnosticsHTML({checkedAt:0,checks:[{status:'warn',title:'<script>',detail:'<img>'}]},esc);
 assert.doesNotMatch(html,/<script>|<img>/);assert.match(html,/&lt;script&gt;/);assert.match(html,/diagnostics-refresh/);assert.match(html,/확인 필요/);
});

test('diagnostics report voice intake and missing title search configuration without exposing credentials',()=>{
 const options={demo:false,configured:true,hasToken:true,room:{live:true,settings:{quiet:false}},voiceEnabled:true,youtubeConfigured:false};
 const result=buildDiagnostics(options);
 assert.equal(result.checks.find(c=>c.id==='voice').status,'pass');
 assert.match(result.checks.find(c=>c.id==='youtube').title,/キー|키가 없/);
 assert.equal(buildDiagnostics({...options,youtubeConfigured:true}).checks.find(c=>c.id==='youtube').status,'pass');
});
