import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudSync} from '../cloud-sync.js';
import {syncService, syncClient, connectedPair, sampleState, sampleTask, MemoryStorage, deferred} from './sync-fixture.js';

function fixture(t, state = sampleState()) {
  const service = syncService();
  t.after(() => service.close());
  return {service, state, own(client) { t.after(() => client.bridge.stop()); return client; }};
}

test('two devices share task data while credentials and acting roles stay separate', async t => {
  const {service, state, own} = fixture(t); state.shared.push(sampleTask());
  const pair = await connectedPair(service, state), left = own(pair.left), right = own(pair.right);
  assert.equal(left.state.active, 0); assert.equal(right.state.active, 1);
  assert.equal(left.bridge.connection.spaceId, right.bridge.connection.spaceId);
  assert.notEqual(left.bridge.connection.deviceId, right.bridge.connection.deviceId);
  assert.equal(left.bridge.connection.deviceToken, undefined);
  assert.equal(left.bridge.connection.recoveryKey, undefined);
  const ownRecovery = left.bridge.recoveryDetails();
  assert.equal(ownRecovery.recoveryKey.length, 43);
  assert.notEqual(ownRecovery.recoveryKey, right.bridge.recoveryDetails().recoveryKey);
  for (const [key, value] of left.storage.entries()) if (!key.endsWith(':credentials')) {
    assert.doesNotMatch(value, /deviceToken|recoveryKey/);
    assert.equal(value.includes(ownRecovery.recoveryKey), false);
  }
  assert.equal(left.edit(s => { s.shared[0].title = 'A weekend together'; }), true);
  assert.equal(await left.bridge.flush(), true);
  assert.equal(await right.bridge.pull(), true);
  assert.equal(right.state.shared[0].title, 'A weekend together');
  assert.equal(right.state.active, 1);
  const put = service.calls.find(call => call.method === 'PUT');
  assert.equal(put.body.state.active, 0);
  assert.deepEqual(put.body.state.people.map(person => person.plans), [{}, {}]);
});

test('offline edits survive reload and merge with independent partner additions', async t => {
  const {service, own} = fixture(t), pair = await connectedPair(service), left = own(pair.left), right = own(pair.right);
  left.offline();
  left.edit(s => s.people[0].tasks.push(sampleTask('left-task', 'Black task')));
  assert.equal(await left.bridge.flush(), false);
  assert.equal(left.bridge.status.kind, 'offline');
  left.bridge.stop();
  right.edit(s => s.people[1].tasks.push(sampleTask('right-task', 'Pink task')));
  assert.equal(await right.bridge.flush(), true);
  const reloaded = own(syncClient(service, {storage: left.storage}));
  assert.equal(reloaded.bridge.connection.role, 0, 'connection is available synchronously before start');
  assert.equal(reloaded.states.length, 0, 'construction has no UI callback');
  assert.equal(await reloaded.bridge.start(), true);
  assert.equal(reloaded.state.people[0].tasks[0].title, 'Black task');
  assert.equal(reloaded.state.people[1].tasks[0].title, 'Pink task');
  assert.equal(reloaded.bridge.status.pending, 0);
  await right.bridge.pull();
  assert.equal(right.state.people[0].tasks[0].id, 'left-task');
});

test('an edit made while PUT is in flight is preserved after the older response arrives', async t => {
  const {service, state, own} = fixture(t); state.shared.push(sampleTask());
  let hold = false; const arrived = deferred(), release = deferred();
  const client = own(syncClient(service, {state, fetcher: async (url, options) => {
    const reply = await service.fetcher(url, options);
    if (hold && options.method === 'PUT') { hold = false; arrived.resolve(); await release.promise; }
    return reply;
  }}));
  await client.bridge.start(); await client.bridge.create({state, role: 0, zone: 'Asia/Manila'});
  hold = true;
  client.edit(s => { s.shared[0].title = 'First edit'; });
  const sending = client.bridge.flush(); await arrived.promise;
  client.edit(s => { s.shared[0].title = 'A newer edit while saving'; });
  release.resolve();
  assert.equal(await sending, true);
  assert.equal(client.state.shared[0].title, 'A newer edit while saving');
  assert.equal(client.bridge.status.pending, 0);
  await client.bridge.pull();
  assert.equal(client.state.shared[0].title, 'A newer edit while saving');
  assert.equal(service.calls.filter(call => call.method === 'PUT').length, 2);
});

