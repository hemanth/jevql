#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import jevql, { formatTable, formatCSV } from '../src/index.js';

const args = process.argv.slice(2);

function printHelp() {
  console.log(`
\x1b[1m\x1b[36mjevql\x1b[0m - Query language powered by TypeSafe Jev System One

\x1b[1mUSAGE:\x1b[0m
  jevql                          (starts interactive REPL)
  jevql <script.jevql>           (executes JevQL / SQL script directly)
  jevql "<query>"                (executes inline pipeline or SQL query)
  jevql -f <file> -q "<query>"   (executes query on specified data file)

\x1b[1mOPTIONS:\x1b[0m
  -f, --file <path>       Load data file (.json, .jsonl, .csv)
  -q, --query <text>      Execute SQL or Pipeline query
  --format <fmt>          Output format: table (default), json, csv
  --explain               Show query execution plan without running
  --analyze               Run query and display detailed Jev telemetry
  --no-cache              Bypass Jev judgment cache
  --concurrency <n>       Max concurrent TypeSafe requests (default: 6)
  -v, --version           Display version
  -h, --help              Show this help message

\x1b[1mSEMANTIC FUNCTIONS & PIPELINE STAGES:\x1b[0m
  judge col ? "prompt" as alias > thresh     (NOUL semantic condition)
  classify col -> [opt1, opt2] as alias      (CHOICE classification)
  score col ~> [l0, l1, l2] as alias         (SCORE rating)
  NOUL(col, 'question' [, 't', 'f'])         Returns probability [0.0, 1.0]
  CHOICE(col, 'question', ['a', 'b'])        Returns winning category
  SCORE(col, 'question', ['l0', 'l1'])       Returns calibrated score

\x1b[1mEXAMPLES:\x1b[0m
  # Pipeline script
  jevql analysis.jevql

  # Inline pipeline query
  jevql "from 'tickets.json' | filter status == 'open' | take 5"

  # SQL query
  jevql "SELECT name, CHOICE(bio, 'Role', ['eng', 'design']) FROM 'users.json'"
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

  // Resolve query if pointing to an existing script file (.jevql, .sql, .pql)
  if (query) {
    const candidatePath = path.resolve(process.cwd(), query);
    if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
      let content = fs.readFileSync(candidatePath, 'utf8');
      if (content.startsWith('#!')) {
        content = content.replace(/^#![^\n]*\n/, '');
      }
      query = content;
    }
  } else if (!process.stdin.isTTY) {
    // Read query or data from stdin pipe
    try {
      const piped = fs.readFileSync(0, 'utf8').trim();
      if (piped) {
        if (piped.startsWith('[') || (piped.startsWith('{') && !piped.toLowerCase().startsWith('from '))) {
          try {
            const data = JSON.parse(piped);
            db = jevql(data, options);
          } catch (_) {
            query = piped;
          }
        } else {
          query = piped;
        }
      }
    } catch (_) {}
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

  // Interactive REPL Mode (default when no query is passed)
  console.log(`\x1b[1m\x1b[36mJevQL Interactive Shell\x1b[0m${filePath ? ` (loaded: ${filePath})` : ''}`);
  console.log(`Type queries directly (e.g. from "data.json" | ...), '.load <file>', or '.exit'\n`);

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

    if (trimmed.startsWith('.load ')) {
      const targetFile = trimmed.replace(/^\.load\s+/, '').trim().replace(/^['"]|['"]$/g, '');
      const fullPath = path.resolve(process.cwd(), targetFile);
      if (!fs.existsSync(fullPath)) {
        console.error(`\x1b[31mFile not found: ${fullPath}\x1b[0m\n`);
      } else {
        const ext = path.extname(fullPath).toLowerCase();
        let data;
        if (ext === '.csv') {
          const { parseCSV } = await import('../src/utils.js');
          data = parseCSV(fs.readFileSync(fullPath, 'utf8'));
        } else {
          data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        }
        db = jevql(data, options);
        console.log(`\x1b[32mLoaded ${Array.isArray(data) ? data.length : 1} records from ${targetFile}\x1b[0m\n`);
      }
      rl.prompt();
      return;
    }

    if (trimmed === '.tables') {
      console.log('Available tables: data (or query any "path/file.json" directly)');
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
