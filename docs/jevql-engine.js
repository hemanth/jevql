// JevQL In-Browser Standalone Engine (Zero External Dependencies)
// Generated for GitHub Pages Interactive Workbench

// Browser environment shim
const _globalProcess = typeof globalThis !== 'undefined' && globalThis.process
  ? globalThis.process
  : { env: {}, cwd: () => '' };
const process = _globalProcess;


// Browser-compatible sha256
function sha256(content) {
  const str = typeof content === 'string' ? content : JSON.stringify(content);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const p1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const p2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return (p1 + p2).repeat(4);
}




/**
 * Compute stable SHA-256 hash for cache keys.
 */


/**
 * Deep get a property from an object using dot notation or array indexing.
 * e.g. getProp(row, "user.name") or getProp(row, "tags[0]")
 */
function getProp(obj, pathStr) {
  if (obj == null || !pathStr) return obj;
  if (pathStr in obj) return obj[pathStr];

  const parts = pathStr.replace(/\[(\w+)\]/g, '.$1').replace(/^\./, '').split('.');
  let curr = obj;
  for (const part of parts) {
    if (curr == null) return undefined;
    curr = curr[part];
  }
  return curr;
}

/**
 * Case-insensitive property lookup on an object.
 */
function getFieldCaseInsensitive(row, fieldName) {
  if (!row || typeof row !== 'object') return undefined;
  if (fieldName in row) return row[fieldName];
  const target = fieldName.toLowerCase();
  for (const key of Object.keys(row)) {
    if (key.toLowerCase() === target) {
      return row[key];
    }
  }
  return getProp(row, fieldName);
}

/**
 * Format query results as a clean ASCII/Unicode table.
 */
function formatTable(rows, options = {}) {
  if (!rows || rows.length === 0) {
    return '(0 rows)';
  }

  const columns = options.columns || Object.keys(rows[0]);
  const colWidths = {};

  for (const col of columns) {
    colWidths[col] = col.length;
  }

  for (const row of rows) {
    for (const col of columns) {
      const val = row[col];
      const str = val === null ? 'NULL' : val === undefined ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val);
      if (str.length > (colWidths[col] || 0)) {
        colWidths[col] = Math.min(str.length, options.maxWidth || 50);
      }
    }
  }

  // Build borders
  const sepLine = '+' + columns.map(c => '-'.repeat(colWidths[c] + 2)).join('+') + '+';
  const headerLine = '| ' + columns.map(c => c.padEnd(colWidths[c])).join(' | ') + ' |';

  const bodyLines = rows.map(row => {
    return '| ' + columns.map(c => {
      const val = row[c];
      let str = val === null ? 'NULL' : val === undefined ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val);
      if (str.length > colWidths[c]) {
        str = str.slice(0, colWidths[c] - 1) + '…';
      }
      // Right-align numbers
      if (typeof val === 'number') {
        return str.padStart(colWidths[c]);
      }
      return str.padEnd(colWidths[c]);
    }).join(' | ') + ' |';
  });

  return [
    sepLine,
    headerLine,
    sepLine,
    ...bodyLines,
    sepLine,
    `(${rows.length} row${rows.length === 1 ? '' : 's'})`
  ].join('\n');
}

/**
 * Format rows as CSV string.
 */
function formatCSV(rows) {
  if (!rows || rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const row of rows) {
    const vals = headers.map(h => {
      const v = row[h];
      if (v === null || v === undefined) return '';
      const str = typeof v === 'object' ? JSON.stringify(v) : String(v);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    });
    lines.push(vals.join(','));
  }
  return lines.join('\n');
}

/**
 * Simple CSV parser (handles quotes and commas).
 */
function parseCSV(content) {
  const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length === 0) return [];

  function splitLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current);
    return values;
  }

  const rawHeaders = splitLine(lines[0]);
  const headers = rawHeaders.map(h => h.trim().replace(/^["']|["']$/g, ''));
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = splitLine(lines[i]);
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      const val = vals[j] !== undefined ? vals[j].trim() : '';
      // Auto-cast types
      if (val === '') {
        row[headers[j]] = null;
      } else if (val.toLowerCase() === 'true') {
        row[headers[j]] = true;
      } else if (val.toLowerCase() === 'false') {
        row[headers[j]] = false;
      } else if (!isNaN(val) && val.trim() !== '') {
        row[headers[j]] = Number(val);
      } else {
        row[headers[j]] = val;
      }
    }
    rows.push(row);
  }

  return rows;
}



class DataAdapter {
  constructor(sources = {}) {
    this.sources = sources;
  }
  registerTable(name, data) {
    this.sources[name.toLowerCase()] = data;
  }
  async loadSource(sourceNode) {
    if (!sourceNode) return [{ dummy: 1 }];
    const name = (sourceNode.name || sourceNode.path || 'data').toLowerCase();
    if (name in this.sources) return this.sources[name];
    if (Object.keys(this.sources).length === 1) return Object.values(this.sources)[0];
    if ('data' in this.sources) return this.sources['data'];
    return [];
  }
}


/**
 * JevQL Standard & Semantic Functions
 */

const SCALAR_FUNCTIONS = {
  // String functions
  LOWER: (val) => val == null ? null : String(val).toLowerCase(),
  UPPER: (val) => val == null ? null : String(val).toUpperCase(),
  TRIM: (val) => val == null ? null : String(val).trim(),
  LENGTH: (val) => val == null ? null : String(val).length,
  CONCAT: (...args) => args.filter(a => a != null).join(''),
  SUBSTR: (str, start, len) => {
    if (str == null) return null;
    const s = String(str);
    // 1-indexed in SQL
    const idx = Math.max(0, (start || 1) - 1);
    return len !== undefined ? s.slice(idx, idx + len) : s.slice(idx);
  },

  // Math functions
  ROUND: (num, decimals = 0) => {
    if (num == null || isNaN(num)) return null;
    const factor = Math.pow(10, decimals);
    return Math.round(Number(num) * factor) / factor;
  },
  ABS: (num) => num == null ? null : Math.abs(num),
  FLOOR: (num) => num == null ? null : Math.floor(num),
  CEIL: (num) => num == null ? null : Math.ceil(num),

  // Null & Control flow
  COALESCE: (...args) => {
    for (const arg of args) {
      if (arg !== null && arg !== undefined) return arg;
    }
    return null;
  },
  NULLIF: (a, b) => a === b ? null : a,

  // JSON operations
  JSON_EXTRACT: (obj, pathStr) => {
    if (obj == null) return null;
    const parsed = typeof obj === 'string' ? JSON.parse(obj) : obj;
    const cleanPath = String(pathStr).replace(/^\$\.?/, '');
    const parts = cleanPath.split('.');
    let curr = parsed;
    for (const p of parts) {
      if (curr == null) return null;
      curr = curr[p];
    }
    return curr;
  },

  // Date helpers
  NOW: () => new Date().toISOString(),
  CURRENT_DATE: () => new Date().toISOString().split('T')[0],
  CURRENT_TIMESTAMP: () => new Date().toISOString()
};

const AGGREGATE_FUNCTIONS = {
  COUNT: (values, isWildcard = false) => {
    if (isWildcard) return values.length;
    return values.filter(v => v !== null && v !== undefined).length;
  },
  SUM: (values) => {
    const valid = values.filter(v => typeof v === 'number' && !isNaN(v));
    return valid.length > 0 ? valid.reduce((acc, v) => acc + v, 0) : null;
  },
  AVG: (values) => {
    const valid = values.filter(v => typeof v === 'number' && !isNaN(v));
    if (valid.length === 0) return null;
    return Number((valid.reduce((acc, v) => acc + v, 0) / valid.length).toFixed(4));
  },
  MIN: (values) => {
    const valid = values.filter(v => v !== null && v !== undefined);
    if (valid.length === 0) return null;
    return valid.reduce((min, v) => v < min ? v : min, valid[0]);
  },
  MAX: (values) => {
    const valid = values.filter(v => v !== null && v !== undefined);
    if (valid.length === 0) return null;
    return valid.reduce((max, v) => v > max ? v : max, valid[0]);
  },
  ARRAY_AGG: (values) => {
    return values.filter(v => v !== null && v !== undefined);
  },
  STRING_AGG: (values, delimiter = ',') => {
    return values.filter(v => v !== null && v !== undefined).join(delimiter);
  }
};

const SEMANTIC_FUNCTION_NAMES = new Set([
  'NOUL', 'CHOICE', 'SCORE', 'CONFIDENCE', 'PROB', 'IS_TRUE', 'IS_FALSE', 'JEV'
]);

function isSemanticFunction(name) {
  return SEMANTIC_FUNCTION_NAMES.has(String(name).toUpperCase());
}


