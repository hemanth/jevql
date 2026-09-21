export interface JevQLOptions {
  engine?: 'jev' | 'typesafe' | 'webml' | 'webml-kit' | 'openjev' | 'llm' | 'openai' | 'embedding' | 'vector' | 'heuristic' | (string & {});
  apiKey?: string;
  apiUrl?: string;
  model?: string;
  mode?: 'auto' | 'wllama' | 'heuristic';
  decisionEngine?: any;
  concurrency?: number;
  cache?: boolean;
  cacheSize?: number;
  baseDir?: string;
  retries?: number;
  wllama?: any;
  onProgress?: (progress: any) => void;
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

export abstract class BaseSemanticEngine {
  options: any;
  name: string;
  constructor(options?: any);
  abstract evaluateSingleState(state: any, questions: Record<string, any>, options?: any): Promise<Record<string, any>>;
}

export class TypeSafeJevEngine extends BaseSemanticEngine {}
export class LLMStructuredEngine extends BaseSemanticEngine {}
export class EmbeddingEngine extends BaseSemanticEngine {}
export class HeuristicEngine extends BaseSemanticEngine {}
export class WebMLKitEngine extends BaseSemanticEngine {
  model: string;
  mode: string;
  decisionEngine: any;
}

export function registerEngine(name: string, engineClass: new (options?: any) => BaseSemanticEngine): void;
export function createEngine(nameOrInstance: string | BaseSemanticEngine, options?: any): BaseSemanticEngine;

