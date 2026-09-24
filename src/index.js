import { parse, tokenize } from './parser.js';
import {
  JevClient,
  BaseSemanticEngine,
  TypeSafeJevEngine,
  LLMStructuredEngine,
  EmbeddingEngine,
  HeuristicEngine,
  WebMLKitEngine,
  JevK5Engine,
  registerEngine,
  createEngine
} from './jev.js';
import { DataAdapter } from './adapters.js';
import { Executor } from './executor.js';
import { formatTable, formatCSV, parseCSV } from './utils.js';
import { pipelineToSQL, isPipelineQuery } from './pipeline.js';
import { createQueryPlan, splitWhereClause, defaultEvalLiteral } from './planner.js';
import {
  startRepl,
  createCompleter,
  isQueryComplete,
  inspectSchema,
  SQL_KEYWORDS,
  JEV_KEYWORDS,
  COGNITIVE_KEYWORDS,
  DOT_COMMANDS
} from './repl.js';

class JevQLDatabase {
  constructor(initialData = null, options = {}) {
    this.options = { ...options };
    this.client = new JevClient(this.options);
    this.adapter = new DataAdapter();
    this.executor = new Executor(this.client, this.adapter, this.options);

    if (initialData) {
      if (Array.isArray(initialData)) {
        this.adapter.registerTable('data', initialData);
      } else if (typeof initialData === 'object') {
        for (const [name, tbl] of Object.entries(initialData)) {
          this.adapter.registerTable(name, tbl);
        }
      }
    }
  }

  register(name, data) {
    this.adapter.registerTable(name, data);
    return this;
  }

  registerTable(name, data) {
    return this.register(name, data);
  }

  async query(queryText, data = null) {
    const sql = isPipelineQuery(queryText) ? pipelineToSQL(queryText) : queryText;
    const ast = parse(sql);
    return this.executor.execute(ast, data);
  }

  async explain(queryText, data = null) {
    const sql = isPipelineQuery(queryText) ? pipelineToSQL(queryText) : queryText;
    const ast = parse(sql.startsWith('EXPLAIN') ? sql : `EXPLAIN ${sql}`);
    return this.executor.execute(ast, data);
  }

  async analyze(queryText, data = null) {
    const sql = isPipelineQuery(queryText) ? pipelineToSQL(queryText) : queryText;
    const ast = parse(`EXPLAIN ANALYZE ${sql.replace(/^EXPLAIN\s+(ANALYZE\s+)?/i, '')}`);
    return this.executor.execute(ast, data);
  }

  table(rows, options = {}) {
    return formatTable(rows, options);
  }
}

/**
 * Main jevql function - adapts dynamically based on arguments:
 *
 * 1. Tagged Template Literal:
 *    const rows = await jevql`from ${tickets} | filter status == 'open' | take 10`;
 *
 * 2. Direct query:
 *    const rows = await jevql('SELECT * FROM "tickets.json"');
 *    const rows = await jevql('from tickets | filter status == "open"', tickets);
 *
 * 3. Database instance:
 *    const db = jevql(tickets);
 *
 * 4. Curried query:
 *    const filterUrgent = jevql('SELECT * FROM data WHERE NOUL(body, "Urgent?") > 0.8');
 */