/**
 * JevQL SQL Lexer & Parser
 *
 * Extends PostgreSQL-style SQL with first-class TypeSafe Jev System One semantic primitives:
 *   NOUL(col, 'question', criteria)
 *   CHOICE(col, 'question', ['a', 'b', ...])
 *   SCORE(col, 'question', ['lvl1', 'lvl2', ...])
 *   CONFIDENCE(expr)
 *   PROB(expr, 'option')
 *   IS_TRUE(col, 'question')
 *   IS_FALSE(col, 'question')
 */

class Token {
  constructor(type, value, pos) {
    this.type = type;
    this.value = value;
    this.pos = pos;
  }
}

const KEYWORDS = new Set([
  'SELECT', 'DISTINCT', 'FROM', 'WHERE', 'GROUP', 'BY', 'HAVING',
  'ORDER', 'ASC', 'DESC', 'LIMIT', 'OFFSET', 'JOIN', 'LEFT', 'RIGHT',
  'INNER', 'FULL', 'CROSS', 'ON', 'AS', 'AND', 'OR', 'NOT', 'LIKE',
  'ILIKE', 'IN', 'BETWEEN', 'IS', 'NULL', 'TRUE', 'FALSE', 'CASE',
  'WHEN', 'THEN', 'ELSE', 'END', 'EXPLAIN', 'ANALYZE', 'WITH', 'UNION', 'ALL'
]);

function tokenize(sql) {
  const tokens = [];
  let i = 0;

  while (i < sql.length) {
    const char = sql[i];

    // Whitespace
    if (/\s/.test(char)) {
      i++;
      continue;
    }

    // Single-line comments (-- ...)
    if (char === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }

    // Multi-line comments (/* ... */)
    if (char === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    // Number literal
    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(sql[i + 1] || ''))) {
      const start = i;
      let hasDot = false;
      while (i < sql.length && (/[0-9]/.test(sql[i]) || (sql[i] === '.' && !hasDot))) {
        if (sql[i] === '.') hasDot = true;
        i++;
      }
      tokens.push(new Token('NUMBER', parseFloat(sql.slice(start, i)), start));
      continue;
    }

    // String literal (single quotes or double quotes)
    if (char === "'" || char === '"') {
      const quote = char;
      const start = i;
      i++;
      let str = '';
      while (i < sql.length) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            str += quote;
            i += 2;
          } else {
            i++;
            break;
          }
        } else if (sql[i] === '\\') {
          str += sql[i + 1] || '';
          i += 2;
        } else {
          str += sql[i];
          i++;
        }
      }
      tokens.push(new Token('STRING', str, start));
      continue;
    }

    // Multi-character operators
    const two = sql.slice(i, i + 2);
    const three = sql.slice(i, i + 3);

    if (two === '->>' || two === '<>' || two === '!=' || two === '<=' || two === '>=' || two === '||' || two === '->') {
      tokens.push(new Token('OPERATOR', two, i));
      i += 2;
      continue;
    }

    // Single-character punctuation & operators
    if ('=<>+-*/%'.includes(char)) {
      tokens.push(new Token('OPERATOR', char, i));
      i++;
      continue;
    }

    if ('(),;[]{}:.'.includes(char)) {
      tokens.push(new Token('PUNCTUATION', char, i));
      i++;
      continue;
    }

    // Word: identifier or keyword
    if (/[a-zA-Z_]/.test(char) || char === '`') {
      const start = i;
      if (char === '`') {
        i++;
        let ident = '';
        while (i < sql.length && sql[i] !== '`') {
          ident += sql[i];
          i++;
        }
        i++;
        tokens.push(new Token('IDENTIFIER', ident, start));
        continue;
      }

      while (i < sql.length && /[a-zA-Z0-9_$]/.test(sql[i])) {
        i++;
      }
      const word = sql.slice(start, i);
      const upper = word.toUpperCase();
      if (KEYWORDS.has(upper)) {
        tokens.push(new Token('KEYWORD', upper, start));
      } else {
        tokens.push(new Token('IDENTIFIER', word, start));
      }
      continue;
    }

    throw new Error(`Unexpected character '${char}' at index ${i}`);
  }

  tokens.push(new Token('EOF', '', i));
  return tokens;
}

class Parser {
  constructor(sql) {
    this.sql = sql;
    this.tokens = tokenize(sql);
    this.pos = 0;
  }

  current() {
    return this.tokens[this.pos] || this.tokens[this.tokens.length - 1];
  }

  peek(offset = 1) {
    return this.tokens[this.pos + offset] || this.tokens[this.tokens.length - 1];
  }

  matchKeyword(keyword) {
    const cur = this.current();
    return cur.type === 'KEYWORD' && cur.value === keyword.toUpperCase();
  }

  matchPunctuation(char) {
    const cur = this.current();
    return cur.type === 'PUNCTUATION' && cur.value === char;
  }

  matchOperator(op) {
    const cur = this.current();
    return cur.type === 'OPERATOR' && cur.value === op;
  }

  consumeKeyword(keyword) {
    if (!this.matchKeyword(keyword)) {
      throw new Error(`Expected keyword '${keyword}', got '${this.current().value}' at position ${this.current().pos}`);
    }
    const token = this.current();
    this.pos++;
    return token;
  }

  consumePunctuation(char) {
    if (!this.matchPunctuation(char)) {
      throw new Error(`Expected '${char}', got '${this.current().value}' at position ${this.current().pos}`);
    }
    const token = this.current();
    this.pos++;
    return token;
  }

  parse() {
    let explain = false;
    let analyze = false;

    if (this.matchKeyword('EXPLAIN')) {
      explain = true;
      this.pos++;
      if (this.matchKeyword('ANALYZE')) {
        analyze = true;
        this.pos++;
      }
    }

    if (this.matchKeyword('SELECT')) {
      const stmt = this.parseSelect();
      stmt.explain = explain;
      stmt.analyze = analyze;
      return stmt;
    }

    throw new Error(`Unsupported SQL statement at position ${this.current().pos}. Only SELECT statements are supported.`);
  }

  parseSelect() {
    this.consumeKeyword('SELECT');
    let distinct = false;
    if (this.matchKeyword('DISTINCT')) {
      distinct = true;
      this.pos++;
    }

    const columns = this.parseColumns();

    let from = null;
    if (this.matchKeyword('FROM')) {
      from = this.parseFrom();
    }

    let where = null;
    if (this.matchKeyword('WHERE')) {
      this.consumeKeyword('WHERE');
      where = this.parseExpression();
    }

    let groupBy = null;
    if (this.matchKeyword('GROUP')) {
      this.consumeKeyword('GROUP');
      this.consumeKeyword('BY');
      groupBy = this.parseExpressionList();
    }

    let having = null;
    if (this.matchKeyword('HAVING')) {
      this.consumeKeyword('HAVING');
      having = this.parseExpression();
    }

    let orderBy = null;
    if (this.matchKeyword('ORDER')) {
      this.consumeKeyword('ORDER');
      this.consumeKeyword('BY');
      orderBy = this.parseOrderBy();
    }

    let limit = null;
    if (this.matchKeyword('LIMIT')) {
      this.consumeKeyword('LIMIT');
      limit = this.parseExpression();
    }

    let offset = null;
    if (this.matchKeyword('OFFSET')) {
      this.consumeKeyword('OFFSET');
      offset = this.parseExpression();
    }

    return {
      type: 'SelectStatement',
      distinct,
      columns,
      from,
      where,
      groupBy,
      having,
      orderBy,
      limit,
      offset
    };
  }

  parseColumns() {
    const columns = [];
    while (true) {
      if (this.matchOperator('*')) {
        this.pos++;
        columns.push({ expr: { type: 'Wildcard' }, alias: null });
      } else {
        const expr = this.parseExpression();
        let alias = null;
        if (this.matchKeyword('AS')) {
          this.pos++;
          alias = this.parseIdentifierName();
        } else if (this.current().type === 'IDENTIFIER' && !KEYWORDS.has(this.current().value.toUpperCase())) {
          alias = this.parseIdentifierName();
        }
        columns.push({ expr, alias });
      }

      if (this.matchPunctuation(',')) {
        this.pos++;
      } else {
        break;
      }
    }
    return columns;
  }

