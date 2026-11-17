import {listenerRoom} from './shared.mjs';
chrome.action.onClicked.addListener(async tab=>{
 let params;
 if(tab.id&&listenerRoom(tab.url)){
  try{await chrome.scripting.executeScript({target:{tabId:tab.id},files:['bridge.js']});params=new URLSearchParams({tab:String(tab.id),room:tab.url});}
  catch{params=new URLSearchParams({error:'방송 화면을 새로고침한 뒤 확장 버튼을 다시 눌러 주세요.'});}
 }else params=new URLSearchParams({error:'스푼 웹에서 청취 중인 방송을 연 뒤 확장 버튼을 눌러 주세요. 방송 목록과 DJ 콘솔에서는 연결하지 않습니다.'});
 await chrome.windows.create({url:chrome.runtime.getURL(`panel.html?${params}`),type:'popup',width:460,height:790});
});
