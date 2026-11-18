import test from 'node:test';
import assert from 'node:assert/strict';
import {AIChat} from '../ai-chat.mjs';
import {Store} from '../core.mjs';
test('AI uses Responses API with bounded private context and no server credentials in payload',async()=>{
 const store=new Store();store.create('a','A');store.create('b','B');let now=Date.now(),calls=[];
 const ai=new AIChat({key:'secret-test',now:()=>now,fetcher:async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(options.headers.Authorization,'Bearer secret-test');const data=JSON.parse(options.body);assert.equal(data.store,false);assert.equal(data.model,'gpt-4.1-mini');assert.ok(!options.body.includes('secret-test'));calls.push(data);return {ok:true,json:async()=>({output:[{type:'message',content:[{type:'output_text',text:'안녕하세요!'}]}]})};}});
 const context={store,room:'a',user:'dj',channel:'app'};assert.equal(await ai.answer('안녕',context),'안녕하세요!');assert.equal(calls[0].input.length,1);await assert.rejects(ai.answer('또 질문',context),/10초/);now+=11000;
 await ai.answer('내가 뭐라고 했지?',context);assert.equal(calls[1].input.length,3);assert.equal(ai.history({...context,room:'b'}).length,0);assert.equal(ai.history({...context,user:'other'}).length,0);assert.equal(store.load('a').aiUsage.count,2);ai.reset(context);assert.equal(ai.history(context).length,0);store.db.close();
});
test('AI missing key, upstream errors and daily quotas are explicit and do not fabricate replies',async()=>{
 const store=new Store();store.create('a','A');const context={store,room:'a',user:'u',channel:'spoon'};
 await assert.rejects(new AIChat().answer('안녕',context),/API 키/);
 let now=Date.now();const ai=new AIChat({key:'test',dailyLimit:1,now:()=>now,fetcher:async()=>({ok:false,status:429})});await assert.rejects(ai.answer('안녕',context),/크레딧/);assert.equal(ai.history(context).length,0);now+=11000;await assert.rejects(ai.answer('재시도',context),/방송의 AI 호출 한도/);store.db.close();
});
test('anonymous public previews cannot spend the configured OpenAI key',async()=>{
 const store=new Store();store.create('preview-room','공개 테스트');store.transaction('preview-room',r=>r.demo=true);let calls=0;const ai=new AIChat({key:'test',fetcher:async()=>{calls++;throw Error('must not fetch');}});
 await assert.rejects(ai.answer('안녕',{store,room:'preview-room',user:'guest',channel:'spoon'}),/공개 테스트/);assert.equal(calls,0);assert.equal(store.load('preview-room').aiUsage,undefined);store.db.close();
});
