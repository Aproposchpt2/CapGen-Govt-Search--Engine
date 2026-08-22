'use strict';

const fs = require('fs');

function edit(file, transform) {
  const before = fs.readFileSync(file, 'utf8');
  const after = transform(before);
  if (after !== before) fs.writeFileSync(file, after, 'utf8');
}

// Generated customer and operator HTML must use the current RFCP identity.
for (const file of fs.readdirSync('.').filter(name => name.endsWith('.html'))) {
  edit(file, source => source
    .replaceAll('National Government Contract Center', 'Registered Federal Contractors Portal')
    .replaceAll('NATIONAL GOVERNMENT CONTRACT CENTER', 'REGISTERED FEDERAL CONTRACTORS PORTAL')
    .replaceAll('NGCC Executive Procurement Command Center', 'RFCP Executive Procurement Command Center')
    .replaceAll('NGCC · Capability-Matched Contract Dashboard', 'RFCP · Unified Contract Dashboard')
    .replaceAll('NGCC is matching', 'RFCP is matching')
    .replaceAll("From NGCC's own acquired state contract inventory", "From RFCP's acquired State/local contract inventory")
    .replaceAll('NGCC searched', 'RFCP searched')
    .replaceAll('Business profile available to NGCC', 'Business profile available to RFCP')
    .replaceAll('CapGen Intelligent Pro Scanner', 'RFCP Opportunity Discovery')
    .replaceAll('CapGen helps', 'RFCP helps')
    .replaceAll('CapGen', 'RFCP')
    .replaceAll('NAT-CORP', 'RFCP State/local inventory')
    .replaceAll('NGCC', 'RFCP')
    .replaceAll('Your NAICS codes drive live federal matching (official public records) and your state contract matches (official government records), from one profile.', 'Authoritatively verified SAM NAICS drive Federal discovery. Website-supported capabilities and procurement terms drive State/local discovery; SAM NAICS does not contribute to those State/local matches.')
    .replaceAll('These codes drive both your federal and state contract matches, sourced from official public records.', 'After authoritative verification, these codes can support Federal discovery only. State/local discovery uses capability evidence and procurement terms instead.'));
}

edit('index.html', source => {
  let html = source
    .replaceAll('Licensed contractors seeking applicable state and local opportunities are served through NAT-CORP.', 'RFCP presents Federal and State/local opportunities in one unified registered-contractor experience.')
    .replaceAll('NAT-CORP remains the dedicated state and local contract-intelligence product for licensed contractors.', 'State/local inventory is presented inside RFCP; it is not a separate contractor product or destination.');
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
  if (match) {
    const data = JSON.parse(match[1]);
    const graph = data['@graph'] || [];
    const organization = graph.find(node => node['@type'] === 'Organization');
    if (organization) organization.sameAs = ['https://aproposgroupllc.com/', 'https://github.com/Aproposchpt2'];
    const service = graph.find(node => node['@type'] === 'Service');
    if (service) {
      service.name = 'Unified Federal and State/local Opportunity Discovery for Registered Contractors';
      service.serviceType = 'Federal SAM-derived NAICS matching and State/local business-capability matching';
    }
    const faq = graph.find(node => node['@type'] === 'FAQPage');
    const who = faq?.mainEntity?.find(item => item.name === 'Who does the Registered Federal Contractors Portal serve?');
    if (who) who.acceptedAnswer.text = 'RFCP serves registered contractors with Federal and State/local opportunity discovery in one unified experience.';
    html = html.replace(match[0], `<script type="application/ld+json">${JSON.stringify(data)}</script>`);
  }
  return html.replace(/<div class="entity-links"[\s\S]*?<\/div>/, '<div class="entity-links" aria-label="Operator"><a href="https://aproposgroupllc.com/">APROPOS Group LLC</a></div>');
});

edit('netlify/functions/ngcc-ops-outreach.js', source => source
  .replaceAll('NGCC opportunity outreach sent.', 'RFCP opportunity outreach sent.')
  .replaceAll('NGCC outreach sent:', 'RFCP outreach sent:'));
edit('netlify/functions/ngcc-ops-auth.js', source => source.replaceAll('NGCC operator authentication is not configured.', 'RFCP operator authentication is not configured.'));
edit('netlify/functions/ngcc-proposal-agent.js', source => source
  .replaceAll('Registered Federal Contractors Portal (NGCC) dashboard', 'Registered Federal Contractors Portal (RFCP) dashboard')
  .replaceAll('CapGen', 'RFCP'));

// Log labels and current explanatory comments use RFCP. Runtime filenames,
// endpoints, table names, environment variables, and persisted keys remain
// documented technical aliases.
for (const file of fs.readdirSync('netlify/functions').filter(name => /\.(?:js|mjs)$/.test(name))) {
  edit(`netlify/functions/${file}`, source => source
    .replaceAll('[ngcc-', '[rfcp-')
    .replaceAll('// NGCC ', '// RFCP ')
    .replaceAll('// NGCC —', '// RFCP —')
    .replaceAll('NGCC operational database', 'RFCP operational database')
    .replaceAll('NGCC procurement mission', 'RFCP procurement mission')
    .replaceAll("CapGen's federal", "RFCP's Federal")
    .replaceAll('CapGen/NGCC commercial sites', 'retired commercial sites'));
}
edit('analyze-fit.html', source => source.replace(
  "body:JSON.stringify({opportunityId:noticeId,view_token:token||undefined,beta_token:betaToken||undefined,opportunity:opp})",
  "body:JSON.stringify({opportunityId:noticeId,inventorySource,view_token:token||undefined,beta_token:betaToken||undefined})",
));

console.log('[rfcp-var-001] Applied unified identity, matching-truth, and current-route asset remediation.');
