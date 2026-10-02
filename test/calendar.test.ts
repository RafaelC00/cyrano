import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildIcs, escapeText, foldLine, writeIcs } from '../src/calendar/ics.ts';
import { Itinerary, UnknownCityError, zoneOf } from '../src/calendar/itinerary.ts';
import { LocalCalendar } from '../src/calendar/local.ts';
import { RealCalendar, RealCalendarDisabledError } from '../src/calendar/real.ts';
import { computeSlots, ERIC_RHYTHM, isAsleep } from '../src/calendar/slots.ts';
import { dayInZone, localToInstant, zoneOffsetMs } from '../src/calendar/time.ts';
import { CalendarError } from '../src/calendar/types.ts';
import type { ConfirmedEvent, Slot } from '../src/calendar/types.ts';
import { Scheduler } from '../src/schedule/scheduler.ts';
import { makeCalendar, NOW, person, TODAY } from './week-helpers.ts';

// ---------- time ----------

test('local wall-clock times convert correctly on both sides of a DST change', () => {
  assert.equal(localToInstant('2026-10-24', '20:00', 'Europe/Amsterdam').toISOString(), '2026-10-24T18:00:00.000Z'); // CEST
  assert.equal(localToInstant('2026-10-26', '20:00', 'Europe/Amsterdam').toISOString(), '2026-10-26T19:00:00.000Z'); // CET
  assert.equal(localToInstant('2026-10-10', '20:00', 'Asia/Singapore').toISOString(), '2026-10-10T12:00:00.000Z');
  assert.equal(zoneOffsetMs(Date.parse('2026-10-10T12:00:00Z'), 'Asia/Dubai'), 4 * 3_600_000);
});

test('the wall-clock day can differ from the UTC day', () => {
  assert.equal(dayInZone(new Date('2026-10-10T23:30:00Z'), 'Asia/Singapore'), '2026-10-11');
  assert.equal(dayInZone(new Date('2026-10-10T23:30:00Z'), 'Europe/Lisbon'), '2026-10-11');
  assert.equal(dayInZone(new Date('2026-10-10T00:30:00Z'), 'America/New_York'), '2026-10-09');
});

// ---------- itinerary ----------

test('an itinerary rejects overlaps, reversed stays and unknown cities', () => {
  assert.throws(() => new Itinerary([{ city: 'Berlin', from: '2026-10-01', to: '2026-10-05' }, { city: 'Lisbon', from: '2026-10-05', to: '2026-10-09' }]), /overlap/);
  assert.throws(() => new Itinerary([{ city: 'Berlin', from: '2026-10-05', to: '2026-10-01' }]), /before it starts/);
  assert.throws(() => new Itinerary([{ city: 'Atlantis', from: '2026-10-01', to: '2026-10-05' }]), UnknownCityError);
  assert.throws(() => zoneOf('Atlantis'), UnknownCityError);
  assert.throws(() => new Itinerary([{ city: 'Berlin', from: '2026-13-01', to: '2026-13-05' }]), /YYYY-MM-DD/);
});

test('cityOn answers by date and is null on travel days', () => {
  const it = new Itinerary([{ city: 'Berlin', from: '2026-10-01', to: '2026-10-05' }, { city: 'Lisbon', from: '2026-10-07', to: '2026-10-09' }]);
  assert.equal(it.cityOn('2026-10-03'), 'Berlin');
  assert.equal(it.cityOn('2026-10-06'), null);
  assert.equal(it.cityOn('2026-10-08'), 'Lisbon');
  assert.equal(it.cityOn('2026-11-01'), null);
});

test('a stay is firm only when its arrival is within a week', () => {
  const it = new Itinerary([{ city: 'Amsterdam', from: '2026-10-09', to: '2026-10-16' }, { city: 'Lisbon', from: '2026-10-17', to: '2026-10-24' }]);
  assert.equal(it.firmness(it.stays()[0]!, TODAY), 'firm');
  assert.equal(it.firmness(it.stays()[1]!, TODAY), 'tentative');
});

// ---------- slot proposal ----------

test('every proposed slot is in a city Eric is in on that day, never on arrival or departure day', async () => {
  const { calendar, itinerary } = makeCalendar();
  for (const city of new Set(itinerary.stays().map((s) => s.city))) {
    for (const stay of itinerary.staysIn(city, '2026-10-01', '2026-12-31')) {
      const slots = await calendar.proposeSlots({ city, from: stay.from, to: stay.to, count: 20 });
      for (const s of slots) {
        assert.equal(itinerary.cityOn(s.day), city, `${s.id} is not in ${city}`);
        assert.ok(s.day > stay.from && s.day < stay.to, `${s.id} is on an arrival or departure day`);
        assert.equal(dayInZone(new Date(s.start), s.timezone), s.day);
      }
    }
  }
});

