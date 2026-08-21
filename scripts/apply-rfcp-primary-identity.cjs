'use strict';

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const file = path.join(root, 'index.html');
let html = fs.readFileSync(file, 'utf8');

const PRIMARY = 'https://federalcontractorportal.aproposgroupllc.com/';

// The public product is the Registered Federal Contractors Portal. NGCC and
// National Government Contract Center remain historical/alias names only.
html = html.replaceAll('https://ngcc.aproposgroupllc.com/', PRIMARY);
html = html.replaceAll('"alternateName":"Registered Federal Contractors Portal"', '"alternateName":["National Government Contract Center","NGCC"]');
html = html.replaceAll('"alternateName":"NGCC"', '"alternateName":["National Government Contract Center","NGCC"]');

fs.writeFileSync(file, html, 'utf8');
console.log('[rfcp-primary-identity] Applied primary portal identity and NGCC aliases.');
