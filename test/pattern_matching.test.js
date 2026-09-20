import test from 'node:test';
import assert from 'node:assert';
import jevql from '../src/index.js';
import { pipelineToSQL, isPipelineQuery } from '../src/pipeline.js';

test('isPipelineQuery recognizes Haskell pattern matching and list comprehensions', () => {
  assert.strictEqual(isPipelineQuery("tickets { status: open } | 'outage?' > 0.7"), true);
  assert.strictEqual(isPipelineQuery("[ id, dept | tickets { status: open }, dept -> [tech, billing] ]"), true);
});

test('transpiles Haskell pattern matching with guards and bindings to SQL', () => {
  const query = `
    tickets { status: open, priority: P1 }
      | "immediate outage?" > 0.7
      | dept -> [billing, security, tech]
      take 10
  `;
  const sql = pipelineToSQL(query);

  assert.ok(sql.includes('FROM tickets'));
  assert.ok(sql.includes("status = 'open'"));
  assert.ok(sql.includes("priority = 'P1'"));
  assert.ok(sql.includes("NOUL(auto, 'immediate outage?') > 0.7"));
  assert.ok(sql.includes("CHOICE(auto, 'Classify dept', ['billing', 'security', 'tech']) AS dept"));
  assert.ok(sql.includes('LIMIT 10'));
});

test('transpiles Haskell branching case patterns', () => {
  const query = `
    tickets { status: open }
      | "outage?"   -> tech
      | "security?" -> security
      | otherwise   -> billing
      take 5
  `;
  const sql = pipelineToSQL(query);

  assert.ok(sql.includes("WHEN NOUL(auto, 'outage?') > 0.5 THEN 'tech'"));
  assert.ok(sql.includes("WHEN NOUL(auto, 'security?') > 0.5 THEN 'security'"));
  assert.ok(sql.includes("ELSE 'billing'"));
  assert.ok(sql.includes('AS category'));
});

test('transpiles Haskell list comprehension syntax', () => {
  const query = `
    [ id, dept | tickets { status: open }, "outage?" > 0.7, dept -> [billing, tech], take 5 ]
  `;
  const sql = pipelineToSQL(query);

  assert.ok(sql.includes('SELECT id,'));
  assert.ok(sql.includes('FROM tickets'));
  assert.ok(sql.includes("status = 'open'"));
  assert.ok(sql.includes("CHOICE(auto, 'Classify dept', ['billing', 'tech']) AS dept"));
  assert.ok(sql.includes('LIMIT 5'));
});

test('executes Haskell pattern matching directly in JavaScript tagged template', async () => {
  const tickets = [
    { id: "T-1", message: "Production server crash 500 error", status: "open" },
    { id: "T-2", message: "Tax receipt for invoice 2026", status: "open" },
    { id: "T-3", message: "Old closed ticket", status: "closed" }
  ];

  const results = await jevql`
    ${tickets} { status: open }
      | "is this an outage or server crash?" > 0.5
      | dept -> [tech, billing]
      take 2
  `;

  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].id, "T-1");
  assert.strictEqual(results[0].dept, "tech");
});

test('executes Haskell branching case pattern on live dataset', async () => {
  const tickets = [
    { id: "T-1", message: "Production server crash", status: "open" },
    { id: "T-2", message: "Need tax receipt invoice", status: "open" }
  ];

  const results = await jevql`
    ${tickets} { status: open }
      | "server crash or outage?" -> tech
      | "receipt or invoice?"     -> billing
      | otherwise                 -> general
      take 2
  `;

  assert.strictEqual(results.length, 2);
  const techTicket = results.find(r => r.id === "T-1");
  const billingTicket = results.find(r => r.id === "T-2");
  assert.strictEqual(techTicket.category, "tech");
  assert.strictEqual(billingTicket.category, "billing");
});
