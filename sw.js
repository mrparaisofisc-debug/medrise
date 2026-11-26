const C='medrise-v21';
const CORE=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./landing.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(CORE).catch(()=>{})));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('message',e=>{if(e.data&&e.data.type==='offline-all'){e.waitUntil(caches.open(C).then(async c=>{let n=0;for(const u of e.data.urls){try{if(!(await c.match(u))){const r=await fetch(u);if(r.ok)await c.put(u,r);}}catch(x){}n++;}const cl=await self.clients.matchAll();cl.forEach(x=>x.postMessage({type:'offline-done',n}));}));}});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);
  if(u.origin!==location.origin){e.respondWith(caches.match(r).then(m=>m||fetch(r).then(res=>{if(res.ok&&/fonts\.(googleapis|gstatic)/.test(u.host)){const cp=res.clone();caches.open(C).then(c=>c.put(r,cp));}return res;}).catch(()=>m)));return;}
  if(r.mode==='navigate'||u.pathname.endsWith('.html')||u.pathname.endsWith('/')){e.respondWith(fetch(r.url,{cache:'no-store',credentials:'same-origin'}).then(res=>{const cp=res.clone();caches.open(C).then(c=>c.put('./index.html',cp));return res;}).catch(()=>caches.match('./index.html')));return;}
  e.respondWith(caches.match(r).then(m=>m||fetch(r).then(res=>{if(res.ok){const cp=res.clone();caches.open(C).then(c=>c.put(r,cp));}return res;})));});
