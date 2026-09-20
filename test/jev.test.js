import test from 'node:test';
import assert from 'node:assert';
import jevql from '../src/index.js';

const tickets = [
  { id: 'T-1', text: 'Server cluster offline with 500 error', status: 'open' },
  { id: 'T-2', text: 'Can you please refund our annual invoice?', status: 'open' },
  { id: 'T-3', text: 'Nice weather today, thanks!', status: 'closed' }
];

test('semantic NOUL, CHOICE, and SCORE primitives in query', async () => {
  const rows = await jevql(`
    SELECT
      id,
      CHOICE(text, 'Department', ['billing', 'tech', 'general']) AS dept,
      SCORE(text, 'Urgency', ['low', 'medium', 'high']) AS urgency,
      NOUL(text, 'Is this a billing dispute?') AS is_billing
    FROM data
    WHERE status = 'open'
    ORDER BY id ASC
  `, tickets);

  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].id, 'T-1');
  assert.ok(rows[0].dept);
  assert.ok(typeof rows[0].urgency === 'number');
  assert.strictEqual(rows[1].id, 'T-2');
  assert.strictEqual(rows[1].dept, 'billing');
  assert.ok(rows[1].is_billing > 0.5);
});

test('semantic WHERE filtering prunes rows', async () => {
  const rows = await jevql(`
    SELECT id, text
    FROM data
    WHERE NOUL(text, 'Is this a technical server outage?') > 0.6
  `, tickets);

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].id, 'T-1');
});

test('cache hit rate increases on repeated queries', async () => {
  const db = jevql(tickets);
  const q = "SELECT id, CHOICE(text, 'Dept', ['billing', 'tech', 'general']) AS d FROM data";

  const res1 = await db.analyze(q);
  assert.ok(res1.telemetry);

  const res2 = await db.analyze(q);
  // Second run on same data should hit cache!
  assert.ok(res2.telemetry.cacheHits > 0);
});
