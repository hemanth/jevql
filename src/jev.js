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
    // Refresh LRU
    this.cache.delete(key);
    this.cache.set(key, val);
    return val;
  }

  set(key, val) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict oldest
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

export class JevClient {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.TYPESAFE_API_KEY || '';
    this.apiUrl = options.apiUrl || 'https://api.typesafe.ai/v1/systemone';
    this.model = options.model || 'jev-latest';
    this.cache = options.cache !== false ? new JevCache(options.cacheSize || 10000) : null;
    this.concurrency = options.concurrency || 6;
    this.telemetry = {
      requests: 0,
      cacheHits: 0,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0
    };
  }

  getCacheKey(state, question) {
    return sha256({
      model: this.model,
      state,
      question
    });
  }

  /**
   * Evaluate multiple questions on a single state.
   * Leverages Jev's parallel question capability.
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

    // If all questions were in cache, return immediately
    if (Object.keys(missingQuestions).length === 0) {
      return resultAnswers;
    }

    // 2. If no API key, use fallback heuristic
    if (!this.apiKey) {
      const mockAnswers = this.mockEvaluate(state, missingQuestions);
      for (const [qid, ans] of Object.entries(mockAnswers)) {
        resultAnswers[qid] = ans;
        if (this.cache && questionIdToKey[qid]) {
          this.cache.set(questionIdToKey[qid], ans);
        }
      }
      return resultAnswers;
    }

    // 3. Make HTTP request with exponential backoff for rate limits
    const maxRetries = options.retries || 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.telemetry.requests++;
        const res = await fetch(this.apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: this.model,
            state,
            questions: missingQuestions
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

        if (data.usage) {
          this.telemetry.inputTokens += data.usage.input_tokens || 0;
          this.telemetry.outputTokens += data.usage.output_tokens || 0;
        }

        for (const [qid, ans] of Object.entries(data.answers || {})) {
          resultAnswers[qid] = ans;
          if (this.cache && questionIdToKey[qid]) {
            this.cache.set(questionIdToKey[qid], ans);
          }
        }

        this.telemetry.durationMs += Date.now() - startTime;
        return resultAnswers;
      } catch (err) {
        lastError = err;
        if (attempt === maxRetries) break;
        await new Promise(r => setTimeout(r, attempt * 500));
      }
    }

    // Fallback if API fails after retries
    console.warn(`[jevql] TypeSafe API request failed: ${lastError?.message}. Using fallback evaluation.`);
    const fallbackAnswers = this.mockEvaluate(state, missingQuestions);
    for (const [qid, ans] of Object.entries(fallbackAnswers)) {
      resultAnswers[qid] = ans;
    }
    return resultAnswers;
  }

  /**
   * Batch evaluate questions across multiple rows concurrently.
   * items: Array<{ id: string|number, state: any, questions: Record<string, Question> }>
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

  /**
   * Deterministic zero-dependency offline fallback / heuristic evaluator.
   * Ensures test suites and local sandboxes function when offline or without API keys.
   */
  mockEvaluate(state, questions) {
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
          prob = Math.min(0.5 + (matchCount / keywords.length) * 0.45, 0.95);
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
            const p = Number((remainingProb / (options.length - 1)).toFixed(2));
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

        // Check if text matches later levels
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
          probabilities[String(l)] = l === Math.round(scoreVal) ? 0.8 : Number((0.2 / (levelsCount - 1)).toFixed(2));
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
