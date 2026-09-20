import test from 'node:test';
import assert from 'node:assert';
import jevql from '../src/index.js';
import { pipelineToSQL, isPipelineQuery } from '../src/pipeline.js';

test('isPipelineQuery identifies pipeline syntax', () => {
  assert.strictEqual(isPipelineQuery("from tickets | filter status == 'open'"), true);
  assert.strictEqual(isPipelineQuery("SELECT * FROM tickets"), false);
});

test('pipelineToSQL transpiles dataflow syntax to SQL', () => {
  const pipe = `
    from tickets
    | filter status == 'open'
    | judge body ? "Urgent?" as is_urgent > 0.7
    | classify body -> [billing, tech] as dept
    | sort -is_urgent
    | take 5
  `;
  const sql = pipelineToSQL(pipe);
  assert.ok(sql.includes("FROM tickets"));
  assert.ok(sql.includes("NOUL(body, 'Urgent?') > 0.7"));
  assert.ok(sql.includes("CHOICE(body, 'Classify dept', [billing, tech]) AS dept"));
  assert.ok(sql.includes("LIMIT 5"));
});

test('executes native pipeline query on datasets', async () => {
  const tickets = [
    { id: 1, text: "Server 500 internal error", status: "open" },
    { id: 2, text: "Tax invoice receipt please", status: "open" },
    { id: 3, text: "Old closed ticket", status: "closed" }
  ];

  const rows = await jevql(`
    from data
    | filter status == 'open'
    | classify text -> [tech, billing] as dept
    | sort dept
  `, tickets);

  assert.strictEqual(rows.length, 2);
  assert.ok(rows.find(r => r.id === 1).dept === 'tech');
  assert.ok(rows.find(r => r.id === 2).dept === 'billing');
});

test('executes tagged template literal queries directly', async () => {
  const tickets = [
    { id: 1, text: "Server 500 internal error", status: "open" },
    { id: 2, text: "Tax invoice receipt please", status: "open" },
    { id: 3, text: "Old closed ticket", status: "closed" }
  ];

  const limitNum = 2;
  const rows = await jevql`
    from ${tickets}
    | filter status == 'open'
    | classify text -> [tech, billing] as dept
    | take ${limitNum}
  `;

  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].dept, 'tech');
});
