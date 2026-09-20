# jevql

PostgreSQL-compatible query language powered by TypeSafe Jev System One models.

```bash
pip install jevql
```

## Quick start

```python
from jevql import jevql

tickets = [
    {"id": "T-1", "customer": "Acme", "body": "500 error on checkout webhook", "status": "open"},
    {"id": "T-2", "customer": "Stripe", "body": "Can you send the annual tax receipt?", "status": "open"}
]

rows = jevql("""
    SELECT id, customer,
           CHOICE(body, 'Team', ['billing', 'security', 'tech']) AS dept,
           SCORE(body, 'Urgency', ['low', 'high']) AS urgency
    FROM data
    WHERE status = 'open'
      AND NOUL(body, 'Is this an urgent technical outage?') > 0.6
""", tickets)
```

`jevql()` executes SQL statements with first-class semantic snap judgments, calibrated probabilities, and relational pushdown filtering. That's the whole API.

## License

MIT © [Hemanth.HM](https://h3manth.com)
