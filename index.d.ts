export interface JevQLOptions {
  apiKey?: string;
  apiUrl?: string;
  model?: string;
  concurrency?: number;
  cache?: boolean;
  cacheSize?: number;
  baseDir?: string;
  retries?: number;
}

export interface Telemetry {
  requests: number;
  cacheHits: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  totalDurationMs?: number;
  scannedRows?: number;
  pushdownPruned?: number;
  evaluatedRows?: number;
  returnedRows?: number;
}

export interface QueryPlan {
  scannedRows: number;
  pushdownPrunedRows: number;
  candidateRowsForJev: number;
  semanticQuestions: Array<{
    key: string;
    type: 'noul' | 'choice' | 'score';
    instructions: string;
    criteria?: any;
  }>;
  speculativeFanOut: boolean;
  estimatedHttpRequests: number;
}

export class JevQLDatabase {
  constructor(initialData?: any, options?: JevQLOptions);
  register(name: string, data: any[]): this;
  query<T = Record<string, any>>(sql: string, data?: any): Promise<T[]>;
  explain(sql: string, data?: any): Promise<{ plan: QueryPlan }>;
  analyze<T = Record<string, any>>(sql: string, data?: any): Promise<{ rows: T[]; telemetry: Telemetry }>;
  table(rows: any[], options?: { columns?: string[]; maxWidth?: number }): string;
}

export function jevql<T = Record<string, any>>(sql: string, data: any[], options?: JevQLOptions): Promise<T[]>;
export function jevql<T = Record<string, any>>(sql: string, options?: JevQLOptions): Promise<T[]>;
export function jevql(data: any[] | Record<string, any[]>, options?: JevQLOptions): JevQLDatabase;

export default jevql;

export function parse(sql: string): any;
export function formatTable(rows: any[], options?: { columns?: string[]; maxWidth?: number }): string;
export function formatCSV(rows: any[]): string;
export function parseCSV(content: string): Record<string, any>[];