test('a lost PUT response retries the exact mutation while preserving newer local edits', async t => {
  const {service, state, own} = fixture(t); state.shared.push(sampleTask());
  let lose = false;
  const client = own(syncClient(service, {state, fetcher: async (url, options) => {
    const reply = await service.fetcher(url, options);
    if (lose && options.method === 'PUT') { lose = false; throw new TypeError('response lost'); }
    return reply;
  }}));
  await client.bridge.start(); await client.bridge.create({state, role: 0, zone: 'Asia/Manila'});
  lose = true;
  client.edit(s => { s.shared[0].title = 'Accepted but reply lost'; });
  assert.equal(await client.bridge.flush(), false);
  const first = service.calls.find(call => call.method === 'PUT');
  client.edit(s => { s.shared[0].minutes = 45; });
  assert.equal(await client.bridge.flush(), true);
  const writes = service.calls.filter(call => call.method === 'PUT');
  assert.deepEqual(writes[1].body, first.body, 'same mutation ID, revision and exact state are retried');
  assert.notEqual(writes[2].body.mutationId, first.body.mutationId);
  assert.equal(client.state.shared[0].title, 'Accepted but reply lost');
  assert.equal(client.state.shared[0].minutes, 45);
  assert.equal(client.bridge.connection.revision, 2, 'ambiguous retry did not apply twice');
});

test('same-task conflict is explicit; choosing remote preserves disjoint local edits', async t => {
  const {service, state, own} = fixture(t); state.shared.push(sampleTask());
  const pair = await connectedPair(service, state), left = own(pair.left), right = own(pair.right);
  left.offline();
  left.edit(s => { s.shared[0].title = 'Local task version'; s.people[0].tasks.push(sampleTask('independent', 'Keep my other task')); });
  right.edit(s => { s.shared[0].title = 'Partner task version'; }); await right.bridge.flush();
  left.online();
  assert.equal(await left.bridge.flush(), false);
  assert.equal(left.bridge.status.kind, 'conflict');
  assert.equal(left.bridge.status.conflicts[0].label, 'Local task version');
  assert.equal(left.state.shared[0].title, 'Local task version', 'local version remains reviewable');
  assert.equal(await left.bridge.resolveConflicts('remote'), true);
  assert.equal(left.state.shared[0].title, 'Partner task version');
  assert.equal(left.state.people[0].tasks[0].id, 'independent');
  await right.bridge.pull();
  assert.equal(right.state.people[0].tasks[0].id, 'independent');
});

test('explicitly choosing the local conflict version creates a fresh exact-revision mutation', async t => {
  const {service, state, own} = fixture(t); state.shared.push(sampleTask());
  const pair = await connectedPair(service, state), left = own(pair.left), right = own(pair.right);
  left.offline(); left.edit(s => { s.shared[0].title = 'Choose this'; });
  right.edit(s => { s.shared[0].title = 'Other version'; }); await right.bridge.flush();
  left.online(); await left.bridge.flush();
  assert.equal(await left.bridge.resolveConflicts('local'), true);
  await right.bridge.pull();
  assert.equal(right.state.shared[0].title, 'Choose this');
  assert.equal(left.bridge.status.pending, 0);
});

test('two same-origin tabs preserve disjoint pending changes in a shared durable outbox', async t => {
  const {service, own} = fixture(t), first = own(syncClient(service));
  await first.bridge.start(); await first.bridge.create({state: first.state, role: 0, zone: 'Asia/Manila'});
  const second = own(syncClient(service, {storage: first.storage})); await second.bridge.start();
  first.offline(); second.offline();
  first.edit(s => s.shared.push(sampleTask('one', 'From the first tab')));
  second.edit(s => s.shared.push(sampleTask('two', 'From the second tab')));
  first.online(); second.online();
  assert.equal(await first.bridge.flush(), true);
  await second.bridge.pull();
  assert.deepEqual(new Set(second.state.shared.map(task => task.id)), new Set(['one', 'two']));
  assert.equal(second.bridge.status.pending, 0);
});

