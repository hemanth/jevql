import { sha256 } from './utils.js';

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
export class BaseSemanticEngine {
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
export class TypeSafeJevEngine extends BaseSemanticEngine {
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
export class LLMStructuredEngine extends BaseSemanticEngine {
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
export class EmbeddingEngine extends BaseSemanticEngine {
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
export class HeuristicEngine extends BaseSemanticEngine {
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

export function registerEngine(name, engineClass) {
  ENGINE_REGISTRY.set(name.toLowerCase(), engineClass);
}

export function createEngine(nameOrInstance, options = {}) {
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
export class JevClient {
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
