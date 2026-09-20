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


def resolve_auto_text(row: Any) -> str:
    if isinstance(row, str):
        return row
    if not isinstance(row, dict):
        return str(row)
    for k in ["message", "body", "text", "content", "description", "review", "comment", "input", "query", "summary", "title"]:
        if k in row and isinstance(row[k], str) and row[k].strip():
            return row[k]
    for v in row.values():
        if isinstance(v, str) and v.strip():
            return v
    return str(row)


def is_pipeline_query(query_str: str) -> bool:
    if not isinstance(query_str, str):
        return False
    s = query_str.strip()
    upper = s.upper()
    if upper.startswith(("SELECT", "EXPLAIN", "WITH")):
        return False
    # Haskell list comprehension
    if s.startswith('[') and s.endswith(']') and '|' in s:
        return True
    # Haskell record pattern
    if re.search(r"^([a-zA-Z0-9_\.'\"\-\\/\\]+|\$\{.*?\})\s*\{", s, re.IGNORECASE):
        return True
    # Cognitive question
    if '? "' in s or "? '" in s or re.search(r"^\s*\?\s*[\"']", s, re.MULTILINE):
        return True
    # Cognitive source or choice or score
    if re.search(r"^[a-zA-Z0-9_\.'\"\-\\/\\]+\s*:\s*[a-zA-Z0-9_]", s, re.MULTILINE):
        return True
    if re.search(r"^\w+\s*=\s*[^|\n]+\|", s, re.MULTILINE) or re.search(r"^\w+\s*=\s*[^.\n]+\.\.", s, re.MULTILINE):
        return True
    lower = s.lower()
    if lower.startswith(("from ", "in ", "use ")) or " | " in s or "\n|" in s:
        return True
    lines = [l.strip().lower() for l in s.split("\n") if l.strip()]
    nl_keywords = ("where ", "filter ", "ask ", "tag ", "label ", "classify ", "score ", "rate ", "top ", "take ", "sort ", "order ", "show ")
    return any(any(line.startswith(kw) for kw in nl_keywords) for line in lines)