test('lost create and single-use join responses are recovered without repeating the pairing POST', async t => {
  const {service, own} = fixture(t), storage = new MemoryStorage();
  let lostCreate = false;
  const creator = own(syncClient(service, {storage, fetcher: async (url, options) => {
    const response = await service.fetcher(url, options);
    if (url.endsWith('/spaces') && !lostCreate) { lostCreate = true; throw new TypeError('lost'); }
    return response;
  }}));
  await creator.bridge.start();
  await assert.rejects(creator.bridge.create({state: creator.state, role: 0, zone: 'Asia/Manila'}), error => error.code === 'offline');
  creator.bridge.stop();
  const retried = own(syncClient(service, {storage}));
  assert.equal(await retried.bridge.start(), true);
  const creates = service.calls.filter(call => call.path === '/spaces');
  assert.equal(creates.length, 1, 'a lost create reply is recovered with the pending device token using GET /state');
  assert.equal(retried.bridge.connection.role, 0);
  const {invite} = await retried.bridge.invite();
  let lostJoin = false;
  const joining = own(syncClient(service, {fetcher: async (url, options) => {
    const response = await service.fetcher(url, options);
    if (url.endsWith('/join') && !lostJoin) { lostJoin = true; throw new TypeError('lost'); }
    return response;
  }}));
  await joining.bridge.start();
  await assert.rejects(joining.bridge.join({invite}), error => error.code === 'offline');
  joining.bridge.stop();
  const joined = own(syncClient(service, {storage: joining.storage}));
  assert.equal(await joined.bridge.start(), true);
  assert.equal(joined.bridge.connection.role, 1);
  const joins = service.calls.filter(call => call.path === '/join');
  assert.equal(joins.length, 1, 'a lost single-use invitation response is adopted without submitting the invitation twice');
  assert.equal(joined.bridge.connection.spaceId, retried.bridge.connection.spaceId);
});

test('shared focus uses online server time, blocks personal focus and never queues an offline command', async t => {
  const {service, state, own} = fixture(t); state.shared.push(sampleTask()); state.people[0].tasks.push(sampleTask('personal'));
  const pair = await connectedPair(service, state), left = own(pair.left), right = own(pair.right);
  await left.bridge.focus({action: 'start', owner: 2, taskId: 'task-one', minutes: 5});
  assert.equal(left.state.togetherTimer.started, service.now());
  await assert.rejects(left.bridge.focus({action: 'start', owner: 0, taskId: 'personal', minutes: 5}), error => error.code === 'together-active');
  service.advance(120000);
  await right.bridge.pull();
  await right.bridge.focus({action: 'pause', owner: 2});
  assert.equal(right.state.shared[0].spent, 120);
  assert.equal(right.state.togetherTimer.running, false);
  await right.bridge.focus({action: 'resume', owner: 2}); service.advance(60000);
  await right.bridge.focus({action: 'end', owner: 2});
  assert.equal(right.state.shared[0].spent, 180);
  assert.equal(right.state.togetherSessions.reduce((sum, record) => sum + record.seconds, 0), 180);
  right.offline();
  const before = right.storage.entries().filter(([key]) => key.includes(':flight') || key.includes(':op:'));
  await assert.rejects(right.bridge.focus({action: 'start', owner: 2, taskId: 'task-one', minutes: 5}), error => error.code === 'offline');
  assert.deepEqual(right.storage.entries().filter(([key]) => key.includes(':flight') || key.includes(':op:')), before);
});

test('task completion settles the server timer while local invented elapsed time is ignored', async t => {
  const {service, state, own} = fixture(t); state.shared.push(sampleTask());
  const client = own(syncClient(service, {state})); await client.bridge.start();
  await client.bridge.create({state, role: 0, zone: 'Asia/Manila'});
  await client.bridge.focus({action: 'start', owner: 2, taskId: 'task-one', minutes: 5}); service.advance(60000);
  client.edit(s => {
    s.togetherTimer = null; s.shared[0].status = 'done'; s.shared[0].spent = 999999;
    s.shared[0].completed = new Date(service.now()).toISOString(); s.shared[0].completedDay = '2026-10-18';
  });
  assert.equal(client.state.togetherTimer, null);
  assert.equal(await client.bridge.flush(), true);
  assert.equal(client.state.shared[0].spent, 60);
  assert.equal(client.state.togetherTimer, null);
});

