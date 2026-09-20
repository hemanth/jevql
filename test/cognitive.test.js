import test from 'node:test';
import assert from 'node:assert';
import { jevql } from '../src/index.js';
import { isPipelineQuery, pipelineToSQL } from '../src/pipeline.js';

test('isPipelineQuery recognizes Cognitive Minimalist Syntax', () => {
  assert.strictEqual(isPipelineQuery(`
    tickets: status = open
    ? "immediate outage?" > 0.7
    dept = billing | security | tech
    urgency = low .. medium .. high
    top 10
  `), true);

  assert.strictEqual(isPipelineQuery('? "immediate outage?" > 0.7'), true);
  assert.strictEqual(isPipelineQuery('dept = billing | security | tech'), true);
  assert.strictEqual(isPipelineQuery('urgency = low .. high'), true);
  assert.strictEqual(isPipelineQuery('tickets: status = open'), true);
});

test('transpiles Cognitive Minimalist Syntax to SQL with pushdown and speculative fan-out', () => {
  const sql = pipelineToSQL(`
    tickets: status = open
    ? "immediate outage?" > 0.7
    dept = billing | security | tech
    urgency = low .. medium .. high
    top 10
  `);

  assert.match(sql, /FROM tickets/i);
  assert.match(sql, /WHERE status = 'open' AND NOUL\(auto, 'immediate outage\?'\) > 0\.7/i);
  assert.match(sql, /CHOICE\(auto, 'Classify dept', \['billing', 'security', 'tech'\]\) AS dept/i);
  assert.match(sql, /SCORE\(auto, 'Rate urgency', \['low', 'medium', 'high'\]\) AS urgency/i);
  assert.match(sql, /ORDER BY is_immediate_outage DESC/i);
  assert.match(sql, /LIMIT 10/i);
});

test('executes Cognitive Minimalist Syntax directly on live dataset', async () => {
  const tickets = [
    { id: "T-1", message: "500 error on checkout webhook! Server is crashing!", status: "open" },
    { id: "T-2", message: "Need tax receipt invoice for 2024", status: "open" },
    { id: "T-3", message: "Duplicate charge on credit card", status: "closed" }
  ];

  const highRisk = await jevql`
    ${tickets}: status = open
    ? "immediate outage?" > 0.7
    dept = billing | security | tech
    urgency = low .. medium .. high
    top 10
  `;

  assert.strictEqual(highRisk.length, 1);
  assert.strictEqual(highRisk[0].id, "T-1");
  assert.strictEqual(highRisk[0].dept, "tech");
  assert.ok(highRisk[0].is_immediate_outage > 0.7);
  assert.ok(highRisk[0].urgency !== undefined);
});
