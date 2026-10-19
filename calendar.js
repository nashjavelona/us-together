// A browser workspace can have a different calendar from the phone running it.
// This module is page-local. Server requests must use their own explicit zone.
let selectedZone = null;
let zonedFormatter = null;
const instantCache = new Map();
const DAY = 86400000;
const INVALID_DAY = 'NaN-NaN-NaN';
const pad = number => String(number).padStart(2, '0');

function dateLabel(date, utc = false) {
  const year = utc ? date.getUTCFullYear() : date.getFullYear();
  const month = (utc ? date.getUTCMonth() : date.getMonth()) + 1;
  const day = utc ? date.getUTCDate() : date.getDate();
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
}

function civilEpoch(year, month, day, hour = 0, minute = 0, second = 0) {
  // setUTCFullYear avoids Date.UTC's special treatment of years 0 through 99.
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  value.setUTCHours(hour, minute, second, 0);
  return value.getTime();
}

function civilDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const instant = civilEpoch(year, month, day);
  if (dateLabel(new Date(instant), true) !== date) return null;
  return {year, month, day, instant};
}

function parts(instant) {
  const values = Object.fromEntries(
    zonedFormatter.formatToParts(new Date(instant))
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)]),
  );
  return values;
}

function wallEpoch(instant) {
  const value = parts(instant);
  return civilEpoch(value.year, value.month, value.day, value.hour, value.minute, value.second);
}

export function setCalendarZone(zone = null) {
  if (zone !== null && (typeof zone !== 'string' || !zone.trim())) {
    throw new RangeError('Choose a valid IANA time zone.');
  }
  // Construct before assigning, so an invalid zone does not erase the current one.
  const formatter = zone === null ? null : new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, calendar: 'gregory', numberingSystem: 'latn',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  selectedZone = zone;
  zonedFormatter = formatter;
  instantCache.clear();
  return selectedZone;
}

export const getCalendarZone = () => selectedZone;
export const isCalendarDate = date => civilDate(date) !== null;

export function calendarDay(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return INVALID_DAY;
  if (!selectedZone) return dateLabel(date);
  const result = parts(date.getTime());
  return `${String(result.year).padStart(4, '0')}-${pad(result.month)}-${pad(result.day)}`;
}

export function addCalendarDays(date, count) {
  const value = civilDate(date);
  if (!value || !Number.isInteger(count)) return INVALID_DAY;
  return dateLabel(new Date(value.instant + count * DAY), true);
}

export function calendarWeekday(date) {
  const value = civilDate(date);
  return value ? new Date(value.instant).getUTCDay() : NaN;
}

export function calendarDayDifference(from, to) {
  const left = civilDate(from), right = civilDate(to);
  return left && right ? (right.instant - left.instant) / DAY : NaN;
}

export function calendarAt(date, time) {
  const value = civilDate(date);
  if (!value || typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return NaN;
  if (!selectedZone) return new Date(`${date}T${time}:00`).getTime();
  const key = `${date}T${time}`;
  if (instantCache.has(key)) return instantCache.get(key);

  const [hour, minute] = time.split(':').map(Number);
  const wanted = civilEpoch(value.year, value.month, value.day, hour, minute);
  // Include offsets on both sides of a transition. This also covers half-hour
  // changes and the rare skipped civil day. No assumption that a day is 24 hours.
  const offsets = new Set([-2, -1, 0, 1, 2].map(delta => {
    const sample = wanted + delta * DAY;
    return wallEpoch(sample) - sample;
  }));
  const candidates = [...offsets].map(offset => {
    const instant = wanted - offset;
    return {instant, difference: wallEpoch(instant) - wanted};
  });
  const exact = candidates.filter(candidate => candidate.difference === 0)
    .sort((a, b) => a.instant - b.instant);
  // Compatible wall-time behavior: choose the earlier occurrence of a repeated
  // clock time, or move forward by the clock gap when the time does not exist.
  const forward = candidates.filter(candidate => candidate.difference > 0)
    .sort((a, b) => a.difference - b.difference || a.instant - b.instant);
  const result = exact[0]?.instant ?? forward[0]?.instant ?? NaN;
  if (instantCache.size >= 512) instantCache.clear();
  instantCache.set(key, result);
  return result;
}

export function nextCalendarMidnight(instant) {
  return calendarAt(addCalendarDays(calendarDay(new Date(instant)), 1), '00:00');
}
