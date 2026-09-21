import { isSemanticFunction } from './functions.js';
import { sha256 } from './utils.js';

/**
 * Traverses an expression AST to find all semantic function calls (NOUL, CHOICE, SCORE).
 */
export function extractSemanticNodes(exprNode, results = []) {
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
export function containsSemanticCalls(exprNode) {
  const list = extractSemanticNodes(exprNode);
  return list.length > 0;
}

/**
 * Splits a WHERE clause conjuncts (top-level ANDs) into deterministic vs semantic.
 */
export function splitWhereClause(whereNode) {
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

export function defaultEvalLiteral(node) {
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
export function buildQuestionDescriptor(fnNode, evalLiteralFn = defaultEvalLiteral) {
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
export function createQueryPlan(ast, evalLiteralFn = defaultEvalLiteral) {
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
