/**
 * JevQL Pipeline Query Language (PQL)
 *
 * Modern, linear, top-to-bottom dataflow query syntax:
 *   from tickets
 *   | filter status == 'open'
 *   | judge body ? "Urgent outage?" as is_urgent
 *   | filter is_urgent > 0.6
 *   | classify body -> [billing, security, infrastructure] as dept
 *   | score body ~> [calm, frustrated, enraged] as frustration
 *   | group dept
 *   | aggregate count(), avg(frustration)
 *   | sort -count
 *   | take 10
 */

import { parse } from './parser.js';

export function isPipelineQuery(text) {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  return trimmed.toLowerCase().startsWith('from ') || trimmed.includes('\n|') || trimmed.includes(' | ');
}

/**
 * Transpiles JevQL Pipeline syntax into standard JevQL AST or equivalent SQL.
 */
export function pipelineToSQL(pipeStr) {
  // Normalize lines and split by pipe '|'
  const rawPipes = pipeStr
    .split('|')
    .map(p => p.trim())
    .filter(p => p.length > 0);

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

  for (const pipe of rawPipes) {
    const trimmed = pipe.trim();

    // 1. FROM stage
    if (/^from\s+/i.test(trimmed)) {
      source = trimmed.replace(/^from\s+/i, '').trim();
      continue;
    }

    // 2. JUDGE stage: judge [col] ? "prompt" [as alias] [> threshold]
    // e.g. judge body ? "Urgent outage?" as is_urgent > 0.7
    if (/^judge\s+/i.test(trimmed)) {
      const match = trimmed.match(/^judge\s+(\w+)\s*\?\s*["']([^"']+)["'](?:\s+as\s+(\w+))?(?:\s*(>|<|>=|<=)\s*([0-9\.]+))?/i);
      if (match) {
        const [, col, prompt, alias, op, thresh] = match;
        const outAlias = alias || `is_${prompt.slice(0, 10).replace(/\W+/g, '_').toLowerCase()}`;
        semanticEnrichments.push({
          type: 'NOUL',
          col,
          prompt,
          alias: outAlias
        });
        if (op && thresh) {
          filters.push(`NOUL(${col}, '${prompt.replace(/'/g, "\\'")}') ${op} ${thresh}`);
        }
      }
      continue;
    }

    // 3. CLASSIFY stage: classify [col] -> [opt1, opt2, ...] as [alias]
    // e.g. classify body -> [billing, security, tech] as dept
    if (/^classify\s+/i.test(trimmed)) {
      const match = trimmed.match(/^classify\s+(\w+)\s*->\s*(\[.*?\]|\{.*?\})\s+as\s+(\w+)/i);
      if (match) {
        const [, col, criteriaRaw, alias] = match;
        semanticEnrichments.push({
          type: 'CHOICE',
          col,
          prompt: `Classify ${alias}`,
          criteria: criteriaRaw,
          alias
        });
      }
      continue;
    }

    // 4. SCORE stage: score [col] ~> [lvl1, lvl2, ...] as [alias]
    // e.g. score body ~> [calm, frustrated, enraged] as frustration
    if (/^score\s+/i.test(trimmed)) {
      const match = trimmed.match(/^score\s+(\w+)\s*~>\s*(\[.*?\])\s+as\s+(\w+)/i);
      if (match) {
        const [, col, levelsRaw, alias] = match;
        semanticEnrichments.push({
          type: 'SCORE',
          col,
          prompt: `Rate ${alias}`,
          criteria: levelsRaw,
          alias
        });
      }
      continue;
    }

    // 5. FILTER stage
    // e.g. filter status == 'open' and priority == 'P1'
    if (/^filter\s+/i.test(trimmed)) {
      let cond = trimmed.replace(/^filter\s+/i, '').trim();
      // Replace == with =
      cond = cond.replace(/==/g, '=');
      if (groupBy.length > 0) {
        having.push(cond);
      } else {
        filters.push(cond);
      }
      continue;
    }

    // 6. GROUP stage: group dept, tier
    if (/^group\s+/i.test(trimmed)) {
      const cols = trimmed.replace(/^group\s+(by\s+)?/i, '').split(',').map(s => s.trim());
      groupBy = cols;
      continue;
    }

    // 7. AGGREGATE / AGG stage: aggregate count(), avg(frustration)
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

    // 8. SELECT stage: select id, customer, dept
    if (/^select\s+/i.test(trimmed)) {
      const cols = trimmed.replace(/^select\s+/i, '').split(',').map(s => s.trim());
      projections.push(...cols);
      continue;
    }

    // 9. SORT stage: sort -count, +dept or sort count desc
    if (/^sort\s+/i.test(trimmed)) {
      const items = trimmed.replace(/^sort\s+(by\s+)?/i, '').split(',').map(s => s.trim());
      for (const item of items) {
        if (item.startsWith('-')) {
          orderBy.push(`${item.slice(1)} DESC`);
        } else if (item.startsWith('+')) {
          orderBy.push(`${item.slice(1)} ASC`);
        } else if (/\s+desc$/i.test(item)) {
          orderBy.push(item);
        } else if (/\s+asc$/i.test(item)) {
          orderBy.push(item);
        } else {
          orderBy.push(`${item} ASC`);
        }
      }
      continue;
    }

    // 10. TAKE / LIMIT stage: take 10
    if (/^(take|limit)\s+/i.test(trimmed)) {
      limit = trimmed.replace(/^(take|limit)\s+/i, '').trim();
      continue;
    }

    // 11. SKIP / OFFSET stage: skip 5
    if (/^(skip|offset)\s+/i.test(trimmed)) {
      offset = trimmed.replace(/^(skip|offset)\s+/i, '').trim();
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
    // Aggregation query
    selectCols = [...groupBy, ...aggregates].map(col => resolveEnrichment(col));
  } else if (projections.length > 0) {
    selectCols = projections.map(col => resolveEnrichment(col));
  } else {
    // Default projection: all columns plus any enrichments
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

  // Resolve enrichments in groupBy
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
