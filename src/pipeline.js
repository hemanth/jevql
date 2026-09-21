/**
 * JevQL Haskell-Style Pattern Matching & Natural Query Language (NQL / PQL)
 *
 * Supported syntaxes:
 *
 * 1. Haskell Pattern Matching with Guards:
 *    tickets { status: open }
 *      | "immediate outage?" > 0.7
 *      | dept -> [billing, security, tech]
 *      take 10
 *
 * 2. Haskell Branching Case Pattern:
 *    tickets { status: open }
 *      | "outage?"   -> tech
 *      | "security?" -> security
 *      | otherwise   -> billing
 *      take 5
 *
 * 3. Haskell List Comprehensions:
 *    [ id, dept | tickets { status: open }, "outage?" > 0.7, dept -> [billing, tech] ]
 *
 * 4. Natural Language Queries:
 *    from tickets
 *    where status is open
 *    ask "immediate outage?" as is_outage > 0.7
 *    tag as billing, security, tech
 *    top 10 by is_outage
 *
 * 5. Traditional Pipeline Dataflow:
 *    from tickets | filter status == 'open' | classify ...
 */

import { parse } from './parser.js';

export function isPipelineQuery(text) {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  const upper = trimmed.toUpperCase();
  if (upper.startsWith('SELECT') || upper.startsWith('EXPLAIN') || upper.startsWith('WITH ')) {
    return false;
  }
  // Haskell List Comprehension: [ id, dept | ... ]
  if (trimmed.startsWith('[') && trimmed.endsWith(']') && trimmed.includes('|')) {
    return true;
  }
  // Haskell Record Pattern: tickets { status: open }
  if (/^([a-zA-Z0-9_\.'"\-/\\]+|\$\{.*?\})\s*\{/i.test(trimmed)) {
    return true;
  }
  // Cognitive Syntax: ? "question"
  if (trimmed.includes('? "') || trimmed.includes("? '") || trimmed.includes('?“') || /^\s*\?\s*["'“]/m.test(trimmed)) {
    return true;
  }
  // Cognitive Syntax: source: filter  OR  var = opt1 | opt2  OR  var = lvl1 .. lvl2
  if (/^[a-zA-Z0-9_\.'"\-/\\]+\s*:\s*[a-zA-Z0-9_]/m.test(trimmed)) {
    return true;
  }
  if (/^\w+\s*=\s*[^|\n]+\|/m.test(trimmed) || /^\w+\s*=\s*[^.\n]+\.\./m.test(trimmed)) {
    return true;
  }
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('from ') || lower.startsWith('in ') || lower.startsWith('use ')) {
    return true;
  }
  if (trimmed.includes('|')) {
    return true;
  }
  const lines = trimmed.split('\n').map(l => l.trim().toLowerCase());
  const nlKeywords = ['where ', 'filter ', 'ask ', 'tag ', 'label ', 'classify ', 'score ', 'rate ', 'top ', 'take ', 'sort ', 'order ', 'show '];
  return lines.some(line => nlKeywords.some(kw => line.startsWith(kw)));
}

function splitClausesRespectingBrackets(str, delimiter = ',') {
  const clauses = [];
  let current = '';
  let depth = 0;
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if ((char === '"' || char === "'") && (i === 0 || str[i - 1] !== '\\')) {
      if (!inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else if (quoteChar === char) {
        inQuotes = false;
      }
    }

    if (!inQuotes) {
      if (char === '[' || char === '{' || char === '(') depth++;
      else if (char === ']' || char === '}' || char === ')') depth--;
      else if (char === delimiter && depth === 0) {
        if (current.trim()) clauses.push(current.trim());
        current = '';
        continue;
      }
    }
    current += char;
  }
  if (current.trim()) {
    clauses.push(current.trim());
  }
  return clauses;
}

function normalizeCondition(rawCond) {
  let c = rawCond.trim();
  c = c.replace(/^(where|filter|and)\s+/i, '').trim();

  // Replace 'is not' with '!='
  c = c.replace(/(\w+)\s+is\s+not\s+([^\s]+)/gi, (match, col, val) => {
    val = val.trim();
    if (/^['"].*['"]$/.test(val) || /^[0-9\.]+$/.test(val) || /^(true|false|null)$/i.test(val)) {
      return `${col} != ${val}`;
    }
    return `${col} != '${val}'`;
  });

  // Replace 'is' with '='
  c = c.replace(/(\w+)\s+is\s+([^\s]+)/gi, (match, col, val) => {
    val = val.trim();
    if (/^['"].*['"]$/.test(val) || /^[0-9\.]+$/.test(val) || /^(true|false|null)$/i.test(val)) {
      return `${col} = ${val}`;
    }
    return `${col} = '${val}'`;
  });

  // Replace '==' with '='
  c = c.replace(/==/g, '=');

  return c;
}

/**
 * Transpiles JevQL Pattern Matching / Natural / Pipeline syntax into standard JevQL SQL.
 */
export function pipelineToSQL(queryStr) {
  let text = queryStr.trim();
  const comprehensionProjections = [];

  // Check Haskell List Comprehension: [ proj1, proj2 | source { pattern }, guards... ]
  if (text.startsWith('[') && text.endsWith(']') && text.includes('|')) {
    const inner = text.slice(1, -1).trim();
    const pipeIdx = inner.indexOf('|');
    const projPart = inner.slice(0, pipeIdx).trim();
    const bodyPart = inner.slice(pipeIdx + 1).trim();
    comprehensionProjections.push(...projPart.split(',').map(s => s.trim()).filter(Boolean));
    text = bodyPart;
  }

  // Split into stages
  let rawStages = [];
  if (text.includes('\n')) {
    rawStages = text.split('\n')
      .map(p => p.trim().replace(/^([#]|--).*$/, '').trim())
      .filter(Boolean);
  } else if (text.includes('|')) {
    rawStages = splitClausesRespectingBrackets(text, '|');
  } else {
    rawStages = splitClausesRespectingBrackets(text, ',');
  }

  let source = null;
  const filters = [];
  const semanticEnrichments = [];
  const projections = [...comprehensionProjections];
  let groupBy = [];
  const aggregates = [];
  let having = [];
  const orderBy = [];
  let limit = null;
  let offset = null;

  const caseBranches = []; // For Haskell branching case pattern

  for (let idx = 0; idx < rawStages.length; idx++) {
    const raw = rawStages[idx].trim();
    const stage = raw.replace(/^\|\s*/, '').trim();

    // 0. Haskell Branching Case Guard: "prompt?" -> result  OR  otherwise -> result
    const caseMatch = stage.match(/^(?:["'“]([^"'”]+)["'”]|(otherwise|_))\s*(?:->|=>)\s*(\w+)$/i);
    if (caseMatch) {
      const prompt = caseMatch[1];
      const isElse = Boolean(caseMatch[2]);
      const result = caseMatch[3];
      caseBranches.push({ prompt, isElse, result });
      continue;
    }

    // Cognitive 1: Question with `?` (e.g. ? "immediate outage?" > 0.7)
    const cognitiveQuestionMatch = stage.match(/^(?:(\w+)\s+)?\?\s*["'“]([^"'”]+)["'”](?:\s*(>|<|>=|<=)\s*([0-9\.]+))?(?:\s+as\s+(\w+))?/i);
    if (cognitiveQuestionMatch) {
      const col = cognitiveQuestionMatch[1] || 'auto';
      const prompt = cognitiveQuestionMatch[2].replace(/'/g, "\\'");
      const op = cognitiveQuestionMatch[3] || '>';
      const thresh = cognitiveQuestionMatch[4] || '0.5';
      const words = cognitiveQuestionMatch[2].replace(/[^\w\s]/g, '').trim().split(/\s+/);
      const defaultAlias = `is_${words.slice(0, 3).join('_').toLowerCase()}`;
      const alias = cognitiveQuestionMatch[5] || defaultAlias;

      filters.push(`NOUL(${col}, '${prompt}') ${op} ${thresh}`);
      semanticEnrichments.push({
        type: 'NOUL',
        col,
        prompt,
        alias
      });
      if (orderBy.length === 0) {
        orderBy.push(`${alias} DESC`);
      }
      continue;
    }

    // Cognitive 2: Categorical Choice with `|` (e.g. dept = billing | security | tech)
    const cognitiveChoiceMatch = stage.match(/^(\w+)\s*(?:=|:)\s*([^|\n]+(?:\|[^|\n]+)+)$/i);
    if (cognitiveChoiceMatch) {
      const alias = cognitiveChoiceMatch[1];
      const opts = cognitiveChoiceMatch[2].split('|').map(s => s.trim().replace(/^['"`]|['"`]$/g, '')).filter(Boolean);
      const criteria = `[${opts.map(o => `'${o.replace(/'/g, "\\'")}'`).join(', ')}]`;
      semanticEnrichments.push({
        type: 'CHOICE',
        col: 'auto',
        prompt: `Classify ${alias}`,
        criteria,
        alias
      });
      continue;
    }

    // Cognitive 3: Continuous Score with `..` (e.g. urgency = low .. medium .. high)
    const cognitiveScoreMatch = stage.match(/^(\w+)\s*(?:=|:)\s*([^.\n]+(?:\.\.[^.\n]+)+)$/i);
    if (cognitiveScoreMatch) {
      const alias = cognitiveScoreMatch[1];
      const lvls = cognitiveScoreMatch[2].split('..').map(s => s.trim().replace(/^['"`]|['"`]$/g, '')).filter(Boolean);
      const criteria = `[${lvls.map(l => `'${l.replace(/'/g, "\\'")}'`).join(', ')}]`;
      semanticEnrichments.push({
        type: 'SCORE',
        col: 'auto',
        prompt: `Rate ${alias}`,
        criteria,
        alias
      });
      continue;
    }

    // Cognitive 4: Source with Constraints via `:` (e.g. tickets: status = open, priority = P1)
    const cognitiveSourceMatch = stage.match(/^([a-zA-Z0-9_\.'"\-/\\]+|\$\{.*?\})\s*:\s*([^|\n.]+)$/i);
    if (cognitiveSourceMatch && !stage.includes('|') && !stage.includes('..') && !stage.toLowerCase().startsWith('from ') && !stage.toLowerCase().startsWith('select ')) {
      source = cognitiveSourceMatch[1].trim();
      const filterBody = cognitiveSourceMatch[2].trim();
      if (filterBody) {
        const props = splitClausesRespectingBrackets(filterBody);
        for (const prop of props) {
          const eqMatch = prop.match(/^(\w+)\s*(:|!=|==|=|>|<|>=|<=)\s*(.+)$/);
          if (eqMatch) {
            const col = eqMatch[1].trim();
            let op = eqMatch[2].trim();
            if (op === ':' || op === '==') op = '=';
            let val = eqMatch[3].trim();
            if (!/^['"].*['"]$/.test(val) && !/^[0-9\.]+$/.test(val) && !/^(true|false|null)$/i.test(val)) {
              val = `'${val}'`;
            }
            filters.push(`${col} ${op} ${val}`);
          } else if (prop) {
            filters.push(`status = '${prop.replace(/['"]/g, '')}'`);
          }
        }
      }
      continue;
    }

    // 1. Haskell Record Pattern: source { status: open, priority: P1 }
    const recordMatch = stage.match(/^([a-zA-Z0-9_\.'"\-/\\]+|\$\{.*?\})\s*\{([^}]*)\}/i);
    if (recordMatch) {
      source = recordMatch[1].trim();
      const patternBody = recordMatch[2].trim();
      if (patternBody) {
        const props = splitClausesRespectingBrackets(patternBody);
        for (const prop of props) {
          const eqMatch = prop.match(/^(\w+)\s*(:|!=|==|=|>|<|>=|<=)\s*(.+)$/);
          if (eqMatch) {
            const col = eqMatch[1].trim();
            let op = eqMatch[2].trim();
            if (op === ':' || op === '==') op = '=';
            let val = eqMatch[3].trim();
            if (!/^['"].*['"]$/.test(val) && !/^[0-9\.]+$/.test(val) && !/^(true|false|null)$/i.test(val)) {
              val = `'${val}'`;
            }
            filters.push(`${col} ${op} ${val}`);
          } else if (prop) {
            filters.push(`${prop} = true`);
          }
        }
      }
      continue;
    }

    // 2. Haskell Classification Guard: dept -> [billing, security, tech]  or  dept <- [a, b]
    const choiceGuardMatch = stage.match(/^(\w+)\s*(?:->|<-|in)\s*\[([^\]]+)\]/i);
    if (choiceGuardMatch) {
      const alias = choiceGuardMatch[1];
      const opts = choiceGuardMatch[2].split(',').map(s => s.trim().replace(/^['"`]|['"`]$/g, '')).filter(Boolean);
      const criteria = `[${opts.map(o => `'${o.replace(/'/g, "\\'")}'`).join(', ')}]`;
      semanticEnrichments.push({
        type: 'CHOICE',
        col: 'auto',
        prompt: `Classify ${alias}`,
        criteria,
        alias
      });
      continue;
    }

    // 3. Haskell Scoring Guard: urgency ~> [low, medium, high]
    const scoreGuardMatch = stage.match(/^(\w+)\s*~>\s*\[([^\]]+)\]/i);
    if (scoreGuardMatch) {
      const alias = scoreGuardMatch[1];
      const lvls = scoreGuardMatch[2].split(',').map(s => s.trim().replace(/^['"`]|['"`]$/g, '')).filter(Boolean);
      const criteria = `[${lvls.map(l => `'${l.replace(/'/g, "\\'")}'`).join(', ')}]`;
      semanticEnrichments.push({
        type: 'SCORE',
        col: 'auto',
        prompt: `Rate ${alias}`,
        criteria,
        alias
      });
      continue;
    }

    // 4. Haskell Predicate Guard: "immediate outage?" > 0.7  or  "immediate outage?"
    const predGuardMatch = stage.match(/^["'“]([^"'”]+)["'”](?:\s*(>|<|>=|<=)\s*([0-9\.]+))?$/i);
    if (predGuardMatch) {
      const prompt = predGuardMatch[1];
      const op = predGuardMatch[2] || '>';
      const thresh = predGuardMatch[3] || '0.5';
      const cleanPrompt = prompt.replace(/'/g, "\\'");
      const words = prompt.replace(/[^\w\s]/g, '').trim().split(/\s+/);
      const alias = `is_${words.slice(0, 3).join('_').toLowerCase()}`;

      filters.push(`NOUL(auto, '${cleanPrompt}') ${op} ${thresh}`);
      semanticEnrichments.push({
        type: 'NOUL',
        col: 'auto',
        prompt: cleanPrompt,
        alias
      });
      if (orderBy.length === 0) {
        orderBy.push(`${alias} DESC`);
      }
      continue;
    }

    // 5. FROM / IN / USE stage
    if (/^(from|in|use)\s+/i.test(stage)) {
      source = stage.replace(/^(from|in|use)\s+/i, '').trim();
      continue;
    }

    // 6. ASK / JUDGE / CHECK stage (Natural language)
    if (/^(ask|check|judge)\s+/i.test(stage) || /^judge\s+\w+\s*\?/i.test(stage)) {
      let m = stage.match(/^judge\s+(\w+)\s*\?\s*["'“]([^"'”]+)["'”](?:\s+as\s+(\w+))?(?:\s*(>|<|>=|<=)\s*([0-9\.]+))?/i);
      let col, prompt, alias, op, thresh;

      if (m) {
        [, col, prompt, alias, op, thresh] = m;
      } else {
        m = stage.match(/^(?:ask|check)\s+(?:(\w+)\s+)?["'“]([^"'”]+)["'”](?:\s+as\s+(\w+))?(?:\s*(>|<|>=|<=)\s*([0-9\.]+))?/i);
        if (m) [, col, prompt, alias, op, thresh] = m;
      }

      if (m) {
        const targetCol = col || 'auto';
        const cleanPrompt = prompt.replace(/'/g, "\\'");
        const words = prompt.replace(/[^\w\s]/g, '').trim().split(/\s+/);
        const defaultAlias = `is_${words.slice(0, 3).join('_').toLowerCase()}`;
        const outAlias = alias || defaultAlias;

        semanticEnrichments.push({
          type: 'NOUL',
          col: targetCol,
          prompt: cleanPrompt,
          alias: outAlias
        });

        if (op && thresh) {
          filters.push(`NOUL(${targetCol}, '${cleanPrompt}') ${op} ${thresh}`);
        }
        continue;
      }
    }

    // 7. TAG / CLASSIFY / LABEL / CATEGORIZE stage
    if (/^(tag|label|classify|categorize|pick)\s+/i.test(stage)) {
      let col, optionsRaw, alias;

      let m = stage.match(/^(?:classify|tag)\s+(\w+)\s*->\s*(\[.*?\]|\{.*?\})\s+as\s+(\w+)/i);
      if (m) {
        [, col, optionsRaw, alias] = m;
      } else {
        m = stage.match(/^(?:tag|label|classify|categorize|pick)\s+(?:(\w+)\s+)?(?:as|from|:\s*)\s*(?:\[([^\]]+)\]|([^\n\r]+?))(?:\s+as\s+(\w+))?$/i);
        if (m) {
          const explicitCol = m[1];
          const optsString = m[2] || m[3];
          alias = m[4];
          col = explicitCol || 'auto';

          let opts = [];
          if (optsString) {
            opts = optsString.split(',').map(s => s.trim().replace(/^['"`]|['"`]$/g, '')).filter(Boolean);
          }
          optionsRaw = `[${opts.map(o => `'${o.replace(/'/g, "\\'")}'`).join(', ')}]`;
        }
      }

      if (m) {
        const targetCol = col || 'auto';
        const targetAlias = alias || (stage.startsWith('tag') ? 'tag' : 'category');
        semanticEnrichments.push({
          type: 'CHOICE',
          col: targetCol,
          prompt: `Classify ${targetAlias}`,
          criteria: optionsRaw,
          alias: targetAlias
        });
        continue;
      }
    }

    // 8. SCORE / RATE stage
    if (/^(score|rate)\s+/i.test(stage)) {
      let col, levelsRaw, alias;

      let m = stage.match(/^score\s+(\w+)\s*~>\s*(\[.*?\])\s+as\s+(\w+)/i);
      if (m) {
        [, col, levelsRaw, alias] = m;
      } else {
        m = stage.match(/^(?:score|rate)\s+(?:(\w+)\s+)?(?:as|:\s*)\s*(?:\[([^\]]+)\]|([^\n\r]+?))(?:\s+as\s+(\w+))?$/i);
        if (m) {
          const explicitCol = m[1];
          const lvlsString = m[2] || m[3];
          alias = m[4];
          col = explicitCol || 'auto';

          let lvls = [];
          if (lvlsString) {
            lvls = lvlsString.split(',').map(s => s.trim().replace(/^['"`]|['"`]$/g, '')).filter(Boolean);
          }
          levelsRaw = `[${lvls.map(l => `'${l.replace(/'/g, "\\'")}'`).join(', ')}]`;
        }
      }

      if (m) {
        const targetCol = col || 'auto';
        const targetAlias = alias || 'score';
        semanticEnrichments.push({
          type: 'SCORE',
          col: targetCol,
          prompt: `Rate ${targetAlias}`,
          criteria: levelsRaw,
          alias: targetAlias
        });
        continue;
      }
    }

    // 9. TOP / TAKE / LIMIT / FIRST stage
    if (/^(top|take|limit|first)\s+(\d+)(?:\s+by\s+(.+))?/i.test(stage)) {
      const m = stage.match(/^(top|take|limit|first)\s+(\d+)(?:\s+by\s+(.+))?/i);
      limit = m[2];
      if (m[3]) {
        const sortField = m[3].trim();
        if (/(\bdesc|\basc)$/i.test(sortField)) {
          orderBy.push(sortField.toUpperCase());
        } else {
          orderBy.push(`${sortField} DESC`);
        }
      }
      continue;
    }

    // 10. SORT / ORDER stage
    if (/^(sort|order)\s+(by\s+)?(.+)/i.test(stage)) {
      const items = stage.replace(/^(sort|order)\s+(by\s+)?/i, '').split(',').map(s => s.trim());
      for (const item of items) {
        if (item.startsWith('-')) orderBy.push(`${item.slice(1)} DESC`);
        else if (item.startsWith('+')) orderBy.push(`${item.slice(1)} ASC`);
        else if (/\s+(desc|asc)$/i.test(item)) orderBy.push(item);
        else orderBy.push(`${item} ASC`);
      }
      continue;
    }
    if (/^highest\s+(\w+)/i.test(stage)) {
      orderBy.push(`${stage.replace(/^highest\s+/i, '').trim()} DESC`);
      continue;
    }
    if (/^lowest\s+(\w+)/i.test(stage)) {
      orderBy.push(`${stage.replace(/^lowest\s+/i, '').trim()} ASC`);
      continue;
    }

    // 11. FILTER / WHERE / AND stage
    if (/^(where|filter|and)\s+/i.test(stage) || /^\w+\s+is\s+/i.test(stage)) {
      const cond = normalizeCondition(stage);
      if (groupBy.length > 0) having.push(cond);
      else filters.push(cond);
      continue;
    }

    // 12. SHOW / SELECT / KEEP stage
    if (/^(show|select|keep)\s+/i.test(stage)) {
      const cols = stage.replace(/^(show|select|keep)\s+/i, '').split(',').map(s => s.trim());
      projections.push(...cols);
      continue;
    }

    // 13. GROUP stage
    if (/^group\s+/i.test(stage)) {
      const cols = stage.replace(/^group\s+(by\s+)?/i, '').split(',').map(s => s.trim());
      groupBy = cols;
      continue;
    }

    // 14. AGGREGATE / COUNT stage
    if (/^(aggregate|agg)\s+/i.test(stage)) {
      const exprs = stage.replace(/^(aggregate|agg)\s+/i, '').split(',').map(s => s.trim());
      for (const e of exprs) {
        if (/^count\(\s*\)$/i.test(e)) aggregates.push('COUNT(*) AS count');
        else aggregates.push(e);
      }
      continue;
    }
    if (/^count$/i.test(stage)) {
      aggregates.push('COUNT(*) AS count');
      continue;
    }

    // 15. Fallback for first line as source name
    if (idx === 0 && !source && !stage.includes(' ')) {
      source = stage;
      continue;
    }
  }

  // Assemble branching CASE statement if case branches exist
  let caseExpressionStr = null;
  if (caseBranches.length > 0) {
    const whenClauses = [];
    let elseClause = "'other'";
    for (const b of caseBranches) {
      if (b.isElse) {
        elseClause = `'${b.result}'`;
      } else {
        whenClauses.push(`WHEN NOUL(auto, '${b.prompt.replace(/'/g, "\\'")}') > 0.5 THEN '${b.result}'`);
      }
    }
    caseExpressionStr = `CASE ${whenClauses.join(' ')} ELSE ${elseClause} END AS category`;
  }

  function resolveEnrichment(exprStr) {
    let res = exprStr;
    for (const enr of semanticEnrichments) {
      let callStr = '';
      if (enr.type === 'NOUL') callStr = `NOUL(${enr.col}, '${enr.prompt.replace(/'/g, "\\'")}')`;
      else if (enr.type === 'CHOICE') callStr = `CHOICE(${enr.col}, '${enr.prompt}', ${enr.criteria})`;
      else if (enr.type === 'SCORE') callStr = `SCORE(${enr.col}, '${enr.prompt}', ${enr.criteria})`;

      if (res === enr.alias) {
        return `${callStr} AS ${enr.alias}`;
      }
      const aliasRegex = new RegExp(`\\b${enr.alias}\\b`, 'g');
      if (aliasRegex.test(res)) {
        res = res.replace(aliasRegex, callStr);
      }
    }
    return res;
  }

  // Construct standard SQL
  let selectCols = [];

  if (groupBy.length > 0 || aggregates.length > 0) {
    selectCols = [...groupBy, ...aggregates].map(col => resolveEnrichment(col));
  } else if (projections.length > 0) {
    selectCols = projections.map(col => resolveEnrichment(col));
    if (caseExpressionStr) {
      selectCols.push(caseExpressionStr);
    }
  } else {
    // Default projection: all columns plus enrichments
    selectCols = ['*'];
    for (const enr of semanticEnrichments) {
      if (enr.type === 'NOUL') {
        selectCols.push(`NOUL(${enr.col}, '${enr.prompt.replace(/'/g, "\\'")}') AS ${enr.alias}`);
      } else if (enr.type === 'CHOICE') {
        selectCols.push(`CHOICE(${enr.col}, '${enr.prompt}', ${enr.criteria}) AS ${enr.alias}`);
      } else if (enr.type === 'SCORE') {
        selectCols.push(`SCORE(${enr.col}, '${enr.prompt}', ${enr.criteria}) AS ${enr.alias}`);
      }
    }
    if (caseExpressionStr) {
      selectCols.push(caseExpressionStr);
    }
  }

  const resolvedGroupBy = groupBy.map(g => {
    const r = resolveEnrichment(g);
    return r.replace(/\s+AS\s+\w+$/i, '');
  });

  const sqlParts = [
    `SELECT ${selectCols.join(', ')}`,
    `FROM ${source || 'data'}`
  ];

  if (filters.length > 0) {
    sqlParts.push(`WHERE ${filters.join(' AND ')}`);
  }

  if (groupBy.length > 0) {
    sqlParts.push(`GROUP BY ${resolvedGroupBy.join(', ')}`);
  }

  if (having.length > 0) {
    sqlParts.push(`HAVING ${having.join(' AND ')}`);
  }

  if (orderBy.length > 0) {
    const resolvedOrderBy = orderBy.map(o => o.replace(/\bcount\b/i, 'COUNT(*)'));
    sqlParts.push(`ORDER BY ${resolvedOrderBy.join(', ')}`);
  }

  if (limit) {
    sqlParts.push(`LIMIT ${limit}`);
  }

  if (offset) {
    sqlParts.push(`OFFSET ${offset}`);
  }

  return sqlParts.join('\n');
}

export function compilePipeline(pipelineCode) {
  const sql = pipelineToSQL(pipelineCode);
  return parse(sql);
}
