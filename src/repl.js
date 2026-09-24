import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import jevql, { formatTable, formatCSV, parseCSV } from './index.js';

export const JEV_KEYWORDS = [
  'NOUL',
  'CHOICE',
  'SCORE'
];

export const COGNITIVE_KEYWORDS = [
  'from',
  'filter',
  'classify',
  'judge',
  'score',
  'ask',
  'tag',
  'as',
  'take',
  'top',
  'by',
  'sort',
  'map',
  'into',
  'status',
  'urgency',
  'low',
  'medium',
  'high'
];

export const SQL_KEYWORDS = [
  'SELECT',
  'FROM',
  'WHERE',
  'GROUP BY',
  'ORDER BY',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'JOIN',
  'LEFT JOIN',
  'RIGHT JOIN',
  'INNER JOIN',
  'CROSS JOIN',
  'ON',
  'AS',
  'AND',
  'OR',
  'NOT',
  'IN',
  'LIKE',
  'IS NULL',
  'IS NOT NULL',
  'IS',
  'NULL',
  'TRUE',
  'FALSE',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'DISTINCT',
  'BETWEEN',
  'ASC',
  'DESC',
  'EXPLAIN',
  'ANALYZE',
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'ROUND',
  'COALESCE',
  'LENGTH',
  'LOWER',
  'UPPER'
];

export const DOT_COMMANDS = [
  '.load',
  '.tables',
  '.schema',
  '.format',
  '.explain',
  '.analyze',
  '.clear',
  '.history',
  '.help',
  '.exit',
  '.quit'
];

/**
 * Auto-completes file paths given a partial path string.
 */
