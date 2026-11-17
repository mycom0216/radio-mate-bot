// Only this app's public offline illustration and stylesheet may be cached.
// Never cache a DJ page, credentials, OAuth callbacks, API data or voice recordings.
const CACHE='radiomate-offline-v1';
const ASSETS=['/offline.html','/pwa.css','/app-icon.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith('radiomate-offline-')&&key!==CACHE)await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  if(ASSETS.includes(url.pathname)&&!url.search){
    event.respondWith(fetch(event.request).catch(()=>caches.match(url.pathname)));return;
  }
  // Auth and voice routes deliberately bypass even the offline fallback.
  if(event.request.mode==='navigate'&&!url.search&&['/','/player'].includes(url.pathname)){
    event.respondWith(fetch(event.request).catch(()=>caches.match('/offline.html')));
  }
});
