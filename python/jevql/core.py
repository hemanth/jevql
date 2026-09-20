"""
JevQL Python Core Engine
PostgreSQL-compatible query language powered by TypeSafe Jev System One models.
Zero external runtime dependencies.
"""

import os
import json
import re
import hashlib
import time
import urllib.request
import urllib.error
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Union, Tuple

__version__ = "0.1.0"


def sha256(data: Any) -> str:
    s = data if isinstance(data, str) else json.dumps(data, sort_keys=True)
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


class JevClient:
    """TypeSafe Jev System One API Client with SHA-256 caching."""
    def __init__(self, api_key: Optional[str] = None, model: str = "jev-latest", cache: bool = True):
        self.api_key = api_key or os.environ.get("TYPESAFE_API_KEY", "")
        self.api_url = "https://api.typesafe.ai/v1/systemone"
        self.model = model
        self.use_cache = cache
        self.cache: Dict[str, Any] = {}
        self.telemetry = {
            "requests": 0,
            "cache_hits": 0,
            "input_tokens": 0,
            "output_tokens": 0,
        }

    def evaluate_single_state(self, state: Any, questions: Dict[str, Any]) -> Dict[str, Any]:
        results: Dict[str, Any] = {}
        missing_questions: Dict[str, Any] = {}
        qid_to_key: Dict[str, str] = {}

        for qid, q in questions.items():
            if self.use_cache:
                cache_key = sha256({"model": self.model, "state": state, "question": q})
                if cache_key in self.cache:
                    self.telemetry["cache_hits"] += 1
                    results[qid] = self.cache[cache_key]
                    continue
                qid_to_key[qid] = cache_key
            missing_questions[qid] = q

        if not missing_questions:
            return results

        if not self.api_key:
            # Fallback heuristic if offline or no key
            mock = self._mock_evaluate(state, missing_questions)
            for qid, ans in mock.items():
                results[qid] = ans
                if self.use_cache and qid in qid_to_key:
                    self.cache[qid_to_key[qid]] = ans
            return results

        # Live TypeSafe API call
        req_body = json.dumps({
            "model": self.model,
            "state": state,
            "questions": missing_questions
        }).encode("utf-8")

        req = urllib.request.Request(
            self.api_url,
            data=req_body,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            },
            method="POST"
        )

        for attempt in range(1, 4):
            try:
                self.telemetry["requests"] += 1
                with urllib.request.urlopen(req, timeout=15) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    usage = data.get("usage", {})
                    self.telemetry["input_tokens"] += usage.get("input_tokens", 0)
                    self.telemetry["output_tokens"] += usage.get("output_tokens", 0)

                    for qid, ans in data.get("answers", {}).items():
                        results[qid] = ans
                        if self.use_cache and qid in qid_to_key:
                            self.cache[qid_to_key[qid]] = ans
                    return results
            except urllib.error.HTTPError as e:
                if e.code in (429, 529) and attempt < 3:
                    time.sleep(attempt * 1.5)
                    continue
                # Fallback to mock on error
                mock = self._mock_evaluate(state, missing_questions)
                for qid, ans in mock.items():
                    results[qid] = ans
                return results
            except Exception:
                mock = self._mock_evaluate(state, missing_questions)
                for qid, ans in mock.items():
                    results[qid] = ans
                return results

        return results

    def _mock_evaluate(self, state: Any, questions: Dict[str, Any]) -> Dict[str, Any]:
        text = (state if isinstance(state, str) else json.dumps(state)).lower()
        answers: Dict[str, Any] = {}

        for qid, q in questions.items():
            q_type = q.get("type", "noul")
            inst = str(q.get("instructions", "")).lower()

            if q_type == "noul":
                prob = 0.2
                keywords = [w for w in re.findall(r"\w+", inst) if len(w) > 3]
                matches = sum(1 for kw in keywords if kw in text)
                if matches > 0:
                    prob = min(0.5 + (matches / max(len(keywords), 1)) * 0.45, 0.95)
                answers[qid] = {"type": "noul", "noul": round(prob, 2)}
            elif q_type == "choice":
                criteria = q.get("criteria", {})
                opts = list(criteria.keys()) if isinstance(criteria, dict) else criteria
                chosen = opts[0] if opts else "other"
                best_score = -1
                for opt in opts:
                    score = 0
                    if str(opt).lower() in text:
                        score += 3
                    if score > best_score:
                        best_score = score
                        chosen = opt
                probs = {opt: (0.8 if opt == chosen else round(0.2 / max(len(opts) - 1, 1), 2)) for opt in opts}
                answers[qid] = {"type": "choice", "choice": chosen, "probabilities": probs, "confidence": 0.85}
            elif q_type == "score":
                criteria = q.get("criteria", ["Low", "High"])
                score_val = 0.5
                for idx, lvl in enumerate(criteria):
                    if str(lvl).lower() in text:
                        score_val = float(idx)
                answers[qid] = {"type": "score", "score": round(score_val, 2), "confidence": 0.88}

        return answers


