import jevql from '../index.js';

const tickets = [
  { id: 'T-1', customer: 'Acme', text: '500 error when clicking checkout button' },
  { id: 'T-2', customer: 'Stripe', text: 'Can we get an updated tax invoice for 2025?' }
];

const results = await jevql(`
  SELECT
    customer,
    CHOICE(text, 'Department', ['billing', 'engineering', 'sales']) AS team,
    NOUL(text, 'Urgent outage?') AS is_urgent
  FROM data
`, tickets);

console.log(results);