test('history, recovery and own-device revocation wrappers keep their exact response contracts', async t => {
  const {service, own} = fixture(t), client = own(syncClient(service));
  await client.bridge.start(); await client.bridge.create({state: client.state, role: 0, zone: 'Asia/Manila'});
  client.edit(s => s.shared.push(sampleTask())); await client.bridge.flush();
  const history = await client.bridge.history();
  assert.ok(history.snapshots.length);
  const snapshot = await client.bridge.snapshot(history.snapshots[0].id);
  assert.equal(snapshot.snapshot.id, history.snapshots[0].id);
  const recovered = own(syncClient(service)); await recovered.bridge.start();
  const recovery = client.bridge.recoveryDetails();
  await recovered.bridge.recover({...recovery, deviceName: 'Second own device', apiBase: 'https://attacker.example/api'});
  assert.equal(recovered.bridge.connection.role, 0);
  const ownDevices = await client.bridge.devices();
  assert.equal(ownDevices.devices.length, 2);
  await client.bridge.revoke(recovered.bridge.connection.deviceId);
  assert.equal(await recovered.bridge.pull(), false);
  assert.equal(recovered.bridge.status.kind, 'revoked');
  assert.ok(service.calls.every(call => !call.path.includes('attacker')));
  const originalLocalTasks = structuredClone(client.state);
  client.bridge.disconnect();
  assert.equal(client.bridge.connection, null);
  assert.deepEqual(client.state, originalLocalTasks);
  assert.equal(client.storage.length, 0);
});

test('local-only startup tolerates unavailable fetch and storage without module side effects', async () => {
  const state = sampleState(), callbacks = [];
  const bridge = createCloudSync({getState: () => state, storage: null, fetcher: null, onState: value => callbacks.push(value)});
  assert.equal(bridge.connection, null); assert.equal(callbacks.length, 0);
  assert.equal(await bridge.start(), true);
  assert.equal(bridge.status.kind, 'local');
  assert.equal(bridge.save(state), true);
  await assert.rejects(bridge.create({state, role: 0, zone: 'UTC'}), error => error.code === 'storage-unavailable');
  bridge.stop();
});

test('cached offline startup reuses the received clock offset instead of rewinding to a stale serverNow', async t => {
  const {service, state, own} = fixture(t); state.shared.push(sampleTask());
  const originalNow = Date.now; let deviceNow = service.now() + 15000;
  Date.now = () => deviceNow; t.after(() => { Date.now = originalNow; });
  const client = own(syncClient(service, {state}));
  await client.bridge.start(); await client.bridge.create({state, role: 0, zone: 'Asia/Manila'});
  await client.bridge.focus({action: 'start', owner: 2, taskId: 'task-one', minutes: 5});
  const sample = client.states.at(-1).envelope;
  assert.equal(sample.serverOffset, -15000);
  client.bridge.stop(); deviceNow += 3600000;
  const reloaded = own(syncClient(service, {storage: client.storage})); reloaded.offline();
  assert.equal(await reloaded.bridge.start(), false);
  const cached = reloaded.states.at(-1).envelope;
  assert.equal(cached.serverOffset, sample.serverOffset);
  assert.equal(cached.serverReceivedAt, sample.serverReceivedAt);
  assert.equal(Date.now() + cached.serverOffset, service.now() + 3600000);
  assert.ok(Date.now() + cached.serverOffset > reloaded.state.togetherTimer.started + reloaded.state.togetherTimer.remaining);
});

