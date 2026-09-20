/**
 * JevQL Natural & Pipeline Query Language (PQL / NQL)
 *
 * Minimalist, human-readable dataflow query language:
 *
 * Natural English style:
 *   from tickets
 *   where status is open
 *   ask "immediate outage?" as outage > 0.7
 *   tag as billing, security, tech
 *   top 10 by outage
 *
 * Pipeline style:
 *   from tickets
 *   | filter status == 'open'
 *   | classify body -> [billing, security, tech] as dept
 *   | judge body ? "Outage?" as is_outage > 0.7
 *   | sort is_outage desc
 *   | take 10
 */

import { parse } from './parser.js';

export function isPipelineQuery(text) {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  const upper = trimmed.toUpperCase();
  if (upper.startsWith('SELECT') || upper.startsWith('EXPLAIN') || upper.startsWith('WITH ')) {
    return false;
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
 * Transpiles JevQL Natural / Pipeline syntax into standard JevQL SQL.
 */
export function pipelineToSQL(pipeStr) {
  const isPiped = pipeStr.includes('|');
  const rawStages = isPiped
    ? pipeStr.split('|').map(p => p.trim()).filter(Boolean)
    : pipeStr.split('\n')
        .map(p => p.trim().replace(/^([#]|--).*$/, '').trim())
        .filter(Boolean);

  let source = null;
  const filters = [];
  const semanticEnrichments = []; // { col, type, inst, criteria, alias, threshold }
  const projections = [];
  let groupBy = [];
  const aggregates = [];
  let having = [];
  const orderBy = [];
  let limit = null;
  let offset = null;

  for (let idx = 0; idx < rawStages.length; idx++) {
    const trimmed = rawStages[idx];

    // 1. FROM / IN / USE stage: from tickets, in "data.json", use db
    if (/^(from|in|use)\s+/i.test(trimmed)) {
      source = trimmed.replace(/^(from|in|use)\s+/i, '').trim();
      continue;
    }

    // 2. ASK / JUDGE / CHECK stage (NOUL semantic snap judgment)
    // Examples:
    //   ask "is there an immediate outage?"
    //   ask body "is there an immediate outage?" as is_outage > 0.7
    //   judge body ? "Outage?" as is_outage > 0.7
    if (/^(ask|check|judge)\s+/i.test(trimmed) || /^judge\s+\w+\s*\?/i.test(trimmed)) {
      let col, prompt, alias, op, thresh;

      // Check legacy judge syntax: judge col ? "prompt" as alias > thresh
      let m = trimmed.match(/^judge\s+(\w+)\s*\?\s*["'“]([^"'”]+)["'”](?:\s+as\s+(\w+))?(?:\s*(>|<|>=|<=)\s*([0-9\.]+))?/i);
      if (m) {
        [, col, prompt, alias, op, thresh] = m;
      } else {
        // Natural syntax: ask [col] "prompt" [as alias] [> thresh]
        m = trimmed.match(/^(?:ask|check)\s+(?:(\w+)\s+)?["'“]([^"'”]+)["'”](?:\s+as\s+(\w+))?(?:\s*(>|<|>=|<=)\s*([0-9\.]+))?/i);
        if (m) {
          [, col, prompt, alias, op, thresh] = m;
        }
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

    // 3. TAG / CLASSIFY / LABEL / CATEGORIZE stage (CHOICE categorical decision)
    // Examples:
    //   tag as billing, security, tech
    //   tag message as card_arrival, lost_card, transfer as intent
    //   classify body -> [billing, security, tech] as dept
    //   pick from billing, tech, security
    if (/^(tag|label|classify|categorize|pick)\s+/i.test(trimmed)) {
      let col, optionsRaw, alias;

      // Legacy syntax: classify col -> [opt1, opt2] as alias
      let m = trimmed.match(/^(?:classify|tag)\s+(\w+)\s*->\s*(\[.*?\]|\{.*?\})\s+as\s+(\w+)/i);
      if (m) {
        [, col, optionsRaw, alias] = m;
      } else {
        // Natural syntax: tag [col] as opt1, opt2, opt3 [as alias]
        // or: pick [col] from opt1, opt2, opt3
        m = trimmed.match(/^(?:tag|label|classify|categorize|pick)\s+(?:(\w+)\s+)?(?:as|from|:\s*)\s*(?:\[([^\]]+)\]|([^\n\r]+?))(?:\s+as\s+(\w+))?$/i);
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
        const targetAlias = alias || (trimmed.startsWith('tag') ? 'tag' : 'category');
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

    // 4. SCORE / RATE stage (Continuous score across ordered levels)
    // Examples:
    //   score as low, medium, high
    //   rate body as calm, frustrated, enraged as frustration
    //   score body ~> [calm, frustrated, enraged] as frustration
    if (/^(score|rate)\s+/i.test(trimmed)) {
      let col, levelsRaw, alias;

      let m = trimmed.match(/^score\s+(\w+)\s*~>\s*(\[.*?\])\s+as\s+(\w+)/i);
      if (m) {
        [, col, levelsRaw, alias] = m;
      } else {
        m = trimmed.match(/^(?:score|rate)\s+(?:(\w+)\s+)?(?:as|:\s*)\s*(?:\[([^\]]+)\]|([^\n\r]+?))(?:\s+as\s+(\w+))?$/i);
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

    // 5. TOP / TAKE / LIMIT / FIRST stage
    // Examples:
    //   top 10 by outage
    //   top 10 by urgency desc
    //   top 10
    //   take 5
    if (/^(top|take|limit|first)\s+(\d+)(?:\s+by\s+(.+))?/i.test(trimmed)) {
      const m = trimmed.match(/^(top|take|limit|first)\s+(\d+)(?:\s+by\s+(.+))?/i);
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

    // 6. SORT / ORDER stage
    // Examples:
    //   sort by urgency desc
    //   order by count desc
    //   highest urgency
    //   lowest score
    if (/^(sort|order)\s+(by\s+)?(.+)/i.test(trimmed)) {
      const items = trimmed.replace(/^(sort|order)\s+(by\s+)?/i, '').split(',').map(s => s.trim());
      for (const item of items) {
        if (item.startsWith('-')) orderBy.push(`${item.slice(1)} DESC`);
        else if (item.startsWith('+')) orderBy.push(`${item.slice(1)} ASC`);
        else if (/\s+(desc|asc)$/i.test(item)) orderBy.push(item);
        else orderBy.push(`${item} ASC`);
      }
      continue;
    }
    if (/^highest\s+(\w+)/i.test(trimmed)) {
      orderBy.push(`${trimmed.replace(/^highest\s+/i, '').trim()} DESC`);
      continue;
    }
    if (/^lowest\s+(\w+)/i.test(trimmed)) {
      orderBy.push(`${trimmed.replace(/^lowest\s+/i, '').trim()} ASC`);
      continue;
    }

    // 7. FILTER / WHERE / AND / ONLY stage (Relational pushdown)
    // Examples:
    //   where status is open
    //   where status is not closed
    //   filter status == 'open'
    //   and priority is P1
    if (/^(where|filter|and)\s+/i.test(trimmed) || /^\w+\s+is\s+/i.test(trimmed)) {
      const cond = normalizeCondition(trimmed);
      if (groupBy.length > 0) {
        having.push(cond);
      } else {
        filters.push(cond);
      }
      continue;
    }

    // 8. SHOW / SELECT / KEEP stage (Projections)
    // Examples:
    //   show id, customer, dept
    //   select id, customer
    if (/^(show|select|keep)\s+/i.test(trimmed)) {
      const cols = trimmed.replace(/^(show|select|keep)\s+/i, '').split(',').map(s => s.trim());
      projections.push(...cols);
      continue;
    }

    // 9. GROUP stage: group by dept, group dept
    if (/^group\s+/i.test(trimmed)) {
      const cols = trimmed.replace(/^group\s+(by\s+)?/i, '').split(',').map(s => s.trim());
      groupBy = cols;
      continue;
    }

    // 10. AGGREGATE / AGG / COUNT stage: count, aggregate count(), avg(score)
    if (/^(aggregate|agg)\s+/i.test(trimmed)) {
      const exprs = trimmed.replace(/^(aggregate|agg)\s+/i, '').split(',').map(s => s.trim());
      for (const e of exprs) {
        if (/^count\(\s*\)$/i.test(e)) {
          aggregates.push('COUNT(*) AS count');
        } else if (!e.includes(' as ') && /^\w+\(/.test(e)) {
          const cleanAlias = e.replace(/\W+/g, '_').replace(/^_+|_+$/g, '');
          aggregates.push(`${e} AS ${cleanAlias}`);
        } else {
          aggregates.push(e);
        }
      }
      continue;
    }
    if (/^count$/i.test(trimmed)) {
      aggregates.push('COUNT(*) AS count');
      continue;
    }

    // 11. SKIP / OFFSET stage: skip 5
    if (/^(skip|offset)\s+/i.test(trimmed)) {
      offset = trimmed.replace(/^(skip|offset)\s+/i, '').trim();
      continue;
    }

    // 12. Fallback for first line as source name
    if (idx === 0 && !source && !trimmed.includes(' ')) {
      source = trimmed;
      continue;
    }
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
