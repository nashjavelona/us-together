import {validCouple} from './couple.js';

const MAX_BYTES = 1024 * 1024;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const privateKeys = new Set(['deviceToken', 'recoveryKey', 'authorization', 'credentials']);
const commonFields = ['setup', 'tagline', 'sound', 'pinnedNote', 'momentIndex'];

export class SyncModelError extends Error {
  constructor(message, code = 'invalid-state') {
    super(message);
    this.name = 'SyncModelError';
    this.code = code;
  }
}

/** Clone JSON while rejecting prototype keys, non-finite values and oversized data. */
export function cloneJSON(input, {privateData = false} = {}) {
  let nodes = 0;
  const visit = (value, depth) => {
    if (++nodes > 100000 || depth > 40) throw new SyncModelError('The saved data is too large or deeply nested.');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (value.length > MAX_BYTES) throw new SyncModelError('The saved data is too large.');
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value)) {
      if (value.length > 10000) throw new SyncModelError('The saved data contains too many items.');
      return value.map(item => visit(item, depth + 1));
    }
    if (value && typeof value === 'object') {
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) throw new SyncModelError('Only plain saved data is supported.');
      const result = {};
      for (const key of Object.keys(value)) {
        if (forbidden.has(key) || (!privateData && privateKeys.has(key))) throw new SyncModelError('The saved data contains a private or unsafe field.');
        if (value[key] !== undefined) result[key] = visit(value[key], depth + 1);
      }
      return result;
    }
    throw new SyncModelError('The saved data is not valid JSON.');
  };
  const result = visit(input, 0);
  const text = JSON.stringify(result);
  const size = typeof TextEncoder === 'function' ? new TextEncoder().encode(text).length : text.length * 3;
  if (size > MAX_BYTES) throw new SyncModelError('The saved data exceeds the one-megabyte limit.');
  return result;
}

export function validZone(zone) {
  if (typeof zone !== 'string' || !zone || zone.length > 100) return false;
  try { new Intl.DateTimeFormat('en', {timeZone: zone}).format(0); return true; } catch { return false; }
}

function unique(records) {
  return new Set(records.map(record => record.id)).size === records.length;
}

/** The portable state contains no credentials, selected profile or derived plans. */
export function wireState(input) {
  const state = cloneJSON(input);
  state.active = 0;
  if (Array.isArray(state.people)) state.people.forEach(person => { person.plans = {}; });
  if (!validCouple(state) || !unique(state.notes) || state.people.some(person => !unique(person.routines) || !unique(person.appointments))) {
    throw new SyncModelError('The shared space contains invalid or duplicate records.');
  }
  return state;
}

export function validateEnvelope(input, expected = {}) {
  const value = cloneJSON(input);
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      ![0, 1].includes(value.role) || !validZone(value.zone) ||
      typeof value.partnerJoined !== 'boolean' || !Number.isFinite(value.serverNow) || value.serverNow < 0 ||
      !['spaceId', 'deviceId'].every(key => typeof value[key] === 'string' && value[key].length > 0 && value[key].length <= 200) ||
      value.state?.active !== 0 || !Array.isArray(value.state?.people) ||
      value.state.people.some(person => !person.plans || Array.isArray(person.plans) || Object.keys(person.plans).length)) {
    throw new SyncModelError('The server returned an invalid shared-space response.', 'invalid-response');
  }
  for (const key of ['spaceId', 'role', 'deviceId', 'zone']) {
    if (expected[key] !== undefined && value[key] !== expected[key]) throw new SyncModelError('The server response belongs to a different connection.', 'invalid-response');
  }
  return {
    state: wireState(value.state), revision: value.revision, spaceId: value.spaceId,
    role: value.role, zone: value.zone, partnerJoined: value.partnerJoined,
    serverNow: value.serverNow, deviceId: value.deviceId,
  };
}

export function stateForRole(state, role) {
  const result = wireState(state);
  result.active = role;
  return result;
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}

/** Completion clocks and earned time belong to the server, not a task edit. */
function comparable(key, value) {
  if (value === null) return value;
  if (key.startsWith('note/')) {
    const note = {...value.note}; delete note.date;
    return {...value, note};
  }
  if (key.startsWith('routine/')) {
    const routine = {...value.routine};
    for (const field of ['spent', 'created', 'assignedBy', 'completed', 'completedDay', 'generatedDays', 'status', 'request']) delete routine[field];
    routine.steps = routine.steps.map(step => ({title: step.title}));
    return {...value, routine};
  }
  if (!key.startsWith('task/')) return value;
  const task = {...value.task};
  delete task.spent;
  delete task.created;
  delete task.assignedBy;
  delete task.completed;
  delete task.completedDay;
  task.help = task.help === true;
  task.helper = task.helper ?? null;
  if (task.request) {
    task.request = {...task.request};
    delete task.request.created;
  } else delete task.request;
  return {...value, task};
}

export const sameRecord = (key, a, b) => canonical(comparable(key, a)) === canonical(comparable(key, b));

