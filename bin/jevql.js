#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import jevql, { formatTable, formatCSV } from '../src/index.js';

const args = process.argv.slice(2);

function printHelp() {
  console.log(`
\x1b[1m\x1b[36mjevql\x1b[0m - PostgreSQL-like query language powered by TypeSafe Jev System One

\x1b[1mUSAGE:\x1b[0m
  jevql [options] [query]
  jevql -f <file> -q "<sql>"
  jevql -f <file> (starts interactive REPL)

\x1b[1mOPTIONS:\x1b[0m
  -f, --file <path>       Load data file (.json, .jsonl, .csv)
  -q, --query <sql>       Execute SQL query
  --format <fmt>          Output format: table (default), json, csv
  --explain               Show query execution plan without running
  --analyze               Run query and display detailed Jev telemetry
  --no-cache              Bypass Jev judgment cache
  --concurrency <n>       Max concurrent TypeSafe requests (default: 6)
  -v, --version           Display version
  -h, --help              Show this help message

\x1b[1mSEMANTIC FUNCTIONS:\x1b[0m
  NOUL(col, 'question' [, 'true_desc' [, 'false_desc']])  Returns probability [0.0, 1.0]
  IS_TRUE(col, 'question' [, threshold])                  Returns boolean
  CHOICE(col, 'question', ['opt1', 'opt2'])               Returns winning category
  SCORE(col, 'question', ['level0', 'level1', ...])       Returns calibrated score
  CONFIDENCE(CHOICE(...))                                 Returns model confidence
  PROB(CHOICE(...), 'opt')                                Returns probability for option

\x1b[1mEXAMPLES:\x1b[0m
  jevql "SELECT name, CHOICE(bio, 'Role', ['eng', 'design']) AS role FROM 'users.json'"
  jevql -f tickets.csv -q "SELECT * FROM data WHERE NOUL(body, 'Urgent?') > 0.8"
  jevql -f reviews.json --analyze -q "SELECT SCORE(text, 'Rating', ['bad','ok','great']) AS s FROM data ORDER BY s DESC"
`);
}

async function main() {
  if (args.includes('-h') || args.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  if (args.includes('-v') || args.includes('--version')) {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    console.log(`jevql v${pkg.version}`);
    process.exit(0);
  }

  let filePath = null;
  let query = null;
  let format = 'table';
  let explain = false;
  let analyze = false;
  let useCache = true;
  let concurrency = 6;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-f' || arg === '--file') {
      filePath = args[++i];
    } else if (arg === '-q' || arg === '--query') {
      query = args[++i];
    } else if (arg === '--format') {
      format = args[++i];
    } else if (arg === '--explain') {
      explain = true;
    } else if (arg === '--analyze') {
      analyze = true;
    } else if (arg === '--no-cache') {
      useCache = false;
    } else if (arg === '--concurrency') {
      concurrency = parseInt(args[++i], 10);
    } else if (!query && !arg.startsWith('-')) {
      query = arg;
    }
  }

  const options = {
    cache: useCache,
    concurrency
  };

  let db = null;
  if (filePath) {
    const fullPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(fullPath)) {
      console.error(`\x1b[31mError: File not found: ${fullPath}\x1b[0m`);
      process.exit(1);
    }
    const ext = path.extname(fullPath).toLowerCase();
    let data;
    if (ext === '.csv') {
      const { parseCSV } = await import('../src/utils.js');
      data = parseCSV(fs.readFileSync(fullPath, 'utf8'));
    } else {
      data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    }
    db = jevql(data, options);
  } else {
    db = jevql(null, options);
  }

  // If query is provided, execute it
  if (query) {
    try {
      if (explain) {
        const plan = await db.explain(query);
        console.log(JSON.stringify(plan, null, 2));
        return;
      }

      if (analyze) {
        const res = await db.analyze(query);
        outputResult(res.rows, format);
        console.log('\n\x1b[36m--- Jev Execution Telemetry ---\x1b[0m');
        console.log(`Duration:       ${res.telemetry.totalDurationMs}ms`);
        console.log(`Scanned Rows:   ${res.telemetry.scannedRows}`);
        console.log(`Pruned Rows:    ${res.telemetry.pushdownPruned} (filtered before AI)`);
        console.log(`Evaluated Rows: ${res.telemetry.evaluatedRows}`);
        console.log(`HTTP Requests:  ${res.telemetry.requests}`);
        console.log(`Cache Hits:     ${res.telemetry.cacheHits}`);
        console.log(`Tokens (In/Out):${res.telemetry.inputTokens} / ${res.telemetry.outputTokens}`);
        return;
      }

      const rows = await db.query(query);
      outputResult(rows, format);
    } catch (err) {
      console.error(`\x1b[31mQuery Error:\x1b[0m ${err.message}`);
      process.exit(1);
    }
    return;
  }

  // Interactive REPL Mode
  if (filePath) {
    console.log(`\x1b[36mJevQL Interactive Shell\x1b[0m (loaded: ${filePath})`);
    console.log(`Type SQL statements, '.tables', '.schema', or '.exit'\n`);

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '\x1b[32mjevql>\x1b[0m '
    });

    rl.prompt();

    rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        rl.prompt();
        return;
      }

      if (trimmed === '.exit' || trimmed === 'exit' || trimmed === 'quit') {
        rl.close();
        return;
      }

      if (trimmed === '.tables') {
        console.log('Available tables: data');
        rl.prompt();
        return;
      }

      if (trimmed === '.help') {
        printHelp();
        rl.prompt();
        return;
      }

      try {
        const start = Date.now();
        const rows = await db.query(trimmed);
        const elapsed = Date.now() - start;
        outputResult(rows, format);
        console.log(`\x1b[90mExecuted in ${elapsed}ms\x1b[0m\n`);
      } catch (err) {
        console.error(`\x1b[31mError:\x1b[0m ${err.message}\n`);
      }
      rl.prompt();
    });

    rl.on('close', () => {
      console.log('\nBye!');
      process.exit(0);
    });
  } else {
    printHelp();
  }
}

function outputResult(rows, format) {
  if (format === 'json') {
    console.log(JSON.stringify(rows, null, 2));
  } else if (format === 'csv') {
    console.log(formatCSV(rows));
  } else {
    console.log(formatTable(rows));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
