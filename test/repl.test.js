import { test } from 'node:test';
import assert from 'node:assert';
import jevql from '../src/index.js';
import {
  createCompleter,
  completePath,
  isQueryComplete,
  inspectSchema,
  getAvailableColumns,
  getAvailableTables,
  SQL_KEYWORDS,
  JEV_KEYWORDS,
  COGNITIVE_KEYWORDS,
  DOT_COMMANDS
} from '../src/repl.js';

test('createCompleter completes SQL keywords with matching case', () => {
  const completer = createCompleter(null);

  // Lowercase input
  const [lowerHits, lowerWord] = completer('select id from tickets whe');
  assert.strictEqual(lowerWord, 'whe');
  assert.ok(lowerHits.includes('where'));

  // Uppercase input
  const [upperHits, upperWord] = completer('SELECT id FROM tickets WHE');
  assert.strictEqual(upperWord, 'WHE');
  assert.ok(upperHits.includes('WHERE'));

  // Group by / order by
  const [groupHits] = completer('SELECT id FROM tickets gro');
  assert.ok(groupHits.includes('group by'));
});

test('createCompleter completes Jev semantic primitives', () => {
  const completer = createCompleter(null);

  const [noulHits, noulWord] = completer('SELECT id, NO');
  assert.strictEqual(noulWord, 'NO');
  assert.ok(noulHits.includes('NOUL'));

  const [choiceHits, choiceWord] = completer('SELECT id, CHO');
  assert.strictEqual(choiceWord, 'CHO');
  assert.ok(choiceHits.includes('CHOICE'));

  const [scoreHits, scoreWord] = completer('SELECT id, SCO');
  assert.strictEqual(scoreWord, 'SCO');
  assert.ok(scoreHits.includes('SCORE'));
});

test('createCompleter completes cognitive pipeline keywords', () => {
  const completer = createCompleter(null);

  const [filterHits] = completer('from tickets | fil');
  assert.ok(filterHits.includes('filter'));

  const [judgeHits] = completer('from tickets | jud');
  assert.ok(judgeHits.includes('judge'));

  const [classHits] = completer('from tickets | cla');
  assert.ok(classHits.includes('classify'));
});

test('createCompleter completes dot commands', () => {
  const completer = createCompleter(null);

  const [loadHits, loadToken] = completer('.lo');
  assert.strictEqual(loadToken, '.lo');
  assert.ok(loadHits.includes('.load'));

  const [tableHits, tableToken] = completer('.tab');
  assert.strictEqual(tableToken, '.tab');
  assert.ok(tableHits.includes('.tables'));

  const [schemaHits, schemaToken] = completer('.sch');
  assert.strictEqual(schemaToken, '.sch');
  assert.ok(schemaHits.includes('.schema'));

  const [formatHits] = completer('.format j');
  assert.ok(formatHits.includes('.format json'));
});

test('createCompleter dynamically discovers loaded table columns', () => {
  const tickets = [
    { id: 'T-100', customer: 'Acme Corp', priority: 'P1', message: 'Down', status: 'open' }
  ];
  const db = jevql(tickets);
  const completer = createCompleter(() => db);

  const [custHits, custWord] = completer('SELECT cu');
  assert.strictEqual(custWord, 'cu');
  assert.ok(custHits.includes('customer'));

  const [prioHits, prioWord] = completer('SELECT pri');
  assert.strictEqual(prioWord, 'pri');
  assert.ok(prioHits.includes('priority'));

  const [messHits] = completer('tickets: mess');
  assert.ok(messHits.includes('message'));
});

test('completePath suggests local directory files', () => {
  const [hits, raw] = completePath('pack', process.cwd());
  assert.strictEqual(raw, 'pack');
  assert.ok(hits.includes('package.json'));

  const [dirHits] = completePath('sc', process.cwd());
  assert.ok(dirHits.includes('scripts/'));
});

test('isQueryComplete correctly validates single-line and multiline states', () => {
  // Dot command is always single line complete
  assert.strictEqual(isQueryComplete([], '.tables'), true);
  assert.strictEqual(isQueryComplete([], '.load data.json'), true);

  // Semicolon completes query immediately
  assert.strictEqual(isQueryComplete([], 'SELECT * FROM tickets;'), true);
  assert.strictEqual(isQueryComplete(['SELECT *', 'FROM tickets'], 'WHERE status = open;'), true);

  // Unclosed quotes require continuation
  assert.strictEqual(isQueryComplete([], 'SELECT * FROM tickets WHERE message = "outage'), false);

  // Unclosed parens require continuation
  assert.strictEqual(isQueryComplete([], 'SELECT NOUL(body, "outage?"'), false);

  // Pipeline continuation symbol | requires next line
  assert.strictEqual(isQueryComplete([], 'from tickets |'), false);

  // SELECT statement without semicolon continues in multiline
  assert.strictEqual(isQueryComplete([], 'SELECT id, customer'), false);

  // Single-line cognitive syntax completes immediately
  assert.strictEqual(isQueryComplete([], 'from tickets | filter status == open | take 5'), true);
  assert.strictEqual(isQueryComplete([], 'tickets: status = open'), true);
});

test('inspectSchema produces formatted schema table', () => {
  const sample = [
    { id: 'T-1', customer: 'Stripe', count: 42, active: true }
  ];
  const out = inspectSchema('tickets', sample);
  assert.match(out, /Table: tickets/);
  assert.match(out, /customer/);
  assert.match(out, /string/);
  assert.match(out, /count/);
  assert.match(out, /number/);
});
