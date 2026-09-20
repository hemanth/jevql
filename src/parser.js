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

export class Token {
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

export function tokenize(sql) {
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

export class Parser {
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

export function parse(sql) {
  const parser = new Parser(sql);
  return parser.parse();
}