test('repeated optimistic callbacks keep the original clock sample as device time advances', async t => {
  const {service, state, own} = fixture(t); state.shared.push(sampleTask());
  const originalNow = Date.now; let deviceNow = service.now() + 21000;
  Date.now = () => deviceNow; t.after(() => { Date.now = originalNow; });
  const client = own(syncClient(service, {state}));
  await client.bridge.start(); await client.bridge.create({state, role: 0, zone: 'Asia/Manila'});
  const sample = client.states.at(-1).envelope; client.offline();
  for (let i = 1; i <= 3; i++) {
    deviceNow += 60000;
    client.edit(s => { s.shared[0].title = 'Offline edit ' + i; });
    const emitted = client.states.at(-1).envelope;
    assert.equal(emitted.serverOffset, -21000);
    assert.equal(emitted.serverReceivedAt, sample.serverReceivedAt);
    assert.equal(Date.now() + emitted.serverOffset, service.now() + i * 60000);
  }
  assert.equal(await client.bridge.flush(), false);
  assert.equal(client.states.at(-1).envelope.serverOffset, sample.serverOffset);
});

test('revoked remains revoked after a local edit, flush and reload while pending data stays durable', async t => {
  const {service, state, own} = fixture(t); state.shared.push(sampleTask());
  const client = own(syncClient(service, {state})); await client.bridge.start();
  await client.bridge.create({state, role: 0, zone: 'Asia/Manila'});
  await client.bridge.revoke(client.bridge.connection.deviceId);
  assert.equal(client.bridge.status.kind, 'revoked');
  assert.equal(client.edit(s => { s.shared[0].title = 'Keep this offline edit'; }), true);
  assert.equal(client.bridge.status.kind, 'revoked'); assert.equal(client.bridge.status.pending, 1);
  assert.equal(await client.bridge.flush(), false);
  assert.equal(client.bridge.status.kind, 'revoked'); assert.equal(client.bridge.status.pending, 1);
  client.bridge.stop();
  const reloaded = own(syncClient(service, {storage: client.storage}));
  assert.equal(await reloaded.bridge.start(), false);
  assert.equal(reloaded.bridge.status.kind, 'revoked'); assert.equal(reloaded.bridge.status.pending, 1);
  assert.equal(reloaded.state.shared[0].title, 'Keep this offline edit');
});

test('a lost restore response resumes the same durable mutation once after reload', async t => {
  const {service, state, own} = fixture(t); state.shared.push(sampleTask());
  let lose = true;
  const client = own(syncClient(service, {state, fetcher: async (url, options) => {
    const response = await service.fetcher(url, options);
    if (url.endsWith('/restore') && lose) { lose = false; throw new TypeError('lost restore reply'); }
    return response;
  }}));
  await client.bridge.start(); await client.bridge.create({state, role: 0, zone: 'Asia/Manila'});
  const restored = structuredClone(client.state); restored.names = ['Restored Black', 'Restored Pink'];
  await assert.rejects(client.bridge.restore({state: restored}), error => error.code === 'offline');
  client.bridge.stop();
  const reloaded = own(syncClient(service, {storage: client.storage}));
  assert.equal(await reloaded.bridge.start(), true);
  assert.deepEqual(reloaded.state.names, restored.names);
  const restores = service.calls.filter(call => call.path === '/restore');
  assert.equal(restores.length, 2); assert.deepEqual(restores[0].body, restores[1].body);
  assert.equal(reloaded.bridge.connection.revision, 1);
});

test('a restore losing its revision race stays explicitly reviewable instead of replacing partner changes', async t => {
  const {service, state, own} = fixture(t); state.shared.push(sampleTask());
  const pair = await connectedPair(service, state), left = own(pair.left), right = own(pair.right);
  right.edit(s => { s.shared[0].title = 'Partner changed this first'; }); await right.bridge.flush();
  await assert.rejects(left.bridge.restore({state}), error => error.code === 'conflict');
  assert.equal(left.bridge.status.kind, 'conflict');
  const conflict = left.bridge.status.conflicts.find(item => item.path === 'restore');
  assert.equal(conflict.local.shared[0].title, 'Plan the weekend');
  assert.equal(conflict.remote.shared[0].title, 'Partner changed this first');
  assert.equal(await left.bridge.resolveConflicts('remote'), true);
  assert.equal(left.state.shared[0].title, 'Partner changed this first');
});