test('no slot is ever proposed in a city he is not in during the window', async () => {
  const { calendar } = makeCalendar();
  // Lisbon is 17-24 Oct; ask for the days before and after it.
  assert.deepEqual(await calendar.proposeSlots({ city: 'Lisbon', from: '2026-10-02', to: '2026-10-15' }), []);
  assert.deepEqual(await calendar.proposeSlots({ city: 'Lisbon', from: '2026-10-26', to: '2026-12-31' }), []);
  assert.deepEqual(await calendar.proposeSlots({ city: 'Paris' }), []);
  await assert.rejects(calendar.proposeSlots({ city: 'Atlantis' }), UnknownCityError);
});

test('proposals respect his Asian-hours sleep: no European morning coffee, no Dubai midday', async () => {
  const { calendar } = makeCalendar();
  const ams = await calendar.proposeSlots({ city: 'Amsterdam', from: '2026-10-09', to: '2026-10-16', kinds: ['coffee'], count: 10 });
  assert.ok(ams.length > 0);
  assert.ok(ams.every((s) => s.localStart.endsWith('T15:00')), 'the 11:30 coffee falls inside the wake-up buffer');
  const dubaiCoffee = await calendar.proposeSlots({ city: 'Dubai', from: '2026-11-14', to: '2026-11-20', kinds: ['coffee'], count: 10 });
  assert.deepEqual(dubaiCoffee, [], 'Dubai afternoon is still his night');
  const dubaiDinner = await calendar.proposeSlots({ city: 'Dubai', from: '2026-11-14', to: '2026-11-20', kinds: ['dinner'], count: 10 });
  assert.ok(dubaiDinner.length > 0);
  const sg = await calendar.proposeSlots({ city: 'Singapore', kinds: ['coffee'], count: 10 });
  assert.ok(sg.some((s) => s.localStart.endsWith('T11:30')), 'in Singapore his day is ordinary');
});

test('a proposal never overlaps anything busy, and keeps a buffer around it', () => {
  const { itinerary } = makeCalendar();
  const base = { itinerary, rhythm: ERIC_RHYTHM, now: NOW, req: { city: 'Amsterdam', from: '2026-10-09', to: '2026-10-16', kinds: ['dinner'] as const, count: 10 } };
  const free = computeSlots({ ...base, busy: [] });
  const target = free[0]!;
  const busy = [{ start: target.start, end: target.end }];
  const blocked = computeSlots({ ...base, busy });
  assert.ok(!blocked.some((s) => s.day === target.day), 'the day with a clash has no dinner slot');
  // A call ending 30 minutes before dinner is inside the 45-minute buffer.
  const near = computeSlots({ ...base, busy: [{ start: new Date(Date.parse(target.start) - 150 * 60_000).toISOString(), end: new Date(Date.parse(target.start) - 30 * 60_000).toISOString() }] });
  assert.ok(!near.some((s) => s.day === target.day));
});

test('slots carry firm or tentative from the itinerary, and a day gets at most one', async () => {
  const { calendar } = makeCalendar();
  const ams = await calendar.proposeSlots({ city: 'Amsterdam', from: '2026-10-09', to: '2026-10-16', count: 10 });
  const lis = await calendar.proposeSlots({ city: 'Lisbon', from: '2026-10-17', to: '2026-10-24', count: 10 });
  assert.ok(ams.every((s) => s.confidence === 'firm'));
  assert.ok(lis.length > 0 && lis.every((s) => s.confidence === 'tentative'));
  assert.equal(new Set(ams.map((s) => s.day)).size, ams.length);
  assert.deepEqual([...ams].map((s) => s.start), [...ams].map((s) => s.start).sort());
});

test('nothing is offered inside the lead time', async () => {
  const { calendar } = makeCalendar();
  const soon = await calendar.proposeSlots({ city: 'Singapore', count: 10 });
  const earliest = NOW.getTime() + 18 * 3_600_000;
  assert.ok(soon.every((s) => Date.parse(s.start) >= earliest));
});