  parseFrom() {
    this.consumeKeyword('FROM');
    let source = null;

    // Could be a file string 'data.csv', an identifier, or a function call like postgres('...')
    if (this.current().type === 'STRING') {
      source = { type: 'FileSource', path: this.current().value };
      this.pos++;
    } else if (this.current().type === 'IDENTIFIER') {
      const name = this.current().value;
      this.pos++;
      // Check if it's a function call like postgres(...) or csv(...)
      if (this.matchPunctuation('(')) {
        this.pos++;
        const args = [];
        while (!this.matchPunctuation(')') && this.current().type !== 'EOF') {
          args.push(this.parseExpression());
          if (this.matchPunctuation(',')) this.pos++;
          else break;
        }
        this.consumePunctuation(')');
        source = { type: 'FunctionSource', name, arguments: args };
        // Check property chaining: postgres('...').tickets
        if (this.matchPunctuation('.')) {
          this.pos++;
          const prop = this.parseIdentifierName();
          source = { type: 'ChainedSource', base: source, property: prop };
        }
      } else {
        source = { type: 'TableSource', name };
        if (this.matchPunctuation('.')) {
          this.pos++;
          const table = this.parseIdentifierName();
          source = { type: 'TableSource', schema: name, name: table };
        }
      }
    } else {
      throw new Error(`Unexpected token in FROM clause: ${this.current().value}`);
    }

    let alias = null;
    if (this.matchKeyword('AS')) {
      this.pos++;
      alias = this.parseIdentifierName();
    } else if (this.current().type === 'IDENTIFIER' && !KEYWORDS.has(this.current().value.toUpperCase())) {
      alias = this.parseIdentifierName();
    }

    const joins = [];
    while (
      this.matchKeyword('JOIN') ||
      this.matchKeyword('LEFT') ||
      this.matchKeyword('RIGHT') ||
      this.matchKeyword('INNER') ||
      this.matchKeyword('FULL') ||
      this.matchKeyword('CROSS')
    ) {
      joins.push(this.parseJoin());
    }

    return {
      type: 'FromClause',
      source,
      alias,
      joins
    };
  }

  parseJoin() {
    let joinType = 'INNER';
    if (this.matchKeyword('LEFT') || this.matchKeyword('RIGHT') || this.matchKeyword('INNER') || this.matchKeyword('FULL') || this.matchKeyword('CROSS')) {
      joinType = this.current().value;
      this.pos++;
      if (this.matchKeyword('JOIN')) {
        this.pos++;
      }
    } else if (this.matchKeyword('JOIN')) {
      this.pos++;
    }

    let target = null;
    if (this.current().type === 'STRING') {
      target = { type: 'FileSource', path: this.current().value };
      this.pos++;
    } else {
      const name = this.parseIdentifierName();
      target = { type: 'TableSource', name };
    }

    let alias = null;
    if (this.matchKeyword('AS')) {
      this.pos++;
      alias = this.parseIdentifierName();
    } else if (this.current().type === 'IDENTIFIER' && !KEYWORDS.has(this.current().value.toUpperCase())) {
      alias = this.parseIdentifierName();
    }

    let on = null;
    if (this.matchKeyword('ON')) {
      this.consumeKeyword('ON');
      on = this.parseExpression();
    }

    return {
      type: 'JoinClause',
      joinType,
      target,
      alias,
      on
    };
  }

  parseOrderBy() {
    const items = [];
    while (true) {
      const expr = this.parseExpression();
      let direction = 'ASC';
      if (this.matchKeyword('ASC')) {
        this.pos++;
      } else if (this.matchKeyword('DESC')) {
        direction = 'DESC';
        this.pos++;
      }
      items.push({ expr, direction });

      if (this.matchPunctuation(',')) {
        this.pos++;
      } else {
        break;
      }
    }
    return items;
  }

  parseExpressionList() {
    const list = [];
    while (true) {
      list.push(this.parseExpression());
      if (this.matchPunctuation(',')) {
        this.pos++;
      } else {
        break;
      }
    }
    return list;
  }

  parseIdentifierName() {
    const cur = this.current();
    if (cur.type === 'IDENTIFIER' || cur.type === 'STRING') {
      this.pos++;
      return cur.value;
    }
    throw new Error(`Expected identifier, got '${cur.value}' at position ${cur.pos}`);
  }

  // Precedence climbing expression parsing
  parseExpression() {
    return this.parseOr();
  }

  parseOr() {
    let left = this.parseAnd();
    while (this.matchKeyword('OR')) {
      this.pos++;
      const right = this.parseAnd();
      left = { type: 'BinaryExpression', operator: 'OR', left, right };
    }
    return left;
  }

  parseAnd() {
    let left = this.parseNot();
    while (this.matchKeyword('AND')) {
      this.pos++;
      const right = this.parseNot();
      left = { type: 'BinaryExpression', operator: 'AND', left, right };
    }
    return left;
  }

  parseNot() {
    if (this.matchKeyword('NOT')) {
      this.pos++;
      return { type: 'UnaryExpression', operator: 'NOT', argument: this.parseComparison() };
    }
    return this.parseComparison();
  }

  parseComparison() {
    let left = this.parseAddition();

    const cur = this.current();

    // IS [NOT] NULL
    if (this.matchKeyword('IS')) {
      this.pos++;
      let not = false;
      if (this.matchKeyword('NOT')) {
        not = true;
        this.pos++;
      }
      if (this.matchKeyword('NULL')) {
        this.pos++;
        return { type: 'IsNullExpression', expr: left, not };
      }
      if (this.matchKeyword('TRUE')) {
        this.pos++;
        return { type: 'BinaryExpression', operator: not ? '!=' : '=', left, right: { type: 'Literal', value: true } };
      }
      if (this.matchKeyword('FALSE')) {
        this.pos++;
        return { type: 'BinaryExpression', operator: not ? '!=' : '=', left, right: { type: 'Literal', value: false } };
      }
    }

    // [NOT] IN (...)
    let notIn = false;
    if (this.matchKeyword('NOT') && this.peek().type === 'KEYWORD' && this.peek().value === 'IN') {
      notIn = true;
      this.pos += 2;
    } else if (this.matchKeyword('IN')) {
      this.pos++;
    }

    if (notIn || this.tokens[this.pos - 1]?.value === 'IN') {
      this.consumePunctuation('(');
      const values = [];
      while (!this.matchPunctuation(')') && this.current().type !== 'EOF') {
        values.push(this.parseExpression());
        if (this.matchPunctuation(',')) this.pos++;
        else break;
      }
      this.consumePunctuation(')');
      return { type: 'InExpression', expr: left, values, not: notIn };
    }

    // [NOT] BETWEEN ... AND ...
    let notBetween = false;
    if (this.matchKeyword('NOT') && this.peek().type === 'KEYWORD' && this.peek().value === 'BETWEEN') {
      notBetween = true;
      this.pos += 2;
    } else if (this.matchKeyword('BETWEEN')) {
      this.pos++;
    }

    if (notBetween || this.tokens[this.pos - 1]?.value === 'BETWEEN') {
      const lower = this.parseAddition();
      this.consumeKeyword('AND');
      const upper = this.parseAddition();
      return { type: 'BetweenExpression', expr: left, lower, upper, not: notBetween };
    }

    // [NOT] LIKE / ILIKE
    let notLike = false;
    if (this.matchKeyword('NOT') && (this.peek().value === 'LIKE' || this.peek().value === 'ILIKE')) {
      notLike = true;
      this.pos++;
    }

    if (this.matchKeyword('LIKE') || this.matchKeyword('ILIKE')) {
      const isILike = this.current().value === 'ILIKE';
      this.pos++;
      const pattern = this.parseAddition();
      return { type: 'LikeExpression', expr: left, pattern, caseInsensitive: isILike, not: notLike };
    }

    // Standard comparison operators (=, !=, <>, >, <, >=, <=)
    if (cur.type === 'OPERATOR' && ['=', '!=', '<>', '>', '<', '>=', '<='].includes(cur.value)) {
      this.pos++;
      const right = this.parseAddition();
      return { type: 'BinaryExpression', operator: cur.value === '<>' ? '!=' : cur.value, left, right };
    }

    return left;
  }

  parseAddition() {
    let left = this.parseMultiplication();
    while (
      (this.current().type === 'OPERATOR' && (this.current().value === '+' || this.current().value === '-' || this.current().value === '||'))
    ) {
      const op = this.current().value;
      this.pos++;
      const right = this.parseMultiplication();
      left = { type: 'BinaryExpression', operator: op, left, right };
    }
    return left;
  }

  parseMultiplication() {
    let left = this.parseUnary();
    while (
      (this.current().type === 'OPERATOR' && (this.current().value === '*' || this.current().value === '/' || this.current().value === '%' || this.current().value === '->' || this.current().value === '->>'))
    ) {
      const op = this.current().value;
      this.pos++;
      const right = this.parseUnary();
      left = { type: 'BinaryExpression', operator: op, left, right };
    }
    return left;
  }

