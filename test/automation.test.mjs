import test from 'node:test';import assert from 'node:assert/strict';import {Store,Engine} from '../core.mjs';import {setAutomation} from '../automation.mjs';import {restartDelay,recoveryDecision} from '../tools/runtime-policy.mjs';import {findTunnelOrigin} from '../tools/managed-runtime.mjs';
test('operating profile is idempotent, preserves quiet mode and restores settings without overwriting DJ edits',()=>{
 const store=new Store();store.create('a','A');const room=store.load('a');room.settings.quiet=true;room.settings.listenMinutes=12;room.settings.autoQuizEnabled=false;setAutomation(room,true,1000);assert.equal(room.settings.quiet,true);assert.equal(room.settings.listenMinutes,5);assert.equal(room.settings.listenTickets,1);assert.equal(room.settings.listenDailyCap,100);assert.equal(room.settings.autoQuizEnabled,true);const revision=room.settingsRevision;assert.equal(setAutomation(room,true),false);assert.equal(room.settingsRevision,revision);room.settings.listenMinutes=7;setAutomation(room,false);assert.equal(room.settings.listenMinutes,7);assert.equal(room.settings.autoQuizEnabled,false);store.db.close();
});
test('automatic operations commands are DJ-only and create a recoverable settings backup',()=>{
 const store=new Store();store.create('a','A');const engine=new Engine(store);let id=0;const say=(message,dj)=>engine.handle('a',{id:'a'+(++id),message,isDj:dj,user:{id:dj?'dj':'user',nickname:'test'}});
 assert.match(say('!자동운영 on',false).text,/DJ 전용/);assert.match(say('!자동운영 on',true).text,/ON/);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM backups').get().n,1);assert.match(say('!자동운영 상태',true).text,/5분마다 1장/);assert.match(say('!자동운영 off',true).text,/복원/);store.db.close();
});
test('tunnel address is read from cloudflared output, newest wins and the API host is ignored',()=>{
 const output=['INF Requesting new quick Tunnel on trycloudflare.com...','INF POST https://api.trycloudflare.com/tunnel','INF +--------------------------------------------+','INF |  https://alpha-beta-gamma.trycloudflare.com  |','INF Registered tunnel connection connIndex=0'].join('\n');
 assert.equal(findTunnelOrigin(output),'https://alpha-beta-gamma.trycloudflare.com');
 assert.equal(findTunnelOrigin(output+'\nINF |  https://delta-epsilon.trycloudflare.com/ |'),'https://delta-epsilon.trycloudflare.com');
 assert.equal(findTunnelOrigin('POST https://api.trycloudflare.com/tunnel'),'');assert.equal(findTunnelOrigin(''),'');assert.equal(findTunnelOrigin('https://x.trycloudflare.com.evil.test/path'),'');assert.equal(findTunnelOrigin('see https://ok-1.trycloudflare.com.'),'https://ok-1.trycloudflare.com');
});
test('restart policy avoids a restart on one transient failure and exponentially limits crash loops',()=>{
 assert.equal(recoveryDecision({alive:true,healthy:false,failures:0}).action,'wait');assert.equal(recoveryDecision({alive:true,healthy:false,failures:2}).action,'restart');assert.equal(recoveryDecision({alive:false,healthy:false}).action,'restart');assert.equal(recoveryDecision({alive:false,healthy:false,nextStartAt:200,now:100}).action,'wait');assert.equal(recoveryDecision({alive:true,healthy:true,failures:4}).failures,0);assert.equal(restartDelay(0),2000);assert.equal(restartDelay(100),300000);
});
