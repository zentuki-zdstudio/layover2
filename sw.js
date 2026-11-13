/* Only static same-origin app files are cached. Never cache authentication or Supabase API responses. */
const CACHE = 'layover-live-static-v3';
const STATIC = ['./','./index.html','./styles.css','./app.js','./config.js','./manifest.webmanifest','./assets/icon.svg','./assets/icon-192.png','./assets/icon-512.png'];
self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(STATIC)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET' || new URL(e.request.url).origin!==self.location.origin) return;
  e.respondWith(fetch(e.request).then(r=>{
    if(r.ok && new URL(e.request.url).pathname.startsWith(new URL(self.registration.scope).pathname)){
      const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});
    }
    return r;
  }).catch(()=>caches.match(e.request)));
});
