// Back up / Restore (js/store.js parseBackup + backupText) and the one-time storage.persist() request. Drafted by Hark.
const test = require('node:test'); const assert = require('node:assert/strict');
const S = require('../js/store.js'); const D = require('../js/demo.js');

const plan = { personalBest: 400, green: 'Controller daily', yellow: 'Albuterol 2 puffs', red: 'Call doctor', beforeExercise: '2 puffs 15 min before', doctorPhone: '555-0100', triggers: ['ozone', 'pollen'] };

test('round trip: export then import gives the same plan and check-ins back', () => {
  const entries = D.generate('2026-10-14', 30, 400, 7);
  const text = S.backupText({ plan, entries }, '2026-10-14T12:00:00.000Z');
  const b = S.parseBackup(text);
  assert.equal(b.ok, true); assert.equal(b.dropped, 0);
  assert.deepEqual(b.plan, plan);
  assert.deepEqual(b.entries, S.entries(entries));
  assert.equal(b.entries.length, 30);
  // and a second round trip is stable
  assert.deepEqual(S.parseBackup(S.backupText(b, 'x')), b);
});
test('round trip: an empty plan and no check-ins still restore', () => {
  const b = S.parseBackup(S.backupText({ plan: { triggers: [] }, entries: [] }, 'x'));
  assert.equal(b.ok, true); assert.deepEqual(b.entries, []); assert.deepEqual(b.plan, { personalBest: null, triggers: [] });
});
test('malformed JSON is refused', () => {
  for (const t of ['', '{', 'not json', '{"plan":', "{'plan':{}}", '\u0000', undefined, null, 42, {}])
    assert.deepEqual(S.parseBackup(t), { ok: false, error: 'bad_json' }, String(t));
});
test('valid JSON that is not a backup is refused', () => {
  for (const t of ['null', '42', '"hi"', '[]', '[{"plan":{}}]', '{}', '{"lang":"es"}', '{"plan":"x"}', '{"entries":{}}',
    '{"plan":null,"entries":[]}', '{"plan":{},"entries":"x"}', '{"entries":[{"date":"bad"},{"zone":"green"}]}'])
    assert.deepEqual(S.parseBackup(t), { ok: false, error: 'not_backup' }, t);
});
test('oversized files are refused before parsing', () => {
  const big = JSON.stringify({ plan, entries: [], pad: 'x'.repeat(S.MAX_BACKUP_BYTES) });
  assert.deepEqual(S.parseBackup(big), { ok: false, error: 'too_big' });
  // multi-byte text: under the limit in characters but over it in UTF-8 bytes
  const wide = JSON.stringify({ plan: { green: '\u00e9'.repeat(Math.ceil(S.MAX_BACKUP_BYTES / 2) + 10) }, entries: [] });
  assert.ok(wide.length < S.MAX_BACKUP_BYTES);
  assert.deepEqual(S.parseBackup(wide), { ok: false, error: 'too_big' });
});
test('hand-edited rows are cleaned, broken ones dropped and counted', () => {
  const t = JSON.stringify({ plan: { personalBest: 'lots', triggers: ['ozone', 'ozone', 'lava'], green: 3 }, entries: [
    { date: '2026-10-01', zone: 'green', peakFlow: 380 }, { date: '2026-02-30', zone: 'green' }, { date: '2026-10-02', zone: 'purple' },
    { date: '2026-10-03', zone: 'yellow', peakFlow: 'NaN', symptoms: ['cough', 7] }, 'row', null] });
  const b = S.parseBackup(t);
  assert.equal(b.ok, true); assert.equal(b.dropped, 4); assert.equal(b.entries.length, 2);
  assert.deepEqual(b.plan, { personalBest: null, triggers: ['ozone'] });
  assert.equal(b.entries[1].peakFlow, null); assert.deepEqual(b.entries[1].symptoms, ['cough']);
});
test('__proto__ keys in a backup do not pollute objects', () => {
  const b = S.parseBackup('{"plan":{"__proto__":{"polluted":1}},"entries":[{"date":"2026-10-01","zone":"green","__proto__":{"polluted":1}}]}');
  assert.equal(b.ok, true); assert.equal({}.polluted, undefined); assert.equal(b.entries[0].polluted, undefined);
});

function fakeStorage() { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, m }; }
test('storage.persist() is asked once per browser profile', async () => {
  let calls = 0; const nav = { storage: { persist: () => { calls++; return Promise.resolve(false); } } };
  const ls = fakeStorage();
  assert.equal(S.requestPersist(nav, ls, 'k'), true);
  assert.equal(S.requestPersist(nav, ls, 'k'), false);
  assert.equal(S.requestPersist(nav, ls, 'k'), false);
  assert.equal(calls, 1); assert.equal(ls.m.k, '1');
});
test('storage.persist(): missing API, rejection or throwing storage never throw', async () => {
  const ls = fakeStorage();
  assert.equal(S.requestPersist({}, ls, 'k'), false);
  assert.equal(S.requestPersist({ storage: {} }, ls, 'k'), false);
  assert.equal(S.requestPersist(undefined, ls, 'k'), false);
  assert.equal(ls.m.k, undefined); // not marked as asked when the browser can't be asked
  assert.equal(S.requestPersist({ storage: { persist: () => Promise.reject(new Error('no')) } }, ls, 'k'), true);
  const bad = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(S.requestPersist({ storage: { persist: () => { throw new Error('x'); } } }, bad, 'k'), false);
  await new Promise((r) => setTimeout(r, 0)); // an unhandled rejection would fail the run here
});
