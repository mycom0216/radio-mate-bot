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
 assert.doesNotMatch(JSON.stringify(result),/private-name|private-voice-token|secret/);assert.equal(result.checks.length,8);
});
test('diagnostics rendering escapes displayed strings and offers a non-mutating refresh',()=>{
 const esc=x=>String(x).replaceAll('<','&lt;').replaceAll('>','&gt;');const html=diagnosticsHTML({checkedAt:0,checks:[{status:'warn',title:'<script>',detail:'<img>'}]},esc);
 assert.doesNotMatch(html,/<script>|<img>/);assert.match(html,/&lt;script&gt;/);assert.match(html,/diagnostics-refresh/);assert.match(html,/확인 필요/);
});
