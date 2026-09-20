import test from 'node:test';
import assert from 'node:assert';
import jevql from '../src/index.js';
import { pipelineToSQL, isPipelineQuery } from '../src/pipeline.js';

test('isPipelineQuery recognizes natural language statements without pipes', () => {
  const query = `
    from tickets
    where status is open
    ask "immediate outage?"
    tag as billing, security, tech
    top 10 by score
  `;
  assert.strictEqual(isPipelineQuery(query), true);
});

test('pipelineToSQL transpiles clean natural English queries to SQL', () => {
  const query = `
    from tickets
    where status is open
    ask "is there an immediate outage?" as is_outage > 0.7
    tag as billing, security, tech
    top 10 by is_outage
  `;
  const sql = pipelineToSQL(query);

  assert.ok(sql.includes('FROM tickets'));
  assert.ok(sql.includes("status = 'open'"));
  assert.ok(sql.includes("NOUL(auto, 'is there an immediate outage?') > 0.7"));
  assert.ok(sql.includes("CHOICE(auto, 'Classify tag', ['billing', 'security', 'tech']) AS tag"));
  assert.ok(sql.includes('ORDER BY is_outage DESC'));
  assert.ok(sql.includes('LIMIT 10'));
});

test('executes natural language query directly on in-memory data with auto-column resolution', async () => {
  const tickets = [
    { id: 1, text: "Server 500 internal error outage", status: "open" },
    { id: 2, text: "Tax invoice receipt request", status: "open" },
    { id: 3, text: "Old closed ticket", status: "closed" }
  ];

  // Notice: no pipes, no quotes around categories, no '==', auto-detected text column!
  const rows = await jevql`
    from ${tickets}
    where status is open
    tag as tech, billing
    top 2
  `;

  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].status, 'open');
  assert.strictEqual(rows[0].tag, 'tech');
  assert.strictEqual(rows[1].tag, 'billing');
});

test('executes natural query with semantic ask condition and top by score', async () => {
  const tickets = [
    { id: 1, message: "Critical database crash outage", status: "open" },
    { id: 2, message: "Just checking in on my order", status: "open" }
  ];

  const rows = await jevql(`
    from tickets
    where status is open
    ask "is this a system outage?" as is_outage > 0.4
    tag as tech, general
    top 1 by is_outage
  `, tickets);

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].id, 1);
  assert.strictEqual(rows[0].tag, 'tech');
  assert.ok(rows[0].is_outage > 0.4);
});