test('isAsleep follows the zone: UTC window in Europe, local night in Singapore', () => {
  const sleepy = Date.parse('2026-10-10T06:00:00Z'); // 08:00 Amsterdam, 14:00 Singapore
  assert.equal(isAsleep(ERIC_RHYTHM, 'Europe/Amsterdam', sleepy, sleepy + 3_600_000), true);
  assert.equal(isAsleep(ERIC_RHYTHM, 'Asia/Singapore', sleepy, sleepy + 3_600_000), false);
  const night = Date.parse('2026-10-10T17:00:00Z'); // 01:00 Singapore
  assert.equal(isAsleep(ERIC_RHYTHM, 'Asia/Singapore', night, night + 3_600_000), true);
});

// ---------- local calendar ----------

test('hold, confirm and cancel work, and a confirmed date blocks its slot', async () => {
  const { calendar } = makeCalendar();
  const [slot, other] = await calendar.proposeSlots({ city: 'Amsterdam', from: '2026-10-09', to: '2026-10-16', count: 2 });
  const hold = await calendar.hold({ slot: slot!, label: 'Testa' });
  assert.equal((await calendar.listBusy({ start: slot!.start, end: slot!.end })).length, 1);
  await assert.rejects(calendar.hold({ slot: slot!, label: 'Someone else' }), (e: unknown) => e instanceof CalendarError && e.code === 'slot_conflict');
  const event = await calendar.confirm(hold.id, { place: 'Café X' });
  assert.equal(event.place, 'Café X');
  assert.equal((await calendar.confirm(hold.id)).uid, event.uid, 'confirming twice is the same event');
  const again = await calendar.proposeSlots({ city: 'Amsterdam', from: '2026-10-09', to: '2026-10-16', count: 10 });
  assert.ok(!again.some((s) => s.id === slot!.id));
  await calendar.cancel(event.id);
  await calendar.cancel(event.id); // no-op
  assert.equal(calendar.listEvents().length, 0);
  assert.ok((await calendar.proposeSlots({ city: 'Amsterdam', from: '2026-10-09', to: '2026-10-16', count: 10 })).some((s) => s.id === slot!.id));
  void other;
});

test('a hold cannot be placed in a city he is not in, or on a forged slot', async () => {
  const { calendar } = makeCalendar();
  const [slot] = await calendar.proposeSlots({ city: 'Amsterdam', from: '2026-10-09', to: '2026-10-16', count: 1 });
  const wrongCity: Slot = { ...slot!, city: 'Lisbon', timezone: 'Europe/Lisbon' };
  await assert.rejects(calendar.hold({ slot: wrongCity, label: 'x' }), (e: unknown) => e instanceof CalendarError && (e.code === 'not_in_city' || e.code === 'bad_request'));
  const lisbonDay: Slot = { ...slot!, id: 'x', city: 'Lisbon', timezone: 'Europe/Lisbon', day: '2026-10-12', start: '2026-10-12T19:00:00.000Z', end: '2026-10-12T21:00:00.000Z' };
  await assert.rejects(calendar.hold({ slot: lisbonDay, label: 'x' }), (e: unknown) => e instanceof CalendarError && e.code === 'not_in_city');
  const wrongDay: Slot = { ...slot!, day: '2026-10-11' };
  await assert.rejects(calendar.hold({ slot: wrongDay, label: 'x' }), (e: unknown) => e instanceof CalendarError && e.code === 'bad_request');
  const past: Slot = { ...slot!, id: 'p', city: 'Singapore', timezone: 'Asia/Singapore', day: '2026-10-01', start: '2026-10-01T12:00:00.000Z', end: '2026-10-01T14:00:00.000Z' };
  await assert.rejects(calendar.hold({ slot: past, label: 'x' }), (e: unknown) => e instanceof CalendarError && e.code === 'bad_request');
});

test('an expired hold stops blocking and cannot be confirmed', async () => {
  const { calendar, advance } = makeCalendar();
  const [slot] = await calendar.proposeSlots({ city: 'Amsterdam', from: '2026-10-09', to: '2026-10-16', count: 1 });
  const hold = await calendar.hold({ slot: slot!, label: 'Testa', ttlHours: 1 });
  advance(2 * 3_600_000);
  await assert.rejects(calendar.confirm(hold.id), (e: unknown) => e instanceof CalendarError && e.code === 'hold_expired');
  assert.equal(calendar.listHolds().length, 0);
  const again = await calendar.hold({ slot: slot!, label: 'Someone else' });
  assert.ok(again.id !== hold.id);
});