test('recovery can retry after a device-name edit, reusing the original identity without a second pairing', async t => {
  const {service, own} = fixture(t);
  const owner = own(syncClient(service)); await owner.bridge.start();
  await owner.bridge.create({state: owner.state, role: 0, zone: 'Asia/Manila', deviceName: 'Original phone'});
  const recovery = owner.bridge.recoveryDetails();
  let lostReply = false;
  const other = own(syncClient(service, {fetcher: async (url, options) => {
    const response = await service.fetcher(url, options);
    if (url.endsWith('/recover') && !lostReply) { lostReply = true; throw new TypeError('lost recovery reply'); }
    return response;
  }}));
  await other.bridge.start();
  await assert.rejects(other.bridge.recover({...recovery, deviceName: 'My new device'}), error => error.code === 'offline');
  assert.deepEqual(other.bridge.pendingConnection(), {type: 'recover', deviceName: 'My new device'});
  await other.bridge.recover({...recovery, deviceName: 'NASH LAPTOP'});
  assert.equal(other.bridge.connection.spaceId, owner.bridge.connection.spaceId);
  assert.equal(service.calls.filter(call => call.path === '/recover').length, 1);
  assert.equal(other.bridge.pendingConnection(), null);
  assert.notEqual(other.bridge.connection.deviceId, owner.bridge.connection.deviceId);
});

test('rate-limited or definitively rejected pairing releases the unfinished attempt without erasing local tasks', async t => {
  const {service, own} = fixture(t);
  const creator = own(syncClient(service)); await creator.bridge.start();
  await creator.bridge.create({state: creator.state, role: 0, zone: 'Asia/Manila'});
  const invite = (await creator.bridge.invite()).invite;
  const joining = own(syncClient(service, {fetcher: async (url, opts) => {
    if (url.endsWith('/join')) return new Response(JSON.stringify({code:'rate_limited',error:'Too many pairing attempts. Wait before trying again.'}),{status:429});
    return service.fetcher(url,opts);
  }}));
  await joining.bridge.start();
  joining.state.people[1].tasks.push(sampleTask('keep-this-task'));
  await assert.rejects(joining.bridge.join({invite, deviceName:'Old failed invite'}), error => error.code === 'rate_limited');
  assert.equal(joining.bridge.pendingConnection(), null, 'definitive 429 cannot trap a new flow');
  assert.equal(joining.state.people[1].tasks[0].id, 'keep-this-task');
  await joining.bridge.recover({...creator.bridge.recoveryDetails(),deviceName:'NASH LAPTOP'});
  assert.equal(joining.bridge.connection.role, 0);
});

test('resolve earlier attempt verifies that an already-created space is still accessible', async t => {
  const {service, own} = fixture(t);
  let lost = false;
  const client = own(syncClient(service, {fetcher: async (url, options) => {
    const response = await service.fetcher(url, options);
    if (url.endsWith('/spaces') && !lost) { lost = true; throw new TypeError('lost create reply'); }
    return response;
  }}));
  await client.bridge.start();
  client.state.shared.push(sampleTask('keep-current','Do not lose me'));
  await assert.rejects(client.bridge.create({state:client.state,role:0,zone:'Asia/Manila',deviceName:'Phone'}),error => error.code==='offline');
  const result=await client.bridge.resetPending();
  assert.equal(result.outcome,'connected');
  assert.equal(client.state.shared[0].id,'keep-current');
  assert.equal(service.calls.filter(call=>call.path==='/spaces').length,1);
  assert.equal(client.bridge.pendingConnection(),null);
});

test('resolve unfinished invitation checks server then safely clears an unaccepted attempt', async t => {
  const {service, own} = fixture(t);
  const creator = own(syncClient(service)); await creator.bridge.start();
  await creator.bridge.create({state:creator.state,role:0,zone:'Asia/Manila'});
  const invite=(await creator.bridge.invite()).invite;
  const stranded=own(syncClient(service)); await stranded.bridge.start();
  stranded.offline();
  stranded.state.shared.push(sampleTask('local-safe','Saved locally'));
  await assert.rejects(stranded.bridge.join({invite,deviceName:'Partner phone'}),error=>error.code==='offline');
  assert.equal(stranded.bridge.pendingConnection().type,'join');
  stranded.online();
  const result=await stranded.bridge.resetPending();
  assert.equal(result.outcome,'cleared');
  assert.equal(stranded.bridge.pendingConnection(),null);
  assert.equal(stranded.state.shared[0].id,'local-safe');
  await stranded.bridge.recover({...creator.bridge.recoveryDetails(),deviceName:'My laptop'});
  assert.equal(stranded.bridge.connection.role,0);
});

