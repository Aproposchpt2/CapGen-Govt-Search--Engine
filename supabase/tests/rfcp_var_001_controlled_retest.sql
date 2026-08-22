-- RFCP-CDAR-001 controlled disposable-branch retest.
-- All fixtures use reserved example.invalid addresses and are rolled back.
begin;

do $$
declare
  u_verified uuid := gen_random_uuid();
  u_unverified uuid := gen_random_uuid();
  u_second uuid := gen_random_uuid();
  r_id uuid;
  r_id_2 uuid;
  r_status text;
  r_basis text;
  n integer;
  balance integer;
begin
  insert into auth.users(id,email) values
    (u_verified,'rfcp.cdar.verified@example.invalid'),
    (u_unverified,'rfcp.cdar.unverified@example.invalid'),
    (u_second,'rfcp.cdar.second@example.invalid');
  insert into public.contractor_registrations(user_id,access_status) values
    (u_verified,'pending_verification'),
    (u_unverified,'pending_verification'),
    (u_second,'pending_verification');

  if has_function_privilege('anon', 'public.portal_apply_sam_profile(text,text,timestamptz,text[],text,text[],text[],jsonb,text,text)', 'EXECUTE') then
    raise exception 'anon can execute legacy SAM apply';
  end if;
  if has_function_privilege('authenticated', 'public.portal_apply_sam_profile(text,text,timestamptz,text[],text,text[],text[],jsonb,text,text)', 'EXECUTE') then
    raise exception 'authenticated can execute legacy SAM apply';
  end if;
  if has_function_privilege('authenticated', 'public.rfcp_apply_authoritative_sam_verification(uuid,text,text,text,text,text,timestamptz,text[],text,text[],text[],jsonb,jsonb)', 'EXECUTE') then
    raise exception 'authenticated can execute authoritative verification';
  end if;
  if not has_function_privilege('service_role', 'public.rfcp_apply_authoritative_sam_verification(uuid,text,text,text,text,text,timestamptz,text[],text,text[],text[],jsonb,jsonb)', 'EXECUTE') then
    raise exception 'service role lacks authoritative verification';
  end if;

  perform set_config('request.jwt.claim.role','service_role',true);
  begin
    perform public.rfcp_apply_authoritative_sam_verification(
      u_verified,'cdar-incomplete','SAM.gov Entity API','',
      'SYNTHETICUEI','SYNTH',now()+interval '1 year','{541511}','541511','{}','{}','{}','{}');
    raise exception 'incomplete authoritative evidence succeeded';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.rfcp_apply_authoritative_sam_verification(
      u_verified,'cdar-expired','SAM.gov Entity API','synthetic-sha256-expired',
      'SYNTHETICUEI','SYNTH',now()-interval '1 day','{541511}','541511','{}','{}','{}','{}');
    raise exception 'expired authoritative verification succeeded';
  exception when invalid_parameter_value then null; end;

  perform public.rfcp_apply_authoritative_sam_verification(
    u_verified,'cdar-valid','SAM.gov Entity API','synthetic-sha256-valid',
    'SYNTHETICUEI','SYNTH',now()+interval '1 year','{541511,541512}','541511','{}','{}',
    '{"capabilities":["software development"]}',
    '{"synthetic":true,"source_record":"controlled"}');
  if (select access_status from public.contractor_registrations where user_id=u_verified) <> 'verified' then
    raise exception 'valid service verification did not grant access';
  end if;
  if (select count(*) from public.rfcp_sam_verification_events where user_id=u_verified) <> 1 then
    raise exception 'verification evidence was not recorded exactly once';
  end if;
  begin
    perform public.rfcp_apply_authoritative_sam_verification(
      u_verified,'cdar-valid','SAM.gov Entity API','synthetic-sha256-valid',
      'SYNTHETICUEI','SYNTH',now()+interval '1 year','{541511}','541511','{}','{}','{}','{}');
    raise exception 'verification replay succeeded';
  exception when unique_violation then null; end;

  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub',u_second::text,true);
  perform public.portal_reset_sam_profile();
  if (select access_status from public.contractor_registrations where user_id=u_verified) <> 'verified' then
    raise exception 'cross-user reset modified verified contractor';
  end if;
  if (select access_status from public.contractor_registrations where user_id=u_second) <> 'pending_verification' then
    raise exception 'owner reset produced unexpected state';
  end if;

  if has_table_privilege('anon','public.rfcp_sam_verification_events','SELECT')
     or has_table_privilege('authenticated','public.rfcp_sam_verification_events','SELECT')
     or has_table_privilege('authenticated','public.rfcp_analyze_fit_access','SELECT')
     or has_table_privilege('authenticated','public.rfcp_analyze_fit_requests','SELECT') then
    raise exception 'browser role has unauthorized direct table access';
  end if;

  insert into public.rfcp_analyze_fit_access(customer_email,access_type,status,external_reference) values
    ('rfcp.cdar.subscription@example.invalid','subscription','active','cdar-subscription'),
    ('rfcp.cdar.package@example.invalid','package','active','cdar-package'),
    ('rfcp.cdar.complimentary@example.invalid','complimentary','active','cdar-complimentary'),
    ('rfcp.cdar.authorized-test@example.invalid','authorized_test','active','cdar-authorized-test'),
    ('rfcp.cdar.expired@example.invalid','subscription','expired','cdar-expired');
  insert into public.analyze_fit_credit_ledger(customer_email,product_code,credit_delta,reason,metadata)
    values ('rfcp.cdar.credit@example.invalid','ngcc',1,'synthetic_test_grant','{"synthetic":true}');

  perform set_config('request.jwt.claim.role','service_role',true);
  select * into r_id,r_status,r_basis from public.rfcp_reserve_analyze_fit(
    'rfcp.cdar.subscription@example.invalid','federal:cdar-fed','idem-sub');
  if r_basis <> 'subscription' or r_status <> 'reserved' then raise exception 'subscription reservation failed'; end if;
  perform public.rfcp_complete_analyze_fit(r_id);

  select * into r_id,r_status,r_basis from public.rfcp_reserve_analyze_fit(
    'rfcp.cdar.package@example.invalid','state_local:cdar-state','idem-package');
  if r_basis <> 'package' then raise exception 'package reservation failed'; end if;
  perform public.rfcp_complete_analyze_fit(r_id);

  select * into r_id,r_status,r_basis from public.rfcp_reserve_analyze_fit(
    'rfcp.cdar.complimentary@example.invalid','state_local:cdar-state','idem-complimentary');
  if r_basis <> 'complimentary' then raise exception 'complimentary reservation failed'; end if;

  select * into r_id,r_status,r_basis from public.rfcp_reserve_analyze_fit(
    'rfcp.cdar.authorized-test@example.invalid','federal:cdar-fed','idem-test');
  if r_basis <> 'authorized_test' then raise exception 'authorized-test reservation failed'; end if;

  select * into r_id,r_status,r_basis from public.rfcp_reserve_analyze_fit(
    'rfcp.cdar.credit@example.invalid','federal:cdar-fed','idem-credit');
  if r_basis <> 'individual_credit' then raise exception 'individual-credit reservation failed'; end if;
  select * into r_id_2,r_status,r_basis from public.rfcp_reserve_analyze_fit(
    'rfcp.cdar.credit@example.invalid','federal:cdar-fed','idem-credit');
  if r_id_2 <> r_id then raise exception 'idempotent retry created a second request'; end if;
  select count(*) into n from public.rfcp_analyze_fit_requests
   where customer_email='rfcp.cdar.credit@example.invalid' and idempotency_key='idem-credit';
  if n <> 1 then raise exception 'duplicate request rows created'; end if;
  select coalesce(sum(credit_delta),0) into balance from public.analyze_fit_credit_ledger
   where customer_email='rfcp.cdar.credit@example.invalid';
  if balance <> 0 then raise exception 'individual credit was not debited exactly once'; end if;
  perform public.rfcp_release_analyze_fit(r_id,'controlled_failure');
  select coalesce(sum(credit_delta),0) into balance from public.analyze_fit_credit_ledger
   where customer_email='rfcp.cdar.credit@example.invalid';
  if balance <> 1 then raise exception 'failed analysis was not refunded'; end if;
  select * into r_id_2,r_status,r_basis from public.rfcp_reserve_analyze_fit(
    'rfcp.cdar.credit@example.invalid','federal:cdar-fed','idem-credit');
  if r_id_2 <> r_id or r_status <> 'reserved' then raise exception 'controlled retry did not reuse request'; end if;
  select coalesce(sum(credit_delta),0) into balance from public.analyze_fit_credit_ledger
   where customer_email='rfcp.cdar.credit@example.invalid';
  if balance <> 0 then raise exception 'retry double-debited individual credit'; end if;

  begin
    perform public.rfcp_reserve_analyze_fit('rfcp.cdar.none@example.invalid','federal:cdar-fed','idem-none');
    raise exception 'no-entitlement reservation succeeded';
  exception when raise_exception then
    if sqlerrm <> 'No Analyze Fit entitlement or credit is available.' then raise; end if;
  end;
  begin
    perform public.rfcp_reserve_analyze_fit('rfcp.cdar.expired@example.invalid','federal:cdar-fed','idem-expired');
    raise exception 'expired entitlement reservation succeeded';
  exception when raise_exception then
    if sqlerrm <> 'No Analyze Fit entitlement or credit is available.' then raise; end if;
  end;

  if exists(select 1 from public.rfcp_analyze_fit_requests where customer_email='rfcp.cdar.none@example.invalid') then
    raise exception 'failed authorization persisted a reservation';
  end if;
end $$;

rollback;
