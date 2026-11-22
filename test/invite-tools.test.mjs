import test from 'node:test';
import assert from 'node:assert/strict';
import {callToken,portableCallUrl,watchConnection,copyCallUrl} from '../public/invite-tools.mjs';

test('moving a call link to another device preserves its capability and removes incidental query strings',()=>{
 const token='a'.repeat(43),origin='https://radio.example';
 for(const path of ['/call/'+token,'/call/'+token+'/']){assert.equal(callToken(path),token);assert.equal(portableCallUrl({origin,pathname:path,search:'?from=chat'}),origin+'/call/'+token);}
 assert.equal(portableCallUrl({origin,pathname:'/invite'}),origin+'/invite');assert.equal(callToken('/call/invalid'),null);
});
test('blocked or missing mobile clipboard leaves a selectable complete call link',async()=>{
 let selected=0;const field={hidden:true,value:'',focus(){},select(){selected++;},setSelectionRange(start,end){assert.equal(start,0);assert.equal(end,this.value.length);}};
 const url='https://radio.example/call/'+'b'.repeat(43);
 for(const clipboard of [null,{writeText:async()=>{throw Error('permission denied');}}]){assert.equal(await copyCallUrl(url,field,{clipboard}),false);assert.equal(field.value,url);assert.equal(field.hidden,false);}
 assert.equal(selected,2);let copied;assert.equal(await copyCallUrl(url,field,{clipboard:{writeText:async value=>copied=value}}),true);assert.equal(copied,url);
});
test('Safari page restoration resumes one timer and visibility/network changes refresh state',()=>{
 const page=new EventTarget(),doc=new EventTarget();doc.hidden=false;
 let active=0,calls=0;const stop=watchConnection(()=>calls++,{page,doc,setTimer:()=>{active++;return 1;},clearTimer:()=>active--});
 assert.equal(active,1);assert.equal(calls,1);
 page.dispatchEvent(new Event('pagehide'));assert.equal(active,0);
 page.dispatchEvent(new Event('pageshow'));assert.equal(active,1);assert.equal(calls,2);
 page.dispatchEvent(new Event('pageshow'));assert.equal(active,1);
 doc.hidden=true;const previous=calls;doc.dispatchEvent(new Event('visibilitychange'));assert.equal(calls,previous);
 doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));page.dispatchEvent(new Event('online'));assert.equal(calls,previous+2);
 stop();assert.equal(active,0);page.dispatchEvent(new Event('pageshow'));assert.equal(active,0);
});