test('offline reset never discards an ambiguous create attempt', async t => {
  const {service, own} = fixture(t);
  const client=own(syncClient(service)); await client.bridge.start();
  client.offline();
  await assert.rejects(client.bridge.create({state:client.state,role:0,zone:'Asia/Manila'}),error=>error.code==='offline');
  assert.equal(client.bridge.pendingConnection().type,'spaces');
  await assert.rejects(client.bridge.resetPending(),error=>error.code==='offline');
  assert.equal(client.bridge.pendingConnection().type,'spaces');
});


test('an unknown definite 4xx pairing rejection is cleared and does not brand an unconnected device as revoked', async t => {
  const {service, own} = fixture(t);
  const client = own(syncClient(service, {fetcher: async (url, options) => {
    if (url.endsWith('/spaces')) return new Response(JSON.stringify({code: 'new_validation_rule', error: 'Please correct your profile before creating a space.'}), {status: 422});
    return service.fetcher(url, options);
  }}));
  await client.bridge.start();
  await assert.rejects(client.bridge.create({state: client.state, role: 0, zone: 'Asia/Manila'}), error => error.httpStatus === 422);
  assert.equal(client.bridge.pendingConnection(), null);
  assert.equal(client.bridge.status.kind, 'error');
  assert.equal(client.bridge.connection, null);
});

test('incorrect recovery details are a pairing error, not a device revocation; valid recovery remains possible', async t => {
  const {service, own} = fixture(t);
  const creator = own(syncClient(service)); await creator.bridge.start();
  await creator.bridge.create({state: creator.state, role: 0, zone: 'Asia/Manila'});
  const client = own(syncClient(service)); await client.bridge.start();
  const details = creator.bridge.recoveryDetails();
  await assert.rejects(client.bridge.recover({...details, recoveryKey: 'A'.repeat(43), deviceName: 'Laptop'}), error => error.code === 'invalid_recovery');
  assert.equal(client.bridge.status.kind, 'error');
  assert.equal(client.bridge.pendingConnection(), null);
  await client.bridge.recover({...details, deviceName: 'Laptop'});
  assert.equal(client.bridge.connection.spaceId, creator.bridge.connection.spaceId);
});

test('unfinished pairing does not schedule background POST retries into the hourly limit', async t => {
  const {service, own} = fixture(t);
  const setTimeoutOriginal = globalThis.setTimeout;
  const scheduled = [];
  globalThis.setTimeout = (callback, delay, ...args) => {
    scheduled.push(delay);
    return setTimeoutOriginal(callback, delay, ...args);
  };
  t.after(() => { globalThis.setTimeout = setTimeoutOriginal; });
  const client = own(syncClient(service)); await client.bridge.start();
  client.offline();
  await assert.rejects(client.bridge.join({invite: 'I'.repeat(43), deviceName: 'Offline phone'}), error => error.code === 'offline');
  assert.equal(client.bridge.pendingConnection().type, 'join');
  assert.ok(!scheduled.some(delay => delay === 5000 || delay === 30000 || delay === 60000), 'pending pairing must not keep polling POSTs');
});

