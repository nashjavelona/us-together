import test from 'node:test';
import assert from 'node:assert/strict';
import {initial} from '../couple.js';
import {parse} from '../core.js';
import {wireState, changesBetween, mergeStates, orderIntents, validateEnvelope} from '../sync-model.js';

const copy = value => structuredClone(value);
function task(id, title = id) { return {...parse(title + ' for 25 minutes', 25, new Date('2026-10-18T10:00:00Z')), id}; }
function fixture() {
  const state = initial(); state.setup = true;
  state.people[0].tasks.push(task('left')); state.people[1].tasks.push(task('right')); state.shared.push(task('shared'));
  return state;
}

test('independent tasks, notes and settings fields merge without changing stable IDs', () => {
  const base = fixture(), local = copy(base), remote = copy(base);
  local.people[0].tasks[0].title = 'My edited task'; local.people[0].settings.focus = 30;
  local.notes.push({id: 'note-local', from: 0, text: 'Thank you', date: '2026-10-18T10:00:00Z'});
  remote.people[1].tasks[0].title = 'Their edited task'; remote.names[1] = 'Rose';
  remote.notes.push({id: 'note-remote', from: 1, text: 'Love you', date: '2026-10-18T10:01:00Z'});
  const result = mergeStates(base, local, remote);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.state.people[0].tasks[0].title, 'My edited task');
  assert.equal(result.state.people[1].tasks[0].title, 'Their edited task');
  assert.equal(result.state.people[0].settings.focus, 30);
  assert.equal(result.state.names[1], 'Rose');
  assert.deepEqual(new Set(result.state.notes.map(note => note.id)), new Set(['note-local', 'note-remote']));
});

test('two changes to the same task produce an explicit conflict even on different fields', () => {
  const base = fixture(), local = copy(base), remote = copy(base);
  local.shared[0].title = 'Local title'; remote.shared[0].minutes = 45;
  const result = mergeStates(base, local, remote);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].path, 'task/shared');
  assert.equal(result.conflicts[0].label, 'Local title');
  assert.equal(result.conflicts[0].remote.task.minutes, 45);
  assert.equal(result.state.shared[0].title, 'Local title');
});

test('owner is part of a global task record: concurrent move and edit cannot duplicate or silently overwrite it', () => {
  const base = fixture(), local = copy(base), remote = copy(base);
  const moved = local.shared.pop(); local.people[0].tasks.push(moved);
  remote.shared[0].title = 'Partner changed this';
  const result = mergeStates(base, local, remote);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].local.owner, 0);
  assert.equal(result.conflicts[0].remote.owner, 2);
  assert.equal(result.state.shared.length, 0);
  assert.equal(result.state.people.flatMap(person => person.tasks).filter(item => item.id === 'shared').length, 1);
});

test('delete versus edit is a conflict and independent additions survive it', () => {
  const base = fixture(), local = copy(base), remote = copy(base);
  local.shared = []; local.shared.push(task('new'));
  remote.shared[0].title = 'Keep this revision';
  const result = mergeStates(base, local, remote);
  assert.equal(result.conflicts[0].kind, 'delete-edit');
  assert.equal(result.conflicts[0].local, null);
  assert.equal(result.state.shared[0].id, 'new');
});

test('server accounting is authoritative and local view clears impossible active timers', () => {
  const base = fixture(), local = copy(base), remote = copy(base), now = Date.parse('2026-10-18T10:00:00Z');
  remote.togetherTimer = {task: 'shared', remaining: 25 * 60000, started: now, running: true};
  remote.shared[0].spent = 120;
  local.shared[0].status = 'done'; local.shared[0].spent = 99999;
  local.shared[0].completed = new Date(now).toISOString(); local.shared[0].completedDay = '2026-10-18';
  const result = mergeStates(base, local, remote);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.state.shared[0].spent, 120);
  assert.equal(result.state.togetherTimer, null);
  assert.equal(remote.togetherTimer.running, true);
});

test('changes to role, plans, timers, sessions and earned time create no ordinary edit', () => {
  const base = fixture(), local = copy(base);
  local.active = 1;
  local.people[0].plans = {'2026-10-18': {planned: [], blocks: [], overflow: []}};
  local.people[0].timer = {task: 'left', remaining: 300000, started: Date.now(), running: true};
  local.people[0].tasks[0].spent = 300;
  local.people[0].sessions.push({id: 'session', task: 'left', start: 0, end: 1000, seconds: 1, date: '2026-10-18'});
  assert.deepEqual(changesBetween(base, local), []);
  const wire = wireState(local);
  assert.equal(wire.active, 0); assert.deepEqual(wire.people[0].plans, {});
});

test('independent author check-ins on a new date merge into the same day', () => {
  const base = fixture(), local = copy(base), remote = copy(base);
  base.checkins = {date: '2026-10-17', moods: ['steady', 'steady']};
  local.checkins = {date: '2026-10-18', moods: ['bright', null]};
  remote.checkins = {date: '2026-10-18', moods: [null, 'soft']};
  const edits = changesBetween(base, local, {role: 0});
  assert.equal(edits.length, 1);
  // Each author has one logical record; starting a day does not author a partner reset.
  const result = mergeStates(base, local, remote, {role: 0});
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.state.checkins, {date: '2026-10-18', moods: ['bright', 'soft']});
});

test('partner routine generation and accounting cannot accidentally enqueue partner edits', () => {
  const base = fixture(), local = copy(base), template = {...task('routine'), repeat: 'daily', from: '2026-10-18', days: [], generatedDays: []};
  base.people[1].routines.push(copy(template)); local.people[1].routines.push({...template, generatedDays: ['2026-10-18']});
  local.people[1].tasks.push({...task('occurrence'), routine: 'routine', occurrenceDate: '2026-10-18'});
  assert.deepEqual(changesBetween(base, local, {role: 0}), []);
  local.people[1].settings.focus = 50;
  assert.throws(() => changesBetween(base, local, {role: 0}), error => error.code === 'forbidden');
});

test('persisted intents replay in dependency order and an explicit resolution supersedes old intents', () => {
  const a = {id: 'aaaaaaaa', created: 2, parents: [], changes: []};
  const b = {id: 'bbbbbbbb', created: 1, parents: ['aaaaaaaa'], changes: []};
  assert.deepEqual(orderIntents([b, a]).map(item => item.id), ['aaaaaaaa', 'bbbbbbbb']);
  const resolution = {id: 'cccccccc', created: 3, parents: [], supersedes: ['aaaaaaaa', 'bbbbbbbb'], changes: []};
  assert.deepEqual(orderIntents([a, b, resolution]).map(item => item.id), ['cccccccc']);
});

test('wire validation rejects private fields, prototype keys and a mismatched server identity', () => {
  const state = fixture();
  assert.throws(() => wireState({...state, deviceToken: 'do-not-save'}));
  const poisoned = JSON.parse(JSON.stringify(state).replace('"version":2', '"version":2,"__proto__":{"polluted":true}'));
  assert.throws(() => wireState(poisoned));
  const envelope = {state, revision: 0, role: 0, spaceId: 'space', deviceId: 'device', zone: 'UTC', partnerJoined: false, serverNow: Date.now()};
  assert.throws(() => validateEnvelope(envelope, {role: 1}), error => error.code === 'invalid-response');
  envelope.state.active = 1;
  assert.throws(() => validateEnvelope(envelope), error => error.code === 'invalid-response');
});
