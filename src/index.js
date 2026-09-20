import { parse } from './parser.js';
import { JevClient } from './jev.js';
import { DataAdapter } from './adapters.js';
import { Executor } from './executor.js';
import { formatTable, formatCSV, parseCSV } from './utils.js';

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

  async query(sql, data = null) {
    const ast = parse(sql);
    return this.executor.execute(ast, data);
  }

  async explain(sql, data = null) {
    const ast = parse(sql.startsWith('EXPLAIN') ? sql : `EXPLAIN ${sql}`);
    return this.executor.execute(ast, data);
  }

  async analyze(sql, data = null) {
    const ast = parse(`EXPLAIN ANALYZE ${sql.replace(/^EXPLAIN\s+(ANALYZE\s+)?/i, '')}`);
    return this.executor.execute(ast, data);
  }

  table(rows, options = {}) {
    return formatTable(rows, options);
  }
}

/**
 * Main jevql function - adapts dynamically based on arguments.
 *
 * 1. Direct query:
 *    await jevql('SELECT * FROM "tickets.json" WHERE NOUL(text, "Urgent?") > 0.8');
 *    await jevql('SELECT name, CHOICE(text, "Cat", ["a", "b"]) FROM data', rows);
 *
 * 2. Database instance:
 *    const db = jevql(dataArray);
 *    const results = await db.query('SELECT ...');
 *
 * 3. Curried query:
 *    const filterUrgent = jevql('SELECT * FROM data WHERE NOUL(text, "Urgent?") > 0.8');
 *    const urgentTickets = await filterUrgent(tickets);
 */
export default function jevql(firstArg, secondArg = null, options = {}) {
  // Case 1: jevql(sql, data, options)
  if (typeof firstArg === 'string' && (firstArg.trim().toUpperCase().startsWith('SELECT') || firstArg.trim().toUpperCase().startsWith('EXPLAIN'))) {
    if (secondArg != null && !Array.isArray(secondArg) && typeof secondArg === 'object' && !secondArg[0] && !secondArg.length) {
      // secondArg might be options if no data provided
      if (secondArg.apiKey || secondArg.cache !== undefined || secondArg.concurrency) {
        options = secondArg;
        secondArg = null;
      }
    }

    if (secondArg != null) {
      const db = new JevQLDatabase(secondArg, options);
      return db.query(firstArg);
    }

    const ast = parse(firstArg);
    // If the query explicitly specifies a file source (e.g. FROM "tickets.json"), execute immediately
    if (ast.from?.source?.type === 'FileSource') {
      const db = new JevQLDatabase(null, options);
      return db.query(firstArg);
    }

    // Otherwise, return a curried query function
    return async (data, callOptions = {}) => {
      const mergedOpts = { ...options, ...callOptions };
      const db = new JevQLDatabase(data, mergedOpts);
      return db.query(firstArg);
    };
  }

  // Case 2: jevql(data, options) -> returns queryable DB instance
  const opts = typeof secondArg === 'object' && secondArg !== null ? secondArg : options;
  return new JevQLDatabase(firstArg, opts);
}

// Named exports
export {
  jevql,
  JevQLDatabase,
  parse,
  JevClient,
  DataAdapter,
  Executor,
  formatTable,
  formatCSV,
  parseCSV
};