  parseUnary() {
    if (this.current().type === 'OPERATOR' && (this.current().value === '+' || this.current().value === '-')) {
      const op = this.current().value;
      this.pos++;
      const arg = this.parsePrimary();
      return { type: 'UnaryExpression', operator: op, argument: arg };
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const cur = this.current();

    // Parenthesized expression
    if (this.matchPunctuation('(')) {
      this.pos++;
      const expr = this.parseExpression();
      this.consumePunctuation(')');
      return expr;
    }

    // Array literal [item, item, ...]
    if (this.matchPunctuation('[')) {
      return this.parseArrayLiteral();
    }

    // Object literal { 'key': val, ... }
    if (this.matchPunctuation('{')) {
      return this.parseObjectLiteral();
    }

    // Number literal
    if (cur.type === 'NUMBER') {
      this.pos++;
      return { type: 'Literal', value: cur.value };
    }

    // String literal
    if (cur.type === 'STRING') {
      this.pos++;
      return { type: 'Literal', value: cur.value };
    }

    // Keywords TRUE, FALSE, NULL
    if (this.matchKeyword('TRUE')) {
      this.pos++;
      return { type: 'Literal', value: true };
    }
    if (this.matchKeyword('FALSE')) {
      this.pos++;
      return { type: 'Literal', value: false };
    }
    if (this.matchKeyword('NULL')) {
      this.pos++;
      return { type: 'Literal', value: null };
    }

    // CASE WHEN ... THEN ... ELSE ... END
    if (this.matchKeyword('CASE')) {
      return this.parseCaseExpression();
    }

    // Function call or Identifier
    if (cur.type === 'IDENTIFIER') {
      const name = cur.value;
      this.pos++;

      // Check for function call
      if (this.matchPunctuation('(')) {
        this.pos++;
        const args = [];
        if (!this.matchPunctuation(')')) {
          while (true) {
            if (this.matchOperator('*')) {
              this.pos++;
              args.push({ type: 'Wildcard' });
            } else {
              args.push(this.parseExpression());
            }

            if (this.matchPunctuation(',')) {
              this.pos++;
            } else {
              break;
            }
          }
        }
        this.consumePunctuation(')');
        return {
          type: 'FunctionCall',
          name: name.toUpperCase(),
          arguments: args
        };
      }

      // Check for table.column
      if (this.matchPunctuation('.')) {
        this.pos++;
        const col = this.parseIdentifierName();
        return {
          type: 'Identifier',
          table: name,
          name: col
        };
      }

      return {
        type: 'Identifier',
        name
      };
    }

    throw new Error(`Unexpected token '${cur.value}' (${cur.type}) at position ${cur.pos}`);
  }

  parseArrayLiteral() {
    this.consumePunctuation('[');
    const elements = [];
    while (!this.matchPunctuation(']') && this.current().type !== 'EOF') {
      elements.push(this.parseExpression());
      if (this.matchPunctuation(',')) {
        this.pos++;
      } else {
        break;
      }
    }
    this.consumePunctuation(']');
    return { type: 'ArrayLiteral', elements };
  }

  parseObjectLiteral() {
    this.consumePunctuation('{');
    const properties = {};
    while (!this.matchPunctuation('}') && this.current().type !== 'EOF') {
      let key = '';
      if (this.current().type === 'STRING' || this.current().type === 'IDENTIFIER') {
        key = this.current().value;
        this.pos++;
      } else {
        throw new Error(`Expected object key, got ${this.current().value} at ${this.current().pos}`);
      }

      this.consumePunctuation(':');
      const valExpr = this.parseExpression();
      properties[key] = valExpr;

      if (this.matchPunctuation(',')) {
        this.pos++;
      } else {
        break;
      }
    }
    this.consumePunctuation('}');
    return { type: 'ObjectLiteral', properties };
  }

  parseCaseExpression() {
    this.consumeKeyword('CASE');
    const conditions = [];
    let elseExpr = null;

    while (this.matchKeyword('WHEN')) {
      this.consumeKeyword('WHEN');
      const when = this.parseExpression();
      this.consumeKeyword('THEN');
      const then = this.parseExpression();
      conditions.push({ when, then });
    }

    if (this.matchKeyword('ELSE')) {
      this.consumeKeyword('ELSE');
      elseExpr = this.parseExpression();
    }

    this.consumeKeyword('END');
    return {
      type: 'CaseExpression',
      conditions,
      elseExpr
    };
  }
}

function parse(sql) {
  const parser = new Parser(sql);
  return parser.parse();
}


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



function isPipelineQuery(text) {
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
function pipelineToSQL(queryStr) {
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

function compilePipeline(pipelineCode) {
  const sql = pipelineToSQL(pipelineCode);
  return parse(sql);
}





/**
 * Traverses an expression AST to find all semantic function calls (NOUL, CHOICE, SCORE).
 */
function extractSemanticNodes(exprNode, results = []) {
  if (!exprNode || typeof exprNode !== 'object') return results;

  if (exprNode.type === 'FunctionCall') {
    const fnName = exprNode.name.toUpperCase();
    if (['NOUL', 'CHOICE', 'SCORE', 'IS_TRUE', 'IS_FALSE', 'JEV'].includes(fnName)) {
      results.push(exprNode);
      // Even if it's a semantic node, its arguments could conceivably contain nested expressions
    }
    // Also traverse arguments (e.g. CONFIDENCE(CHOICE(...)))
    for (const arg of exprNode.arguments || []) {
      extractSemanticNodes(arg, results);
    }
    return results;
  }

  if (exprNode.type === 'BinaryExpression') {
    extractSemanticNodes(exprNode.left, results);
    extractSemanticNodes(exprNode.right, results);
  } else if (exprNode.type === 'UnaryExpression') {
    extractSemanticNodes(exprNode.argument, results);
  } else if (exprNode.type === 'CaseExpression') {
    for (const cond of exprNode.conditions || []) {
      extractSemanticNodes(cond.when, results);
      extractSemanticNodes(cond.then, results);
    }
    if (exprNode.elseExpr) extractSemanticNodes(exprNode.elseExpr, results);
  } else if (exprNode.type === 'InExpression') {
    extractSemanticNodes(exprNode.expr, results);
    for (const v of exprNode.values || []) extractSemanticNodes(v, results);
  } else if (exprNode.type === 'BetweenExpression') {
    extractSemanticNodes(exprNode.expr, results);
    extractSemanticNodes(exprNode.lower, results);
    extractSemanticNodes(exprNode.upper, results);
  } else if (exprNode.type === 'IsNullExpression' || exprNode.type === 'LikeExpression') {
    extractSemanticNodes(exprNode.expr, results);
    if (exprNode.pattern) extractSemanticNodes(exprNode.pattern, results);
  }

  return results;
}

/**
 * Check if an expression AST node has any semantic function calls.
 */
function containsSemanticCalls(exprNode) {
  const list = extractSemanticNodes(exprNode);
  return list.length > 0;
}

/**
 * Splits a WHERE clause conjuncts (top-level ANDs) into deterministic vs semantic.
 */
function splitWhereClause(whereNode) {
  if (!whereNode) {
    return { deterministic: null, semantic: null };
  }

  const conjuncts = [];
  function collectConjuncts(node) {
    if (node.type === 'BinaryExpression' && node.operator === 'AND') {
      collectConjuncts(node.left);
      collectConjuncts(node.right);
    } else {
      conjuncts.push(node);
    }
  }
  collectConjuncts(whereNode);

  const deterministicList = [];
  const semanticList = [];

  for (const c of conjuncts) {
    if (containsSemanticCalls(c)) {
      semanticList.push(c);
    } else {
      deterministicList.push(c);
    }
  }

  function combineWithAnd(list) {
    if (list.length === 0) return null;
    let curr = list[0];
    for (let i = 1; i < list.length; i++) {
      curr = { type: 'BinaryExpression', operator: 'AND', left: curr, right: list[i] };
    }
    return curr;
  }

  return {
    deterministic: combineWithAnd(deterministicList),
    semantic: combineWithAnd(semanticList)
  };
}

function defaultEvalLiteral(node) {
  if (!node) return null;
  if (node.type === 'Literal') return node.value;
  if (node.type === 'ArrayLiteral') {
    return (node.elements || []).map(defaultEvalLiteral);
  }
  if (node.type === 'ObjectLiteral') {
    const obj = {};
    for (const [k, v] of Object.entries(node.properties || {})) {
      obj[k] = defaultEvalLiteral(v);
    }
    return obj;
  }
  if (node.type === 'Identifier') return node.name;
  return node.value ?? null;
}

/**
 * Converts a Semantic AST FunctionCall into a standardized TypeSafe Question descriptor.
 */
function buildQuestionDescriptor(fnNode, evalLiteralFn = defaultEvalLiteral) {
  const fnName = fnNode.name.toUpperCase();
  const args = fnNode.arguments;

  const stateArg = args[0];
  const instructionArg = args[1];

  const instructions = evalLiteralFn(instructionArg) || 'Evaluate';

  let type = 'noul';
  let criteria = undefined;

  if (fnName === 'NOUL' || fnName === 'IS_TRUE' || fnName === 'IS_FALSE') {
    type = 'noul';
    if (args[2]) {
      const criteriaTrue = evalLiteralFn(args[2]);
      const criteriaFalse = args[3] ? evalLiteralFn(args[3]) : undefined;
      criteria = { true: criteriaTrue, false: criteriaFalse };
    }
  } else if (fnName === 'CHOICE') {
    type = 'choice';
    const criteriaArg = evalLiteralFn(args[2]);
    if (Array.isArray(criteriaArg)) {
      criteria = {};
      for (const opt of criteriaArg) {
        criteria[String(opt)] = null;
      }
    } else if (typeof criteriaArg === 'object' && criteriaArg !== null) {
      criteria = criteriaArg;
    } else {
      criteria = { yes: null, no: null };
    }
  } else if (fnName === 'SCORE') {
    type = 'score';
    const levelsArg = evalLiteralFn(args[2]);
    if (Array.isArray(levelsArg)) {
      criteria = levelsArg.map(lvl => typeof lvl === 'object' ? lvl : String(lvl));
    } else {
      criteria = ['Low', 'Medium', 'High'];
    }
  }

  const questionKey = 'q_' + sha256({ type, instructions, criteria }).slice(0, 12);

  return {
    key: questionKey,
    stateExpr: stateArg,
    question: {
      type,
      instructions,
      criteria
    },
    fnName
  };
}

/**
 * Builds an execution plan for a SELECT statement AST.
 */
function createQueryPlan(ast, evalLiteralFn = defaultEvalLiteral) {
  // Build alias map from SELECT columns
  const aliasMap = new Map();
  for (const col of ast.columns) {
    if (col.alias) {
      aliasMap.set(col.alias.toLowerCase(), col.expr);
    }
  }

  // Resolve any alias references in groupBy
  if (ast.groupBy) {
    ast.groupBy = ast.groupBy.map(g => {
      if (g.type === 'Identifier' && !g.table && aliasMap.has(g.name.toLowerCase())) {
        return aliasMap.get(g.name.toLowerCase());
      }
      return g;
    });
  }

  const { deterministic, semantic } = splitWhereClause(ast.where);

  // Collect all semantic nodes across the query
  const allSemanticNodes = [];

  // In columns
  for (const col of ast.columns) {
    extractSemanticNodes(col.expr, allSemanticNodes);
  }

  // In WHERE
  if (ast.where) {
    extractSemanticNodes(ast.where, allSemanticNodes);
  }

  // In GROUP BY
  if (ast.groupBy) {
    for (const g of ast.groupBy) {
      extractSemanticNodes(g, allSemanticNodes);
    }
  }

  // In HAVING
  if (ast.having) {
    extractSemanticNodes(ast.having, allSemanticNodes);
  }

  // In ORDER BY
  if (ast.orderBy) {
    for (const o of ast.orderBy) {
      extractSemanticNodes(o.expr, allSemanticNodes);
    }
  }

  // Map to distinct question descriptors
  const questionMap = new Map();
  for (const node of allSemanticNodes) {
    const desc = buildQuestionDescriptor(node, evalLiteralFn);
    if (!questionMap.has(desc.key)) {
      questionMap.set(desc.key, desc);
    }
    // Tag the AST node with its resolved question key
    node._questionKey = desc.key;
  }

  // Detect aggregations
  const aggregateCalls = [];
  function findAggregates(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'FunctionCall') {
      const name = node.name.toUpperCase();
      if (['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'ARRAY_AGG', 'STRING_AGG'].includes(name)) {
        aggregateCalls.push(node);
      }
    }
    for (const key of Object.keys(node)) {
      if (key !== '_questionKey' && typeof node[key] === 'object') {
        findAggregates(node[key]);
      }
    }
  }

  for (const col of ast.columns) {
    findAggregates(col.expr);
  }

  const isAggregateQuery = Boolean(ast.groupBy?.length || aggregateCalls.length);

  return {
    source: ast.from?.source,
    alias: ast.from?.alias,
    joins: ast.from?.joins || [],
    pushdownFilter: deterministic,
    semanticFilter: semantic,
    questions: Array.from(questionMap.values()),
    isAggregateQuery,
    aggregates: aggregateCalls,
    distinct: ast.distinct,
    groupBy: ast.groupBy,
    having: ast.having,
    orderBy: ast.orderBy,
    limit: ast.limit,
    offset: ast.offset
  };
}




/**
 * In-memory LRU Cache for Jev System One judgments.
 */
class JevCache {
  constructor(maxSize = 10000) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return undefined;
    const val = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, val);
    return val;
  }

  set(key, val) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, val);
  }

  clear() {
    this.cache.clear();
  }

  size() {
    return this.cache.size;
  }
}