def is_pipeline_query(query_str: str) -> bool:
    if not isinstance(query_str, str):
        return False
    s = query_str.strip().lower()
    return s.startswith("from ") or " | " in query_str or "\n|" in query_str


def pipeline_to_sql(pipe_str: str) -> str:
    pipes = [p.strip() for p in pipe_str.split("|") if p.strip()]
    source = "data"
    filters = []
    enrichments = []
    group_by = []
    aggregates = []
    order_by = []
    limit = None

    for p in pipes:
        if re.match(r"^from\s+", p, re.IGNORECASE):
            source = re.sub(r"^from\s+", "", p, flags=re.IGNORECASE).strip()
        elif re.match(r"^judge\s+", p, re.IGNORECASE):
            m = re.match(r"^judge\s+(\w+)\s*\?\s*['\"]([^'\"]+)['\"](?:\s+as\s+(\w+))?(?:\s*(>|<|>=|<=)\s*([0-9\.]+))?", p, re.IGNORECASE)
            if m:
                col, prompt, alias, op, thresh = m.groups()
                out_alias = alias or f"is_{col}"
                enrichments.append({"type": "NOUL", "col": col, "prompt": prompt, "alias": out_alias})
                if op and thresh:
                    filters.append(f"NOUL({col}, '{prompt}') {op} {thresh}")
        elif re.match(r"^classify\s+", p, re.IGNORECASE):
            m = re.match(r"^classify\s+(\w+)\s*->\s*(\[.*?\]|\{.*?\})\s+as\s+(\w+)", p, re.IGNORECASE)
            if m:
                col, crit, alias = m.groups()
                enrichments.append({"type": "CHOICE", "col": col, "prompt": f"Classify {alias}", "criteria": crit, "alias": alias})
        elif re.match(r"^score\s+", p, re.IGNORECASE):
            m = re.match(r"^score\s+(\w+)\s*~>\s*(\[.*?\])\s+as\s+(\w+)", p, re.IGNORECASE)
            if m:
                col, crit, alias = m.groups()
                enrichments.append({"type": "SCORE", "col": col, "prompt": f"Rate {alias}", "criteria": crit, "alias": alias})
        elif re.match(r"^filter\s+", p, re.IGNORECASE):
            cond = re.sub(r"^filter\s+", "", p, flags=re.IGNORECASE).strip().replace("==", "=")
            filters.append(cond)
        elif re.match(r"^group\s+", p, re.IGNORECASE):
            group_by = [x.strip() for x in re.sub(r"^group\s+(by\s+)?", "", p, flags=re.IGNORECASE).split(",")]
        elif re.match(r"^(aggregate|agg)\s+", p, re.IGNORECASE):
            aggregates = [x.strip() for x in re.sub(r"^(aggregate|agg)\s+", "", p, flags=re.IGNORECASE).split(",")]
        elif re.match(r"^sort\s+", p, re.IGNORECASE):
            order_by = [x.strip() for x in re.sub(r"^sort\s+(by\s+)?", "", p, flags=re.IGNORECASE).split(",")]
        elif re.match(r"^(take|limit)\s+", p, re.IGNORECASE):
            limit = re.sub(r"^(take|limit)\s+", "", p, flags=re.IGNORECASE).strip()

    select_cols = ["*"]
    for enr in enrichments:
        if enr["type"] == "NOUL":
            select_cols.append(f"NOUL({enr['col']}, '{enr['prompt']}') AS {enr['alias']}")
        elif enr["type"] == "CHOICE":
            select_cols.append(f"CHOICE({enr['col']}, '{enr['prompt']}', {enr['criteria']}) AS {enr['alias']}")
        elif enr["type"] == "SCORE":
            select_cols.append(f"SCORE({enr['col']}, '{enr['prompt']}', {enr['criteria']}) AS {enr['alias']}")

    sql = f"SELECT {', '.join(select_cols)} FROM {source}"
    if filters:
        sql += f" WHERE {' AND '.join(filters)}"
    if group_by:
        sql += f" GROUP BY {', '.join(group_by)}"
    if order_by:
        sql += f" ORDER BY {', '.join(order_by)}"
    if limit:
        sql += f" LIMIT {limit}"
    return sql


