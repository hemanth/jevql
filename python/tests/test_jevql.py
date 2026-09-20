import unittest
from jevql import jevql, JevQLDatabase

class TestJevQL(unittest.TestCase):
    def setUp(self):
        self.tickets = [
            {"id": "T-1", "customer": "Acme", "body": "500 error on checkout webhook", "status": "open"},
            {"id": "T-2", "customer": "Stripe", "body": "Can you send the annual tax receipt?", "status": "open"},
            {"id": "T-3", "customer": "Globex", "body": "Duplicate invoice charge", "status": "closed"}
        ]

    def test_direct_query(self):
        sql = """
            SELECT id, customer,
                   CHOICE(body, 'Team', ['billing', 'security', 'tech']) AS dept,
                   SCORE(body, 'Urgency', ['low', 'high']) AS urgency
            FROM data
            WHERE status = 'open'
              AND NOUL(body, 'Is this a technical outage?') > 0.5
        """
        rows = jevql(sql, self.tickets)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], "T-1")

    def test_pipeline_query(self):
        pipe = """
            from data
            | filter status == 'open'
            | classify body -> ['billing', 'tech'] as dept
            | judge body ? 'Technical outage?' as is_outage > 0.5
        """
        rows = jevql(pipe, self.tickets)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], "T-1")

    def test_natural_language_query(self):
        nlq = """
            from tickets
            where status is open
            ask "Technical outage?" as is_outage > 0.5
            tag as tech, billing
            top 1 by is_outage
        """
        rows = jevql(nlq, self.tickets)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], "T-1")
        self.assertEqual(rows[0]["tag"], "tech")

    def test_pushdown_pruning(self):
        db = JevQLDatabase(self.tickets)
        res = db.analyze("""
            SELECT id, CHOICE(body, 'Team', ['billing', 'tech']) AS dept
            FROM data
            WHERE status = 'open'
        """)
        self.assertEqual(res["telemetry"]["scanned_rows"], 3)
        self.assertEqual(res["telemetry"]["pushdown_pruned"], 1)
        self.assertEqual(res["telemetry"]["evaluated_rows"], 2)

    def test_cognitive_syntax(self):
        cog = """
            tickets: status = open
            ? "Technical outage?" > 0.5
            dept = billing | security | tech
            urgency = low .. medium .. high
            top 1
        """
        rows = jevql(cog, self.tickets)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], "T-1")
        self.assertEqual(rows[0]["dept"], "tech")

    def test_haskell_syntax(self):
        hask = """
            tickets { status: open }
            | "Technical outage?" > 0.5
            | dept -> [billing, tech]
            take 1
        """
        rows = jevql(hask, self.tickets)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], "T-1")
        self.assertEqual(rows[0]["dept"], "tech")

if __name__ == "__main__":
    unittest.main()