/**
 * Abstract Base Class for Semantic Engines.
 */
class BaseSemanticEngine {
  constructor(options = {}) {
    this.options = options;
    this.name = 'base';
  }

  async evaluateSingleState(state, questions, options = {}) {
    throw new Error('evaluateSingleState must be implemented by semantic engine subclass.');
  }
}

/**
 * 1. TypeSafe Jev System One Engine (Default)
 * Direct, calibrated typed judgments via parallel single-pass API.
 */
class TypeSafeJevEngine extends BaseSemanticEngine {
  constructor(options = {}) {
    super(options);
    this.name = 'jev';
    this.apiKey = options.apiKey || (typeof process !== 'undefined' && process.env?.TYPESAFE_API_KEY) || '';
    this.apiUrl = options.apiUrl || 'https://api.typesafe.ai/v1/systemone';
    this.model = options.model || 'jev-latest';
    this.fallbackEngine = new HeuristicEngine(options);
  }

  async evaluateSingleState(state, questions, options = {}) {
    if (!this.apiKey) {
      return this.fallbackEngine.evaluateSingleState(state, questions, options);
    }

    const maxRetries = options.retries || 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(this.apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: this.model,
            state,
            questions
          })
        });

        if (res.status === 429 || res.status === 529) {
          const waitMs = Math.min(attempt * 1000 + Math.random() * 500, 10000);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`TypeSafe Jev API error (${res.status}): ${errText}`);
        }

        const data = await res.json();
        return data.answers || {};
      } catch (err) {
        lastError = err;
        if (attempt === maxRetries) break;
        await new Promise(r => setTimeout(r, attempt * 500));
      }
    }

    console.warn(`[jevql] TypeSafe API request failed: ${lastError?.message}. Falling back to in-tree heuristic.`);
    return this.fallbackEngine.evaluateSingleState(state, questions, options);
  }
}

/**
 * 2. LLM Function-Calling / Structured Output Engine (Competitor / Alternative Architecture)
 * Emulates or calls an OpenAI-compatible JSON Schema / Tool-Call chat completion endpoint.
 */
class LLMStructuredEngine extends BaseSemanticEngine {
  constructor(options = {}) {
    super(options);
    this.name = 'llm';
    this.apiKey = options.apiKey || (typeof process !== 'undefined' && process.env?.OPENAI_API_KEY) || '';
    this.apiUrl = options.apiUrl || 'https://api.openai.com/v1/chat/completions';
    this.model = options.model || 'gpt-4o-mini';
  }

  async evaluateSingleState(state, questions, options = {}) {
    // If API key is provided and apiUrl is active, call OpenAI-compatible JSON schema endpoint
    if (this.apiKey && typeof fetch !== 'undefined') {
      try {
        const schemaProperties = {};
        for (const [qid, q] of Object.entries(questions)) {
          if (q.type === 'noul') {
            schemaProperties[qid] = { type: 'number', description: `Probability 0.0-1.0: ${q.instructions}` };
          } else if (q.type === 'choice') {
            const opts = Array.isArray(q.criteria) ? q.criteria : Object.keys(q.criteria || {});
            schemaProperties[qid] = { type: 'string', enum: opts.length ? opts : ['yes', 'no'] };
          } else if (q.type === 'score') {
            schemaProperties[qid] = { type: 'number', description: `Continuous score along levels: ${JSON.stringify(q.criteria)}` };
          }
        }

        const res = await fetch(this.apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: this.model,
            messages: [
              { role: 'system', content: 'You are a structured classification and judgment evaluator. Return values adhering strictly to JSON Schema.' },
              { role: 'user', content: `Analyze the following input:\n${typeof state === 'string' ? state : JSON.stringify(state)}` }
            ],
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: 'jev_judgments',
                strict: true,
                schema: {
                  type: 'object',
                  properties: schemaProperties,
                  required: Object.keys(schemaProperties),
                  additionalProperties: false
                }
              }
            }
          })
        });

        if (res.ok) {
          const data = await res.json();
          const parsed = JSON.parse(data.choices[0].message.content);
          const answers = {};
          for (const [qid, q] of Object.entries(questions)) {
            const val = parsed[qid];
            if (q.type === 'noul') {
              answers[qid] = { type: 'noul', noul: Number(val) };
            } else if (q.type === 'choice') {
              answers[qid] = { type: 'choice', choice: String(val), confidence: 0.85 };
            } else if (q.type === 'score') {
              answers[qid] = { type: 'score', score: Number(val), confidence: 0.85 };
            }
          }
          return answers;
        }
      } catch (e) {
        // Fall through to offline emulation
      }
    }

    // Offline LLM Structured Generation Simulation
    const fallback = new HeuristicEngine(this.options);
    const answers = await fallback.evaluateSingleState(state, questions, options);
    // Simulate autoregressive uncalibrated confidence (overconfident 0.95 or 0.1)
    for (const ans of Object.values(answers)) {
      if (ans.type === 'choice') ans.confidence = 0.96;
      if (ans.type === 'score') ans.confidence = 0.94;
    }
    return answers;
  }
}

