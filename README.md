# jevql

Query unstructured data with calibrated semantic SQL and cognitive syntax.

```bash
npm install @hemanth/jevql
```

## Quick start

```js
import jevql from '@hemanth/jevql';

const rows = await jevql`
  from ${tickets}
  where status is open
  ask "immediate production outage?" as is_outage > 0.7
  tag as billing, security, infrastructure
  top 10 by is_outage
`;
```

`jevql` compiles natural language and SQL queries with single-pass semantic primitives and relational pushdown filtering. That's the whole API.

## Cognitive syntax

```haskell
tickets: status = open
? "immediate outage?" > 0.7
team = security | infrastructure | billing
severity = minor .. moderate .. critical
top 5
```

Minimal syntax designed for human working memory with pattern guards and zero LLM prompt escaping.

## Group by semantic choice

```js
const breakdown = await jevql(`
  SELECT
    CHOICE(body, 'Category', ['bug', 'feature', 'billing']) AS category,
    COUNT(*) AS count,
    AVG(SCORE(body, 'Frustration', ['calm', 'annoyed', 'furious'])) AS avg_frustration
  FROM 'tickets.json'
  GROUP BY category
  ORDER BY count DESC
`);
```

Aggregates unstructured text across categorical distributions in a single pass.

## Relational pushdown

```js
const plan = await db.explain(`
  SELECT id FROM tickets
  WHERE status = 'open'
    AND priority = 'P1'
    AND NOUL(text, 'Security exploit?') > 0.85
`);
```

Deterministic SQL filters execute first, pruning non-matching rows ($0 cost) before calling the AI engine.

## Confidence gating

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

## Python SDK

```python
from jevql import JevQLDatabase

db = JevQLDatabase(tickets)
results = db.query("""
  tickets: status = open
  ? "urgent security breach?" > 0.8
  team = security | tech
  top 5
""")
```

Zero-dependency Python implementation mirroring identical AST planning and pushdown semantics.

## CLI

```bash
jevql script.jevql                 # Run query directly
jevql                              # Interactive REPL shell
jevql -f tickets.json -q "from data where status is open top 5"
```

## Demo

```bash
npm run demo
npm test
npm run playground
```

Runs the multi-mode demonstration, executes unit tests, and launches the interactive workbench at `http://localhost:3456`.

## Related

- [Interactive Playground](https://hemanth.github.io/jevql/) — live in-browser compiler and AST switchboard
- [TypeSafe](https://typesafe.ai) — System One AI models for calibrated semantic judgments

## License

MIT © [Hemanth.HM](https://h3manth.com)
