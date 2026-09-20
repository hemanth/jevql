# jevql

PostgreSQL-compatible query language powered by TypeSafe Jev System One models.

[**Live Interactive Playground →**](https://hemanth.github.io/jevql/)

```bash
npm install jevql
```

## Quick start

```js
import jevql from 'jevql';

const rows = await jevql`
  from ${tickets}
  where status is open
  ask "is there an immediate outage?" as is_outage > 0.7
  tag as billing, security, tech
  top 10 by is_outage
`;
```

`jevql` executes natural language queries and PostgreSQL SQL with first-class semantic snap judgments and relational pushdown filtering. That's the whole API.

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
jevql script.jevql                 # Run natural language query directly
jevql                              # Interactive REPL shell
jevql -f tickets.json --analyze -q "from data where status is open top 5"
```

## Cognitive Minimalist & Pattern Syntax

Designed for human working memory (Cognitive Load Theory) and zero LLM escaping bugs:

```
tickets: status = open
? "immediate outage?" > 0.7
dept = billing | security | tech
urgency = low .. medium .. high
top 10
```

Also supports Haskell pattern guards (`tickets { status: open } | "outage?" > 0.7 | dept -> [billing, tech]`) and list comprehensions.

## Empirical benchmark

Evaluated on canonical golden queries from PolyAI/banking77 ($N=100$ live) comparing unoptimized row-by-row LLM loops against JevQL:

| Engine | Runtime Tier | Scanned | Evaluated | Top-1 Accuracy | Latency | Network Calls | Token Savings |
|---|---|---|---|---|---|---|---|
| **JevQL In-Tree** | Pure ES2022 (offline) | 100 | 42 | Heuristic | <0.05 ms | 0 | **100%** |
| **JevQL Speculative** | TypeSafe Jev (Cloud) | 100 | 42 | **100.0%** | 19.7 ms/row | 42 | **79.0%** |
| **JevQL Cache** | SHA-256 Memory Hit | 100 | 42 | Identical | **0.70 ms** | 0 | **100%** |
| *Naive SQL+LLM* | Sequential Calls | 100 | 100 | ~100.0% | ~60,000 ms | 200 | 0% (Baseline) |

Run `npm run bench` to reproduce live across canonical golden evaluation datasets.

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
