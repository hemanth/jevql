/**
 * JevQL Standard & Semantic Functions
 */

export const SCALAR_FUNCTIONS = {
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

export const AGGREGATE_FUNCTIONS = {
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

export const SEMANTIC_FUNCTION_NAMES = new Set([
  'NOUL', 'CHOICE', 'SCORE', 'CONFIDENCE', 'PROB', 'IS_TRUE', 'IS_FALSE', 'JEV'
]);

export function isSemanticFunction(name) {
  return SEMANTIC_FUNCTION_NAMES.has(String(name).toUpperCase());
}
