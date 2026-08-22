'use strict';

const fs = require('fs');

const failures = [];
for (const file of ['index.html','onboarding.html','dashboard.html','profile-review.html','analyze-fit.html','state-contract.html','federal-contract.html','operator-login.html','ops-command-center-v3.html','ops-command-center-v5.html']) {
  const source = fs.readFileSync(file, 'utf8');
  if (/National Government Contract Center|NAT-CORP|\bCapGen\b|\bNGCC\b/.test(source)) failures.push(`${file}: retired customer-facing identity remains`);
}
const netlify = fs.readFileSync('netlify.toml', 'utf8');
if (!/Content-Security-Policy-Report-Only/.test(netlify)) failures.push('netlify.toml: CSP validation policy missing');
if (!/rfcpOperatorAuth/.test(fs.readFileSync('netlify/edge-functions/rfcp-operator-auth.js', 'utf8'))) failures.push('operator edge authorization missing');
if (failures.length) {
  failures.forEach(failure => console.error(failure));
  process.exit(1);
}
console.log('[lint-rfcp] PASS — active identity, CSP, and operator authorization checks passed');
