/* Sudoku service worker
   - Always tries the internet first for the game itself, so a new commit shows up the next time
     the app is opened. The saved copy is only used when offline (or the connection is very slow).
   - You never need to edit this file or bump a version number when you update index.html.
   - Only touches caches it made itself, so other games on the same github.io site are left alone. */

const CACHE = 'sudoku-app:' + self.registration.scope;
const PAGE = new URL('index.html', self.registration.scope).href;
const SHELL = [PAGE, 'manifest.webmanifest', 'icon-192.png', 'icon-180.png', 'icon-512.png'];
const SLOW = 4000;   // ms to wait for the internet before falling back to the saved copy

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u =>
    fetch(new Request(u, {cache: 'no-cache'})).then(r => r.ok && c.put(u === PAGE ? PAGE : new URL(u, self.registration.scope).href, r)).catch(() => {})))));
  self.skipWaiting();                        // take over straight away, no "close all tabs" needed
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // remove caches left by an older sudoku worker: any other cache holding this game's page
    // (caches belonging to other games on the same site hold different pages, so they're kept)
    for (const k of await caches.keys()) {
      if (k === CACHE) continue;
      const c = await caches.open(k);
      if (await c.match(PAGE) || await c.match(self.registration.scope)) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

const isPage = req => req.mode === 'navigate' || req.url.split(/[?#]/)[0] === PAGE;

// Fetch the newest index.html, save it, and say whether it differs from the saved copy
async function refreshPage() {
  const res = await fetch(PAGE, {cache: 'no-cache'});
  if (!res.ok) throw new Error('bad response');
  const cache = await caches.open(CACHE);
  const old = await cache.match(PAGE);
  const [now, before] = await Promise.all([res.clone().text(), old ? old.text() : null]);
  await cache.put(PAGE, res.clone());
  return {res, changed: before !== null && before !== now};
}

async function tellPages() {
  for (const c of await self.clients.matchAll({type: 'window'})) c.postMessage({type: 'updated'});
}

async function servePage() {
  const net = refreshPage();
  const timeout = new Promise(r => setTimeout(r, SLOW));
  const first = await Promise.race([net.then(x => x.res).catch(() => null), timeout]);
  if (first) return first;
  // offline or slow: use the saved copy now, and if the internet catches up with a newer version, reload
  net.then(x => x.changed && tellPages()).catch(() => {});
  const saved = await (await caches.open(CACHE)).match(PAGE);
  return saved || net.then(x => x.res);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.registration.scope)) return;
  if (isPage(req) && req.url.split(/[?#]/)[0].replace(/index\.html$/, '') === self.registration.scope) {
    e.respondWith(servePage());
    return;
  }
  // icons, manifest etc.: saved copy straight away, refreshed in the background
  e.respondWith(caches.open(CACHE).then(async cache => {
    const saved = await cache.match(req);
    const net = fetch(req, {cache: 'no-cache'}).then(r => { if (r.ok) cache.put(req, r.clone()); return r; });
    if (saved) { e.waitUntil(net.catch(() => {})); return saved; }
    return net;
  }));
});

// The page asks "is there something newer?" when it comes back from the background
self.addEventListener('message', e => {
  if (!e.data || e.data.type !== 'check') return;
  e.waitUntil(refreshPage().then(x => { if (x.changed) e.source.postMessage({type: 'updated'}); }).catch(() => {}));
});
