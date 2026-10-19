import {
  cloneJSON, wireState, validateEnvelope, validZone, stateForRole,
  changesBetween, replayChanges, orderIntents, validateChange,
} from './sync-model.js';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const ID = /^[A-Za-z0-9_-]{8,128}$/;
const PREFIX = 'us-together.cloud.v4:';
const MAX_RESPONSE = 1024 * 1024;

export class CloudSyncError extends Error {
  constructor(message, code = 'error', details = {}) {
    super(message);
    this.name = 'CloudSyncError';
    this.code = code;
    Object.assign(this, details);
  }
}

function randomId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return secret();
}

function secret() {
  if (typeof globalThis.crypto?.getRandomValues !== 'function') throw new CloudSyncError('This browser needs a secure connection to create a shared space.', 'crypto-unavailable');
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let result = '', bits = 0, value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 6) { bits -= 6; result += alphabet[(value >>> bits) & 63]; }
  }
  if (bits) result += alphabet[(value << (6 - bits)) & 63];
  return result;
}

function defaultStorage() { try { return globalThis.localStorage; } catch { return null; } }
function defaultFetch() { return typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null; }
const timestamp = value => (Number.isFinite(value) && value >= 0) || (typeof value === 'string' && value.length < 100 && Number.isFinite(Date.parse(value)));
const opaqueId = value => typeof value === 'string' && value.length > 0 && value.length <= 200;

