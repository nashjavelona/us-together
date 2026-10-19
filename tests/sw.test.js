import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const origin = 'https://nashjavelona.github.io';
const projectScope = `${origin}/us-together/`;
const prefixFor = scope => `us-together:${scope}:`;
const cacheFor = scope => `${prefixFor(scope)}v9`;

function worker({scope = projectScope, entries = new Map(), saved, network, writeError} = {}) {
  const handlers = {};
  const calls = {opened: [], deleted: [], added: [], put: [], matched: [], fetched: [], skipped: 0, claimed: 0};
  const defaultResponse = new Response('application asset');
  vm.runInNewContext(source, {
    URL,
    self: {
      registration: {scope},
      location: {origin: new URL(scope).origin},
      addEventListener(type, handler) { handlers[type] = handler; },
      async skipWaiting() { calls.skipped++; },
      clients: {async claim() { calls.claimed++; }},
    },
    caches: {
      async open(key) {
        calls.opened.push(key);
        return {
          async addAll(urls) { calls.added.push(...urls); },
          async put(request, response) {
            if (writeError) throw writeError;
            calls.put.push({key, request, response});
          },
          async match(request) {
            const url = typeof request === 'string' ? request : request.url;
            calls.matched.push({key, url});
            return key === cacheFor(scope) ? saved : entries.get(key)?.get(url);
          },
        };
      },
      async keys() { return [...entries.keys()]; },
      async delete(key) { calls.deleted.push(key); return entries.delete(key); },
      async match() { throw Error('Origin-wide cache matching must not be used'); },
    },
    async fetch(request) {
      calls.fetched.push(request);
      return network ? network(request) : defaultResponse;
    },
  });

  function dispatch(type, request) {
    const pending = [];
    const event = {
      request, intercepted: false, response: undefined,
      waitUntil(promise) { pending.push(promise); },
      respondWith(promise) { this.intercepted = true; this.response = promise; },
      async finish() { await Promise.all(pending); },
    };
    handlers[type](event);
    return event;
  }
  return {calls, dispatch, defaultResponse};
}