function records(input) {
  const state = wireState(input), map = new Map();
  for (let owner = 0; owner < 3; owner++) {
    for (const original of owner === 2 ? state.shared : state.people[owner].tasks) {
      const task = {...original};
      delete task.spent;
      map.set('task/' + encodeURIComponent(task.id), {owner, task});
    }
  }
  for (let owner = 0; owner < 2; owner++) {
    const person = state.people[owner];
    for (const routine of person.routines) map.set(`routine/${owner}/` + encodeURIComponent(routine.id), {owner, routine});
    for (const appointment of person.appointments) map.set(`appointment/${owner}/` + encodeURIComponent(appointment.id), {owner, appointment});
    for (const [key, value] of Object.entries(person.settings)) map.set(`settings/${owner}/` + encodeURIComponent(key), {value});
    if (person.setup !== undefined) map.set(`person/${owner}/setup`, {value: person.setup});
    map.set(`name/${owner}`, {value: state.names[owner]});
    if (state.initials) map.set(`initial/${owner}`, {value: state.initials[owner]});
    const mood = state.checkins?.moods[owner];
    if (mood) map.set(`checkin/${owner}`, {date: state.checkins.date, mood});
  }
  for (const note of state.notes) map.set('note/' + encodeURIComponent(note.id), {note});
  for (const key of commonFields) if (state[key] !== undefined) map.set('common/' + key, {value: state[key]});
  return map;
}

function labelFor(key, before, after) {
  const record = after || before;
  if (key.startsWith('task/')) return record?.task?.title || 'Task';
  if (key.startsWith('routine/')) return record?.routine?.title || 'Routine';
  if (key.startsWith('appointment/')) return record?.appointment?.title || 'Appointment';
  if (key.startsWith('note/')) return 'Note: ' + (record?.note?.text || '').slice(0, 70);
  if (key.startsWith('checkin/')) return 'Daily check-in';
  if (key.startsWith('name/')) return 'Nickname';
  if (key.startsWith('initial/')) return 'Avatar initials';
  return key.split('/').at(-1).replaceAll('-', ' ');
}

function isPassivePartnerChange(key, before, after, role) {
  if (![0, 1].includes(role)) return false;
  if (key === `checkin/${1 - role}`) {
    // Starting a new day resets the display of yesterday's mood, not the partner's authored check-in.
    return after === null;
  }
  if (key.startsWith(`routine/${1 - role}/`) && before && after) {
    const a = {...before.routine}, b = {...after.routine};
    delete a.generatedDays; delete b.generatedDays;
    return canonical(a) === canonical(b);
  }
  return key.startsWith('task/') && before === null && after?.owner === 1 - role && after.task.routine && !after.task.request;
}

/** Compact immutable change intents, keyed by globally stable task IDs (including owner). */
export function changesBetween(beforeState, afterState, {role} = {}) {
  const before = records(beforeState), after = records(afterState), changes = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(key) ?? null, b = after.get(key) ?? null;
    if (sameRecord(key, a, b) || isPassivePartnerChange(key, a, b, role)) continue;
    if ([0, 1].includes(role) && (
      key.startsWith(`settings/${1 - role}/`) || key.startsWith(`person/${1 - role}/`) ||
      key.startsWith(`routine/${1 - role}/`) || key.startsWith(`appointment/${1 - role}/`) ||
      key === `checkin/${1 - role}` ||
      (key.startsWith('note/') && (a?.note?.from ?? b?.note?.from) !== role)
    )) throw new SyncModelError('Only your partner can change their personal settings, calendar, routines, notes or check-in.', 'forbidden');
    changes.push({key, before: a, after: b, label: labelFor(key, a, b)});
  }
  return cloneJSON(changes);
}

