// Runs only after the listener invokes activeTab. No cookies, chat history, API or send action.
(()=>{
 if(globalThis.__radioMateListenerBridge)return;globalThis.__radioMateListenerBridge=true;
 let selected=null,picking=false,timer=null;const seen=new Map();
 const validRoom=url=>{try{const u=new URL(url);return u.protocol==='https:'&&['www.spooncast.net','spooncast.net'].includes(u.hostname)&&!u.port&&/^\/kr\/live\/[^/]+\/?$/.test(u.pathname);}catch{return false;}};
 function editable(el){return el instanceof HTMLElement&&(el instanceof HTMLTextAreaElement||el instanceof HTMLInputElement&&el.type==='text'||el.isContentEditable)&&!el.disabled&&!el.readOnly&&el.getAttribute('aria-disabled')!=='true'&&el.getBoundingClientRect().width>0;}
 const value=el=>el.isContentEditable?el.textContent:el.value;
 function endPick(){picking=false;clearTimeout(timer);document.removeEventListener('click',pick,true);document.removeEventListener('keydown',cancel,true);document.getElementById('radio-mate-pick-note')?.remove();}
 function cancel(e){if(e.key==='Escape')endPick();}
 function pick(e){
  const el=e.target.closest('textarea,input,[contenteditable="true"],[contenteditable="plaintext-only"]');if(!editable(el))return;
  e.preventDefault();e.stopImmediatePropagation();selected={el,url:location.href};endPick();el.focus();
 }
 function beginPick(){
  endPick();picking=true;const note=document.createElement('div');note.id='radio-mate-pick-note';note.textContent='♡ Radio Mate: 청취자 채팅 입력창을 한 번 눌러 주세요 · Esc 취소';
  Object.assign(note.style,{position:'fixed',top:'12px',left:'50%',transform:'translateX(-50%)',zIndex:'2147483647',background:'#fff4fa',color:'#803859',border:'2px solid #bc739b',borderRadius:'18px',padding:'16px',font:'14px sans-serif',maxWidth:'90vw',pointerEvents:'none'});
  document.documentElement.append(note);document.addEventListener('click',pick,true);document.addEventListener('keydown',cancel,true);timer=setTimeout(endPick,30000);
 }
 chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==chrome.runtime.id||message?.namespace!=='radio-mate-listener')return;
  try{
   if(!validRoom(location.href)||message.room!==location.href)throw Error('방송 주소가 바뀌었습니다. 해당 방송에서 확장 버튼을 다시 눌러 주세요.');
   if(message.action==='pick'){beginPick();reply({ok:true});return;}
   if(message.action==='status'){
    if(!selected||selected.url!==location.href||!selected.el.isConnected){const candidates=[...document.querySelectorAll('textarea[placeholder="대화를 입력하세요."]')].filter(editable);if(candidates.length===1)selected={el:candidates[0],url:location.href};}
    reply({ok:true,selected:!!selected&&selected.url===location.href&&selected.el.isConnected&&editable(selected.el),picking});return;
   }
   if(message.action!=='insert')return;
   if(typeof message.requestId!=='string'||message.requestId.length>100)throw Error('입력 요청을 확인하세요.');
   if(seen.has(message.requestId)){const prior=seen.get(message.requestId);if(prior.text!==message.text)throw Error('같은 요청 번호의 문장이 달라졌습니다. 다시 인식해 주세요.');reply({ok:true,duplicate:true});return;}
   if(!selected||selected.url!==location.href||!selected.el.isConnected||!editable(selected.el))throw Error('채팅 입력창을 다시 선택해 주세요. 로그인 또는 채팅 제한 상태도 확인해 주세요.');
   const el=selected.el,text=String(message.text||'').trim();if(!text)throw Error('입력할 문장이 없습니다.');
   const current=value(el),max=el.maxLength>0?Math.min(el.maxLength,200):200,next=current?`${current}${/\s$/.test(current)?'':' '}${text}`:text;
   if(next.length>max)throw Error(`채팅 ${max}자 한도를 넘었습니다. 기존 글을 줄인 뒤 다시 입력해 주세요.`);
   el.focus();
   if(el.isContentEditable){if(el.children.length)throw Error('복잡한 편집기는 자동 입력을 지원하지 않습니다. 문장을 복사해 붙여넣어 주세요.');el.textContent=next;}
   else{const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,next);}
   el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));el.dispatchEvent(new Event('change',{bubbles:true}));
   if(value(el)!==next)throw Error('입력창이 변경을 허용하지 않았습니다. 인식 문장을 복사해 직접 붙여넣어 주세요.');
   seen.set(message.requestId,{text:message.text});if(seen.size>100)seen.delete(seen.keys().next().value);
   reply({ok:true,inserted:text.length});
  }catch(error){reply({ok:false,error:error.message});}
 });
})();
