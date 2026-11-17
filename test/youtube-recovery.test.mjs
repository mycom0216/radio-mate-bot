import test from 'node:test';
import assert from 'node:assert/strict';
import {YouTubePlayer} from '../public/youtube-player.mjs';
function environment(t){
 const original={YT:globalThis.YT,document:globalThis.document,location:globalThis.location};
 class Node{constructor(tag='DIV'){this.tagName=tag;this.id='';this.parentNode=null;this.children=[];}get nextSibling(){const i=this.parentNode?.children.indexOf(this);return this.parentNode?.children[i+1]||null;}append(n){n.parentNode=this;this.children.push(n);}insertBefore(n,next){n.parentNode=this;this.children.splice(this.children.indexOf(next),0,n);}remove(){if(this.parentNode){const i=this.parentNode.children.indexOf(this);this.parentNode.children.splice(i,1);this.parentNode=null;}}}
 const parent=new Node(),host=new Node();host.id='youtube-player';parent.append(host);const actions=new Node();parent.append(actions);
 const document={getElementById:id=>parent.children.find(n=>n.id===id)||null,createElement:tag=>new Node(tag.toUpperCase())};
 const players=[];let failConstructor=false;
 class Player{constructor(id,options){if(failConstructor){failConstructor=false;throw Error('failed constructor');}const h=document.getElementById(id);if(!h)throw Error('player host missing');this.iframe=new Node('IFRAME');this.iframe.id=id;parent.insertBefore(this.iframe,h);h.remove();this.events=options.events;players.push(this);}destroy(){this.iframe.remove();}getVideoData(){return {video_id:this.videoId};}loadVideoById(id){this.videoId=id;}playVideo(){}pauseVideo(){}}
 globalThis.YT={Player,PlayerState:{PLAYING:1,ENDED:0,PAUSED:2}};globalThis.document=document;globalThis.location={origin:'http://localhost:4310'};
 t.after(()=>{for(const [key,value]of Object.entries(original))if(value===undefined)delete globalThis[key];else globalThis[key]=value;});
 const statuses=[],errors=[];const player=new YouTubePlayer({onEnd:()=>{},onError:x=>errors.push(x),onStatus:x=>statuses.push(x),readyTimeoutMs:10});
 return {player,players,parent,document,actions,statuses,errors,failNext:()=>failConstructor=true};
}
test('timed out player restores its host and can successfully retry without reloading the page',async t=>{
 const f=environment(t);await assert.rejects(()=>f.player.load('M7lc1UVf-VE',()=>true,'one'),/준비 시간/);
 assert.equal(f.document.getElementById('youtube-player').tagName,'DIV');assert.equal(f.parent.children[1],f.actions);
 const retry=f.player.load('M7lc1UVf-VE',()=>true,'one');await new Promise(resolve=>setImmediate(resolve));
 f.players[1].events.onReady();await retry;assert.equal(f.players[1].videoId,'M7lc1UVf-VE');
 f.players[0].events.onStateChange({data:1});assert.equal(f.statuses.length,0);
});
test('synchronous player creation failure is retryable and never leaves a rejected readiness promise cached',async t=>{
 const f=environment(t);f.failNext();await assert.rejects(()=>f.player.load('M7lc1UVf-VE',()=>true,'one'));
 const retry=f.player.load('M7lc1UVf-VE',()=>true,'one');await new Promise(resolve=>setImmediate(resolve));
 f.players[0].events.onReady();await retry;assert.equal(f.players[0].videoId,'M7lc1UVf-VE');
});

test('new player resumes only a saved matching request and clears checkpoint on completion',async t=>{
 const f=environment(t),writes=[];let cleared=0;
 f.player.checkpoint={read:(song,video)=>song==='saved'&&video==='M7lc1UVf-VE'?42:0,write:(...args)=>writes.push(args),clear:()=>cleared++};
 const pending=f.player.load('M7lc1UVf-VE',()=>true,'saved');await new Promise(resolve=>setImmediate(resolve));
 const native=f.players[0];let loaded;
 native.loadVideoById=value=>{loaded=value;native.videoId=typeof value==='string'?value:value.videoId;};
 native.getCurrentTime=()=>57;
 native.events.onReady();await pending;
 assert.deepEqual(loaded,{videoId:'M7lc1UVf-VE',startSeconds:42});
 native.events.onStateChange({data:1});f.player.pause();assert.deepEqual(writes.at(-1),['saved','M7lc1UVf-VE',57]);
 native.events.onStateChange({data:1});native.events.onStateChange({data:0});assert.equal(cleared,1);
 const count=writes.length;f.player.pause();assert.equal(writes.length,count);
});
