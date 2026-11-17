import test from 'node:test';import assert from 'node:assert/strict';
import {spoonChargeReply,spoonChargeUrl,DEFAULT_CHARGE_NOTICE,LEGACY_CHARGE_NOTICE} from '../public/spoon-charge.mjs';
import {Store,Engine} from '../core.mjs';
test('charge reply always keeps the official URL and price-condition disclaimer within 200 UTF-16 code units',()=>{
 for(const region of ['kr','jp'])for(const notice of [DEFAULT_CHARGE_NOTICE,LEGACY_CHARGE_NOTICE,'안내'.repeat(100),'💗'.repeat(200)]){
 const text=spoonChargeReply(notice,region);assert.ok(text.length<=200);assert.ok(text.endsWith(spoonChargeUrl(region)));assert.match(text,/최종 금액/);assert.doesNotMatch(text,/refresh_token|access_token/);
 }
 assert.throws(()=>spoonChargeUrl('us'));
});
test('charge command works without a profile for listeners and DJs and chooses the configured region',()=>{
 for(const region of ['kr','jp']){const s=new Store();try{s.create('a','A');const e=new Engine(s,{region});
 const listener=e.handle('a',{id:'l',message:'!스푼',user:{id:'listener',nickname:'청취자'}});assert.ok(listener.text.includes(spoonChargeUrl(region)));assert.ok(listener.text.includes(DEFAULT_CHARGE_NOTICE));
 const dj=e.handle('a',{id:'d',message:'!스푼',isDj:true,user:{id:'dj',nickname:'DJ'}});assert.ok(dj.text.includes(spoonChargeUrl(region)));assert.equal(Object.keys(s.load('a').users).length,0);
 }finally{s.db.close();}}
});
