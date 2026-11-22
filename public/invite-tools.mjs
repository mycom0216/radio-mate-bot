export function callToken(path){return /^\/call\/([A-Za-z0-9_-]{43})\/?$/.exec(path)?.[1]||null;}
export function portableCallUrl(location){const token=callToken(location.pathname);return new URL(token?'/call/'+token:'/invite',location.origin).href;}

// pagehide also fires when Safari puts a page into its back/forward cache.
export function watchConnection(check,{page=window,doc=document,every=3000,setTimer=setInterval,clearTimer=clearInterval}={}){
  let timer=null;
  const refresh=()=>{if(!doc.hidden)void check();};
  const start=()=>{if(timer===null)timer=setTimer(refresh,every);refresh();};
  const stop=()=>{if(timer!==null)clearTimer(timer);timer=null;};
  page.addEventListener('pageshow',start);page.addEventListener('pagehide',stop);
  page.addEventListener('online',refresh);doc.addEventListener('visibilitychange',refresh);start();
  return ()=>{stop();page.removeEventListener('pageshow',start);page.removeEventListener('pagehide',stop);page.removeEventListener('online',refresh);doc.removeEventListener('visibilitychange',refresh);};
}

export async function copyCallUrl(value,field,{clipboard=globalThis.navigator?.clipboard}={}){
  field.value=value;field.hidden=false;
  if(clipboard?.writeText)try{await clipboard.writeText(value);return true;}catch{}
  field.focus();field.select();field.setSelectionRange?.(0,value.length);return false;
}