export default function jevql(firstArg, ...rest) {
  // Case 0: Tagged Template Literal: jevql`from ${tickets} | ...`
  if (Array.isArray(firstArg) && firstArg.raw !== undefined) {
    const strings = firstArg;
    const values = rest;
    let queryStr = '';
    let extractedData = null;

    for (let i = 0; i < strings.length; i++) {
      queryStr += strings[i];
      if (i < values.length) {
        const val = values[i];
        if (Array.isArray(val) || (val && typeof val === 'object' && !val.type && !val.name)) {
          extractedData = val;
          queryStr += 'data';
        } else if (typeof val === 'number' || typeof val === 'boolean') {
          queryStr += String(val);
        } else if (typeof val === 'string') {
          queryStr += `'${val.replace(/'/g, "''")}'`;
        } else {
          queryStr += String(val);
        }
      }
    }

    const sql = isPipelineQuery(queryStr) ? pipelineToSQL(queryStr) : queryStr;
    const db = new JevQLDatabase(extractedData, {});
    return db.query(sql);
  }

  const secondArg = rest[0] !== undefined ? rest[0] : null;
  let options = rest[1] !== undefined ? rest[1] : {};

  // Check if firstArg is a query (either SQL or Pipeline)
  const isQuery = typeof firstArg === 'string' && (
    firstArg.trim().toUpperCase().startsWith('SELECT') ||
    firstArg.trim().toUpperCase().startsWith('EXPLAIN') ||
    isPipelineQuery(firstArg)
  );

  if (isQuery) {
    const sql = isPipelineQuery(firstArg) ? pipelineToSQL(firstArg) : firstArg;

    if (secondArg != null && !Array.isArray(secondArg) && typeof secondArg === 'object' && !secondArg[0] && !secondArg.length) {
      if (secondArg.apiKey || secondArg.cache !== undefined || secondArg.concurrency) {
        options = secondArg;
      }
    }

    if (secondArg != null && (Array.isArray(secondArg) || secondArg.length !== undefined)) {
      const db = new JevQLDatabase(secondArg, options);
      return db.query(sql);
    }

    const ast = parse(sql);
    // If the query explicitly specifies a file source (e.g. FROM "tickets.json"), execute immediately
    if (ast.from?.source?.type === 'FileSource') {
      const db = new JevQLDatabase(null, options);
      return db.query(sql);
    }

    // Otherwise, return a curried query function
    return async (data, callOptions = {}) => {
      const mergedOpts = { ...options, ...callOptions };
      const db = new JevQLDatabase(data, mergedOpts);
      return db.query(sql);
    };
  }

  // Case 2: jevql(data, options) -> returns queryable DB instance
  const opts = typeof secondArg === 'object' && secondArg !== null ? secondArg : options;
  return new JevQLDatabase(firstArg, opts);
}

jevql.with = function(options = {}) {
  return function(firstArg, ...rest) {
    if (Array.isArray(firstArg) && firstArg.raw !== undefined) {
      const strings = firstArg;
      const values = rest;
      let queryStr = '';
      let extractedData = null;

      for (let i = 0; i < strings.length; i++) {
        queryStr += strings[i];
        if (i < values.length) {
          const val = values[i];
          if (Array.isArray(val) || (val && typeof val === 'object' && !val.type && !val.name)) {
            extractedData = val;
            queryStr += 'data';
          } else if (typeof val === 'number' || typeof val === 'boolean') {
            queryStr += String(val);
          } else if (typeof val === 'string') {
            queryStr += `'${val.replace(/'/g, "''")}'`;
          } else {
            queryStr += String(val);
          }
        }
      }

      const sql = isPipelineQuery(queryStr) ? pipelineToSQL(queryStr) : queryStr;
      const db = new JevQLDatabase(extractedData, options);
      return db.query(sql);
    }
    return jevql(firstArg, ...rest, options);
  };
};

export {
  jevql,
  JevQLDatabase,
  parse,
  tokenize,
  isPipelineQuery,
  pipelineToSQL,
  createQueryPlan,
  splitWhereClause,
  defaultEvalLiteral,
  JevClient,
  DataAdapter,
  Executor,
  BaseSemanticEngine,
  TypeSafeJevEngine,
  LLMStructuredEngine,
  EmbeddingEngine,
  HeuristicEngine,
  WebMLKitEngine,
  JevK5Engine,
  registerEngine,
  createEngine,
  formatTable,
  formatCSV,
  parseCSV,
  startRepl,
  createCompleter,
  isQueryComplete,
  inspectSchema,
  SQL_KEYWORDS,
  JEV_KEYWORDS,
  COGNITIVE_KEYWORDS,
  DOT_COMMANDS
};
