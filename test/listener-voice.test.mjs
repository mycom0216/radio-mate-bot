import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {listenerRoom,appendTranscript} from '../extensions/listener-voice/shared.mjs';
import {ListenerSpeech} from '../extensions/listener-voice/speech.mjs';
test('listener helper restricts targets to Spoon Korean broadcast pages and preserves existing drafts',()=>{
 for(const url of ['https://www.spooncast.net/kr/live/@test','https://spooncast.net/kr/live/1234'])assert.equal(listenerRoom(url),true);
 for(const url of ['https://www.spooncast.net/kr/live','https://www.spooncast.net/kr/console','http://www.spooncast.net/kr/live/a','https://spooncast.net.evil.example/kr/live/a','https://www.spooncast.net:444/kr/live/a'])assert.equal(listenerRoom(url),false);
 assert.equal(appendTranscript('안녕','방송 잘 들어요'),'안녕 방송 잘 들어요');assert.equal(appendTranscript('안녕 ','반가워요'),'안녕 반가워요');
 assert.throws(()=>appendTranscript('x'.repeat(198),'하이'),/200/);assert.throws(()=>appendTranscript('','  '),/없습니다/);
});
class Recognition {
 static instances=[];constructor(){Recognition.instances.push(this);}start(){this.started=true;}abort(){this.aborted=true;}
}
const result=(text,isFinal)=>Object.assign([{transcript:text}],{isFinal});
test('speech only commits finalized text once and deduplicates repeated final recognition events',()=>{
 const committed=[],drafts=[],statuses=[];const speech=new ListenerSpeech({Recognition,onDraft:x=>drafts.push(x),onStatus:x=>statuses.push(x),onDone:x=>committed.push(x)});
 speech.start();const r=Recognition.instances.at(-1);assert.equal(r.lang,'ko-KR');assert.equal(r.continuous,false);
 r.onresult({resultIndex:0,results:[result('임시',false)]});assert.equal(committed.length,0);
 const final={resultIndex:0,results:[result('안녕하세요',true)]};r.onresult(final);r.onresult(final);r.onend();
 assert.deepEqual(committed,['안녕하세요']);assert.equal(speech.listening,false);
});
test('cancelled, failed and stale recognition cannot insert text',()=>{
 const committed=[],statuses=[];const speech=new ListenerSpeech({Recognition,onDraft:()=>{},onStatus:x=>statuses.push(x),onDone:x=>committed.push(x)});
 speech.start();const stale=Recognition.instances.at(-1),late=stale.onend;speech.cancel();assert.equal(stale.aborted,true);late();
 speech.start();const current=Recognition.instances.at(-1);current.onresult({resultIndex:0,results:[result('전송하면 안 되는 문장',true)]});current.onerror({error:'network'});current.onend();
 assert.equal(committed.length,0);assert.ok(statuses.some(x=>x.includes('인터넷')));
});
function bridgeFixture(){
 class Element{constructor(){this.disabled=false;this.readOnly=false;this.isConnected=true;this.maxLength=-1;this.events=[];}getBoundingClientRect(){return {width:300};}getAttribute(){return null;}focus(){}dispatchEvent(e){this.events.push(e.type);return true;}}
 class Textarea extends Element{get value(){return this._value||'';}set value(x){this._value=x;}}
 class Input extends Element{}
 const input=new Textarea();let listener;
 const context={HTMLElement:Element,HTMLTextAreaElement:Textarea,HTMLInputElement:Input,location:{href:'https://www.spooncast.net/kr/live/@test'},URL,Event,InputEvent:class extends Event{},setTimeout,clearTimeout,
  document:{querySelectorAll:()=>[input]},chrome:{runtime:{id:'test-extension',onMessage:{addListener:fn=>listener=fn}}}};
 runInNewContext(readFileSync(new URL('../extensions/listener-voice/bridge.js',import.meta.url),'utf8'),context);
 const send=(action,extra={},sender='test-extension')=>{let response;listener({namespace:'radio-mate-listener',room:context.location.href,action,...extra},{id:sender},x=>response=x);return response;};
 send('status');return {input,send,context};
}
test('input bridge appends with native setter, emits input events, deduplicates retry and never submits',()=>{
 const f=bridgeFixture();f.input.value='기존 초안';assert.equal(f.send('insert',{text:'안녕하세요',requestId:'one'}).ok,true);assert.equal(f.input.value,'기존 초안 안녕하세요');assert.deepEqual(f.input.events,['input','change']);
 assert.equal(f.send('insert',{text:'안녕하세요',requestId:'one'}).duplicate,true);assert.equal(f.input.events.length,2);
 assert.equal(f.send('insert',{text:'변경된 문장',requestId:'one'}).ok,false);assert.equal(f.send('insert',{text:'테스트',requestId:'two'},'other-extension'),undefined);
});
test('input bridge refuses disabled, detached, overlength or navigated chat targets without editing them',()=>{
 const f=bridgeFixture();f.input.value='초안';f.input.disabled=true;assert.equal(f.send('insert',{text:'추가',requestId:'1'}).ok,false);f.input.disabled=false;
 f.input.maxLength=3;assert.equal(f.send('insert',{text:'추가',requestId:'2'}).ok,false);assert.equal(f.input.value,'초안');
 f.input.maxLength=-1;f.input.isConnected=false;assert.equal(f.send('insert',{text:'추가',requestId:'3'}).ok,false);
 f.input.isConnected=true;f.context.location.href='https://www.spooncast.net/kr/console';assert.equal(f.send('insert',{text:'추가',requestId:'4'}).ok,false);assert.equal(f.input.value,'초안');
});