test('install precaches the complete static module shell at root or project scope', async () => {
  const assets = ['', 'index.html', 'style.css', 'app.js', 'core.js', 'calendar.js',
    'couple.js', 'together.js', 'ui-model.js', 'cloud-sync.js', 'sync-model.js',
    'cloud-ui.js', 'for-you.js', 'cloud-config.js', 'icon.svg', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest'];
  for (const scope of [`${origin}/`, projectScope]) {
    const w = worker({scope});
    await w.dispatch('install').finish();
    assert.deepEqual(w.calls.opened, [cacheFor(scope)]);
    assert.deepEqual(w.calls.added, assets.map(asset => `${scope}${asset}`));
    assert.equal(w.calls.skipped, 1);
  }
});

test('activation removes only older scoped caches and preserves unrelated projects', async () => {
  const oldOwn = `${prefixFor(projectScope)}v3`;
  const previous = `${prefixFor(projectScope)}v4`;
  const previousRelease = `${prefixFor(projectScope)}v8`;
  const preserved = ['portfolio-v1', 'other-project-v2', `${prefixFor(`${origin}/other-couple/`)}v3`, cacheFor(projectScope)];
  const w = worker({entries: new Map([...preserved, oldOwn, previous, previousRelease].map(key => [key, new Map()]))});
  await w.dispatch('activate').finish();
  assert.deepEqual(w.calls.deleted, [oldOwn, previous, previousRelease]);
  assert.equal(w.calls.claimed, 1);
});

test('legacy cache cleanup requires this scope’s shell and leaves foreign legacy caches intact', async () => {
  const ownShell = new Map([[`${projectScope}index.html`, {}], [`${projectScope}app.js`, {}], [`${origin}/api/state`, {private: true}]]);
  const foreignShell = new Map([[`${origin}/another/index.html`, {}], [`${origin}/another/app.js`, {}]]);
  const entries = new Map([
    ['us-together-v1', new Map(ownShell)], ['us-together-v6', new Map(ownShell)],
    ['us-together-v5', foreignShell], ['us-together-v99', new Map(ownShell)],
    ['portfolio-v1', new Map(ownShell)],
  ]);
  const w = worker({entries});
  await w.dispatch('activate').finish();
  assert.deepEqual(w.calls.deleted.sort(), ['us-together-v1', 'us-together-v6']);
  assert.ok(entries.has('us-together-v5'));
  assert.ok(entries.has('portfolio-v1'));
});

test('an allowlisted asset uses the network and writes only its own scoped cache', async () => {
  const w = worker(), request = new Request(`${projectScope}calendar.js`);
  const event = w.dispatch('fetch', request);
  assert.equal(event.intercepted, true);
  assert.equal(await event.response, w.defaultResponse);
  await event.finish();
  assert.deepEqual(w.calls.fetched, [request]);
  assert.deepEqual(w.calls.opened, [cacheFor(projectScope)]);
  assert.equal(w.calls.put[0].key, cacheFor(projectScope));
  assert.equal(w.calls.put[0].request, request);
});

test('arbitrary same-origin GETs, other projects, other origins and non-GETs are ignored', () => {
  const w = worker();
  const requests = [
    new Request(`${origin}/portfolio/data.json`),
    new Request(`${origin}/us-together-copy/app.js`),
    new Request(`${projectScope}private.json`),
    new Request(`${projectScope}Us-Together-Source.zip`),
    new Request('https://fonts.googleapis.com/css2?family=DM+Sans'),
    new Request(`${projectScope}app.js`, {method: 'POST'}),
    new Request(`${projectScope}app.js`, {method: 'HEAD'}),
  ];
  for (const request of requests) assert.equal(w.dispatch('fetch', request).intercepted, false);
  assert.deepEqual(w.calls.fetched, []);
  assert.deepEqual(w.calls.opened, []);
});

test('public and authenticated API requests never enter the worker at either scope', () => {
  for (const scope of [`${origin}/`, projectScope]) {
    const w = worker({scope});
    for (const url of [`${origin}/api/state`, `${origin}/api/history/secret`, `${scope}api/state`, `${origin}/api/health`]) {
      for (const headers of [{}, {Authorization: 'Bearer test-only-capability'}]) {
        assert.equal(w.dispatch('fetch', new Request(url, {headers})).intercepted, false);
      }
    }
    assert.deepEqual(w.calls.fetched, []);
    assert.deepEqual(w.calls.opened, []);
    assert.deepEqual(w.calls.matched, []);
  }
});

test('Authorization also disables interception for an otherwise allowlisted asset', () => {
  const w = worker();
  const event = w.dispatch('fetch', new Request(`${projectScope}app.js`, {headers: {authorization: 'Bearer test-only-capability'}}));
  assert.equal(event.intercepted, false);
  assert.deepEqual(w.calls.fetched, []);
  assert.deepEqual(w.calls.opened, []);
});

test('offline asset fallback matches only the current app cache', async () => {
  const saved = new Response('cached asset');
  const w = worker({saved, network() { throw Error('Offline'); }});
  const event = w.dispatch('fetch', new Request(`${projectScope}ui-model.js`));
  assert.equal(await event.response, saved);
  assert.deepEqual(w.calls.opened, [cacheFor(projectScope)]);
  assert.deepEqual(w.calls.matched, [{key: cacheFor(projectScope), url: `${projectScope}ui-model.js`}]);
});

test('offline API requests cannot return a previously cached private response', () => {
  const w = worker({scope: `${origin}/`, saved: new Response('{"private":"state"}'), network() { throw Error('Offline'); }});
  const event = w.dispatch('fetch', new Request(`${origin}/api/state`));
  assert.equal(event.intercepted, false);
  assert.deepEqual(w.calls.matched, []);
  assert.deepEqual(w.calls.opened, []);
});

test('no-store responses are returned without writing an application cache', async () => {
  const privateResponse = new Response('do not store', {headers: {'Cache-Control': 'private, no-store'}});
  const w = worker({network() { return privateResponse; }});
  const event = w.dispatch('fetch', new Request(`${projectScope}app.js`));
  assert.equal(await event.response, privateResponse);
  await event.finish();
  assert.deepEqual(w.calls.put, []);
  assert.deepEqual(w.calls.opened, []);
});

test('cache write failure does not discard a successful network response', async () => {
  const w = worker({writeError: Error('Storage full')});
  const event = w.dispatch('fetch', new Request(`${projectScope}app.js`));
  assert.equal(await event.response, w.defaultResponse);
  await assert.doesNotReject(event.finish());
});

test('HTTP failures remain uncached network responses', async () => {
  const unavailable = new Response('temporarily unavailable', {status: 503});
  const w = worker({network() { return unavailable; }});
  const event = w.dispatch('fetch', new Request(`${projectScope}app.js`));
  assert.equal(await event.response, unavailable);
  await event.finish();
  assert.deepEqual(w.calls.opened, []);
  assert.deepEqual(w.calls.put, []);
});
