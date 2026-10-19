import {createCloudSync} from '../cloud-sync.js';
import {backendFixture, sampleState, sampleTask} from './backend-fixture.js';

export {sampleState, sampleTask};

export class MemoryStorage {
  constructor(entries = []) { this.data = new Map(entries); }
  get length() { return this.data.size; }
  key(index) { return [...this.data.keys()][index] ?? null; }
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
  entries() { return [...this.data.entries()]; }
}

export function syncService() {
  const backend = backendFixture(), calls = [];
  async function fetcher(url, options = {}) {
    const path = new URL(url, 'https://momentum-my-second-brain.void-mag-inv-5623.chatgpt.site').pathname.replace(/^\/api/, '');
    const body = options.body === undefined ? undefined : JSON.parse(options.body);
    calls.push({path, method: options.method || 'GET', body, headers: options.headers});
    const token = options.headers?.Authorization?.replace(/^Bearer /, '');
    const result = await backend.request(options.method || 'GET', path, body, token);
    return new Response(JSON.stringify(result.body), {status: result.status, headers: {'Content-Type': 'application/json'}});
  }
  return {...backend, calls, fetcher};
}

export function syncClient(service, {storage = new MemoryStorage(), state = sampleState(), fetcher = service.fetcher} = {}) {
  let current = structuredClone(state), online = true;
  const states = [], statuses = [], connections = [];
  const bridge = createCloudSync({
    apiBase: '/api', storage,
    fetcher: async (...args) => { if (!online) throw new TypeError('offline'); return fetcher(...args); },
    getState: () => current,
    onState: (next, envelope) => { current = next; states.push({state: structuredClone(next), envelope}); },
    onStatus: status => statuses.push(status),
    onConnection: connection => connections.push(connection),
  });
  return {
    bridge, storage, states, statuses, connections,
    get state() { return current; },
    set state(value) { current = value; },
    offline() { online = false; }, online() { online = true; },
    edit(change) { const next = structuredClone(current); change(next); current = next; return bridge.save(next); },
  };
}

export async function connectedPair(service, state = sampleState()) {
  const left = syncClient(service, {state}), right = syncClient(service);
  await left.bridge.start(); await right.bridge.start();
  await left.bridge.create({state, role: 0, zone: 'Asia/Manila', deviceName: 'Black laptop'});
  const {invite} = await left.bridge.invite();
  await right.bridge.join({invite, deviceName: 'Pink phone'});
  await left.bridge.pull();
  return {left, right};
}

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
