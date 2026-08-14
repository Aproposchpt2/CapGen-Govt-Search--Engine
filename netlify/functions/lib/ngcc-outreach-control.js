'use strict';

function selectApprovedOutreachContacts(contacts = []) {
  return (Array.isArray(contacts) ? contacts : []).filter(contact => {
    const approved = contact.outreach_approved === true;
    const verified = String(contact.contact_status || '').toUpperCase() === 'VERIFIED';
    const hasEmail = Boolean(String(contact.contact_email || '').trim());
    const hasSource = Boolean(String(contact.contact_source_url || contact.source_url || '').trim());
    const qualified = String(contact.qualification_status || '').toUpperCase() === 'QUALIFIED';
    return approved && verified && hasEmail && hasSource && qualified;
  });
}

function toLegacyOutreachCandidate(contact = {}) {
  return {
    candidate_id: contact.candidate_id || null,
    search_run_id: contact.search_run_id || null,
    business_name: contact.business_name || null,
    contact_name: contact.contact_name || null,
    contact_email: contact.contact_email || null,
    ueiSAM: contact.uei || contact.ueiSAM || contact.uei_sam || null,
    cageCode: contact.cage_code || contact.cageCode || null,
    contact_source_url: contact.contact_source_url || contact.source_url || null,
    qualification_rank: contact.qualification_rank ?? contact.rank ?? null,
    qualification_score: contact.contract_qualification_score ?? contact.qualification_score ?? null,
    qualification_status: contact.qualification_status || null,
  };
}

module.exports = { selectApprovedOutreachContacts, toLegacyOutreachCandidate };
