import jevql, { formatTable } from '../index.js';

const db = jevql();

console.log('=== Running JevQL Support Triage Query ===\n');

const sql = `
SELECT
  CHOICE(body, 'Team', ['billing', 'security', 'infrastructure', 'product']) AS department,
  COUNT(*) AS ticket_count,
  AVG(SCORE(body, 'Customer frustration', ['calm', 'frustrated', 'enraged'])) AS avg_frustration
FROM 'examples/tickets.json'
WHERE status = 'open'
GROUP BY department
ORDER BY ticket_count DESC
`;

const rows = await db.query(sql);
console.log(formatTable(rows));
