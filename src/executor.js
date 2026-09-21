import { SCALAR_FUNCTIONS, AGGREGATE_FUNCTIONS } from './functions.js';
import { createQueryPlan } from './planner.js';
import { getFieldCaseInsensitive, getProp } from './utils.js';

export class Executor {
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
          if (fnName === 'NOUL' || fnName === 'SEMANTIC') return ans.noul;
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
      rows = rows.filter(row => {
        const res = this.evalExpr(plan.pushdownFilter, row);
        return typeof res === 'number' ? res >= 0.5 : Boolean(res);
      });
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
        const cond = this.evalExpr(plan.semanticFilter, row, answers);
        const passed = typeof cond === 'number' ? cond >= 0.5 : Boolean(cond);
        if (passed) {
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