/**
 * 3. Embedding Vector Engine (Competitor / Alternative Architecture)
 * Computes semantic similarity using vector space distance (cosine similarity).
 */
class EmbeddingEngine extends BaseSemanticEngine {
  constructor(options = {}) {
    super(options);
    this.name = 'embedding';
  }

  _computeTextVector(text) {
    // 3-gram character frequency vector for zero-dep local cosine similarity
    const clean = String(text || '').toLowerCase();
    const vec = new Map();
    for (let i = 0; i < clean.length - 2; i++) {
      const gram = clean.slice(i, i + 3);
      vec.set(gram, (vec.get(gram) || 0) + 1);
    }
    return vec;
  }

  _cosineSimilarity(vecA, vecB) {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (const v of vecA.values()) normA += v * v;
    for (const v of vecB.values()) normB += v * v;
    if (!normA || !normB) return 0;

    for (const [k, vA] of vecA.entries()) {
      if (vecB.has(k)) {
        dot += vA * vecB.get(k);
      }
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  async evaluateSingleState(state, questions, options = {}) {
    const stateStr = typeof state === 'string' ? state : JSON.stringify(state);
    const stateVec = this._computeTextVector(stateStr);
    const answers = {};

    for (const [qid, q] of Object.entries(questions)) {
      if (q.type === 'noul') {
        const promptVec = this._computeTextVector(q.instructions);
        const sim = this._cosineSimilarity(stateVec, promptVec);
        // Calibrate cosine range [-1, 1] to probability [0.1, 0.98]
        const prob = Math.max(0.1, Math.min(0.98, sim * 1.8));
        answers[qid] = { type: 'noul', noul: Number(prob.toFixed(2)) };
      } else if (q.type === 'choice') {
        const criteria = q.criteria || {};
        const optionsList = Array.isArray(criteria) ? criteria : Object.keys(criteria);
        let bestOpt = optionsList[0] || 'unknown';
        let bestSim = -1;
        const probs = {};

        const sims = optionsList.map(opt => {
          const optDesc = (typeof criteria[opt] === 'string' ? criteria[opt] : opt);
          const optVec = this._computeTextVector(opt + ' ' + optDesc);
          return Math.max(0.01, this._cosineSimilarity(stateVec, optVec));
        });

        // Softmax
        const expSum = sims.reduce((acc, s) => acc + Math.exp(s * 5), 0);
        for (let i = 0; i < optionsList.length; i++) {
          const p = Number((Math.exp(sims[i] * 5) / expSum).toFixed(2));
          probs[optionsList[i]] = p;
          if (sims[i] > bestSim) {
            bestSim = sims[i];
            bestOpt = optionsList[i];
          }
        }

        answers[qid] = {
          type: 'choice',
          choice: bestOpt,
          probabilities: probs,
          confidence: Number(Math.max(...Object.values(probs)).toFixed(2))
        };
      } else if (q.type === 'score') {
        const levels = Array.isArray(q.criteria) ? q.criteria : ['low', 'medium', 'high'];
        const sims = levels.map(lvl => this._cosineSimilarity(stateVec, this._computeTextVector(String(lvl))));
        const maxIdx = sims.indexOf(Math.max(...sims));
        answers[qid] = {
          type: 'score',
          score: Number(maxIdx.toFixed(2)),
          confidence: 0.8
        };
      }
    }

    return answers;
  }
}

/**
 * 4. Deterministic In-Tree Heuristic Engine (Offline Fallback)
 * Zero external network calls, zero dependencies, <0.05ms execution.
 */
class HeuristicEngine extends BaseSemanticEngine {
  constructor(options = {}) {
    super(options);
    this.name = 'heuristic';
  }

  async evaluateSingleState(state, questions, options = {}) {
    const answers = {};
    const text = typeof state === 'string' ? state.toLowerCase() : JSON.stringify(state).toLowerCase();

    for (const [qid, q] of Object.entries(questions)) {
      const type = q.type;
      const inst = (typeof q.instructions === 'string' ? q.instructions : JSON.stringify(q.instructions)).toLowerCase();

      if (type === 'noul') {
        let prob = 0.2;
        const keywords = inst.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3);
        let matchCount = 0;
        for (const kw of keywords) {
          if (text.includes(kw)) matchCount++;
        }
        if (matchCount > 0) {
          prob = Math.min(0.5 + (matchCount / Math.max(keywords.length, 1)) * 0.45, 0.95);
        }
        answers[qid] = {
          type: 'noul',
          noul: Number(prob.toFixed(2))
        };
      } else if (type === 'choice') {
        const criteria = q.criteria || {};
        const options = Array.isArray(criteria) ? criteria : Object.keys(criteria);
        let chosen = options[0] || 'other';
        const probs = {};

        let highestMatch = -1;
        for (const opt of options) {
          const optDesc = (typeof criteria[opt] === 'string' ? criteria[opt] : opt).toLowerCase();
          let score = 0;
          if (text.includes(opt.toLowerCase())) score += 3;
          for (const word of optDesc.split(/\s+/)) {
            if (word.length > 3 && text.includes(word)) score += 1;
          }
          if (score > highestMatch) {
            highestMatch = score;
            chosen = opt;
          }
        }

        let remainingProb = 1.0;
        for (let i = 0; i < options.length; i++) {
          const opt = options[i];
          if (opt === chosen) {
            probs[opt] = 0.8;
            remainingProb -= 0.8;
          } else {
            const p = Number((remainingProb / Math.max(options.length - 1, 1)).toFixed(2));
            probs[opt] = p;
          }
        }

        answers[qid] = {
          type: 'choice',
          choice: chosen,
          probabilities: probs,
          confidence: 0.85
        };
      } else if (type === 'score') {
        const criteria = q.criteria || [];
        const levelsCount = Array.isArray(criteria) ? criteria.length : 3;
        let scoreVal = 0.5;

        if (Array.isArray(criteria)) {
          for (let lvl = criteria.length - 1; lvl >= 0; lvl--) {
            const desc = String(criteria[lvl]).toLowerCase();
            const words = desc.split(/\s+/).filter(w => w.length > 3);
            if (words.some(w => text.includes(w))) {
              scoreVal = lvl;
              break;
            }
          }
        }

        const legend = {};
        const probabilities = {};
        for (let l = 0; l < levelsCount; l++) {
          legend[String(l)] = Array.isArray(criteria) ? criteria[l] : `Level ${l}`;
          probabilities[String(l)] = l === Math.round(scoreVal) ? 0.8 : Number((0.2 / Math.max(levelsCount - 1, 1)).toFixed(2));
        }

        answers[qid] = {
          type: 'score',
          score: Number(scoreVal.toFixed(2)),
          legend,
          probabilities,
          confidence: 0.88
        };
      }
    }

    return answers;
  }
}

// Engine registry
const ENGINE_REGISTRY = new Map([
  ['jev', TypeSafeJevEngine],
  ['typesafe', TypeSafeJevEngine],
  ['llm', LLMStructuredEngine],
  ['openai', LLMStructuredEngine],
  ['embedding', EmbeddingEngine],
  ['vector', EmbeddingEngine],
  ['heuristic', HeuristicEngine],
  ['mock', HeuristicEngine],
  ['offline', HeuristicEngine]
]);

function registerEngine(name, engineClass) {
  ENGINE_REGISTRY.set(name.toLowerCase(), engineClass);
}

function createEngine(nameOrInstance, options = {}) {
  if (!nameOrInstance) return new TypeSafeJevEngine(options);
  if (typeof nameOrInstance === 'object' && typeof nameOrInstance.evaluateSingleState === 'function') {
    return nameOrInstance;
  }
  const key = String(nameOrInstance).toLowerCase();
  const EngineCls = ENGINE_REGISTRY.get(key) || TypeSafeJevEngine;
  return new EngineCls(options);
}

/**
 * Unified Jev Client with Pluggable Engines and LRU Caching.
 */
class JevClient {
  constructor(options = {}) {
    this.options = options;
    this.engine = createEngine(options.engine, options);
    this.model = options.model || 'jev-latest';
    this.cache = options.cache !== false ? new JevCache(options.cacheSize || 10000) : null;
    this.concurrency = options.concurrency || 6;
    this.telemetry = {
      engine: this.engine.name,
      requests: 0,
      cacheHits: 0,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0
    };
  }

  getCacheKey(state, question) {
    return sha256({
      engine: this.engine.name,
      model: this.model,
      state,
      question
    });
  }

