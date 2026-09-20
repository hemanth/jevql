import test from 'node:test';
import assert from 'node:assert';
import jevql from '../src/index.js';

const sampleRows = [
  { id: 1, name: 'Alice', role: 'admin', age: 30, bio: 'Lead DevOps engineer who loves Kubernetes' },
  { id: 2, name: 'Bob', role: 'user', age: 24, bio: 'Junior frontend designer working with CSS' },
  { id: 3, name: 'Charlie', role: 'user', age: 45, bio: 'Financial analyst auditing invoices and payments' },
  { id: 4, name: 'Diana', role: 'admin', age: 35, bio: 'Senior backend architect designing microservices' }
];

test('standard SQL filtering, operators, and projections', async () => {
  const rows = await jevql(
    "SELECT name, age, UPPER(role) AS role_upper FROM data WHERE age > 25 AND role = 'admin' ORDER BY age ASC",
    sampleRows
  );

  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].name, 'Alice');
  assert.strictEqual(rows[0].role_upper, 'ADMIN');
  assert.strictEqual(rows[1].name, 'Diana');
});

test('aggregate functions and GROUP BY', async () => {
  const rows = await jevql(
    "SELECT role, COUNT(*) AS count, AVG(age) AS avg_age FROM data GROUP BY role ORDER BY count DESC",
    sampleRows
  );

  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].count, 2);
  assert.strictEqual(rows[1].count, 2);
});

test('HAVING clause filters groups', async () => {
  const rows = await jevql(
    "SELECT role, COUNT(*) AS count FROM data GROUP BY role HAVING MIN(age) >= 30",
    sampleRows
  );

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].role, 'admin');
});

test('CASE WHEN and LIKE expressions', async () => {
  const rows = await jevql(
    "SELECT name, CASE WHEN bio LIKE '%frontend%' THEN 'UI' ELSE 'Backend' END AS track FROM data WHERE bio LIKE '%engineer%' OR bio LIKE '%designer%'",
    sampleRows
  );

  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows.find(r => r.name === 'Bob').track, 'UI');
  assert.strictEqual(rows.find(r => r.name === 'Alice').track, 'Backend');
});

test('LIMIT and OFFSET', async () => {
  const rows = await jevql(
    "SELECT name FROM data ORDER BY age ASC LIMIT 2 OFFSET 1",
    sampleRows
  );

  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].name, 'Alice'); // 24=Bob, 30=Alice, 35=Diana, 45=Charlie
  assert.strictEqual(rows[1].name, 'Diana');
});
