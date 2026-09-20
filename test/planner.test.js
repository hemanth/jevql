import test from 'node:test';
import assert from 'node:assert';
import { parse } from '../src/parser.js';
import { createQueryPlan, splitWhereClause } from '../src/planner.js';

test('splitWhereClause divides deterministic and semantic predicates', () => {
  const sql = `
    SELECT * FROM data
    WHERE status = 'open'
      AND priority = 'P1'
      AND NOUL(text, 'Urgent?') > 0.8
  `;
  const ast = parse(sql);
  const { deterministic, semantic } = splitWhereClause(ast.where);

  assert.ok(deterministic);
  assert.ok(semantic);
  assert.strictEqual(deterministic.type, 'BinaryExpression');
  assert.strictEqual(deterministic.operator, 'AND');
  assert.strictEqual(semantic.type, 'BinaryExpression');
  assert.strictEqual(semantic.operator, '>');
});

test('createQueryPlan bundles unique Jev questions and resolves aliases', () => {
  const sql = `
    SELECT
      CHOICE(body, 'Team', ['billing', 'tech']) AS team,
      COUNT(*) AS c
    FROM data
    WHERE status = 'active'
      AND NOUL(body, 'Escalate?') > 0.7
    GROUP BY team
  `;
  const ast = parse(sql);
  const plan = createQueryPlan(ast, (node) => node?.value || null);

  assert.strictEqual(plan.questions.length, 2);
  assert.strictEqual(plan.groupBy[0].type, 'FunctionCall');
  assert.strictEqual(plan.groupBy[0].name, 'CHOICE');
  assert.strictEqual(plan.isAggregateQuery, true);
});
