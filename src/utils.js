import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Compute stable SHA-256 hash for cache keys.
 */
export function sha256(content) {
  const str = typeof content === 'string' ? content : JSON.stringify(content);
  return crypto.createHash('sha256').update(str).digest('hex');
}

/**
 * Deep get a property from an object using dot notation or array indexing.
 * e.g. getProp(row, "user.name") or getProp(row, "tags[0]")
 */
export function getProp(obj, pathStr) {
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
export function getFieldCaseInsensitive(row, fieldName) {
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
export function formatTable(rows, options = {}) {
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
export function formatCSV(rows) {
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
export function parseCSV(content) {
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