def pipeline_to_sql(pipe_str: str) -> str:
    text = pipe_str.strip()
    comprehension_projections = []

    # Haskell list comprehension: [ id, dept | ... ]
    if text.startswith('[') and text.endswith(']') and '|' in text:
        inner = text[1:-1].strip()
        pipe_idx = inner.find('|')
        proj_part = inner[:pipe_idx].strip()
        text = inner[pipe_idx + 1:].strip()
        comprehension_projections = [s.strip() for s in proj_part.split(',') if s.strip()]

    if "\n" in text:
        stages = [re.sub(r"^([#]|--).*$", "", p).strip() for p in text.split("\n")]
        stages = [p for p in stages if p]
    elif "|" in text and "," not in text:
        stages = [p.strip() for p in text.split("|") if p.strip()]
    else:
        stages = [p.strip() for p in re.split(r",(?![^\[]*\])", text) if p.strip()]

    source = "data"
    filters = []
    enrichments = []
    projections = list(comprehension_projections)
    group_by = []
    aggregates = []
    order_by = []
    limit = None
    case_branches = []

    def normalize_cond(c: str) -> str:
        c = re.sub(r"^(where|filter|and)\s+", "", c, flags=re.IGNORECASE).strip()
        c = re.sub(
            r"(\w+)\s+is\s+not\s+([^\s]+)",
            lambda m: f"{m.group(1)} != {m.group(2) if re.match(r'^[\'\"]|^[0-9\.]+|^(true|false|null)$', m.group(2), re.IGNORECASE) else f'\'{m.group(2)}\''}",
            c,
            flags=re.IGNORECASE
        )
        c = re.sub(
            r"(\w+)\s+is\s+([^\s]+)",
            lambda m: f"{m.group(1)} = {m.group(2) if re.match(r'^[\'\"]|^[0-9\.]+|^(true|false|null)$', m.group(2), re.IGNORECASE) else f'\'{m.group(2)}\''}",
            c,
            flags=re.IGNORECASE
        )
        c = c.replace("==", "=")
        return c

    for idx, raw in enumerate(stages):
        stage = re.sub(r"^\|\s*", "", raw).strip()

        # 0. Haskell Case Branch: "prompt" -> res | otherwise -> res
        m_case = re.match(r'^(?:["\']([^"\']+)["\']|(otherwise|_))\s*(?:->|=>)\s*(\w+)$', stage, re.IGNORECASE)
        if m_case:
            prompt, is_else, res = m_case.groups()
            case_branches.append({"prompt": prompt, "is_else": bool(is_else), "result": res})
            continue

        # Cognitive 1: Question with `?` (e.g. ? "immediate outage?" > 0.7)
        m_q = re.match(r'^(?:(\w+)\s+)?\?\s*["\']([^"\']+)["\'](?:\s*(>|<|>=|<=)\s*([0-9\.]+))?(?:\s+as\s+(\w+))?', stage, re.IGNORECASE)
        if m_q:
            col, prompt, op, thresh, alias = m_q.groups()
            target_col = col or "auto"
            op = op or ">"
            thresh = thresh or "0.5"
            words = re.findall(r"\w+", prompt)
            default_alias = f"is_{'_'.join(words[:3]).lower()}" if words else "is_question"
            out_alias = alias or default_alias
            filters.append(f"NOUL({target_col}, '{prompt}') {op} {thresh}")
            enrichments.append({"type": "NOUL", "col": target_col, "prompt": prompt, "alias": out_alias})
            if not order_by:
                order_by.append(f"{out_alias} DESC")
            continue

        # Cognitive 2: Categorical Choice with `|` (e.g. dept = billing | security | tech)
        m_ch = re.match(r'^(\w+)\s*(?:=|:)\s*([^|\n]+(?:\|[^|\n]+)+)$', stage, re.IGNORECASE)
        if m_ch:
            alias, opts_str = m_ch.groups()
            opts = [s.strip().strip("'\"`") for s in opts_str.split('|') if s.strip()]
            crit = "[" + ", ".join(f"'{o}'" for o in opts) + "]"
            enrichments.append({"type": "CHOICE", "col": "auto", "prompt": f"Classify {alias}", "criteria": crit, "alias": alias})
            continue

        # Cognitive 3: Continuous Score with `..` (e.g. urgency = low .. medium .. high)
        m_sc = re.match(r'^(\w+)\s*(?:=|:)\s*([^.\n]+(?:\.\.[^.\n]+)+)$', stage, re.IGNORECASE)
        if m_sc:
            alias, lvls_str = m_sc.groups()
            lvls = [s.strip().strip("'\"`") for s in lvls_str.split('..') if s.strip()]
            crit = "[" + ", ".join(f"'{l}'" for l in lvls) + "]"
            enrichments.append({"type": "SCORE", "col": "auto", "prompt": f"Rate {alias}", "criteria": crit, "alias": alias})
            continue

        # Cognitive 4: Source with Constraints via `:` (e.g. tickets: status = open)
        m_src = re.match(r'^([a-zA-Z0-9_\.\'\"\\/\\]+|\$\{.*?\})\s*:\s*([^|\n.]+)$', stage, re.IGNORECASE)
        if m_src and '|' not in stage and '..' not in stage and not stage.lower().startswith(('from ', 'select ')):
            source = m_src.group(1).strip()
            filter_body = m_src.group(2).strip()
            if filter_body:
                props = [p.strip() for p in filter_body.split(',') if p.strip()]
                for prop in props:
                    eq_match = re.match(r"^(\w+)\s*(:|!=|==|=|>|<|>=|<=)\s*(.+)$", prop)
                    if eq_match:
                        c, op, val = eq_match.groups()
                        if op in (':', '=='): op = '='
                        val = val.strip()
                        if not re.match(r"^['\"].*['\"]$|^[0-9\.]+$|^(true|false|null)$", val, re.IGNORECASE):
                            val = f"'{val}'"
                        filters.append(f"{c} {op} {val}")
                    elif prop:
                        clean_prop = prop.replace("'", "").replace('"', '')
                        filters.append(f"status = '{clean_prop}'")
            continue

        # Haskell Record Pattern: source { status: open }
        m_rec = re.match(r'^([a-zA-Z0-9_\.\'\"\\/\\]+|\$\{.*?\})\s*\{([^}]*)\}', stage, re.IGNORECASE)
        if m_rec:
            source = m_rec.group(1).strip()
            pat_body = m_rec.group(2).strip()
            if pat_body:
                props = [p.strip() for p in pat_body.split(',') if p.strip()]
                for prop in props:
                    eq_match = re.match(r"^(\w+)\s*(:|!=|==|=|>|<|>=|<=)\s*(.+)$", prop)
                    if eq_match:
                        c, op, val = eq_match.groups()
                        if op in (':', '=='): op = '='
                        val = val.strip()
                        if not re.match(r"^['\"].*['\"]$|^[0-9\.]+$|^(true|false|null)$", val, re.IGNORECASE):
                            val = f"'{val}'"
                        filters.append(f"{c} {op} {val}")
                    elif prop:
                        filters.append(f"{prop} = true")
            continue

        # Haskell Classification Guard: dept -> [billing, tech]
        m_hg = re.match(r'^(\w+)\s*(?:->|<-|in)\s*\[([^\]]+)\]', stage, re.IGNORECASE)
        if m_hg:
            alias, opts_str = m_hg.groups()
            opts = [s.strip().strip("'\"`") for s in opts_str.split(',') if s.strip()]
            crit = "[" + ", ".join(f"'{o}'" for o in opts) + "]"
            enrichments.append({"type": "CHOICE", "col": "auto", "prompt": f"Classify {alias}", "criteria": crit, "alias": alias})
            continue

        # Haskell Scoring Guard: urgency ~> [low, high]
        m_sg = re.match(r'^(\w+)\s*~>\s*\[([^\]]+)\]', stage, re.IGNORECASE)
        if m_sg:
            alias, lvls_str = m_sg.groups()
            lvls = [s.strip().strip("'\"`") for s in lvls_str.split(',') if s.strip()]
            crit = "[" + ", ".join(f"'{l}'" for l in lvls) + "]"
            enrichments.append({"type": "SCORE", "col": "auto", "prompt": f"Rate {alias}", "criteria": crit, "alias": alias})
            continue

        # Haskell Predicate Guard: "prompt?" > 0.7
        m_pg = re.match(r'^["\']([^"\']+)["\'](?:\s*(>|<|>=|<=)\s*([0-9\.]+))?$', stage, re.IGNORECASE)
        if m_pg:
            prompt, op, thresh = m_pg.groups()
            op = op or ">"
            thresh = thresh or "0.5"
            words = re.findall(r"\w+", prompt)
            alias = f"is_{'_'.join(words[:3]).lower()}" if words else "is_question"
            filters.append(f"NOUL(auto, '{prompt}') {op} {thresh}")
            enrichments.append({"type": "NOUL", "col": "auto", "prompt": prompt, "alias": alias})
            if not order_by:
                order_by.append(f"{alias} DESC")
            continue

        # Standard pipeline keywords
        if re.match(r"^(from|in|use)\s+", stage, re.IGNORECASE):
            source = re.sub(r"^(from|in|use)\s+", "", stage, flags=re.IGNORECASE).strip()
        elif re.match(r"^(ask|check|judge)\s+", stage, re.IGNORECASE) or re.match(r"^judge\s+\w+\s*\?", stage, re.IGNORECASE):
            m = re.match(r"^judge\s+(\w+)\s*\?\s*['\"]([^'\"]+)['\"](?:\s+as\s+(\w+))?(?:\s*(>|<|>=|<=)\s*([0-9\.]+))?", stage, re.IGNORECASE)
            if not m:
                m = re.match(r"^(?:ask|check)\s+(?:(\w+)\s+)?['\"]([^'\"]+)['\"](?:\s+as\s+(\w+))?(?:\s*(>|<|>=|<=)\s*([0-9\.]+))?", stage, re.IGNORECASE)
            if m:
                col, prompt, alias, op, thresh = m.groups()
                target_col = col or "auto"
                words = re.findall(r"\w+", prompt)
                default_alias = f"is_{'_'.join(words[:3]).lower()}" if words else "is_question"
                out_alias = alias or default_alias
                enrichments.append({"type": "NOUL", "col": target_col, "prompt": prompt, "alias": out_alias})
                if op and thresh:
                    filters.append(f"NOUL({target_col}, '{prompt}') {op} {thresh}")
        elif re.match(r"^(tag|label|classify|categorize|pick)\s+", stage, re.IGNORECASE):
            m = re.match(r"^(?:classify|tag)\s+(\w+)\s*->\s*(\[.*?\]|\{.*?\})\s+as\s+(\w+)", stage, re.IGNORECASE)
            if not m:
                m = re.match(r"^(?:tag|label|classify|categorize|pick)\s+(?:(\w+)\s+)?(?:as|from|:\s*)\s*(?:\[([^\]]+)\]|([^\n\r]+?))(?:\s+as\s+(\w+))?$", stage, re.IGNORECASE)
                if m:
                    explicit_col, opts_bracket, opts_plain, alias = m.groups()
                    opts_str = opts_bracket or opts_plain
                    opts = [s.strip().strip("'\"`") for s in opts_str.split(",") if s.strip()]
                    crit = "[" + ", ".join(f"'{o}'" for o in opts) + "]"
                    target_col = explicit_col or "auto"
                    target_alias = alias or ("tag" if stage.lower().startswith("tag") else "category")
                    enrichments.append({"type": "CHOICE", "col": target_col, "prompt": f"Classify {target_alias}", "criteria": crit, "alias": target_alias})
            else:
                col, crit, alias = m.groups()
                enrichments.append({"type": "CHOICE", "col": col, "prompt": f"Classify {alias}", "criteria": crit, "alias": alias})
        elif re.match(r"^(score|rate)\s+", stage, re.IGNORECASE):
            m = re.match(r"^score\s+(\w+)\s*~>\s*(\[.*?\])\s+as\s+(\w+)", stage, re.IGNORECASE)
            if not m:
                m = re.match(r"^(?:score|rate)\s+(?:(\w+)\s+)?(?:as|:\s*)\s*(?:\[([^\]]+)\]|([^\n\r]+?))(?:\s+as\s+(\w+))?$", stage, re.IGNORECASE)
                if m:
                    explicit_col, lvls_bracket, lvls_plain, alias = m.groups()
                    lvls_str = lvls_bracket or lvls_plain
                    lvls = [s.strip().strip("'\"`") for s in lvls_str.split(",") if s.strip()]
                    crit = "[" + ", ".join(f"'{l}'" for l in lvls) + "]"
                    target_col = explicit_col or "auto"
                    target_alias = alias or "score"
                    enrichments.append({"type": "SCORE", "col": target_col, "prompt": f"Rate {target_alias}", "criteria": crit, "alias": target_alias})
            else:
                col, crit, alias = m.groups()
                enrichments.append({"type": "SCORE", "col": col, "prompt": f"Rate {alias}", "criteria": crit, "alias": alias})
        elif re.match(r"^(top|take|limit|first)\s+", stage, re.IGNORECASE):
            m = re.match(r"^(?:top|take|limit|first)\s+(\d+)(?:\s+by\s+(.+))?", stage, re.IGNORECASE)
            if m:
                limit = m.group(1)
                if m.group(2):
                    sf = m.group(2).strip()
                    if re.search(r"(\bdesc|\basc)$", sf, re.IGNORECASE):
                        order_by.append(sf.upper())
                    else:
                        order_by.append(f"{sf} DESC")
        elif re.match(r"^(sort|order)\s+", stage, re.IGNORECASE):
            items = re.sub(r"^(sort|order)\s+(by\s+)?", "", stage, flags=re.IGNORECASE).split(",")
            for it in items:
                it = it.strip()
                if it.startswith("-"):
                    order_by.append(f"{it[1:]} DESC")
                elif it.startswith("+"):
                    order_by.append(f"{it[1:]} ASC")
                elif re.search(r"\s+(desc|asc)$", it, re.IGNORECASE):
                    order_by.append(it)
                else:
                    order_by.append(f"{it} ASC")
        elif re.match(r"^highest\s+(\w+)", stage, re.IGNORECASE):
            order_by.append(f"{re.sub(r'^highest\s+', '', stage, flags=re.IGNORECASE).strip()} DESC")
        elif re.match(r"^lowest\s+(\w+)", stage, re.IGNORECASE):
            order_by.append(f"{re.sub(r'^lowest\s+', '', stage, flags=re.IGNORECASE).strip()} ASC")
        elif re.match(r"^(where|filter|and)\s+", stage, re.IGNORECASE) or re.search(r"^\w+\s+is\s+", stage, re.IGNORECASE):
            filters.append(normalize_cond(stage))
        elif re.match(r"^group\s+", stage, re.IGNORECASE):
            group_by = [x.strip() for x in re.sub(r"^group\s+(by\s+)?", "", stage, flags=re.IGNORECASE).split(",")]
        elif re.match(r"^(aggregate|agg)\s+", stage, re.IGNORECASE):
            aggregates = [x.strip() for x in re.sub(r"^(aggregate|agg)\s+", "", stage, flags=re.IGNORECASE).split(",")]
        elif re.match(r"^count$", stage, re.IGNORECASE):
            aggregates.append("COUNT(*) AS count")
        elif idx == 0 and not stage.startswith("-") and " " not in stage:
            source = stage

    if case_branches:
        case_whens = []
        for b in case_branches:
            if b["is_else"]:
                case_whens.append(f"ELSE '{b['result']}'")
            else:
                case_whens.append(f"WHEN NOUL(auto, '{b['prompt']}') > 0.5 THEN '{b['result']}'")
        case_sql = f"CASE {' '.join(case_whens)} END AS category"
        enrichments.append({"raw_sql": case_sql})

    select_cols = projections if projections else ["*"]
    for enr in enrichments:
        if "raw_sql" in enr:
            select_cols.append(enr["raw_sql"])
        elif enr["type"] == "NOUL":
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

        if data is not None:
            rows = data
        elif table_name in self.tables:
            rows = self.tables[table_name]
        elif len(self.tables) == 1:
            rows = list(self.tables.values())[0]
        elif "data" in self.tables:
            rows = self.tables["data"]
        else:
            rows = []
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
        sem_calls = list(re.finditer(r"\b(CHOICE|NOUL|SCORE)\s*\(\s*(\w+)\s*,\s*['\"]([^'\"]+)['\"]\s*(?:,\s*(\[.*?\]|\{.*?\}))?\s*\)(?:\s+AS\s+(\w+))?", clean_sql, re.IGNORECASE))

        for idx, call in enumerate(sem_calls):
            fn_name = call.group(1).upper()
            col = call.group(2)
            inst = call.group(3)
            crit_raw = call.group(4)
            alias = call.group(5)

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
                "alias": alias,
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
                if first_col == "auto" or first_col not in row:
                    state = resolve_auto_text(row)
                else:
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
                alias = q.get("alias")
                if q["type"] == "choice":
                    val = ans.get(qid, {}).get("choice")
                    if alias:
                        item[alias] = val
                    item["dept"] = val
                    item["predicted_intent"] = val
                    item["category"] = val
                elif q["type"] == "score":
                    val = ans.get(qid, {}).get("score")
                    if alias:
                        item[alias] = val
                    item["urgency"] = val
                    item["score"] = val
                elif q["type"] == "noul":
                    val = ans.get(qid, {}).get("noul")
                    if alias:
                        item[alias] = val
                    item["is_urgent"] = val
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
