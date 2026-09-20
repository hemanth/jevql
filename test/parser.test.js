import test from 'node:test';
import assert from 'node:assert';
import { parse, tokenize } from '../src/parser.js';

test('tokenize extracts keywords, strings, numbers, and operators', () => {
  const sql = "SELECT id, 'urgent', 42.5 FROM data WHERE status = 'open'";
  const tokens = tokenize(sql);
  assert.strictEqual(tokens[0].type, 'KEYWORD');
  assert.strictEqual(tokens[0].value, 'SELECT');
  assert.strictEqual(tokens[1].type, 'IDENTIFIER');
  assert.strictEqual(tokens[1].value, 'id');
  assert.strictEqual(tokens[3].type, 'STRING');
  assert.strictEqual(tokens[3].value, 'urgent');
  assert.strictEqual(tokens[5].type, 'NUMBER');
  assert.strictEqual(tokens[5].value, 42.5);
});

test('parse creates AST for SELECT with Jev primitives', () => {
  const sql = `
    SELECT
      id,
      CHOICE(body, 'Department', ['billing', 'tech']) AS dept,
      SCORE(body, 'Urgency', ['low', 'high']) AS urgency,
      NOUL(body, 'Escalate?') AS escalate_prob
    FROM 'tickets.json'
    WHERE status = 'open' AND NOUL(body, 'Escalate?') > 0.8
    GROUP BY dept
    HAVING COUNT(*) > 1
    ORDER BY urgency DESC
    LIMIT 5 OFFSET 10
  `;

  const ast = parse(sql);
  assert.strictEqual(ast.type, 'SelectStatement');
  assert.strictEqual(ast.columns.length, 4);
  assert.strictEqual(ast.columns[1].alias, 'dept');
  assert.strictEqual(ast.columns[1].expr.type, 'FunctionCall');
  assert.strictEqual(ast.columns[1].expr.name, 'CHOICE');
  assert.strictEqual(ast.from.source.type, 'FileSource');
  assert.strictEqual(ast.from.source.path, 'tickets.json');
  assert.strictEqual(ast.where.type, 'BinaryExpression');
  assert.strictEqual(ast.where.operator, 'AND');
  assert.strictEqual(ast.groupBy.length, 1);
  assert.strictEqual(ast.having.type, 'BinaryExpression');
  assert.strictEqual(ast.orderBy.length, 1);
  assert.strictEqual(ast.orderBy[0].direction, 'DESC');
  assert.strictEqual(ast.limit.value, 5);
  assert.strictEqual(ast.offset.value, 10);
});

test('parse handles EXPLAIN ANALYZE', () => {
  const sql = "EXPLAIN ANALYZE SELECT * FROM data";
  const ast = parse(sql);
  assert.strictEqual(ast.explain, true);
  assert.strictEqual(ast.analyze, true);
});

test('parse handles CASE WHEN and IN expressions', () => {
  const sql = `
    SELECT
      CASE WHEN score > 1 THEN 'high' ELSE 'low' END AS label
    FROM data
    WHERE status IN ('open', 'pending')
  `;
  const ast = parse(sql);
  assert.strictEqual(ast.columns[0].expr.type, 'CaseExpression');
  assert.strictEqual(ast.where.type, 'InExpression');
  assert.strictEqual(ast.where.values.length, 2);
});
