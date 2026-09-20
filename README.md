# jevql

PostgreSQL-compatible query language powered by TypeSafe Jev System One models.

[**Live Interactive Playground →**](https://hemanth.github.io/jevql/)

```bash
npm install jevql
```

## Quick start

```js
import jevql from 'jevql';

const rows = await jevql(`
  SELECT id,
         CHOICE(body, 'Team', ['billing', 'security', 'tech']) AS dept,
         SCORE(body, 'Urgency', ['low', 'medium', 'high']) AS urgency
  FROM data
  WHERE status = 'open'
    AND NOUL(body, 'Does this issue require immediate escalation?') > 0.7
  ORDER BY urgency DESC
`, tickets);
```

`jevql()` executes SQL statements with first-class semantic snap judgments, calibrated probabilities, and relational pushdown filtering. That's the whole API.

## Group by semantic choice

```js
const breakdown = await jevql(`
  SELECT
    CHOICE(review, 'Category', ['bug', 'feature', 'billing']) AS category,
    COUNT(*) AS count,
    AVG(SCORE(review, 'Frustration', ['calm', 'annoyed', 'furious'])) AS avg_frustration
  FROM 'feedback.json'
  GROUP BY category
  ORDER BY count DESC
`);
```

Aggregates semi-structured text across categorical distributions in a single pass.

## Relational pushdown optimization

```js
const plan = await db.explain(`
  SELECT id FROM tickets
  WHERE status = 'open'
    AND priority = 'P1'
    AND NOUL(text, 'Security exploit?') > 0.85
`);
```

Deterministic SQL filters (`status = 'open'`) run first, pruning non-matching rows before calling Jev. Surviving rows bundle all questions into a single System One request ($0 cost for filtered rows, 12x cheaper via speculative fan-out).

## Confidence gating & option probabilities

```js
const safeActions = await jevql(`
  SELECT customer,
         CHOICE(body, 'Action', ['refund', 'rebook', 'triage']) AS action,
         CONFIDENCE(CHOICE(body, 'Action', ['refund', 'rebook', 'triage'])) AS conf,
         PROB(CHOICE(body, 'Action', ['refund', 'rebook', 'triage']), 'refund') AS refund_prob
  FROM data
  WHERE CONFIDENCE(CHOICE(body, 'Action', ['refund', 'rebook', 'triage'])) > 0.8
`, tickets);
```

`CONFIDENCE()` measures distribution peakedness for escalation policies. `PROB()` extracts calibrated probability floats for individual outcomes.

## Querying PostgreSQL databases

```js
const escalated = await jevql(`
  SELECT id, customer,
         SCORE(feedback, 'Churn risk', ['low', 'moderate', 'critical']) AS churn_risk
  FROM postgres('postgres://user:pass@localhost:5432/db').support_tickets
  WHERE status = 'open'
  ORDER BY churn_risk DESC
  LIMIT 25
`);
```

Executes pushdown scans directly on PostgreSQL tables, then streams rows through local JevQL semantic scoring.

## CLI & Interactive REPL

```bash
# Query any file directly
jevql -f tickets.json -q "SELECT * FROM data WHERE NOUL(body, 'Urgent?') > 0.8"

# Launch interactive SQL REPL with live table formatting
jevql -f tickets.csv

# Inspect query plan and token savings
jevql -f tickets.json --analyze -q "SELECT CHOICE(body, 'Dept', ['billing', 'tech']) FROM data"
```

## Functions

- `NOUL(col, 'prompt' [, 'true_desc' [, 'false_desc']])` — Evaluates condition, returns probability [0.0, 1.0].
- `IS_TRUE(col, 'prompt' [, threshold])` — Boolean predicate shorthand (`NOUL(...) >= threshold`).
- `CHOICE(col, 'prompt', ['opt1', 'opt2'])` — Categorical classification; returns winning option.
- `SCORE(col, 'prompt', ['level0', 'level1', ...])` — Continuous score across ordered levels.
- `CONFIDENCE(choice_or_score)` — Returns model confidence [0.0, 1.0].
- `PROB(choice, 'option')` — Returns exact probability for chosen option.

## Demo

```bash
npm run demo
npm test
npm run playground
```

Runs the multi-mode demonstration, executes unit tests, and launches the local interactive workbench at `http://localhost:3456`.

## License

MIT © [Hemanth.HM](https://h3manth.com)
