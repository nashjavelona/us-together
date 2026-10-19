import test from 'node:test';
import assert from 'node:assert/strict';
import {
  setCalendarZone, getCalendarZone, day, at, addCalendarDays,
  nextCalendarMidnight, validDate, parse, defaults, generate, plan, settle,
} from '../core.js';
import {calendarDayDifference, calendarWeekday} from '../calendar.js';
import {initial} from '../couple.js';
import {settleTogether} from '../together.js';

const minute = 60000;
const stamp = text => new Date(text).getTime();
function zone(t, name) { setCalendarZone(name); t.after(() => setCalendarZone(null)); }

test('local mode retains browser-local day and wall-time interpretation', t => {
  zone(t, null);
  const value = new Date('2026-10-18T20:25:00Z');
  const expected = `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  assert.equal(day(value), expected);
  assert.equal(at('2026-10-18', '08:30'), new Date('2026-10-18T08:30:00').getTime());
  assert.equal(getCalendarZone(), null);
});

test('workspace day follows Manila across UTC midnight disagreement', t => {
  zone(t, 'Asia/Manila');
  assert.equal(day(new Date('2026-10-18T15:59:59Z')), '2026-10-18');
  assert.equal(day(new Date('2026-10-18T16:00:00Z')), '2026-10-19');
  assert.equal(at('2026-10-19', '08:30'), stamp('2026-10-19T00:30:00Z'));
});

test('non-hour zone offsets resolve correctly and changing zones clears cached instants', t => {
  zone(t, 'Asia/Kathmandu');
  assert.equal(at('2026-10-19', '08:30'), stamp('2026-10-19T02:45:00Z'));
  setCalendarZone('Asia/Manila');
  assert.equal(at('2026-10-19', '08:30'), stamp('2026-10-19T00:30:00Z'));
  setCalendarZone(null);
  assert.equal(at('2026-10-19', '08:30'), new Date('2026-10-19T08:30:00').getTime());
});

test('invalid zone leaves the existing calendar intact', t => {
  zone(t, 'Asia/Manila');
  assert.throws(() => setCalendarZone('Not/A_Real_Zone'), RangeError);
  assert.equal(getCalendarZone(), 'Asia/Manila');
  assert.throws(() => setCalendarZone(''), RangeError);
  assert.equal(day(new Date('2026-10-18T16:00:00Z')), '2026-10-19');
});

test('tomorrow and weekday capture use the workspace civil date', t => {
  zone(t, 'Asia/Manila');
  const now = new Date('2026-10-18T16:05:00Z'); // Monday in the workspace.
  const tomorrow = parse('Read tomorrow for 20 minutes', 25, now);
  assert.equal(tomorrow.notBefore, '2026-10-20');
  assert.equal(tomorrow.due, '2026-10-20');
  assert.equal(parse('Walk on Monday', 25, now).notBefore, '2026-10-19');
  assert.equal(parse('Walk on Sunday', 25, now).notBefore, '2026-10-25');
  const deadline = parse('Finish by Monday', 25, now);
  assert.equal(deadline.due, '2026-10-19');
  assert.equal(deadline.notBefore, '2026-10-19');
});

test('date validation and civil arithmetic are independent of selected and host zones', t => {
  zone(t, 'Pacific/Kiritimati');
  assert.equal(validDate('2028-02-29'), true);
  assert.equal(validDate('2026-02-29'), false);
  assert.equal(validDate('2026-04-31'), false);
  assert.equal(addCalendarDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addCalendarDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addCalendarDays('2026-03-08', 1), '2026-03-09');
  assert.equal(calendarDayDifference('2026-03-07', '2026-03-09'), 2);
  assert.equal(calendarWeekday('2026-10-19'), 1);
});

test('weekly routines roll deadlines by calendar days across a DST change', t => {
  zone(t, 'America/New_York');
  const person = defaults();
  person.routines.push({...parse('Sunday tidy for 20 minutes', 25, new Date('2026-03-01T12:00:00Z')),
    repeat: 'weekly', days: [0], from: '2026-03-01', due: '2026-03-03'});
  generate(person, '2026-03-08');
  assert.equal(person.tasks.length, 1);
  assert.equal(person.tasks[0].notBefore, '2026-03-08');
  assert.equal(person.tasks[0].due, '2026-03-10');
  generate(person, '2026-03-09');
  assert.equal(person.tasks.length, 1);
});

test('plan uses workspace dates, working hours, and appointment instants', t => {
  zone(t, 'Asia/Manila');
  const now = stamp('2026-10-18T16:01:00Z'), person = defaults();
  person.settings.end = '09:00';
  person.tasks.push(parse('Read for 20 minutes', 25, new Date(now)));
  person.appointments.push({id: 'a', title: 'Call', date: '2026-10-19', start: '08:10', end: '08:30'});
  const result = plan(person, now);
  assert.ok(person.plans['2026-10-19']);
  const focus = result.blocks.filter(block => block.type === 'focus');
  assert.equal(focus[0].start, stamp('2026-10-19T00:00:00Z'));
  assert.ok(focus.every(block => block.end <= stamp('2026-10-19T01:00:00Z')));
  assert.ok(focus.every(block => block.end <= stamp('2026-10-19T00:10:00Z') || block.start >= stamp('2026-10-19T00:30:00Z')));
});

test('shared reservations are clipped at workspace midnight rather than host midnight', t => {
  zone(t, 'Asia/Manila');
  const person = defaults(), now = stamp('2026-10-19T15:50:00Z');
  const result = plan(person, now, [{type: 'together', title: 'Together', start: now, end: now + 20 * minute}]);
  const reserved = result.blocks.find(block => block.type === 'together');
  assert.equal(reserved.end, stamp('2026-10-19T16:00:00Z'));
});

test('connected plan mode does not generate either member’s local routine occurrences', t => {
  zone(t, 'Asia/Manila');
  const person = defaults(), now = stamp('2026-10-19T00:00:00Z');
  person.routines.push({...parse('Read daily', 25, new Date(now)), repeat: 'daily', days: [], from: '2026-10-19'});
  plan(person, now, [], false);
  assert.equal(person.tasks.length, 0);
  assert.equal(person.routines[0].generatedDays, undefined);
  plan(person, now, [], true);
  assert.equal(person.tasks.length, 1);
});

test('personal focused time splits at workspace midnight with no duplicate accounting', t => {
  zone(t, 'Asia/Manila');
  const started = stamp('2026-10-18T15:59:00Z'), person = defaults();
  const task = parse('Read', 25, new Date(started));
  person.tasks.push(task);
  person.timer = {task: task.id, started, remaining: 2 * minute, running: true};
  settle(person, started + 2 * minute);
  assert.deepEqual(person.sessions.map(row => [row.date, row.seconds]), [['2026-10-18', 60], ['2026-10-19', 60]]);
  assert.equal(task.spent, 120);
  settle(person, started + 5 * minute);
  assert.equal(person.sessions.length, 2);
});

test('shared focused time uses the same workspace midnight split', t => {
  zone(t, 'Asia/Manila');
  const state = initial(), started = stamp('2026-10-18T15:59:00Z');
  const task = parse('Plan together', 25, new Date(started));
  state.shared.push(task);
  state.togetherTimer = {task: task.id, started, remaining: 2 * minute, running: true};
  settleTogether(state, started + 2 * minute);
  assert.deepEqual(state.togetherSessions.map(row => [row.date, row.seconds]), [['2026-10-18', 60], ['2026-10-19', 60]]);
  assert.equal(task.spent, 120);
});

test('DST gaps move forward and repeated clock times choose the earlier occurrence', t => {
  zone(t, 'America/New_York');
  assert.equal(at('2026-03-08', '02:30'), stamp('2026-03-08T07:30:00Z'));
  assert.equal(at('2026-11-01', '01:30'), stamp('2026-11-01T05:30:00Z'));
  setCalendarZone('Australia/Lord_Howe');
  assert.equal(at('2026-10-04', '02:15'), stamp('2026-10-03T15:45:00Z'));
});

test('calendar midnight follows 23-hour and 25-hour days without fixed-day assumptions', t => {
  zone(t, 'America/New_York');
  const spring = at('2026-03-08', '00:00'), autumn = at('2026-11-01', '00:00');
  assert.equal(nextCalendarMidnight(spring) - spring, 23 * 60 * minute);
  assert.equal(nextCalendarMidnight(autumn) - autumn, 25 * 60 * minute);
  assert.equal(nextCalendarMidnight(stamp('2026-11-01T06:30:00Z')), stamp('2026-11-02T05:00:00Z'));
});