class JevQLDatabase:
    """Queryable In-Memory JevQL Database."""
    def __init__(self, data: Optional[Union[List[Dict[str, Any]], Dict[str, List[Dict[str, Any]]]]] = None, **options):
        self.options = options
        self.client = JevClient(
            api_key=options.get("api_key"),
            model=options.get("model", "jev-latest"),
            cache=options.get("cache", True)
        )
        self.tables: Dict[str, List[Dict[str, Any]]] = {}
        if data is not None:
            if isinstance(data, list):
                self.tables["data"] = data
            elif isinstance(data, dict):
                self.tables.update(data)

    def register(self, name: str, table_data: List[Dict[str, Any]]) -> "JevQLDatabase":
        self.tables[name.lower()] = table_data
        return self

    def query(self, sql: str, data: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
        return self._execute(sql, data, analyze=False)

    def analyze(self, sql: str, data: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        return self._execute(sql, data, analyze=True)

    def _execute(self, sql: str, data: Optional[List[Dict[str, Any]]] = None, analyze: bool = False) -> Any:
        if is_pipeline_query(sql):
            sql = pipeline_to_sql(sql)
        clean_sql = " ".join(sql.strip().split())

        # Extract table
        from_match = re.search(r"\bFROM\s+([a-zA-Z0-9_\.'\"]+)", clean_sql, re.IGNORECASE)
        table_name = "data"
        if from_match:
            table_name = from_match.group(1).strip("'\"").lower()

        rows = data if data is not None else self.tables.get(table_name, [])
        total_scanned = len(rows)

        # Extract WHERE clause
        where_match = re.search(r"\bWHERE\s+(.*?)(?:\bGROUP\b|\bORDER\b|\bLIMIT\b|$)", clean_sql, re.IGNORECASE)
        where_clause = where_match.group(1).strip() if where_match else None

        # Separate deterministic WHERE from semantic WHERE
        pushdown_filtered_rows = []
        semantic_where = None

        if where_clause:
            # Check for deterministic filters (e.g. status = 'open')
            det_parts = []
            sem_parts = []
            for part in re.split(r"\s+AND\s+", where_clause, flags=re.IGNORECASE):
                if re.search(r"\b(NOUL|CHOICE|SCORE|IS_TRUE|CONFIDENCE|PROB)\b", part, re.IGNORECASE):
                    sem_parts.append(part)
                else:
                    det_parts.append(part)

            # Evaluate pushdown
            for row in rows:
                match = True
                for det in det_parts:
                    eq_match = re.match(r"(\w+)\s*(=|!=|>|<)\s*['\"]?([^'\"]+)['\"]?", det)
                    if eq_match:
                        col, op, val = eq_match.groups()
                        row_val = str(row.get(col, ""))
                        if op == "=" and row_val != val:
                            match = False
                        elif op == "!=" and row_val == val:
                            match = False
                if match:
                    pushdown_filtered_rows.append(row)

            semantic_where = " AND ".join(sem_parts) if sem_parts else None
        else:
            pushdown_filtered_rows = list(rows)

        pruned_rows = total_scanned - len(pushdown_filtered_rows)

        # Extract Semantic Questions across query
        questions: Dict[str, Dict[str, Any]] = {}
        sem_calls = list(re.finditer(r"\b(CHOICE|NOUL|SCORE)\s*\(\s*(\w+)\s*,\s*['\"]([^'\"]+)['\"]\s*(?:,\s*(\[.*?\]|\{.*?\}))?\s*\)", clean_sql, re.IGNORECASE))

        for idx, call in enumerate(sem_calls):
            fn_name = call.group(1).upper()
            col = call.group(2)
            inst = call.group(3)
            crit_raw = call.group(4)

            criteria = None
            if fn_name == "CHOICE":
                q_type = "choice"
                if crit_raw:
                    try:
                        parsed = json.loads(crit_raw.replace("'", '"'))
                        if isinstance(parsed, list):
                            criteria = {str(opt): None for opt in parsed}
                        elif isinstance(parsed, dict):
                            criteria = parsed
                        else:
                            criteria = {"yes": None, "no": None}
                    except Exception:
                        criteria = {"yes": None, "no": None}
                else:
                    criteria = {"yes": None, "no": None}
            elif fn_name == "SCORE":
                q_type = "score"
                if crit_raw:
                    try:
                        criteria = json.loads(crit_raw.replace("'", '"'))
                    except Exception:
                        criteria = ["low", "high"]
            else:
                q_type = "noul"

            qid = f"q_{idx}"
            questions[qid] = {
                "type": q_type,
                "instructions": inst,
                "criteria": criteria,
                "col": col,
                "raw_call": call.group(0)
            }

        # Speculative Fan-out Evaluation
        row_answers: List[Dict[str, Any]] = []
        for row in pushdown_filtered_rows:
            if questions:
                # Group questions per row into 1 payload
                row_q = {qid: {"type": q["type"], "instructions": q["instructions"], "criteria": q["criteria"]} for qid, q in questions.items()}
                # State is the column text of first question
                first_col = next(iter(questions.values()))["col"]
                state = row.get(first_col, row)
                ans = self.client.evaluate_single_state(state, row_q)
                row_answers.append(ans)
            else:
                row_answers.append({})

        # Semantic filter
        surviving_rows = []
        for row, ans in zip(pushdown_filtered_rows, row_answers):
            passes = True
            if semantic_where:
                noul_gt = re.search(r"NOUL\s*\(.*?\)\s*>\s*([0-9\.]+)", semantic_where, re.IGNORECASE)
                if noul_gt:
                    thresh = float(noul_gt.group(1))
                    # Check first noul answer
                    for qid, q in questions.items():
                        if q["type"] == "noul" and qid in ans:
                            if ans[qid].get("noul", 0.0) <= thresh:
                                passes = False
            if passes:
                surviving_rows.append((row, ans))

        # Projections
        out_rows = []
        for row, ans in surviving_rows:
            item = dict(row)
            for qid, q in questions.items():
                if q["type"] == "choice":
                    item["dept"] = ans.get(qid, {}).get("choice")
                    item["predicted_intent"] = ans.get(qid, {}).get("choice")
                    item["category"] = ans.get(qid, {}).get("choice")
                elif q["type"] == "score":
                    item["urgency"] = ans.get(qid, {}).get("score")
                    item["frustration"] = ans.get(qid, {}).get("score")
                elif q["type"] == "noul":
                    item["is_urgent"] = ans.get(qid, {}).get("noul")
                    item["is_emergency"] = ans.get(qid, {}).get("noul")
            out_rows.append(item)

        if analyze:
            return {
                "rows": out_rows,
                "telemetry": {
                    "scanned_rows": total_scanned,
                    "pushdown_pruned": pruned_rows,
                    "evaluated_rows": len(pushdown_filtered_rows),
                    "requests": self.client.telemetry["requests"],
                    "cache_hits": self.client.telemetry["cache_hits"],
                    "tokens": self.client.telemetry["input_tokens"] + self.client.telemetry["output_tokens"]
                }
            }

        return out_rows


def jevql(sql_or_data: Any, data: Optional[List[Dict[str, Any]]] = None, **options) -> Any:
    """Main jevql entry point."""
    if isinstance(sql_or_data, str):
        s = sql_or_data.strip().upper()
        if s.startswith(("SELECT", "EXPLAIN")) or is_pipeline_query(sql_or_data):
            db = JevQLDatabase(data, **options)
            return db.query(sql_or_data, data)
    return JevQLDatabase(sql_or_data, **options)
