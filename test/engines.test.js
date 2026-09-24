import test from 'node:test';
import assert from 'node:assert';
import { jevql, JevClient, JevQLDatabase } from '../src/index.js';
import { BaseSemanticEngine, registerEngine } from '../src/jev.js';

const tickets = [
  { id: "T-1", message: "CRITICAL 500 error: Database server down, checkout broken", status: "open" },
  { id: "T-2", message: "Please send invoice receipt for last month tax audit", status: "open" }
];

test('executes queries with Heuristic engine', async () => {
  const db = new JevQLDatabase(tickets, { engine: 'heuristic' });
  const rows = await db.query(`
    tickets: status = open
    ? "Immediate system outage or database error?" > 0.5
    team = infrastructure | billing | general
    urgency = low .. medium .. critical
    top 2
  `);

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].id, "T-1");
  assert.strictEqual(rows[0].team, "infrastructure");
});

test('executes queries with LLM Structured engine adapter', async () => {
  const db = new JevQLDatabase(tickets, { engine: 'llm' });
  const rows = await db.query(`
    tickets: status = open
    ? "Database server error or downtime?" > 0.5
    team = infrastructure | billing | general
    top 2
  `);

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].id, "T-1");
  assert.strictEqual(rows[0].team, "infrastructure");
});

test('executes queries with Embedding vector cosine similarity engine', async () => {
  const db = new JevQLDatabase(tickets, { engine: 'embedding' });
  const rows = await db.query(`
    tickets: status = open
    ? "Database server down error" > 0.3
    team = infrastructure | billing
    top 2
  `);

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].id, "T-1");
  assert.strictEqual(rows[0].team, "infrastructure");
});

test('supports custom third-party engine plugin via registerEngine', async () => {
  class CustomMockEngine extends BaseSemanticEngine {
    constructor(options = {}) {
      super(options);
      this.name = 'custom_mock';
    }
    async evaluateSingleState(state, questions) {
      const answers = {};
      for (const [qid, q] of Object.entries(questions)) {
        if (q.type === 'noul') answers[qid] = { type: 'noul', noul: 0.99 };
        if (q.type === 'choice') answers[qid] = { type: 'choice', choice: 'custom_winner', confidence: 1.0 };
        if (q.type === 'score') answers[qid] = { type: 'score', score: 2.5, confidence: 1.0 };
      }
      return answers;
    }
  }

  registerEngine('custom_mock', CustomMockEngine);

  const customQuery = jevql.with({ engine: 'custom_mock' });
  const results = await customQuery`
    ${tickets}: status = open
    ? "Custom check?" > 0.5
    winner = opt1 | opt2
    top 1
  `;

  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].winner, "custom_winner");
});

test('executes queries with WebMLKitEngine (webml-kit decision engine)', async () => {
  const db = new JevQLDatabase(tickets, { engine: 'webml' });
  const rows = await db.query(`
    tickets: status = open
    ? "Database server outage or 500 error?" > 0.5
    team = infrastructure | billing | general
    urgency = low .. medium .. critical
    top 2
  `);

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].id, "T-1");
  assert.strictEqual(rows[0].team, "infrastructure");
});

test('executes SQL queries with SEMANTIC() function using WebMLKitEngine', async () => {
  const db = new JevQLDatabase(tickets, { engine: 'webml-kit' });
  const rows = await db.query(`
    SELECT id, message
    FROM data
    WHERE SEMANTIC(message, 'Database crash or downtime') > 0.5
  `);

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].id, "T-1");
});

test('evaluates NOUL, CHOICE, and SCORE with WebMLKitEngine', async () => {
  const db = new JevQLDatabase(tickets, { engine: 'webml' });
  const rows = await db.query(`
    SELECT
      id,
      NOUL(message, 'Database down or fatal error?') AS is_outage,
      CHOICE(message, 'Department', ['infrastructure', 'billing']) AS dept,
      SCORE(message, 'Urgency', ['low', 'medium', 'high']) AS urgency_score
    FROM data
    WHERE id = 'T-1'
  `);

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].id, 'T-1');
  assert.strictEqual(typeof rows[0].is_outage, 'number');
  assert.ok(rows[0].is_outage > 0.5);
  assert.strictEqual(rows[0].dept, 'infrastructure');
  assert.strictEqual(typeof rows[0].urgency_score, 'number');
});

test('executes queries with JevK5Engine (allebee/jevk5)', async () => {
  const db = new JevQLDatabase(tickets, { engine: 'jevk5' });
  const rows = await db.query(`
    SELECT
      id,
      NOUL(message, 'Is this a database or infrastructure incident?') AS is_incident,
      CHOICE(message, 'Responsible team', ['infrastructure', 'billing']) AS team
    FROM data
    WHERE id = 'T-1'
  `);

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].id, 'T-1');
  assert.strictEqual(typeof rows[0].is_incident, 'number');
  assert.strictEqual(rows[0].team, 'infrastructure');
});