test('a clash added after the hold is caught at confirmation', async () => {
  const { calendar } = makeCalendar();
  const [slot] = await calendar.proposeSlots({ city: 'Amsterdam', from: '2026-10-09', to: '2026-10-16', count: 1 });
  const hold = await calendar.hold({ slot: slot!, label: 'Testa' });
  calendar.addBusy({ start: slot!.start, end: slot!.end, label: 'investor call' });
  await assert.rejects(calendar.confirm(hold.id), (e: unknown) => e instanceof CalendarError && e.code === 'slot_conflict');
});

test('state persists across a restart, and a foreign file is refused rather than overwritten', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cyrano-cal-'));
  const storagePath = join(dir, 'nested', 'calendar.json');
  const a = makeCalendar({ storagePath });
  const [s1, s2] = await a.calendar.proposeSlots({ city: 'Amsterdam', from: '2026-10-09', to: '2026-10-16', count: 2 });
  const hold = await a.calendar.hold({ slot: s1!, label: 'Testa' });
  const kept = await a.calendar.hold({ slot: s2!, label: 'Other' });
  const event = await a.calendar.confirm(hold.id);
  a.calendar.addBusy({ start: '2026-10-12T08:00:00.000Z', end: '2026-10-12T09:00:00.000Z', label: 'call' });

  const b = makeCalendar({ storagePath });
  assert.deepEqual(b.calendar.listEvents(), [JSON.parse(JSON.stringify(event))]);
  assert.deepEqual(b.calendar.listHolds().map((h) => h.id), [kept.id]);
  assert.equal((await b.calendar.listBusy({ start: '2026-10-12T00:00:00Z', end: '2026-10-13T00:00:00Z' })).length, 1);
  await assert.rejects(b.calendar.hold({ slot: s1!, label: 'again' }), (e: unknown) => e instanceof CalendarError && e.code === 'slot_conflict');
  const c = await b.calendar.hold({ slot: (await b.calendar.proposeSlots({ city: 'Amsterdam', from: '2026-10-09', to: '2026-10-16', count: 1 }))[0]!, label: 'new' });
  assert.notEqual(c.id, hold.id, 'ids do not restart after a reload');

  writeFileSync(storagePath, JSON.stringify({ version: 2 }));
  assert.throws(() => makeCalendar({ storagePath }), (e: unknown) => e instanceof CalendarError && e.code === 'bad_request');
  assert.match(readFileSync(storagePath, 'utf8'), /"version":2/);
});

// ---------- real provider stub ----------

test('RealCalendar throws on construction and explains why', () => {
  const { itinerary } = makeCalendar();
  assert.throws(
    () =>
      new RealCalendar({
        auth: { kind: 'oauth', accessToken: 'x', refresh: async () => 'y' },
        calendarId: 'c',
        readCalendarIds: ['c'],
        itinerary,
        rateLimit: { requestsPerMinute: 1 },
        backoff: { baseMs: 1, maxMs: 2, maxAttempts: 1 },
      }),
    (e: unknown) => {
      assert.ok(e instanceof RealCalendarDisabledError);
      assert.equal(e.code, 'provider_disabled');
      assert.match(e.message, /OAuth/);
      assert.match(e.message, /\.ics/);
      return true;
    },
  );
});

// ---------- .ics ----------

function sampleEvent(label = 'Testa Quillfield'): ConfirmedEvent {
  const start = localToInstant('2026-10-10', '20:00', 'Europe/Amsterdam');
  const slot: Slot = {
    id: 'Amsterdam|x|dinner',
    kind: 'dinner',
    city: 'Amsterdam',
    timezone: 'Europe/Amsterdam',
    day: '2026-10-10',
    localStart: '2026-10-10T20:00',
    start: start.toISOString(),
    end: new Date(start.getTime() + 2 * 3_600_000).toISOString(),
    stay: { city: 'Amsterdam', from: '2026-10-09', to: '2026-10-16' },
    confidence: 'firm',
  };
  return { id: 'hold_001', slot, label, confirmedAt: NOW.toISOString(), uid: 'abc-123@cyrano.invalid' };
}

