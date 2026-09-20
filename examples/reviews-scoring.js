import jevql, { formatTable } from '../index.js';

const reviews = [
  { id: 101, product: 'Mechanical Keyboard', review: 'Keycaps feel cheap and spacebar rattles constantly. Returning it.' },
  { id: 102, product: 'Noise Cancelling Headphones', review: 'Soundstage is incredible and ANC blocks out subway commute easily. Love it!' },
  { id: 103, product: 'Ergonomic Mouse', review: 'Decent battery life but thumb grip feels slightly slippery after long hours.' },
  { id: 104, product: '4K Monitor', review: 'DEAD PIXELS right out of the box! Customer support refused to issue a replacement!' }
];

console.log('=== Running JevQL Review Sentiment Scoring & Confidence Gating ===\n');

const sql = `
SELECT
  id,
  product,
  SCORE(review, 'Sentiment', ['negative', 'neutral', 'positive']) AS sentiment,
  CHOICE(review, 'Action recommendation', ['escalate_support', 'investigate_qa', 'promote_testimonial']) AS action,
  CONFIDENCE(CHOICE(review, 'Action recommendation', ['escalate_support', 'investigate_qa', 'promote_testimonial'])) AS action_conf
FROM data
ORDER BY sentiment ASC
`;

const rows = await jevql(sql, reviews);
console.log(formatTable(rows));
