import test from 'node:test';import assert from 'node:assert/strict';
import {Store,Engine} from '../core.mjs';
import {temperatureEvent,temperatureLabel,temperatureRank,temperatureSummary} from '../public/affinity.mjs';

const at=Date.parse('2026-11-22T03:00:00Z');
const event=(value,time=at)=>({type:'JOIN',user:{id:'u',nickname:'청취자'},favoriteTemperature:value,time:new Date(time).toISOString()});
test('official temperature preserves decimals and zero and never treats unavailable data as zero',()=>{
 for(const value of [0,36.5,98.765]){const u={spoonTemperature:temperatureEvent(event(value),at)};assert.equal(temperatureLabel(u),value+'°');assert.match(temperatureSummary(u),/수신.*입장값/);}
 assert.equal(temperatureLabel({}),'미수신');assert.equal(temperatureLabel({spoonTemperature:temperatureEvent(event(null),at)}),'스푼 미제공');
 for(const value of ['36.5',undefined,-1,Infinity,NaN])assert.equal(temperatureEvent(event(value),at),null);
 assert.equal(temperatureEvent({...event(36.5),type:'LEAVE'},at),null);assert.equal(temperatureEvent({...event(36.5),time:'bad'},at),null);
});
test('reentry refreshes official values, older events cannot revert them and rooms remain isolated',t=>{
 const store=new Store();t.after(()=>store.db.close());store.create('a','A');store.create('b','B');const engine=new Engine(store,{now:()=>at});
 assert.equal(engine.recordSpoonTemperature('a',event(36.5),at),true);let u=store.load('a').users.u;assert.equal(u.spoonTemperature.value,36.5);
 assert.equal(engine.recordSpoonTemperature('a',event(38,at+1000),at+1000),true);assert.equal(engine.recordSpoonTemperature('a',event(12,at),at+2000),false);
 u=store.load('a').users.u;assert.equal(u.spoonTemperature.value,38);assert.equal(u.spoonTemperature.receivedAt,at+1000);assert.equal(store.load('b').users.u,undefined);
 assert.equal(engine.recordSpoonTemperature('a',event(null,at+3000),at+3000),true);assert.equal(temperatureLabel(store.load('a').users.u),'스푼 미제공');
 assert.equal(engine.recordSpoonTemperature('a',event(undefined,at+4000),at+4000),false);
 assert.equal(engine.recordSpoonTemperature('b',event(9),at),true);assert.equal(store.load('b').users.u.spoonTemperature.value,9);
});
test('temperature commands and profile use the received official value independently of internal points',t=>{
 const store=new Store();t.after(()=>store.db.close());store.create('r','R');let now=at;const engine=new Engine(store,{now:()=>now});
 engine.recordSpoonTemperature('r',event(36.5),now);store.transaction('r',r=>{r.users.u.listeningMs=999*60000;r.settings.cooldown=0;r.settings.responseGap=0;});
 const say=message=>engine.handle('r',{id:String(++now),message,isDj:true,user:{id:'u',nickname:'청취자'}}).text;
 assert.match(say('!애청온도'),/스푼 애청온도 36\.5°/);assert.match(say('!온도'),/입장/);assert.match(say('!내정보'),/스푼 애청온도 36\.5°/);assert.match(say('!애청지수'),/999점/);assert.ok(!say('!애청지수').includes('°'));
 const unknown=engine.handle('r',{id:'unknown',message:'!애청온도',isDj:true,user:{id:'unknown',nickname:'미수신'}});assert.match(unknown.text,/미수신/);
});
test('temperature display order places known received values before unavailable values without fabricating a ranking',()=>{
 const users={a:{id:'a'},b:{id:'b',spoonTemperature:temperatureEvent(event(0),at)},c:{id:'c',spoonTemperature:temperatureEvent(event(36.5),at)},d:{id:'d',spoonTemperature:temperatureEvent(event(null),at)}};
 assert.deepEqual(temperatureRank(users).map(u=>u.id),['c','b','a','d']);
});