test('the .ics is a standard RFC 5545 file with UTC times, CRLF endings and folded lines', () => {
  const ics = buildIcs(sampleEvent());
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.doesNotMatch(ics.replace(/\r\n/g, ''), /[\r\n]/);
  assert.match(ics, /DTSTART:20261010T180000Z\r\n/);
  assert.match(ics, /DTEND:20261010T200000Z\r\n/);
  assert.match(ics, /UID:abc-123@cyrano\.invalid\r\n/);
  assert.match(ics, /SUMMARY:Dinner with Testa Quillfield\r\n/);
  assert.match(ics, /LOCATION:Amsterdam\r\n/);
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, `line too long: ${line}`);
  const unfolded = ics.replace(/\r\n /g, '');
  assert.match(unfolded, /Local time: Sat 10 Oct 20:00 \(Europe\/Amsterdam\)/);
});

test('ics text is escaped and long or non-ASCII lines fold on character boundaries', () => {
  assert.equal(escapeText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
  const ics = buildIcs(sampleEvent('Dr. Zoë Müller, née Åström; the long-named 😀 one'));
  assert.match(ics.replace(/\r\n /g, ''), /SUMMARY:Dinner with Dr\. Zoë Müller\\, née Åström\\; the long-named 😀 one/);
  const folded = foldLine('X:' + 'é'.repeat(80));
  for (const l of folded.split('\r\n')) assert.ok(Buffer.byteLength(l) <= 75);
  assert.equal(folded.replace(/\r\n /g, ''), 'X:' + 'é'.repeat(80));
});

test('a tentative trip is flagged in the file, and the file lands on disk', () => {
  const e = sampleEvent();
  e.slot = { ...e.slot, confidence: 'tentative' };
  assert.match(buildIcs(e).replace(/\r\n /g, ''), /not booked yet/);
  const dir = mkdtempSync(join(tmpdir(), 'cyrano-ics-'));
  const path = writeIcs(e, dir);
  assert.ok(existsSync(path));
  assert.equal(readFileSync(path, 'utf8'), buildIcs(e));
});

// ---------- scheduler ----------

test('the scheduler proposes and holds slots in her city, then confirms one and releases the rest', async () => {
  const { calendar } = makeCalendar();
  const scheduler = new Scheduler(calendar, () => NOW);
  const her = person({ city: 'Amsterdam' });
  const plan = await scheduler.propose(her, { matchId: 'm1', count: 3 });
  assert.equal(plan.status, 'proposed');
  assert.equal(plan.slots.length, 3);
  assert.ok(plan.slots.every((s) => s.city === 'Amsterdam'));
  assert.equal(calendar.listHolds().length, 3);

  await assert.rejects(scheduler.confirm(her.id, 'nope'), (e: unknown) => e instanceof CalendarError && e.code === 'not_found');
  const event = await scheduler.confirm(her.id, plan.slots[1]!.id);
  assert.equal(calendar.listHolds().length, 0);
  assert.equal(calendar.listEvents().length, 1);
  assert.equal(scheduler.get(her.id)!.status, 'confirmed');
  assert.equal(scheduler.get(her.id)!.chosen!.id, plan.slots[1]!.id);

  const path = await scheduler.exportIcs(her.id, mkdtempSync(join(tmpdir(), 'cyrano-sch-')), event);
  assert.match(readFileSync(path, 'utf8'), /BEGIN:VEVENT/);
  await assert.rejects(scheduler.propose(her), /already confirmed/);
  await scheduler.release(her.id);
  assert.equal(calendar.listEvents().length, 0);
});

test('with no overlap the plan is empty and holds nothing; re-proposing replaces the old holds', async () => {
  const { calendar } = makeCalendar();
  const scheduler = new Scheduler(calendar, () => NOW);
  const porto = await scheduler.propose(person({ city: 'Porto' }, 'p_porto'));
  assert.equal(porto.slots.length, 0);
  assert.equal(porto.status, 'released');
  const her = person({ city: 'Berlin' }, 'p_berlin');
  await scheduler.propose(her, { count: 2 });
  await scheduler.propose(her, { count: 2 });
  assert.equal(calendar.listHolds().length, 2);
});

test('two people in one city are never offered the same evening', async () => {
  const { calendar } = makeCalendar();
  const scheduler = new Scheduler(calendar, () => NOW);
  const a = await scheduler.propose(person({ city: 'Amsterdam' }, 'p_a', 'A'), { count: 3 });
  const b = await scheduler.propose(person({ city: 'Amsterdam' }, 'p_b', 'B'), { count: 3 });
  const taken = new Set(a.slots.map((s) => s.id));
  assert.ok(b.slots.every((s) => !taken.has(s.id)));
});