function materialize(authority, map) {
  const state = wireState(authority);
  const taskAuthority = new Map([...state.people.flatMap(person => person.tasks), ...state.shared].map(task => [task.id, task]));
  const routineAuthority = state.people.map(person => new Map(person.routines.map(routine => [routine.id, routine])));
  const noteAuthority = new Map(state.notes.map(note => [note.id, note]));
  state.people.forEach(person => { person.tasks = []; person.routines = []; person.appointments = []; person.settings = {}; delete person.setup; });
  state.shared = []; state.notes = [];
  for (const key of commonFields) delete state[key];
  delete state.initials;
  const checkins = [null, null];
  for (const [key, record] of map) {
    const parts = key.split('/');
    if (parts[0] === 'task') {
      const task = {...record.task}, remote = taskAuthority.get(task.id);
      task.spent = remote?.spent ?? 0;
      if (remote) task.created = remote.created;
      if (task.status === 'done' && remote?.status === 'done') {
        task.completed = remote.completed; task.completedDay = remote.completedDay;
      }
      (record.owner === 2 ? state.shared : state.people[record.owner].tasks).push(task);
    } else if (parts[0] === 'routine') {
      const routine = cloneJSON(record.routine), remote = routineAuthority[record.owner].get(routine.id);
      if (remote) {
        for (const field of ['spent', 'created', 'assignedBy', 'completed', 'completedDay', 'generatedDays', 'status', 'request']) {
          if (remote[field] === undefined) delete routine[field]; else routine[field] = cloneJSON(remote[field]);
        }
      } else {
        routine.spent = 0; routine.status = 'open'; routine.generatedDays = [];
        routine.steps = routine.steps.map(step => ({...step, done: false}));
        delete routine.completed; delete routine.completedDay; delete routine.request;
      }
      state.people[record.owner].routines.push(routine);
    }
    else if (parts[0] === 'appointment') state.people[record.owner].appointments.push(cloneJSON(record.appointment));
    else if (parts[0] === 'note') {
      const note = cloneJSON(record.note), remote = noteAuthority.get(note.id);
      if (remote) note.date = remote.date;
      state.notes.push(note);
    }
    else if (parts[0] === 'settings') state.people[Number(parts[1])].settings[decodeURIComponent(parts[2])] = record.value;
    else if (parts[0] === 'person') state.people[Number(parts[1])][parts[2]] = record.value;
    else if (parts[0] === 'common') state[parts[1]] = record.value;
    else if (parts[0] === 'name') state.names[Number(parts[1])] = record.value;
    else if (parts[0] === 'initial') { state.initials ??= ['', '']; state.initials[Number(parts[1])] = record.value; }
    else if (parts[0] === 'checkin') checkins[Number(parts[1])] = record;
  }
  const dates = [state.checkins?.date, ...checkins.map(record => record?.date)].filter(Boolean).sort();
  if (dates.length) {
    const date = dates.at(-1);
    state.checkins = {date, moods: checkins.map(record => record?.date === date ? record.mood : null)};
  }
  // The PUT endpoint settles the original server timer on these task transitions.
  // A structurally impossible timer is omitted from the optimistic/wire candidate.
  state.people.forEach(person => {
    if (person.timer && !person.tasks.some(task => task.id === person.timer.task && task.status === 'open' && !task.request)) person.timer = null;
  });
  if (state.togetherTimer && !state.shared.some(task => task.id === state.togetherTimer.task && task.status === 'open' && !task.request)) state.togetherTimer = null;
  return cloneJSON(state);
}

export function validateChange(input) {
  const change = cloneJSON(input);
  if (!change || typeof change.key !== 'string' || !/^(task\/[^/]+|routine\/[01]\/[^/]+|appointment\/[01]\/[^/]+|note\/[^/]+|settings\/[01]\/[^/]+|person\/[01]\/setup|name\/[01]|initial\/[01]|checkin\/[01]|common\/(setup|tagline|sound|pinnedNote|momentIndex))$/.test(change.key) ||
      !Object.hasOwn(change, 'before') || !Object.hasOwn(change, 'after') ||
      typeof change.label !== 'string' || change.label.length > 1000) throw new SyncModelError('A queued edit is damaged.', 'invalid-outbox');
  return change;
}

/** Replays causally ordered intents. Conflicting local versions remain visible and durable. */
export function replayChanges(authority, intents) {
  const map = records(authority), remoteRecords = new Map(map), conflicts = new Map();
  for (const intent of intents) for (const input of intent.changes) {
    const change = validateChange(input), current = map.get(change.key) ?? null;
    const nextDayCheckin = change.key.startsWith('checkin/') && change.after?.date &&
      (!change.before?.date || change.after.date > change.before.date) &&
      (current === null || current.date < change.after.date);
    if (!nextDayCheckin && !sameRecord(change.key, current, change.before) && !sameRecord(change.key, current, change.after)) {
      const previous = conflicts.get(change.key);
      conflicts.set(change.key, {
        path: change.key, label: change.label,
        kind: change.before === null ? 'add-add' : change.after === null || current === null ? 'delete-edit' : 'edit-edit',
        base: previous?.base ?? change.before,
        local: change.after,
        remote: remoteRecords.get(change.key) ?? null,
      });
    }
    if (change.after === null) map.delete(change.key); else map.set(change.key, change.after);
    if (conflicts.has(change.key)) conflicts.get(change.key).local = change.after;
  }
  const state = materialize(authority, map);
  if (!validCouple(state)) conflicts.set('state', {path: 'state', label: 'Related settings or task changes', kind: 'invalid-combination', base: null, local: null, remote: null});
  return {state, conflicts: cloneJSON([...conflicts.values()])};
}

export function mergeStates(base, local, remote, options) {
  return replayChanges(remote, [{changes: changesBetween(base, local, options)}]);
}

/** Stable topological ordering keeps sequential edits sequential across reloads and tabs. */
export function orderIntents(intents) {
  const superseded = new Set(intents.flatMap(intent => intent.supersedes || []));
  const waiting = intents.filter(intent => !superseded.has(intent.id)).sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
  const pending = new Set(waiting.map(intent => intent.id)), result = [];
  while (waiting.length) {
    const index = waiting.findIndex(intent => !(intent.parents || []).some(id => pending.has(id)));
    if (index < 0) throw new SyncModelError('Queued edits contain an invalid dependency.', 'invalid-outbox');
    const [intent] = waiting.splice(index, 1);
    pending.delete(intent.id); result.push(intent);
  }
  return result;
}
