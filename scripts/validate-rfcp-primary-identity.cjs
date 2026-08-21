'use strict';

const fs = require('fs');

const html = fs.readFileSync('index.html', 'utf8');
const robots = fs.readFileSync('robots.txt', 'utf8');
const sitemap = fs.readFileSync('sitemap.xml', 'utf8');
const netlify = fs.readFileSync('netlify.toml', 'utf8');

const primary = 'https://federalcontractorportal.aproposgroupllc.com/';
const orgId = `${primary}#organization`;
const legacyHostPattern = /https?:\/\/ngcc\.aproposgroupllc\.com\//i;
const failures = [];

if (!html.includes(`<link rel="canonical" href="${primary}">`)) failures.push('homepage canonical is not the primary portal domain');
if (!html.includes(`<meta property="og:type" content="website">`)) failures.push('Open Graph type is not website');
if (!html.includes(`<meta property="og:site_name" content="Registered Federal Contractors Portal">`)) failures.push('Open Graph site name is incorrect');
if (!html.includes(`<meta property="og:url" content="${primary}">`)) failures.push('Open Graph URL is not the primary portal domain');
if (!html.includes(`<meta property="og:image" content="${primary}og-ngcc.jpg">`)) failures.push('Open Graph image is not on the primary portal domain');
if (!html.includes('<div class="lsub">Federal Procurement Intelligence</div>')) failures.push('public portal sub-label is not remediated');
if (legacyHostPattern.test(html)) failures.push('legacy hostname remains in homepage output');
if (html.includes('"alternateName"')) failures.push('legacy/alternate structured-data name remains');

const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
if (!match) {
  failures.push('homepage JSON-LD is missing');
} else {
  try {
    const data = JSON.parse(match[1]);
    const graph = Array.isArray(data?.['@graph']) ? data['@graph'] : [];
    const byType = type => graph.find(node => node?.['@type'] === type);
    const org = byType('Organization');
    const website = byType('WebSite');
    const service = byType('Service');
    const faq = byType('FAQPage');

    if (!org || org['@id'] !== orgId || org.name !== 'Registered Federal Contractors Portal' || org.url !== primary) failures.push('Organization schema identity is incorrect');
    if (org?.parentOrganization?.['@type'] !== 'Corporation' || org?.parentOrganization?.name !== 'APROPOS Group LLC' || org?.parentOrganization?.url !== 'https://aproposgroupllc.com/') failures.push('parentOrganization schema is incorrect');
    const sameAs = org?.sameAs || [];
    for (const url of ['https://aproposgroupllc.com/','https://natcorp.aproposgroupllc.com/','https://nebc.aproposgroupllc.com/','https://marketplace.aproposgroupllc.com/','https://github.com/Aproposchpt2']) {
      if (!sameAs.includes(url)) failures.push(`Organization sameAs is missing ${url}`);
    }
    if (org?.contactPoint?.['@type'] !== 'ContactPoint' || org?.contactPoint?.contactType !== 'Customer Support' || org?.contactPoint?.email !== 'jmitchell@aiflowdeskpro.com') failures.push('Organization contactPoint is incorrect');
    if (!website || website['@id'] !== `${primary}#website` || website.url !== primary || website.name !== 'Registered Federal Contractors Portal' || website?.publisher?.['@id'] !== orgId || website.inLanguage !== 'en-US') failures.push('WebSite schema is incorrect');
    if (!service || service['@id'] !== `${primary}#service` || service.url !== primary || service?.provider?.['@id'] !== orgId) failures.push('Service schema primary URLs are incorrect');
    if (service?.offers && !Array.isArray(service.offers) && service.offers.url !== primary) failures.push('Service Offer URL is not on the primary domain');
    if (!faq || faq['@id'] !== `${primary}#faq` || !Array.isArray(faq.mainEntity) || faq.mainEntity.length !== 4) failures.push('FAQPage schema does not contain the four required questions');
    const requiredQuestions = [
      'Who does the Registered Federal Contractors Portal serve?',
      'What does the Registered Federal Contractors Portal cost?',
      'What does an additional Analyze Fit Report cost?',
      'Is the Registered Federal Contractors Portal a government agency or part of SAM.gov?',
    ];
    for (const question of requiredQuestions) {
      const item = faq?.mainEntity?.find(node => node?.name === question);
      if (!item?.acceptedAnswer?.text) failures.push(`FAQ schema is missing an answer for: ${question}`);
    }
  } catch (error) {
    failures.push(`homepage JSON-LD is invalid: ${error.message}`);
  }
}

for (const href of ['https://aproposgroupllc.com/','https://nebc.aproposgroupllc.com/','https://natcorp.aproposgroupllc.com/','https://marketplace.aproposgroupllc.com/']) {
  if (!html.includes(`href="${href}"`)) failures.push(`footer entity link is missing ${href}`);
}
if (!robots.includes(`Sitemap: ${primary}sitemap.xml`)) failures.push('robots.txt sitemap is not on the primary portal domain');
if (!sitemap.includes(`<loc>${primary}</loc>`)) failures.push('sitemap root URL is not the primary portal domain');
if (legacyHostPattern.test(netlify)) failures.push('legacy hostname remains in Netlify configuration');

if (failures.length) {
  console.error('[rfcp-primary-identity] Validation failed:');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[rfcp-primary-identity] PASS — primary domain, Organization/WebSite/Service/FAQ schema, Open Graph, and APROPOS entity links are consistent.');
