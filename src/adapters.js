import fs from 'node:fs';
import path from 'node:path';
import { parseCSV } from './utils.js';

export class DataAdapter {
  constructor(sources = {}) {
    this.sources = sources; // e.g. { tickets: [...], users: [...] }
  }

  registerTable(name, data) {
    this.sources[name.toLowerCase()] = data;
  }

  async loadSource(sourceNode, baseDir = (typeof process !== 'undefined' && process.cwd ? process.cwd() : '')) {
    if (!sourceNode) {
      // Default dummy table if no FROM clause
      return [{ dummy: 1 }];
    }

    // 1. File source: FROM 'path/to/file.csv' or 'data.json'
    if (sourceNode.type === 'FileSource') {
      const filePath = path.isAbsolute(sourceNode.path)
        ? sourceNode.path
        : path.resolve(baseDir, sourceNode.path);

      if (!fs.existsSync(filePath)) {
        throw new Error(`Data source file not found: ${filePath}`);
      }

      const ext = path.extname(filePath).toLowerCase();
      const content = fs.readFileSync(filePath, 'utf8');

      if (ext === '.json') {
        const parsed = JSON.parse(content);
        return Array.isArray(parsed) ? parsed : [parsed];
      } else if (ext === '.jsonl' || ext === '.ndjson') {
        return content
          .split(/\r?\n/)
          .filter(l => l.trim().length > 0)
          .map(l => JSON.parse(l));
      } else if (ext === '.csv') {
        return parseCSV(content);
      } else {
        // Fallback: try parsing JSON first, then CSV
        try {
          const parsed = JSON.parse(content);
          return Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          return parseCSV(content);
        }
      }
    }

    // 2. Named table source: FROM tickets
    if (sourceNode.type === 'TableSource') {
      const tableName = sourceNode.name.toLowerCase();

      // Check registered in-memory tables
      if (tableName in this.sources) {
        const data = this.sources[tableName];
        return Array.isArray(data) ? data : [data];
      }

      // Check if there is a local file with this name (e.g. FROM tickets looks for tickets.json or tickets.csv)
      for (const ext of ['.json', '.jsonl', '.csv']) {
        const candidate = path.resolve(baseDir, sourceNode.name + ext);
        if (fs.existsSync(candidate)) {
          return this.loadSource({ type: 'FileSource', path: candidate }, baseDir);
        }
      }

      // Fallback: If in-memory data was provided (e.g. 'data' or single source), use it
      const sourceKeys = Object.keys(this.sources);
      if (sourceKeys.length === 1) {
        const data = this.sources[sourceKeys[0]];
        return Array.isArray(data) ? data : [data];
      }
      if (this.sources['data']) {
        const data = this.sources['data'];
        return Array.isArray(data) ? data : [data];
      }

      throw new Error(`Table or source not found: '${sourceNode.name}'`);
    }

    // 3. Function source: FROM csv('path') or FROM postgres('...')
    if (sourceNode.type === 'FunctionSource') {
      const fnName = sourceNode.name.toLowerCase();
      if (fnName === 'csv') {
        const p = sourceNode.arguments[0]?.value;
        return this.loadSource({ type: 'FileSource', path: p }, baseDir);
      }
      if (fnName === 'json') {
        const p = sourceNode.arguments[0]?.value;
        return this.loadSource({ type: 'FileSource', path: p }, baseDir);
      }
      if (fnName === 'postgres') {
        // Postgres connection handled by PostgresAdapter
        return this.loadPostgresSource(sourceNode);
      }
    }

    // 4. Chained source: FROM postgres('...').tickets
    if (sourceNode.type === 'ChainedSource') {
      return this.loadPostgresSource(sourceNode);
    }

    throw new Error(`Unsupported source type: ${sourceNode.type}`);
  }

  async loadPostgresSource(sourceNode) {
    // Dynamic import of pg to keep zero hard dependencies
    let pg;
    try {
      pg = await import('pg');
    } catch {
      throw new Error("PostgreSQL adapter requires the 'pg' package. Install it via: npm install pg");
    }

    let connStr = '';
    let table = '';

    if (sourceNode.type === 'ChainedSource') {
      connStr = sourceNode.base.arguments[0]?.value;
      table = sourceNode.property;
    } else if (sourceNode.type === 'FunctionSource') {
      connStr = sourceNode.arguments[0]?.value;
      table = sourceNode.arguments[1]?.value;
    }

    const { Client } = pg.default || pg;
    const client = new Client({ connectionString: connStr });
    await client.connect();
    try {
      const res = await client.query(`SELECT * FROM ${table}`);
      return res.rows;
    } finally {
      await client.end();
    }
  }
}