test('a definitively rejected state PUT is blocked, survives reload, and preserves newer independent edits', async t => {
  const {service, state, own} = fixture(t); state.shared.push(sampleTask());
  let forbidden = 1;
  const fetcher = async (url, options) => {
    if (url.endsWith('/state') && options.method === 'PUT' && forbidden-- > 0)
      return new Response(JSON.stringify({code:'forbidden', error:'Only the owner may edit that private task.'}), {status:403});
    return service.fetcher(url, options);
  };
  const client = own(syncClient(service, {state, fetcher}));
  await client.bridge.start(); await client.bridge.create({state, role: 0, zone: 'Asia/Manila'});
  client.edit(s => s.shared[0].title = 'Rejected title');
  assert.equal(await client.bridge.flush(), false);
  assert.equal(client.bridge.status.kind, 'conflict');
  assert.equal(client.bridge.status.conflicts[0].kind, 'save-rejected');
  assert.equal(client.bridge.status.pending, 1);
  assert.equal(await client.bridge.flush(), false);
  assert.equal(service.calls.filter(x=>x.method==='PUT').length,0,'rejected payload is never sent again');
  // Newer unrelated work must remain queued behind the blocked operation.
  client.edit(s => s.people[0].tasks.push(sampleTask('new-after-rejection','Keep my later task')));
  assert.equal(client.bridge.status.pending, 2);
  client.bridge.stop();
  const resumed = own(syncClient(service, {storage: client.storage}));
  assert.equal(await resumed.bridge.start(), false);
  assert.equal(resumed.bridge.status.conflicts[0].kind,'save-rejected');
  assert.equal(resumed.bridge.status.pending,2);
  assert.equal(resumed.state.shared[0].title,'Rejected title','rejected local data remains reviewable');
  assert.equal(await resumed.bridge.discardRejected(),true);
  assert.equal(resumed.state.shared[0].title,'Plan the weekend');
  assert.equal(resumed.state.people[0].tasks[0].id,'new-after-rejection');
  assert.equal(resumed.bridge.status.pending,0);
  assert.equal(service.calls.filter(x=>x.method==='PUT').length,1,'only the later independent edit was sent');
  assert.equal((await service.request('GET','/state',undefined,service.calls.find(x=>x.path==='/spaces').body.deviceToken)).body.state.people[0].tasks[0].id,'new-after-rejection');
});

test('a network error on PUT is kept for exact replay and is not misclassified as a rejected save', async t => {
  const {service, state, own} = fixture(t); state.shared.push(sampleTask());
  let interrupted=true;
  const client = own(syncClient(service,{state,fetcher:async(url,options)=>{
    if(interrupted && url.endsWith('/state') && options.method==='PUT'){interrupted=false;throw new TypeError('network lost');}
    return service.fetcher(url,options);
  }}));
  await client.bridge.start(); await client.bridge.create({state,role:0,zone:'Asia/Manila'});
  client.edit(s=>s.shared[0].title='Keep this until online');
  assert.equal(await client.bridge.flush(),false);
  assert.notEqual(client.bridge.status.kind,'conflict');
  assert.equal(await client.bridge.flush(),true);
  assert.equal(client.state.shared[0].title,'Keep this until online');
});

test('advanced explicit reset can discard only a stuck unconnected handshake while offline', async t => {
  const {service,own}=fixture(t);
  const client=own(syncClient(service));await client.bridge.start();client.offline();
  client.state.people[0].tasks.push(sampleTask('precious-local','My important local task'));
  await assert.rejects(client.bridge.join({invite:'I'.repeat(43),deviceName:'Old phone'}),e=>e.code==='offline');
  assert.equal(client.bridge.pendingConnection().type,'join');
  await assert.rejects(client.bridge.resetPending(),e=>e.code==='offline');
  const pendingRequestCount=service.calls.length;
  assert.deepEqual(await client.bridge.forgetPending(),{outcome:'cleared'});
  assert.equal(client.bridge.pendingConnection(),null);
  assert.equal(client.bridge.connection,null);
  assert.equal(client.state.people[0].tasks[0].id,'precious-local');
  assert.equal(service.calls.length,pendingRequestCount,'manual reset does not call the backend');
  assert.deepEqual(await client.bridge.forgetPending(),{outcome:'none'});
});

test('manual pending reset never disconnects an authenticated device', async t=>{
  const {service,own}=fixture(t);
  const client=own(syncClient(service));await client.bridge.start();
  await client.bridge.create({state:client.state,role:0,zone:'Asia/Manila'});
  const before=client.bridge.connection;
  await assert.rejects(client.bridge.forgetPending(),e=>e.code==='already-connected');
  assert.deepEqual(client.bridge.connection,before);
});