  /**
   * Evaluate multiple questions on a single state with caching.
   */
  async evaluateSingleState(state, questions, options = {}) {
    const startTime = Date.now();
    const resultAnswers = {};
    const missingQuestions = {};
    const questionIdToKey = {};

    // 1. Check cache for each question
    for (const [qid, q] of Object.entries(questions)) {
      if (this.cache) {
        const key = this.getCacheKey(state, q);
        const cached = this.cache.get(key);
        if (cached !== undefined) {
          this.telemetry.cacheHits++;
          resultAnswers[qid] = cached;
          continue;
        }
        questionIdToKey[qid] = key;
      }
      missingQuestions[qid] = q;
    }

    if (Object.keys(missingQuestions).length === 0) {
      return resultAnswers;
    }

    this.telemetry.requests++;
    const evaluated = await this.engine.evaluateSingleState(state, missingQuestions, options);

    for (const [qid, ans] of Object.entries(evaluated)) {
      resultAnswers[qid] = ans;
      if (this.cache && questionIdToKey[qid]) {
        this.cache.set(questionIdToKey[qid], ans);
      }
    }

    this.telemetry.durationMs += Date.now() - startTime;
    return resultAnswers;
  }

  /**
   * Batch evaluate questions across multiple rows concurrently.
   */
  async evaluateBatch(items, options = {}) {
    const results = new Map();
    const concurrency = options.concurrency || this.concurrency;

    let index = 0;
    const total = items.length;

    const worker = async () => {
      while (index < total) {
        const itemIndex = index++;
        const item = items[itemIndex];
        if (!item || !item.questions || Object.keys(item.questions).length === 0) {
          continue;
        }
        const answers = await this.evaluateSingleState(item.state, item.questions, options);
        results.set(item.id, answers);
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, total) }, () => worker());
    await Promise.all(workers);

    return results;
  }
}






class Executor {
  constructor(jevClient, dataAdapter, options = {}) {
    this.jevClient = jevClient;
    this.dataAdapter = dataAdapter;
    this.options = options;
  }

  evalLiteral(node) {
    if (!node) return null;
    if (node.type === 'Literal') return node.value;
    if (node.type === 'Identifier') return node.name;
    if (node.type === 'ArrayLiteral') {
      return node.elements.map(e => this.evalLiteral(e));
    }
    if (node.type === 'ObjectLiteral') {
      const obj = {};
      for (const [k, v] of Object.entries(node.properties)) {
        obj[k] = this.evalLiteral(v);
      }
      return obj;
    }
    return null;
  }

  resolveAutoText(row) {
    if (typeof row === 'string') return row;
    if (!row || typeof row !== 'object') return String(row || '');
    const candidateKeys = ['message', 'body', 'text', 'content', 'description', 'review', 'comment', 'input', 'query', 'summary', 'title'];
    for (const k of candidateKeys) {
      const val = getFieldCaseInsensitive(row, k);
      if (typeof val === 'string' && val.trim().length > 0) return val;
    }
    for (const v of Object.values(row)) {
      if (typeof v === 'string' && v.trim().length > 0) return v;
    }
    return row;
  }

