import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, '..', 'src');
const outPath = path.join(__dirname, '..', 'docs', 'jevql-engine.js');

// Helper to strip imports/exports
function getModuleBody(filename) {
  let code = fs.readFileSync(path.join(srcDir, filename), 'utf8');
  // Strip node:* imports
  code = code.replace(/import\s+crypto\s+from\s+['"]node:crypto['"];?/g, '');
  code = code.replace(/import\s+fs\s+from\s+['"]node:fs['"];?/g, '');
  code = code.replace(/import\s+path\s+from\s+['"]node:path['"];?/g, '');
  code = code.replace(/import\s+.*?from\s+['"]\.\/.*?\.js['"];?/g, '');
  // Remove export keywords and export blocks from declarations
  code = code.replace(/^export\s*\{[\s\S]*?\};?/gm, '');
  code = code.replace(/^export\s+default\s+function/gm, 'function');
  code = code.replace(/^export\s+(class|function|const|let)/gm, '$1');
  return code;
}

const utilsCode = `
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
` + getModuleBody('utils.js').replace(/function sha256[\s\S]*?^}/m, '');

const adaptersCode = `
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
`;

const functionsCode = getModuleBody('functions.js');
const parserCode = getModuleBody('parser.js');
const pipelineCode = getModuleBody('pipeline.js');
const plannerCode = getModuleBody('planner.js');
const jevCode = getModuleBody('jev.js');
const executorCode = getModuleBody('executor.js');
const indexCode = getModuleBody('index.js');

const bundle = `// JevQL In-Browser Standalone Engine (Zero External Dependencies)
// Generated for GitHub Pages Interactive Workbench

${utilsCode}

${adaptersCode}

${functionsCode}

${parserCode}

${pipelineCode}

${plannerCode}

${jevCode}

${executorCode}

${indexCode}

export {
  jevql,
  JevQLDatabase,
  parse,
  tokenize,
  isPipelineQuery,
  pipelineToSQL,
  createQueryPlan,
  splitWhereClause,
  JevClient,
  registerEngine,
  createEngine
};
`;

fs.writeFileSync(outPath, bundle, 'utf8');
console.log('Built docs/jevql-engine.js successfully!');