function endpoint(input) {
  const base = String(input || '/api').replace(/\/+$/, '');
  if (base.startsWith('/') && !base.startsWith('//') && !/[?#\\]/.test(base) && base.endsWith('/api')) return base;
  let url;
  try { url = new URL(base); } catch { throw new CloudSyncError('The shared-space service address is invalid.', 'invalid-endpoint'); }
  if (url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/api') ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new CloudSyncError('The shared-space service must use its configured secure API address.', 'invalid-endpoint');
  }
  return url.href.replace(/\/+$/, '');
}

/** No module-level browser access: usable in local-only mode, Node tests and static exports. */
export function createCloudSync({getState, onState, onStatus, storage = defaultStorage(), fetcher = defaultFetch(), apiBase = '/api', onConnection} = {}) {
  if (typeof getState !== 'function') throw new TypeError('createCloudSync requires getState.');
  const baseURL = endpoint(apiBase), namespace = PREFIX + encodeURIComponent(baseURL) + ':';
  const credentialsKey = namespace + 'credentials', handshakeKey = namespace + 'handshake';
  const lockName = namespace + 'network';
  let credentials = null, accepted = null, view = null, intents = [], conflicts = [], clockSample = null;
  let started = false, generation = 0, failures = 0, pollTimer = null, saveTimer = null;
  let serial = Promise.resolve(), initError = null, disposedListeners = [];
  let currentStatus = {kind: 'local', message: 'Saved on this browser.', pending: 0};

  const notify = (callback, ...args) => { if (started && typeof callback === 'function') { try { callback(...args); } catch { /* UI callbacks cannot undo a committed save. */ } } };
  const prefix = () => credentials ? namespace + 'space:' + encodeURIComponent(credentials.spaceId) + ':device:' + encodeURIComponent(credentials.deviceId) + ':' : null;
  const cacheKey = () => prefix() + 'base';
  const flightKey = () => prefix() + 'flight';
  const operationKey = id => prefix() + 'op:' + id;

  function callbackEnvelope() {
    return {...cloneJSON(accepted), ...(clockSample ? {serverOffset: clockSample.serverOffset, serverReceivedAt: clockSample.receivedAt} : {})};
  }

  function read(key, privateData = false) {
    if (!storage || typeof storage.getItem !== 'function') return null;
    let raw;
    try { raw = storage.getItem(key); } catch { throw new CloudSyncError('This browser cannot read its saved connection. Keep your task backup before changing browser storage.', 'storage-unavailable'); }
    if (raw === null || raw === undefined) return null;
    try { return cloneJSON(JSON.parse(raw), {privateData}); } catch { throw new CloudSyncError('A saved connection or queued edit is damaged. Your local tasks have not been discarded.', 'invalid-storage'); }
  }

  function write(key, value, privateData = false) {
    if (!storage || typeof storage.setItem !== 'function') throw new CloudSyncError('Browser storage is unavailable. Enable it before connecting or syncing.', 'storage-unavailable');
    const text = JSON.stringify(cloneJSON(value, {privateData}));
    try { storage.setItem(key, text); } catch { throw new CloudSyncError('This browser could not save the sync queue. Export your local tasks and free browser storage before retrying.', 'storage-full'); }
  }

  function remove(key) {
    try { storage?.removeItem(key); } catch { throw new CloudSyncError('This browser could not update the saved sync queue.', 'storage-unavailable'); }
  }

  function keys(start) {
    if (!storage || typeof storage.key !== 'function' || !Number.isInteger(storage.length)) throw new CloudSyncError('This browser cannot safely enumerate its queued edits.', 'storage-unavailable');
    const result = [];
    try { for (let i = 0; i < storage.length; i++) { const key = storage.key(i); if (key?.startsWith(start)) result.push(key); } }
    catch { throw new CloudSyncError('The saved sync queue is unavailable.', 'storage-unavailable'); }
    return result;
  }

  function readCredentials() {
    const value = read(credentialsKey, true);
    if (value === null) return null;
    if (value.version !== 1 || !TOKEN.test(value.deviceToken) || (value.recoveryKey !== undefined && !TOKEN.test(value.recoveryKey)) ||
        !opaqueId(value.spaceId) || !opaqueId(value.deviceId) || ![0, 1].includes(value.role) || !validZone(value.zone)) {
      throw new CloudSyncError('The saved device connection is invalid. Your local tasks are still available.', 'invalid-storage');
    }
    return value;
  }

  function publicConnection() {
    if (!credentials) return null;
    return {
      spaceId: credentials.spaceId, role: credentials.role, zone: credentials.zone, deviceId: credentials.deviceId,
      revision: accepted?.revision ?? 0, partnerJoined: accepted?.partnerJoined ?? false,
    };
  }

  function readIntents() {
    if (!credentials) return [];
    const result = keys(prefix() + 'op:').map(key => {
      const value = read(key);
      if (!value || value.version !== 1 || !ID.test(value.id) || operationKey(value.id) !== key || !Number.isFinite(value.created) ||
          !Array.isArray(value.changes) || value.changes.length > 10000 || !Array.isArray(value.parents) ||
          !value.parents.every(id => typeof id === 'string' && ID.test(id)) ||
          (value.supersedes !== undefined && (!Array.isArray(value.supersedes) || !value.supersedes.every(id => typeof id === 'string' && ID.test(id))))) {
        throw new CloudSyncError('A queued edit is damaged. Export your local tasks before reconnecting.', 'invalid-outbox');
      }
      value.changes = value.changes.map(validateChange);
      return value;
    });
    return orderIntents(result);
  }

  function readFlight() {
    if (!credentials) return null;
    const value = read(flightKey());
    if (!value) return null;
    if (value.version !== 1 || !['state', 'restore'].includes(value.kind) || !value.body || !ID.test(value.body.mutationId) ||
        !Number.isSafeInteger(value.body.revision) || value.body.revision < 0 || !Array.isArray(value.opIds) ||
        !value.opIds.every(id => typeof id === 'string' && ID.test(id)) ||
        (value.kind === 'state' && !value.body.state)) throw new CloudSyncError('An in-progress save is damaged. Your queued edits have been kept.', 'invalid-outbox');
    if (value.body.state) value.body.state = wireState(value.body.state);
    return value;
  }

  function setStatus(kind, message, extra = {}) {
    const next = {kind, message, pending: intents.length, ...(conflicts.length ? {conflicts: cloneJSON(conflicts)} : {}), ...extra};
    const changed = JSON.stringify(next) !== JSON.stringify(currentStatus);
    currentStatus = next;
    if (changed) notify(onStatus, cloneJSON(next));
  }

  function showError(error) {
    if (error.code === 'cancelled') return;
    const kind = credentials && (['unauthorized', 'revoked', 'device-revoked', 'invalid-token'].includes(error.code) || error.httpStatus === 401) ? 'revoked' : error.code === 'offline' ? 'offline' : ['conflict', 'rejected-save'].includes(error.code) && conflicts.length ? 'conflict' : 'error';
    if (kind === 'offline') failures = Math.min(failures + 1, 5);
    if (kind === 'revoked' && credentials) { try { write(prefix() + 'revoked', {at: Date.now()}); } catch { /* Keep the access failure visible even if storage is full. */ } }
    setStatus(kind, error.message || 'The shared space could not be reached. Your queued edits are still here.');
  }

  function assertCurrent(epoch) {
    if (epoch !== generation) throw new CloudSyncError('The connection changed while the request was in progress.', 'cancelled');
  }

  function rebuild({emit = true, status = true} = {}) {
    if (!accepted) return;
    intents = readIntents();
    const merged = replayChanges(accepted.state, intents);
    view = merged.state; conflicts = merged.conflicts;
    const flight = readFlight();
    if (flight?.blocked) {
      if (flight.rejected) conflicts.unshift({
        path: 'rejected-save', label: 'Change rejected by the server', kind: 'save-rejected',
        base: {revision: flight.body.revision}, local: flight.body.state,
        remote: accepted.state, reason: flight.rejected.message,
      });
      else conflicts.unshift({path: 'restore', label: 'Restore of the whole shared space', kind: 'restore-conflict', base: {revision: flight.body.revision}, local: flight.body.state ?? {snapshotId: flight.body.snapshotId}, remote: accepted.state});
    }
    if (emit && !merged.conflicts.some(conflict => conflict.kind === 'invalid-combination')) notify(onState, stateForRole(view, credentials.role), callbackEnvelope());
    if (status && currentStatus.kind === 'revoked') setStatus('revoked', currentStatus.message);
    else if (status && conflicts.length) setStatus('conflict', 'Changes to the same item need your choice. Both versions are kept until you decide.');
    else if (status && intents.length) setStatus('syncing', `${intents.length} saved local edit${intents.length === 1 ? '' : 's'} waiting to sync.`);
    else if (status && !flight) setStatus('saved', 'Saved to your shared space.');
  }

  function loadShared({emit = false} = {}) {
    const stored = readCredentials();
    if ((stored?.deviceToken ?? null) !== (credentials?.deviceToken ?? null)) {
      generation++;
      credentials = stored; accepted = null; view = null; intents = []; conflicts = []; clockSample = null;
      notify(onConnection, publicConnection());
    }
    if (!credentials) return;
    const sample = read(prefix() + 'clock');
    if (sample && Number.isFinite(sample.serverOffset) && Number.isFinite(sample.receivedAt) && Number.isFinite(sample.serverNow)) clockSample = sample;
    if (read(prefix() + 'revoked')) currentStatus = {kind: 'revoked', message: 'This device no longer has access. Your local edits are kept here; use your recovery file to reconnect.', pending: intents.length};
    const cached = read(cacheKey());
    if (cached) {
      const envelope = validateEnvelope(cached, credentials);
      if (!accepted || envelope.revision >= accepted.revision) accepted = envelope;
    }
    if (accepted) rebuild({emit, status: false});
    if (currentStatus.kind === 'revoked') currentStatus = {...currentStatus, pending: intents.length};
  }

  function acceptEnvelope(input, {emit = true} = {}) {
    const envelope = validateEnvelope(input, credentials || {});
    // A delayed response or another tab must never roll back an accepted revision.
    const cached = read(cacheKey());
    const stored = cached ? validateEnvelope(cached, credentials) : null;
    const newest = [envelope, accepted, stored].filter(Boolean).sort((a, b) => b.revision - a.revision || b.serverNow - a.serverNow)[0];
    write(cacheKey(), newest);
    accepted = newest;
    if (newest === envelope) {
      const receivedAt = Date.now();
      clockSample = {serverNow: envelope.serverNow, receivedAt, serverOffset: envelope.serverNow - receivedAt};
      write(prefix() + 'clock', clockSample);
    }
    failures = 0;
    rebuild({emit, status: false});
    notify(onConnection, publicConnection());
    return envelope;
  }

  async function request(path, {method = 'GET', body, authenticated = true, token} = {}) {
    if (typeof fetcher !== 'function' || globalThis.navigator?.onLine === false) throw new CloudSyncError('You are offline. Local edits are saved here and will sync when you reconnect.', 'offline');
    const headers = {'Accept': 'application/json'};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (authenticated) {
      const deviceToken = token || credentials?.deviceToken;
      if (!deviceToken) throw new CloudSyncError('Connect this browser to a shared space first.', 'not-connected');
      headers.Authorization = 'Bearer ' + deviceToken;
    }
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), 20000) : null;
    timeout?.unref?.();
    let response, value;
    try {
      response = await fetcher(baseURL + path, {method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', credentials: 'omit', redirect: 'error', ...(controller ? {signal: controller.signal} : {})});
      if (typeof response?.text === 'function') {
        const text = await response.text();
        if (text.length > MAX_RESPONSE) throw new CloudSyncError('The server response is too large.', 'invalid-response');
        try { value = JSON.parse(text); } catch { throw new CloudSyncError('The server did not return a valid response. Your queued edits are still here.', 'invalid-response'); }
      } else if (typeof response?.json === 'function') value = await response.json();
      else throw new CloudSyncError('The server did not return a valid response.', 'invalid-response');
    } catch (error) {
      if (error instanceof CloudSyncError) throw error;
      throw new CloudSyncError('The connection was interrupted. Your queued edits are saved and the same request will be retried safely.', 'offline');
    } finally { if (timeout) clearTimeout(timeout); }
    value = cloneJSON(value);
    if (!response.ok) {
      const code = typeof value?.code === 'string' && /^[a-z0-9_-]{1,80}$/.test(value.code) ? value.code : 'server-error';
      throw new CloudSyncError(typeof value?.error === 'string' ? value.error.slice(0, 400) : 'The shared space could not accept this request.', code, {httpStatus: response.status, current: value?.current});
    }
    return value;
  }

  function serialized(action) {
    const run = async () => {
      const locks = globalThis.navigator?.locks;
      return typeof locks?.request === 'function' ? locks.request(lockName, action) : action();
    };
    const result = serial.then(run, run);
    serial = result.catch(() => {});
    return result;
  }

  function clearSchedule() {
    if (pollTimer) clearTimeout(pollTimer);
    if (saveTimer) clearTimeout(saveTimer);
    pollTimer = saveTimer = null;
  }

  function schedule() {
    if (pollTimer) clearTimeout(pollTimer);
    if (!started || currentStatus.kind === 'revoked' || !credentials) return;
    // Pairing is intentionally NOT polled: repeatedly POSTing an ambiguous
    // invitation/recovery attempt triggers hourly security rate limits.
    // One resume at startup, one on reconnect, and explicit Retry remain available.
    const hidden = globalThis.document?.visibilityState === 'hidden';
    const delay = failures ? Math.min(60000, 5000 * 2 ** failures) : hidden ? 30000 : 5000;
    pollTimer = setTimeout(() => { pollTimer = null; if (started) pull(); }, delay);
    pollTimer?.unref?.();
  }

  function scheduleSave() {
    if (!started || saveTimer || currentStatus.kind === 'revoked') return;
    saveTimer = setTimeout(() => { saveTimer = null; if (started) flush(); }, 40);
    saveTimer?.unref?.();
  }

  async function fetchStateInternal() {
    const epoch = generation;
    const result = await request('/state');
    assertCurrent(epoch);
    acceptEnvelope(result);
    return result;
  }

  async function sendFlight(flight) {
    const epoch = generation;
    try {
      const result = await request(flight.kind === 'restore' ? '/restore' : '/state', {method: flight.kind === 'restore' ? 'POST' : 'PUT', body: flight.body});
      assertCurrent(epoch);
      acceptEnvelope(result, {emit: false});
      // Remove only the immutable edits captured by this request, never edits made while awaiting it.
      for (const id of flight.opIds) remove(operationKey(id));
      const stored = readFlight();
      if (stored?.body.mutationId === flight.body.mutationId) remove(flightKey());
      rebuild();
      return true;
    } catch (error) {
      assertCurrent(epoch);
      if (error.code === 'conflict' && error.current) {
        acceptEnvelope(error.current, {emit: false});
        const stored = readFlight();
        if (stored?.body.mutationId === flight.body.mutationId) {
          if (flight.kind === 'restore') write(flightKey(), {...flight, blocked: true});
          else remove(flightKey());
        }
        rebuild();
        return false;
      }
      // A definitive validation/permission failure will never succeed by
      // replaying the identical payload. Keep its exact edits durably until
      // the user exports a backup and explicitly discards the rejected batch.
      // Offline, 408, 429 and server failures remain retryable, not discarded.
      if (flight.kind === 'state' && [400, 403, 404, 413, 415, 422].includes(error.httpStatus)) {
        const stored = readFlight();
        if (stored?.body.mutationId === flight.body.mutationId) {
          write(flightKey(), {...flight, blocked: true, rejected: {code: error.code, message: error.message}});
          rebuild();
        }
        throw new CloudSyncError('The server rejected a saved edit: ' + error.message + ' Export a backup, then review the rejected change.', 'rejected-save', {httpStatus: error.httpStatus});
      }
      throw error;
    }
  }

  async function flushInternal() {
    loadShared();
    if (!credentials) {
      const pending = read(handshakeKey, true);
      if (pending) await resumePending(validateHandshake(pending));
      else return true;
    }
    ensureConnected();
    if (!accepted) await fetchStateInternal();
    for (let turn = 0; turn < 10; turn++) {
      loadShared();
      const flight = readFlight();
      if (flight) {
        if (flight.blocked) { rebuild(); return false; }
        setStatus('syncing', 'Saving your shared space…');
        await sendFlight(flight);
        continue;
      }
      rebuild({emit: false});
      if (conflicts.length) return false;
      const changes = changesBetween(accepted.state, view);
      if (!changes.length) {
        // The desired values may already be on the server after an ambiguous response or an identical edit.
        for (const intent of intents) remove(operationKey(intent.id));
        rebuild();
        return true;
      }
      const pending = {version: 1, kind: 'state', body: {state: wireState(view), revision: accepted.revision, mutationId: randomId()}, opIds: intents.map(intent => intent.id)};
      write(flightKey(), pending); // Durability before network, including the exact revision and payload.
      setStatus('syncing', 'Saving your shared space…');
      await sendFlight(pending);
    }
    rebuild();
    scheduleSave();
    return false;
  }

  async function flush() {
    return serialized(async () => {
      if (!started) return false;
      try { return await flushInternal(); }
      catch (error) { showError(error); return false; }
      finally { schedule(); }
    });
  }

  async function pull() {
    return serialized(async () => {
      if (!started) return false;
      try {
        loadShared();
        if (!credentials) {
          const pending = read(handshakeKey, true);
          if (pending) await resumePending(validateHandshake(pending));
          else return true;
        }
        ensureConnected();
        await fetchStateInternal();
        return await flushInternal();
      } catch (error) { showError(error); return false; }
      finally { schedule(); }
    });
  }

  function save(state) {
    if (!credentials) return true;
    try {
      if (!started || !accepted || !view) throw new CloudSyncError('Wait for this browser to load its saved shared space before editing.', 'not-ready');
      // Do not refresh view here: it is exactly what the UI edited. New storage events are rebased later.
      const changes = changesBetween(view, state, {role: credentials.role});
      if (!changes.length) return true;
      const existing = readIntents();
      const intent = {version: 1, id: randomId(), created: Date.now(), parents: existing.map(item => item.id), changes};
      write(operationKey(intent.id), intent);
      rebuild({status: false});
      if (currentStatus.kind === 'revoked') setStatus('revoked', 'Saved on this browser. This device no longer has access; recover your connection before syncing these edits.');
      else if (conflicts.length) setStatus('conflict', 'Changes to the same item need your choice. Both versions are kept until you decide.');
      else if (currentStatus.kind === 'offline' || globalThis.navigator?.onLine === false || typeof fetcher !== 'function') setStatus('offline', 'Saved on this browser. These edits will sync when you reconnect.');
      else setStatus('syncing', 'Saved on this browser; syncing your shared space…');
      scheduleSave();
      return true;
    } catch (error) { showError(error); return false; }
  }

  function validateHandshake(value) {
    if (!value || value.version !== 1 || !['spaces', 'join', 'recover'].includes(value.type) || !value.body ||
        !TOKEN.test(value.body.deviceToken) || !TOKEN.test(value.body.recoveryKey) ||
        typeof value.signature !== 'string') throw new CloudSyncError('The saved connection attempt is damaged. Your local tasks are still available.', 'invalid-storage');
    return value;
  }

  // Known 4xx responses (including future server validation codes) are
  // definite rejections. 408/425 are transient; network errors and 5xx are
  // ambiguous and must keep the same provisional identity for safe replay.
  const handshakeRejected = error => Number.isInteger(error?.httpStatus) &&
    error.httpStatus >= 400 && error.httpStatus < 500 && ![408, 425].includes(error.httpStatus);

  function handshakeIdentityMatches(pending, type, body) {
    if (pending.type !== type) return false;
    // Names are cosmetic. Retrying a pending operation must keep its original
    // device token/name/payload, even if the user edits the field meanwhile.
    if (type === 'recover') return pending.body.spaceId === body.spaceId &&
      pending.body.role === body.role && pending.body.recoveryKey === body.recoveryKey;
    if (type === 'join') return pending.body.invite === body.invite;
    return pending.body.role === body.role && pending.body.zone === body.zone;
  }

  function finalizeHandshake(pending, reply) {
    const expected = pending.type === 'spaces' ? {role: pending.body.role, zone: pending.body.zone} : pending.type === 'recover' ? {role: pending.body.role, spaceId: pending.body.spaceId} : {};
    const envelope = validateEnvelope(reply, expected);
    const next = {version: 1, spaceId: envelope.spaceId, role: envelope.role, zone: envelope.zone, deviceId: envelope.deviceId, deviceToken: pending.body.deviceToken, recoveryKey: pending.body.recoveryKey};
    write(credentialsKey, next, true);
    credentials = next; accepted = null; intents = []; conflicts = []; view = null; clockSample = null;
    acceptEnvelope(envelope, {emit: false});
    remove(handshakeKey);
    notify(onConnection, publicConnection());
    rebuild();
    schedule();
    return {...cloneJSON(envelope), recoveryKey: next.recoveryKey};
  }

  async function completeHandshake(pending) {
    const epoch = generation;
    setStatus('connecting', 'Connecting this browser to your shared space…', {pending: 1});
    let reply;
    try {
      reply = await request('/' + pending.type, {method: 'POST', body: pending.body, authenticated: false});
    } catch (error) {
      assertCurrent(epoch);
      if (handshakeRejected(error)) remove(handshakeKey);
      throw error;
    }
    assertCurrent(epoch);
    return finalizeHandshake(pending, reply);
  }

  async function probePending(pending) {
    const epoch = generation;
    try {
      const reply = await request('/state', {token: pending.body.deviceToken});
      assertCurrent(epoch);
      return finalizeHandshake(pending, reply);
    } catch (error) {
      assertCurrent(epoch);
      if (error.httpStatus === 401 && error.code === 'unauthorized') return null;
      throw error; // Never clear an ambiguous or inaccessible connection.
    }
  }

  async function resumePending(pending) {
    // If the previous request succeeded but its reply was lost, GET /state
    // recovers that exact device without consuming a new pairing attempt.
    const alreadyConnected = await probePending(pending);
    return alreadyConnected || completeHandshake(pending);
  }

  function pendingConnection() {
    if (credentials) return null;
    const pending = read(handshakeKey, true);
    if (!pending) return null;
    validateHandshake(pending);
    // Do not expose any capability, recovery key, invite or device token.
    return {type: pending.type, deviceName: pending.body.deviceName || 'This browser'};
  }

  function retryPending() {
    return serialized(async () => {
      try {
        loadShared();
        if (credentials) return {outcome: 'connected'};
        const pending = read(handshakeKey, true);
        if (!pending) return {outcome: 'none'};
        await resumePending(validateHandshake(pending));
        return {outcome: 'connected'};
      } catch (error) { showError(error); throw error; }
      finally { schedule(); }
    });
  }

  function resetPending() {
    return serialized(async () => {
      try {
        loadShared();
        if (credentials) return {outcome: 'connected'};
        const pending = read(handshakeKey, true);
        if (!pending) return {outcome: 'none'};
        // Do not orphan a newly created member/space: first ask the backend if
        // the provisional device has already connected (lost POST response).
        const adopted = await probePending(validateHandshake(pending));
        if (adopted) return {outcome: 'connected'};
        // 401 unauthorized proves there is no active device for this token.
        remove(handshakeKey);
        failures = 0;
        setStatus('local', 'Unfinished connection cleared. Your tasks are still saved on this browser.');
        return {outcome: 'cleared'};
      } catch (error) { showError(error); throw error; }
      finally { schedule(); }
    });
  }

  // Emergency escape hatch for an unconnected browser when the server cannot
  // confirm whether a pairing succeeded. This is explicitly user-initiated in
  // the UI after a warning: a successfully created but unrecovered space may
  // otherwise become inaccessible. Never silently discard a pending handshake.
  function forgetPending() {
    return serialized(async () => {
      if (credentials || readCredentials()) throw new CloudSyncError('This device is already connected. Its access was not changed.', 'already-connected');
      const pending = read(handshakeKey, true);
      if (!pending) return {outcome: 'none'};
      // Only remove the pending handshake. Never touch local task data,
      // connected device credentials, queued edits, or recovery files.
      remove(handshakeKey);
      failures = 0;
      setStatus('local', 'Unfinished attempt forgotten on this browser. Your tasks are still here. This does not reset the server pairing limit.');
      return {outcome: 'cleared'};
    });
  }

  function handshake(type, input) {
    return serialized(async () => {
      try {
        if (!started) started = true;
        loadShared();
        if (credentials) throw new CloudSyncError('This browser is already connected. Disconnect it before joining another space.', 'already-connected');
        const body = cloneJSON(input, {privateData: true});
        body.deviceName = String(body.deviceName || 'This browser').trim().slice(0, 80) || 'This browser';
        if (type === 'spaces') {
          if (![0, 1].includes(body.role) || !validZone(body.zone)) throw new CloudSyncError('Choose your side and a valid time zone.', 'invalid-input');
          body.state = wireState(body.state);
        } else if (type === 'join') {
          if (!TOKEN.test(body.invite)) throw new CloudSyncError('Paste the complete invitation code from your partner.', 'invalid-invite');
        } else if (!opaqueId(body.spaceId) || ![0, 1].includes(body.role) || !TOKEN.test(body.recoveryKey)) {
          throw new CloudSyncError('This recovery file or code is invalid.', 'invalid-recovery');
        }
        const signature = JSON.stringify(body);
        let pending = read(handshakeKey, true);
        if (pending) {
          pending = validateHandshake(pending);
          if (!handshakeIdentityMatches(pending, type, body)) throw new CloudSyncError('Another connection attempt is saved on this browser. Choose “Resolve previous attempt” in Connect us to safely finish or start over. Your tasks are untouched.', 'pending-connection');
          return await resumePending(pending);
        }
        pending = {version: 1, type, signature, body: {...body, deviceToken: secret(), recoveryKey: type === 'recover' ? body.recoveryKey : secret()}};
        write(handshakeKey, pending, true); // Persist identity before an idempotent create/join/recovery request.
        return await completeHandshake(pending);
      } catch (error) { showError(error); throw error; }
      finally { schedule(); }
    });
  }

  function ensureConnected() {
    if (!credentials) throw new CloudSyncError('Connect this browser to a shared space first.', 'not-connected');
    if (currentStatus.kind === 'revoked') throw new CloudSyncError('This device no longer has access. Use your recovery file to reconnect.', 'revoked');
  }

  async function requireSynced() {
    ensureConnected();
    if (!await flushInternal()) {
      if (conflicts.length) throw new CloudSyncError('Review the conflicting edits before using this action.', 'conflict');
      throw new CloudSyncError('Wait until your local edits are saved to the shared space, then try again.', currentStatus.kind === 'offline' ? 'offline' : 'pending');
    }
  }

  function focus(args) {
    return serialized(async () => {
      try {
        // Timer commands are intentionally not persisted or replayed after going offline.
        if (typeof fetcher !== 'function' || globalThis.navigator?.onLine === false) throw new CloudSyncError('Focus needs a live connection so both of you see the same timer. Reconnect and try again.', 'offline');
        await requireSynced();
        const action = args?.action, owner = args?.owner;
        if (!['start', 'pause', 'resume', 'end', 'skip-break'].includes(action) || ![credentials.role, 2].includes(owner)) throw new CloudSyncError('You can control your own focus or a shared focus session.', 'forbidden');
        const body = {revision: accepted.revision, mutationId: randomId(), action, owner};
        for (const key of ['taskId', 'minutes', 'allowOutsideHours', 'allowEarly']) if (args[key] !== undefined) body[key] = args[key];
        const epoch = generation;
        setStatus('syncing', 'Updating your shared timer…');
        const reply = await request('/focus', {method: 'POST', body});
        assertCurrent(epoch);
        acceptEnvelope(reply); rebuild();
        return validateEnvelope(reply, credentials);
      } catch (error) {
        if (error.code === 'conflict' && error.current) { acceptEnvelope(error.current); rebuild(); }
        if (error.code === 'offline') error = new CloudSyncError('The focus action could not be confirmed. Reconnect to check the server timer before trying again; your task edits are still saved here.', 'offline');
        showError(error); throw error;
      } finally { schedule(); }
    });
  }

  function readOnly(path, validate, options) {
    return serialized(async () => {
      try {
        loadShared(); ensureConnected();
        const epoch = generation, result = await request(path, options);
        assertCurrent(epoch);
        return validate(result);
      } catch (error) { showError(error); throw error; }
    });
  }

  function restore(input) {
    return serialized(async () => {
      try {
        await requireSynced();
        if (!input || (!!input.state === !!input.snapshotId)) throw new CloudSyncError('Choose one valid backup or history snapshot.', 'invalid-input');
        const body = {revision: accepted.revision, mutationId: randomId()};
        if (input.state) body.state = wireState(input.state);
        else if (opaqueId(input.snapshotId)) body.snapshotId = input.snapshotId;
        else throw new CloudSyncError('Choose a valid history snapshot.', 'invalid-input');
        const flight = {version: 1, kind: 'restore', body, opIds: []};
        write(flightKey(), flight);
        setStatus('syncing', 'Restoring the shared space…');
        if (!await sendFlight(flight)) throw new CloudSyncError('Your partner changed the space before this restore. Review the latest version before choosing to replace it.', 'conflict');
        return cloneJSON(accepted);
      } catch (error) { showError(error); throw error; }
      finally { schedule(); }
    });
  }

  function resolveConflicts(choice) {
    return serialized(async () => {
      try {
        loadShared(); ensureConnected(); rebuild({emit: false});
        if (!['remote', 'local'].includes(choice)) throw new CloudSyncError('Choose the shared version or your local version.', 'invalid-input');
        if (!conflicts.length) return true;
        const flight = readFlight();
        if (flight?.rejected) throw new CloudSyncError('Export a backup, then use Discard rejected save. An invalid change cannot be forced onto the server.', 'rejected-save');
        if (flight?.blocked) {
          if (choice === 'remote') remove(flightKey());
          else write(flightKey(), {...flight, blocked: false, body: {...flight.body, revision: accepted.revision, mutationId: randomId()}});
        }
        const ordinary = conflicts.filter(conflict => conflict.path !== 'restore');
        if (ordinary.length) {
          const blocked = new Set(ordinary.map(conflict => conflict.path));
          const captured = intents.map(intent => intent.id);
          let changes;
          if (choice === 'local') changes = changesBetween(accepted.state, view, {role: credentials.role});
          else {
            const remaining = intents.map(intent => ({changes: intent.changes.filter(change => !blocked.has(change.key) && !blocked.has('state'))}));
            changes = changesBetween(accepted.state, replayChanges(accepted.state, remaining).state, {role: credentials.role});
          }
          // A single durable replacement makes the explicit choice atomic across tabs/reloads.
          const intent = {version: 1, id: randomId(), created: Date.now(), parents: [], supersedes: captured, changes};
          write(operationKey(intent.id), intent);
          for (const id of captured) remove(operationKey(id));
        }
        rebuild();
        return await flushInternal();
      } catch (error) { showError(error); throw error; }
      finally { schedule(); }
    });
  }

  function discardRejected() {
    return serialized(async () => {
      try {
        loadShared(); ensureConnected();
        const flight = readFlight();
        if (!flight?.blocked || !flight.rejected || flight.kind !== 'state') throw new CloudSyncError('There is no rejected edit to discard.', 'not-blocked');
        // Remove only the operations represented by the rejected request;
        // later local edits stay in the durable outbox, never silently erased.
        // Exporting first is explicitly requested in the UI.
        for (const id of flight.opIds) remove(operationKey(id));
        remove(flightKey());
        rebuild();
        return await flushInternal();
      } catch (error) { showError(error); throw error; }
      finally { schedule(); }
    });
  }

  function disconnect() {
    generation++;
    clearSchedule();
    if (credentials) for (const key of keys(prefix())) remove(key);
    remove(credentialsKey); remove(handshakeKey);
    credentials = null; accepted = null; view = null; intents = []; conflicts = []; failures = 0; clockSample = null;
    notify(onConnection, null);
    setStatus('local', 'Disconnected. Your tasks remain on this browser.');
  }

  function listen() {
    const add = (target, name, handler) => {
      if (typeof target?.addEventListener !== 'function') return;
      target.addEventListener(name, handler);
      disposedListeners.push(() => target.removeEventListener?.(name, handler));
    };
    add(globalThis.window, 'storage', event => {
      if (!started || (event.storageArea && event.storageArea !== storage) || (event.key && !event.key.startsWith(namespace))) return;
      try {
        loadShared({emit: true});
        if (credentials) scheduleSave(); else setStatus('local', 'This browser is using local tasks.');
      } catch (error) { showError(error); }
    });
    add(globalThis.window, 'online', () => { if (started) pull(); });
    add(globalThis.window, 'offline', () => { if (credentials) setStatus('offline', 'Offline. Your local edits will sync when you reconnect.'); });
    add(globalThis.document, 'visibilitychange', () => { if (started && globalThis.document?.visibilityState !== 'hidden') pull(); });
  }

  function start() {
    if (started) return pull();
    started = true;
    listen();
    notify(onConnection, publicConnection());
    if (initError) { showError(initError); return Promise.resolve(false); }
    if (accepted) rebuild({status: false});
    if (currentStatus.kind === 'revoked') { notify(onStatus, cloneJSON(currentStatus)); return Promise.resolve(false); }
    if (credentials) setStatus('connecting', 'Checking your saved shared space…');
    if (credentials) return pull();
    return serialized(async () => {
      try {
        const pending = read(handshakeKey, true);
        if (pending) { await resumePending(validateHandshake(pending)); return true; }
        setStatus('local', 'Saved on this browser.');
        return true;
      } catch (error) { showError(error); return false; }
    });
  }

  function stop() {
    started = false; generation++; clearSchedule();
    disposedListeners.forEach(dispose => dispose()); disposedListeners = [];
  }

  // Restore identity, accepted base and outbox synchronously, without callbacks or network.
  try { credentials = readCredentials(); if (credentials) loadShared(); }
  catch (error) { initError = error; currentStatus = {kind: 'error', message: error.message, pending: 0}; }

  return {
    get connection() { return publicConnection(); },
    get status() { return cloneJSON(currentStatus); },
    start, stop, save, flush, pull, focus, restore, resolveConflicts, discardRejected, disconnect,
    pendingConnection, retryPending, resetPending, forgetPending,
    create: ({state, role, zone, deviceName} = {}) => handshake('spaces', {state, role, zone, deviceName}),
    join: ({invite, deviceName} = {}) => handshake('join', {invite, deviceName}),
    recover: ({spaceId, role, recoveryKey, deviceName} = {}) => handshake('recover', {spaceId, role, recoveryKey, deviceName}),
    recoveryDetails() {
      if (!credentials?.recoveryKey) throw new CloudSyncError('No recovery key is saved on this browser.', 'recovery-unavailable');
      return {version: 1, spaceId: credentials.spaceId, role: credentials.role, recoveryKey: credentials.recoveryKey};
    },
    invite: () => readOnly('/invite', value => {
      if (!value || !TOKEN.test(value.invite) || !timestamp(value.expiresAt)) throw new CloudSyncError('The invitation response is invalid.', 'invalid-response');
      return {invite: value.invite, expiresAt: value.expiresAt};
    }, {method: 'POST', body: {}}),
    history: () => readOnly('/history', value => {
      if (!Array.isArray(value?.snapshots) || value.snapshots.length > 50 || value.snapshots.some(item => !opaqueId(item.id) || !Number.isSafeInteger(item.revision) || item.revision < 0 || !timestamp(item.createdAt) || typeof item.reason !== 'string' || !Number.isSafeInteger(item.taskCount) || item.taskCount < 0)) throw new CloudSyncError('The history response is invalid.', 'invalid-response');
      return cloneJSON(value);
    }),
    snapshot: id => {
      if (!opaqueId(id)) return Promise.reject(new CloudSyncError('Choose a valid snapshot.', 'invalid-input'));
      return readOnly('/history/' + encodeURIComponent(id), value => {
        const item = value?.snapshot;
        if (!item || item.id !== id || !Number.isSafeInteger(item.revision) || item.revision < 0 || !timestamp(item.createdAt)) throw new CloudSyncError('The snapshot response is invalid.', 'invalid-response');
        return {snapshot: {...item, state: wireState(item.state)}};
      });
    },
    devices: () => readOnly('/devices', value => {
      if (!Array.isArray(value?.devices) || value.devices.length > 100 || value.devices.some(item => !opaqueId(item.id) || typeof item.name !== 'string' || !timestamp(item.createdAt) || !timestamp(item.lastSeen) || typeof item.current !== 'boolean')) throw new CloudSyncError('The devices response is invalid.', 'invalid-response');
      return cloneJSON(value);
    }),
    revoke: id => {
      if (!opaqueId(id)) return Promise.reject(new CloudSyncError('Choose a valid device.', 'invalid-input'));
      return readOnly('/devices/' + encodeURIComponent(id), value => {
        if (value?.ok !== true) throw new CloudSyncError('The device response is invalid.', 'invalid-response');
        if (id === credentials.deviceId) {
          write(prefix() + 'revoked', {at: Date.now()});
          setStatus('revoked', 'This device has been revoked. Your local tasks remain here.');
        }
        return {ok: true};
      }, {method: 'DELETE'});
    },
  };
}