export function completePath(rawPath, baseDir = process.cwd()) {
  const isQuoted = rawPath.startsWith('"') || rawPath.startsWith("'");
  const quote = isQuoted ? rawPath[0] : '';
  const unquoted = rawPath.replace(/^['"]/, '');

  let searchDir;
  let base;

  if (unquoted.endsWith('/') || unquoted === '.' || unquoted === '..') {
    searchDir = path.resolve(baseDir, unquoted);
    base = '';
  } else {
    const dir = path.dirname(unquoted);
    base = path.basename(unquoted);
    searchDir = path.resolve(baseDir, dir);
  }

  try {
    if (!fs.existsSync(searchDir) || !fs.statSync(searchDir).isDirectory()) {
      return [[], rawPath];
    }
    const entries = fs.readdirSync(searchDir, { withFileTypes: true });
    const hits = [];

    for (const e of entries) {
      if (e.name.startsWith('.') && !base.startsWith('.')) continue; // ignore hidden unless typed
      if (e.name.toLowerCase().startsWith(base.toLowerCase())) {
        const isDir = e.isDirectory();
        const suffix = isDir ? '/' : '';
        const dirPrefix = unquoted.includes('/') ? unquoted.slice(0, unquoted.lastIndexOf('/') + 1) : '';
        hits.push(quote + dirPrefix + e.name + suffix);
      }
    }
    return [hits, rawPath];
  } catch {
    return [[], rawPath];
  }
}

/**
 * Returns available table names from the database instance.
 */
export function getAvailableTables(db) {
  if (!db || !db.adapter || !db.adapter.sources) return [];
  return Object.keys(db.adapter.sources);
}

/**
 * Returns all column names present across registered tables.
 */
export function getAvailableColumns(db) {
  if (!db || !db.adapter || !db.adapter.sources) return [];
  const cols = new Set();
  for (const rows of Object.values(db.adapter.sources)) {
    if (Array.isArray(rows)) {
      const sampleCount = Math.min(rows.length, 5);
      for (let i = 0; i < sampleCount; i++) {
        const row = rows[i];
        if (row && typeof row === 'object') {
          for (const k of Object.keys(row)) {
            cols.add(k);
          }
        }
      }
    }
  }
  return Array.from(cols);
}

/**
 * Creates a Readline completer function with context-aware auto-completion.
 */
export function createCompleter(getDb, options = {}) {
  const cwd = options.cwd || process.cwd();

  return function completer(line) {
    const trimmed = line.trimStart();

    // 1. Path completion after .load or within quotes
    const loadMatch = line.match(/^\s*\.load\s+([^;\s]*)$/);
    if (loadMatch) {
      const target = loadMatch[1] || '';
      return completePath(target, cwd);
    }

    const fromFileMatch = line.match(/(?:from|FROM)\s+(['"][^'"]*)$/);
    if (fromFileMatch) {
      const target = fromFileMatch[1];
      return completePath(target, cwd);
    }

    // 2. Dot-command completion
    if (trimmed.startsWith('.')) {
      const token = trimmed.split(/\s+/)[0];
      if (token === '.format') {
        const sub = trimmed.slice(7).trim();
        const formats = ['table', 'json', 'csv'];
        const hits = formats.filter(f => f.startsWith(sub.toLowerCase())).map(f => `.format ${f}`);
        return [hits.length ? hits : formats.map(f => `.format ${f}`), trimmed];
      }
      const hits = DOT_COMMANDS.filter(cmd => cmd.startsWith(token.toLowerCase()));
      return [hits, token];
    }

    // 3. Keyword, Function, Table, and Column completion
    const db = typeof getDb === 'function' ? getDb() : getDb;
    const tables = getAvailableTables(db);
    const columns = getAvailableColumns(db);

    const match = line.match(/([a-zA-Z_][a-zA-Z0-9_]*)$/);
    if (!match) {
      return [[], ''];
    }

    const word = match[1];
    const isLower = word === word.toLowerCase();
    const isUpper = word === word.toUpperCase();

    const candidates = [
      ...JEV_KEYWORDS,
      ...SQL_KEYWORDS,
      ...COGNITIVE_KEYWORDS,
      ...tables,
      ...columns
    ];

    const uniqueCandidates = Array.from(new Set(candidates));
    const wordLower = word.toLowerCase();

    const matched = uniqueCandidates.filter(c => c.toLowerCase().startsWith(wordLower));

    // Preserve casing convention based on user input
    const hits = matched.map(candidate => {
      // If candidate is a SQL keyword
      if (SQL_KEYWORDS.includes(candidate)) {
        if (isLower) return candidate.toLowerCase();
        return candidate.toUpperCase();
      }
      // If candidate is a Jev Primitive
      if (JEV_KEYWORDS.includes(candidate)) {
        if (isLower) return candidate.toLowerCase();
        return candidate.toUpperCase();
      }
      return candidate;
    });

    return [hits, word];
  };
}

/**
 * Checks whether a buffered query is complete or needs continuation lines.
 */
export function isQueryComplete(buffer, currentLine) {
  const trimmed = currentLine.trim();

  // Dot commands are always single line
  if (buffer.length === 0 && trimmed.startsWith('.')) {
    return true;
  }

  // Explicit query terminator
  if (trimmed.endsWith(';')) {
    return true;
  }

  const fullText = [...buffer, currentLine].join('\n').trim();

  // Check balanced quotes
  let singleQuotes = 0;
  let doubleQuotes = 0;
  let backticks = 0;
  let inQuote = false;

  for (let i = 0; i < fullText.length; i++) {
    const ch = fullText[i];
    const prev = i > 0 ? fullText[i - 1] : '';
    if (ch === "'" && prev !== '\\') singleQuotes++;
    if (ch === '"' && prev !== '\\') doubleQuotes++;
    if (ch === '`' && prev !== '\\') backticks++;
  }

  if (singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0 || backticks % 2 !== 0) {
    return false;
  }

  // Check balanced parentheses, brackets, braces
  let parens = 0;
  let brackets = 0;
  let braces = 0;

  for (let i = 0; i < fullText.length; i++) {
    const ch = fullText[i];
    if (ch === '(') parens++;
    else if (ch === ')') parens--;
    else if (ch === '[') brackets++;
    else if (ch === ']') brackets--;
    else if (ch === '{') braces++;
    else if (ch === '}') braces--;
  }

  if (parens > 0 || brackets > 0 || braces > 0) {
    return false;
  }

  // Pipeline continuation operator |
  if (trimmed.endsWith('|') || trimmed.endsWith(',')) {
    return false;
  }

  // SQL trailing keywords that need predicates
  if (/\b(WHERE|AND|OR|ON|JOIN|CASE|WHEN|THEN|ELSE|HAVING|ORDER BY|GROUP BY)$/i.test(trimmed)) {
    return false;
  }

  // If starts with SELECT/WITH/EXPLAIN and has no semicolon yet:
  // If buffer has multiple lines or ends with semicolon, execute.
  if (/^(SELECT|WITH|EXPLAIN)\b/i.test(fullText)) {
    return trimmed.endsWith(';') || (buffer.length > 0 && trimmed === '');
  }

  // Single-line cognitive queries or pipeline queries execute immediately
  return true;
}

/**
 * Returns formatted schema metadata for a dataset or table.
 */
export function inspectSchema(tableName, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return `\x1b[33mTable '${tableName}' is empty.\x1b[0m`;
  }

  const sample = rows[0];
  const keys = Object.keys(sample);
  const rowsCount = rows.length;

  const schemaInfo = keys.map(k => {
    const val = sample[k];
    let type = typeof val;
    if (val === null) type = 'null';
    else if (Array.isArray(val)) type = 'array';
    else if (val instanceof Date) type = 'date';

    let sampleStr = JSON.stringify(val);
    if (sampleStr && sampleStr.length > 30) {
      sampleStr = sampleStr.slice(0, 27) + '...';
    }

    return {
      Column: k,
      Type: type,
      Sample: sampleStr
    };
  });

  return `\x1b[1m\x1b[36mTable: ${tableName}\x1b[0m (${rowsCount} rows)\n` + formatTable(schemaInfo);
}

/**
 * Starts the interactive JevQL REPL session.
 */
export async function startRepl(options = {}) {
  let db = options.db || jevql(null, options);
  let format = options.format || 'table';
  const historyFile = options.historyFile || path.join(os.homedir(), '.jevql_history');
  let currentBuffer = [];

  const completer = createCompleter(() => db, { cwd: process.cwd() });

  const rl = readline.createInterface({
    input: options.input || process.stdin,
    output: options.output || process.stdout,
    completer,
    prompt: '\x1b[1m\x1b[36mjevql>\x1b[0m '
  });

  // Load persistent history
  if (fs.existsSync(historyFile)) {
    try {
      const past = fs.readFileSync(historyFile, 'utf8')
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);
      rl.history = past.reverse().slice(0, 1000);
    } catch (_) {}
  }

  const logHistory = (line) => {
    try {
      fs.appendFileSync(historyFile, line + '\n', 'utf8');
    } catch (_) {}
  };

  const outputResult = (rows) => {
    if (format === 'json') {
      console.log(JSON.stringify(rows, null, 2));
    } else if (format === 'csv') {
      console.log(formatCSV(rows));
    } else {
      console.log(formatTable(rows));
    }
  };

  // Welcome Banner
  console.log('\x1b[1m\x1b[36mjevql\x1b[0m - Calibrated Semantic SQL Shell (TypeSafe Jev System One)');
  console.log('\x1b[90mTab for keyword & schema completion | .help for commands | .exit to quit\x1b[0m\n');

  const promptNext = () => {
    rl.resume();
    rl.prompt();
  };

  rl.prompt();

  const lineQueue = [];
  let isProcessing = false;

  const processQueue = async () => {
    if (isProcessing) return;
    isProcessing = true;

    while (lineQueue.length > 0) {
      const line = lineQueue.shift();
      await handleLine(line);
    }

    isProcessing = false;
  };

  rl.on('line', (line) => {
    lineQueue.push(line);
    processQueue();
  });

  const handleLine = async (line) => {
    rl.pause();
    const trimmed = line.trim();

    // Check query completion
    if (!isQueryComplete(currentBuffer, line)) {
      currentBuffer.push(line);
      rl.setPrompt('\x1b[90m  ... \x1b[0m ');
      promptNext();
      return;
    }

    const fullQuery = currentBuffer.length > 0
      ? [...currentBuffer, line].join('\n').trim().replace(/;$/, '')
      : trimmed.replace(/;$/, '');

    currentBuffer = [];
    rl.setPrompt('\x1b[1m\x1b[36mjevql>\x1b[0m ');

    if (!fullQuery) {
      promptNext();
      return;
    }

    logHistory(fullQuery);

    // Built-in Dot Commands
    if (fullQuery === '.exit' || fullQuery === '.quit' || fullQuery === 'exit' || fullQuery === 'quit') {
      rl.close();
      return;
    }

    if (fullQuery === '.clear') {
      console.clear();
      promptNext();
      return;
    }

    if (fullQuery === '.help') {
      console.log(`
\x1b[1mCOMMANDS:\x1b[0m
  .load <file>          Load data file (.json, .jsonl, .csv)
  .tables               List loaded tables and record counts
  .schema [table]       Inspect column types and sample values
  .format <fmt>         Set output format: table, json, csv
  .explain <query>      Display transpiled SQL and execution plan
  .analyze <query>      Run query and display detailed Jev telemetry
  .clear                Clear console screen
  .history              Show recent query history
  .exit                 Exit the REPL

\x1b[1mSEMANTIC PRIMITIVES:\x1b[0m
  NOUL(col, 'prompt')                 Calibrated probability [0.0, 1.0]
  CHOICE(col, 'prompt', [a, b, c])    Categorical classification
  SCORE(col, 'prompt', [l0, l1, l2])  Calibrated rating score

\x1b[1mCOGNITIVE MINIMALIST SYNTAX:\x1b[0m
  tickets: status = open
  ? "Immediate outage?" > 0.7
  dept = billing | security | tech
  top 5
`);
      promptNext();
      return;
    }

    if (fullQuery === '.tables') {
      const tables = getAvailableTables(db);
      if (tables.length === 0) {
        console.log('\x1b[90mNo in-memory tables loaded. Query file directly (e.g. from "data.json") or use .load <file>\x1b[0m\n');
      } else {
        const info = tables.map(name => ({
          Table: name,
          Rows: Array.isArray(db.adapter.sources[name]) ? db.adapter.sources[name].length : 0
        }));
        console.log(formatTable(info) + '\n');
      }
      promptNext();
      return;
    }

    if (fullQuery.startsWith('.schema')) {
      const parts = fullQuery.split(/\s+/);
      const targetTable = parts[1] || 'data';
      const tables = getAvailableTables(db);
      if (tables.length === 0) {
        console.log('\x1b[90mNo tables loaded. Use .load <file> first.\x1b[0m\n');
      } else if (!db.adapter.sources[targetTable.toLowerCase()]) {
        console.log(`\x1b[31mTable '${targetTable}' not found. Available: ${tables.join(', ')}\x1b[0m\n`);
      } else {
        console.log(inspectSchema(targetTable, db.adapter.sources[targetTable.toLowerCase()]) + '\n');
      }
      promptNext();
      return;
    }

    if (fullQuery.startsWith('.load ')) {
      const targetFile = fullQuery.replace(/^\.load\s+/, '').trim().replace(/^['"]|['"]$/g, '');
      const fullPath = path.resolve(process.cwd(), targetFile);

      if (!fs.existsSync(fullPath)) {
        console.error(`\x1b[31mFile not found: ${fullPath}\x1b[0m\n`);
      } else {
        try {
          const ext = path.extname(fullPath).toLowerCase();
          let data;
          if (ext === '.csv') {
            data = parseCSV(fs.readFileSync(fullPath, 'utf8'));
          } else if (ext === '.jsonl' || ext === '.ndjson') {
            data = fs.readFileSync(fullPath, 'utf8')
              .split(/\r?\n/)
              .filter(l => l.trim().length > 0)
              .map(l => JSON.parse(l));
          } else {
            data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
          }

          const records = Array.isArray(data) ? data : [data];
          const baseName = path.basename(fullPath, ext).toLowerCase().replace(/[^a-z0-9_]/g, '_');

          db.registerTable('data', records);
          db.registerTable(baseName, records);

          const cols = getAvailableColumns(db);
          console.log(`\x1b[32m✔ Loaded ${records.length} rows into '${baseName}' and 'data'\x1b[0m`);
          console.log(`\x1b[90mColumns: ${cols.join(', ')}\x1b[0m\n`);
        } catch (err) {
          console.error(`\x1b[31mFailed to load file: ${err.message}\x1b[0m\n`);
        }
      }
      promptNext();
      return;
    }

    if (fullQuery.startsWith('.format')) {
      const parts = fullQuery.split(/\s+/);
      const newFmt = parts[1]?.toLowerCase();
      if (['table', 'json', 'csv'].includes(newFmt)) {
        format = newFmt;
        console.log(`\x1b[32mOutput format set to '${format}'\x1b[0m\n`);
      } else {
        console.log(`Current format: \x1b[1m${format}\x1b[0m (options: table, json, csv)\n`);
      }
      promptNext();
      return;
    }

    if (fullQuery.startsWith('.explain ')) {
      const q = fullQuery.replace(/^\.explain\s+/, '').trim();
      try {
        const plan = await db.explain(q);
        console.log(JSON.stringify(plan, null, 2) + '\n');
      } catch (err) {
        console.error(`\x1b[31mExplain Error: ${err.message}\x1b[0m\n`);
      }
      promptNext();
      return;
    }

    if (fullQuery.startsWith('.analyze ')) {
      const q = fullQuery.replace(/^\.analyze\s+/, '').trim();
      try {
        const res = await db.analyze(q);
        outputResult(res.rows);
        console.log('\n\x1b[36m--- Jev Execution Telemetry ---\x1b[0m');
        console.log(`Duration:       ${res.telemetry.totalDurationMs}ms`);
        console.log(`Scanned Rows:   ${res.telemetry.scannedRows}`);
        console.log(`Pruned Rows:    ${res.telemetry.pushdownPruned} (filtered before AI)`);
        console.log(`Evaluated Rows: ${res.telemetry.evaluatedRows}`);
        console.log(`HTTP Requests:  ${res.telemetry.requests}`);
        console.log(`Cache Hits:     ${res.telemetry.cacheHits}`);
        console.log(`Tokens (In/Out):${res.telemetry.inputTokens} / ${res.telemetry.outputTokens}\n`);
      } catch (err) {
        console.error(`\x1b[31mAnalyze Error: ${err.message}\x1b[0m\n`);
      }
      promptNext();
      return;
    }

    if (fullQuery === '.history') {
      const hist = (rl.history || []).slice(0, 20).reverse();
      hist.forEach((h, idx) => console.log(`  \x1b[90m${idx + 1}.\x1b[0m ${h}`));
      console.log();
      promptNext();
      return;
    }

    // Execute standard query
    try {
      const start = Date.now();
      const rows = await db.query(fullQuery);
      const elapsed = Date.now() - start;

      outputResult(rows);
      const count = Array.isArray(rows) ? rows.length : 1;
      console.log(`\x1b[90m(${count} ${count === 1 ? 'row' : 'rows'} in ${elapsed}ms)\x1b[0m\n`);
    } catch (err) {
      console.error(`\x1b[31mQuery Error:\x1b[0m ${err.message}\n`);
    }

    promptNext();
  };

  // Handle Ctrl+C
  rl.on('SIGINT', () => {
    if (currentBuffer.length > 0) {
      currentBuffer = [];
      rl.setPrompt('\x1b[1m\x1b[36mjevql>\x1b[0m ');
      console.log('\n\x1b[90m(buffer cleared)\x1b[0m');
      rl.prompt();
    } else {
      console.log('\nUse .exit or Ctrl+D to quit.');
      rl.prompt();
    }
  });

  rl.on('close', () => {
    console.log('\nBye!');
    process.exit(0);
  });

  return rl;
}
