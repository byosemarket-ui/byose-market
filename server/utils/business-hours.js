'use strict';

const RWANDA_TZ = 'Africa/Kigali';

function toHolidayKey(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const isoDay = text.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(isoDay)) return isoDay;
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return '';
    return rwandaDateKey(parsed);
}

function rwandaDateKey(date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: RWANDA_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    return `${year}-${month}-${day}`;
}

function rwandaWeekday(date) {
    return new Intl.DateTimeFormat('en-US', {
        timeZone: RWANDA_TZ,
        weekday: 'short'
    }).format(date);
}

function buildHolidaySet(holidays = []) {
    const set = new Set();
    (Array.isArray(holidays) ? holidays : []).forEach((entry) => {
        const key = toHolidayKey(entry);
        if (key) set.add(key);
    });
    return set;
}

function isBusinessDay(date, holidaySet = new Set()) {
    const weekday = rwandaWeekday(date);
    if (weekday === 'Sun') return false;
    const key = rwandaDateKey(date);
    if (holidaySet.has(key)) return false;
    return true;
}

/**
 * Advance (or rewind) a timestamp by N hours that fall on business days (Mon–Sat, excluding holidays).
 * Non-business time does not consume the budget.
 */
function addBusinessHours(startInput, hours, holidays = []) {
    const start = new Date(startInput);
    if (Number.isNaN(start.getTime())) {
        throw new Error('Invalid start date for business-hours calculation');
    }
    const holidaySet = holidays instanceof Set ? holidays : buildHolidaySet(holidays);
    const direction = Number(hours) < 0 ? -1 : 1;
    let remainingMs = Math.abs(Number(hours) || 0) * 60 * 60 * 1000;
    let cursor = new Date(start.getTime());
    const stepMs = 60 * 60 * 1000;
    let guard = 0;

    while (remainingMs > 0 && guard < 200000) {
        guard += 1;
        if (isBusinessDay(cursor, holidaySet)) {
            const advance = Math.min(stepMs, remainingMs);
            cursor = new Date(cursor.getTime() + (direction * advance));
            remainingMs -= advance;
        } else {
            cursor = new Date(cursor.getTime() + (direction * stepMs));
        }
    }

    return cursor;
}

function hasElapsedBusinessHours(startInput, hours, nowInput = new Date(), holidays = []) {
    const start = new Date(startInput);
    const now = new Date(nowInput);
    if (Number.isNaN(start.getTime()) || Number.isNaN(now.getTime())) return false;
    if (now.getTime() < start.getTime()) return false;
    const deadline = addBusinessHours(start, hours, holidays);
    return now.getTime() >= deadline.getTime();
}

function isWithinBusinessHoursWindow(startInput, hours, nowInput = new Date(), holidays = []) {
    const start = new Date(startInput);
    const now = new Date(nowInput);
    if (Number.isNaN(start.getTime()) || Number.isNaN(now.getTime())) return false;
    if (now.getTime() < start.getTime()) return false;
    const deadline = addBusinessHours(start, hours, holidays);
    return now.getTime() <= deadline.getTime();
}

function isWithinCalendarHoursWindow(startInput, hours, nowInput = new Date()) {
    const start = new Date(startInput);
    const now = new Date(nowInput);
    if (Number.isNaN(start.getTime()) || Number.isNaN(now.getTime())) return false;
    if (now.getTime() < start.getTime()) return false;
    const deadline = start.getTime() + (Math.max(0, Number(hours) || 0) * 60 * 60 * 1000);
    return now.getTime() <= deadline;
}

module.exports = {
    RWANDA_TZ,
    addBusinessHours,
    buildHolidaySet,
    hasElapsedBusinessHours,
    isBusinessDay,
    isWithinBusinessHoursWindow,
    isWithinCalendarHoursWindow,
    rwandaDateKey,
    toHolidayKey
};
