-- Run against a disposable Supabase branch after applying
-- 20260822143000_rfcp_var_001_security_and_analyze_fit.sql.
-- Synthetic rows are rolled back and never touch contractor production data.
begin;

do $$
declare
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_status public.federal_access_status;
  v_count integer;
begin
  insert into auth.users(id,email) values
    (v_user_a,'rfcp-var-001-a@example.invalid'),
    (v_user_b,'rfcp-var-001-b@example.invalid');
  insert into public.contractor_registrations(user_id,access_status) values
    (v_user_a,'pending_verification'),(v_user_b,'pending_verification');

  -- Unauthenticated/authenticated callers have no grant path.
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub',v_user_a::text,true);
  begin
    perform public.portal_apply_sam_profile('SELF','SELF',now()+interval '1 year','{541511}','541511','{}','{}','{}','self','self');
    raise exception 'authenticated self-verification unexpectedly succeeded';
  exception when insufficient_privilege then null; end;

  -- Only the service verifier may grant access and its evidence id is replay-safe.
  perform set_config('request.jwt.claim.role','service_role',true);
  perform public.rfcp_apply_authoritative_sam_verification(
    v_user_a,'synthetic-verification-1','SAM.gov Entity API','synthetic-sha256',
    'SYNTHETICUEI','SYNTH',now()+interval '1 year','{541511}','541511','{}','{}','{}',
    '{"synthetic":true}'::jsonb
  );
  select access_status into v_status from public.contractor_registrations where user_id=v_user_a;
  if v_status <> 'verified' then raise exception 'service verification did not grant status'; end if;
  begin
    perform public.rfcp_apply_authoritative_sam_verification(
      v_user_a,'synthetic-verification-1','SAM.gov Entity API','synthetic-sha256',
      'SYNTHETICUEI','SYNTH',now()+interval '1 year','{541511}','541511','{}','{}','{}','{}'
    );
    raise exception 'replay unexpectedly succeeded';
  exception when unique_violation then null; end;

  -- Reset can mutate only auth.uid()'s row.
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub',v_user_b::text,true);
  perform public.portal_reset_sam_profile();
  select count(*) into v_count from public.contractor_registrations where user_id=v_user_a and access_status='verified';
  if v_count <> 1 then raise exception 'cross-user reset changed another contractor'; end if;
end $$;

rollback;