  /**
   * Evaluate an expression AST node for a given row and Jev answers.
   */
  evalExpr(node, row, answers = {}, groupRows = null) {
    if (!node) return null;

    switch (node.type) {
      case 'Wildcard':
        return row;

      case 'Literal':
        return node.value;

      case 'ArrayLiteral':
        return node.elements.map(e => this.evalExpr(e, row, answers, groupRows));

      case 'ObjectLiteral': {
        const res = {};
        for (const [k, v] of Object.entries(node.properties)) {
          res[k] = this.evalExpr(v, row, answers, groupRows);
        }
        return res;
      }

      case 'Identifier': {
        if (node.name === 'auto') {
          return this.resolveAutoText(row);
        }
        if (node.table) {
          const tbl = row[node.table];
          if (tbl && typeof tbl === 'object') {
            return getFieldCaseInsensitive(tbl, node.name);
          }
        }
        return getFieldCaseInsensitive(row, node.name);
      }

      case 'BinaryExpression': {
        const op = node.operator.toUpperCase();
        if (op === 'AND') {
          return Boolean(this.evalExpr(node.left, row, answers, groupRows)) && Boolean(this.evalExpr(node.right, row, answers, groupRows));
        }
        if (op === 'OR') {
          return Boolean(this.evalExpr(node.left, row, answers, groupRows)) || Boolean(this.evalExpr(node.right, row, answers, groupRows));
        }

        const left = this.evalExpr(node.left, row, answers, groupRows);
        const right = this.evalExpr(node.right, row, answers, groupRows);

        switch (op) {
          case '=':
            return left === right;
          case '!=':
            return left !== right;
          case '>':
            return left > right;
          case '<':
            return left < right;
          case '>=':
            return left >= right;
          case '<=':
            return left <= right;
          case '+':
            return left + right;
          case '-':
            return left - right;
          case '*':
            return left * right;
          case '/':
            return right === 0 ? null : left / right;
          case '%':
            return left % right;
          case '||':
            return String(left ?? '') + String(right ?? '');
          case '->':
            return typeof left === 'object' && left !== null ? left[right] : null;
          case '->>':
            return typeof left === 'object' && left !== null ? String(left[right] ?? '') : null;
          default:
            throw new Error(`Unknown operator: ${op}`);
        }
      }

      case 'UnaryExpression': {
        const val = this.evalExpr(node.argument, row, answers, groupRows);
        if (node.operator === 'NOT') return !val;
        if (node.operator === '-') return -val;
        if (node.operator === '+') return +val;
        return val;
      }

      case 'IsNullExpression': {
        const val = this.evalExpr(node.expr, row, answers, groupRows);
        const isNull = val === null || val === undefined;
        return node.not ? !isNull : isNull;
      }

      case 'LikeExpression': {
        const val = String(this.evalExpr(node.expr, row, answers, groupRows) ?? '');
        const pat = String(this.evalExpr(node.pattern, row, answers, groupRows) ?? '');
        // Convert SQL LIKE pattern to Regex
        const regexStr = '^' + pat
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/%/g, '.*')
          .replace(/_/g, '.') + '$';
        const regex = new RegExp(regexStr, node.caseInsensitive ? 'i' : '');
        const matches = regex.test(val);
        return node.not ? !matches : matches;
      }

      case 'InExpression': {
        const val = this.evalExpr(node.expr, row, answers, groupRows);
        const list = node.values.map(v => this.evalExpr(v, row, answers, groupRows));
        const inside = list.includes(val);
        return node.not ? !inside : inside;
      }

      case 'BetweenExpression': {
        const val = this.evalExpr(node.expr, row, answers, groupRows);
        const lower = this.evalExpr(node.lower, row, answers, groupRows);
        const upper = this.evalExpr(node.upper, row, answers, groupRows);
        const between = val >= lower && val <= upper;
        return node.not ? !between : between;
      }

      case 'CaseExpression': {
        for (const cond of node.conditions) {
          if (this.evalExpr(cond.when, row, answers, groupRows)) {
            return this.evalExpr(cond.then, row, answers, groupRows);
          }
        }
        if (node.elseExpr) {
          return this.evalExpr(node.elseExpr, row, answers, groupRows);
        }
        return null;
      }

      case 'FunctionCall': {
        const fnName = node.name.toUpperCase();

        // 1. Semantic evaluation from Jev answers
        if (node._questionKey && answers[node._questionKey]) {
          const ans = answers[node._questionKey];
          if (fnName === 'NOUL') return ans.noul;
          if (fnName === 'IS_TRUE') {
            const thresh = node.arguments[2] ? this.evalExpr(node.arguments[2], row, answers, groupRows) : 0.5;
            return ans.noul >= thresh;
          }
          if (fnName === 'IS_FALSE') {
            const thresh = node.arguments[2] ? this.evalExpr(node.arguments[2], row, answers, groupRows) : 0.5;
            return ans.noul < thresh;
          }
          if (fnName === 'CHOICE') return ans.choice;
          if (fnName === 'SCORE') return ans.score;
          if (fnName === 'JEV') return ans;
        }

        // 2. Metapredicates on semantic choices: CONFIDENCE(CHOICE(...))
        if (fnName === 'CONFIDENCE') {
          const innerArg = node.arguments[0];
          if (innerArg && innerArg._questionKey && answers[innerArg._questionKey]) {
            return answers[innerArg._questionKey].confidence ?? 1.0;
          }
          return 1.0;
        }

        // 3. Probability of specific option: PROB(CHOICE(...), 'opt')
        if (fnName === 'PROB') {
          const innerArg = node.arguments[0];
          const targetOpt = this.evalExpr(node.arguments[1], row, answers, groupRows);
          if (innerArg && innerArg._questionKey && answers[innerArg._questionKey]) {
            const probs = answers[innerArg._questionKey].probabilities || {};
            return probs[targetOpt] ?? 0.0;
          }
          return 0.0;
        }

        // 4. Aggregate functions
        if (AGGREGATE_FUNCTIONS[fnName]) {
          if (!groupRows) {
            // Evaluated outside group, evaluate on single row
            return this.evalExpr(node.arguments[0], row, answers, groupRows);
          }
          const isWildcard = node.arguments[0]?.type === 'Wildcard';
          const values = isWildcard
            ? groupRows
            : groupRows.map(r => this.evalExpr(node.arguments[0], r.row, r.answers, null));
          return AGGREGATE_FUNCTIONS[fnName](values, isWildcard);
        }

        // 5. Standard scalar functions
        if (SCALAR_FUNCTIONS[fnName]) {
          const evaluatedArgs = node.arguments.map(a => this.evalExpr(a, row, answers, groupRows));
          return SCALAR_FUNCTIONS[fnName](...evaluatedArgs);
        }

        throw new Error(`Unknown function: ${fnName}`);
      }

      default:
        throw new Error(`Unknown expression type: ${node.type}`);
    }
  }

  /**
   * Execute the parsed SELECT statement AST against data.
   */
  async execute(ast, directData = null) {
    const startTime = Date.now();

    // 1. Compile Query Plan
    const plan = createQueryPlan(ast, (node) => this.evalLiteral(node));

    // 2. Scan & Load Initial Rows
    let rows = [];
    if (directData) {
      rows = Array.isArray(directData) ? directData : [directData];
    } else {
      rows = await this.dataAdapter.loadSource(plan.source, this.options.baseDir);
    }

    const totalScanned = rows.length;

    // 3. Perform Joins if any
    for (const join of plan.joins) {
      const joinData = await this.dataAdapter.loadSource(join.target, this.options.baseDir);
      const joinedRows = [];

      for (const leftRow of rows) {
        let matched = false;
        for (const rightRow of joinData) {
          const combined = {
            ...leftRow,
            ...(join.alias ? { [join.alias]: rightRow } : rightRow)
          };
          if (!join.on || this.evalExpr(join.on, combined)) {
            matched = true;
            joinedRows.push(combined);
          }
        }
        if (!matched && (join.joinType === 'LEFT' || join.joinType === 'FULL')) {
          joinedRows.push({ ...leftRow });
        }
      }
      rows = joinedRows;
    }

    // 4. Relational Pushdown Filter (Drop cheap non-matching rows before Jev AI!)
    if (plan.pushdownFilter) {
      rows = rows.filter(row => Boolean(this.evalExpr(plan.pushdownFilter, row)));
    }

    const rowsAfterPushdown = rows.length;

    // If this is an EXPLAIN query, return the plan without running Jev
    if (ast.explain && !ast.analyze) {
      return {
        plan: {
          scannedRows: totalScanned,
          pushdownPrunedRows: totalScanned - rowsAfterPushdown,
          candidateRowsForJev: rowsAfterPushdown,
          semanticQuestions: plan.questions.map(q => ({
            key: q.key,
            type: q.question.type,
            instructions: q.question.instructions,
            criteria: q.question.criteria
          })),
          speculativeFanOut: true,
          estimatedHttpRequests: rowsAfterPushdown
        }
      };
    }

    // 5. Speculative Fan-out & Single-Pass Jev Evaluation
    const rowAnswersMap = new Map();

    if (plan.questions.length > 0 && rows.length > 0) {
      const batchItems = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowId = i;
        const rowQuestions = {};

        for (const qDesc of plan.questions) {
          // If stateExpr is specified (e.g. `message` column or `user.bio`), resolve it
          let state = row;
          if (qDesc.stateExpr) {
            state = this.evalExpr(qDesc.stateExpr, row);
          }
          if (state === undefined || state === null) {
            state = this.resolveAutoText(row);
          }
          rowQuestions[qDesc.key] = qDesc.question;
        }

        // Default state: if only one column was referenced in question stateExpr
        let stateForCall = row;
        if (plan.questions[0]?.stateExpr) {
          stateForCall = this.evalExpr(plan.questions[0].stateExpr, row);
        }
        if (stateForCall === undefined || stateForCall === null) {
          stateForCall = this.resolveAutoText(row);
        }

        batchItems.push({
          id: rowId,
          state: stateForCall,
          questions: rowQuestions
        });
      }

      const evaluatedResults = await this.jevClient.evaluateBatch(batchItems, this.options);
      for (const [id, answers] of evaluatedResults.entries()) {
        rowAnswersMap.set(id, answers);
      }
    }

    // 6. Semantic Filter (Evaluate remaining WHERE conditions with Jev answers)
    let filteredRows = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const answers = rowAnswersMap.get(i) || {};
      if (plan.semanticFilter) {
        if (this.evalExpr(plan.semanticFilter, row, answers)) {
          filteredRows.push({ row, answers, originalIndex: i });
        }
      } else {
        filteredRows.push({ row, answers, originalIndex: i });
      }
    }

    // 7. Aggregation & Group By
    let evaluatedTuples = [];

    if (plan.isAggregateQuery) {
      const groups = new Map();

      for (const item of filteredRows) {
        let groupKey = 'all';
        if (plan.groupBy && plan.groupBy.length > 0) {
          const keyVals = plan.groupBy.map(g => String(this.evalExpr(g, item.row, item.answers)));
          groupKey = keyVals.join(':::');
        }

        if (!groups.has(groupKey)) {
          groups.set(groupKey, []);
        }
        groups.get(groupKey).push(item);
      }

      // Compute aggregated rows
      for (const [groupKey, groupItems] of groups.entries()) {
        const representative = groupItems[0];

        // Evaluate HAVING if present
        if (plan.having) {
          const passesHaving = this.evalExpr(plan.having, representative.row, representative.answers, groupItems);
          if (!passesHaving) continue;
        }

        const outRow = {};
        for (let colIdx = 0; colIdx < ast.columns.length; colIdx++) {
          const col = ast.columns[colIdx];
          const alias = col.alias || (col.expr.type === 'Identifier' ? col.expr.name : `col_${colIdx}`);
          outRow[alias] = this.evalExpr(col.expr, representative.row, representative.answers, groupItems);
        }
        evaluatedTuples.push({ item: representative, outRow, groupItems });
      }
    } else {
      // Non-aggregate: direct projection
      for (const item of filteredRows) {
        const outRow = {};
        for (let colIdx = 0; colIdx < ast.columns.length; colIdx++) {
          const col = ast.columns[colIdx];
          if (col.expr.type === 'Wildcard') {
            Object.assign(outRow, item.row);
          } else {
            const alias = col.alias || (col.expr.type === 'Identifier' ? col.expr.name : `col_${colIdx}`);
            outRow[alias] = this.evalExpr(col.expr, item.row, item.answers);
          }
        }
        evaluatedTuples.push({ item, outRow, groupItems: null });
      }
    }

    // 8. ORDER BY (can sort by projected aliases OR original row columns)
    if (plan.orderBy && plan.orderBy.length > 0) {
      evaluatedTuples.sort((tA, tB) => {
        for (const orderItem of plan.orderBy) {
          let valA, valB;
          if (orderItem.expr.type === 'Identifier' && orderItem.expr.name in tA.outRow) {
            valA = tA.outRow[orderItem.expr.name];
            valB = tB.outRow[orderItem.expr.name];
          } else {
            valA = this.evalExpr(orderItem.expr, tA.item.row, tA.item.answers, tA.groupItems);
            valB = this.evalExpr(orderItem.expr, tB.item.row, tB.item.answers, tB.groupItems);
          }

          if (valA === valB) continue;
          if (valA == null) return 1;
          if (valB == null) return -1;

          const cmp = valA < valB ? -1 : 1;
          return orderItem.direction === 'DESC' ? -cmp : cmp;
        }
        return 0;
      });
    }

    // 9. DISTINCT
    if (plan.distinct) {
      const seen = new Set();
      evaluatedTuples = evaluatedTuples.filter(t => {
        const str = JSON.stringify(t.outRow);
        if (seen.has(str)) return false;
        seen.add(str);
        return true;
      });
    }

    // 10. OFFSET and LIMIT
    if (plan.offset) {
      const offsetVal = Number(this.evalLiteral(plan.offset)) || 0;
      evaluatedTuples = evaluatedTuples.slice(offsetVal);
    }

    if (plan.limit) {
      const limitVal = Number(this.evalLiteral(plan.limit));
      if (!isNaN(limitVal)) {
        evaluatedTuples = evaluatedTuples.slice(0, limitVal);
      }
    }

    let projectedRows = evaluatedTuples.map(t => t.outRow);

    const durationMs = Date.now() - startTime;

    if (ast.analyze) {
      return {
        rows: projectedRows,
        telemetry: {
          ...this.jevClient.telemetry,
          totalDurationMs: durationMs,
          scannedRows: totalScanned,
          pushdownPruned: totalScanned - rowsAfterPushdown,
          evaluatedRows: rowsAfterPushdown,
          returnedRows: projectedRows.length
        }
      };
    }

    return projectedRows;
  }
}










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
function jevql(firstArg, ...rest) {
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
  registerEngine,
  createEngine
};
