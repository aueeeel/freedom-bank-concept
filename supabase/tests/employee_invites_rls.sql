begin;
create temporary table email_test_ids as select gen_random_uuid() manager,gen_random_uuid() worker,gen_random_uuid() employee;
grant select on email_test_ids to authenticated,service_role;
insert into auth.users(id,aud,role,email,encrypted_password) select manager,'authenticated','authenticated','email-manager-'||manager||'@example.com','' from email_test_ids union all select worker,'authenticated','authenticated','email-worker-'||worker||'@example.com','test-hash-not-used' from email_test_ids;
insert into public.cqa_managers select manager from email_test_ids;
insert into public.cqa_employees(id,name) select employee,'Email test employee' from email_test_ids;
set local role authenticated;
do $$ begin perform set_config('request.jwt.claims',json_build_object('sub',(select manager from email_test_ids),'role','authenticated')::text,true); end $$;
do $$ begin
 insert into public.cqa_employees(name,aliases,account_email) values('Pending email test','{}','pending-test-'||gen_random_uuid()||'@example.com');
 begin perform public.cqa_prepare_employee_invite((select employee from email_test_ids),'test@example.com',(select manager from email_test_ids));raise exception 'Manager called privileged RPC directly';exception when insufficient_privilege then null;end;
 begin update public.cqa_employees set invitation_status='sent' where id=(select employee from email_test_ids);raise exception 'Browser forged sent status';exception when insufficient_privilege then null;end;
end $$;
set local role service_role;
do $$ declare prepared jsonb; begin
 prepared:=public.cqa_prepare_employee_invite((select employee from email_test_ids),(select 'email-worker-'||worker||'@example.com' from email_test_ids),(select manager from email_test_ids));
 if prepared->>'userId'<>(select worker::text from email_test_ids) or (prepared->>'needsPassword')::boolean then raise exception 'Existing-account lookup failed';end if;
 if (select user_id from public.cqa_employees where id=(select employee from email_test_ids)) is not null then raise exception 'Account linked before email was sent';end if;
 if (select invitation_status from public.cqa_employees where id=(select employee from email_test_ids))<>'sending' then raise exception 'Sending status not reserved';end if;
 begin perform public.cqa_prepare_employee_invite((select employee from email_test_ids),(select 'email-worker-'||worker||'@example.com' from email_test_ids),(select manager from email_test_ids));raise exception 'Cooldown was bypassed';exception when raise_exception then if sqlerrm not like '%через минуту%' then raise;end if;end;
 begin perform public.cqa_prepare_employee_invite((select employee from email_test_ids),'other@example.com',(select worker from email_test_ids));raise exception 'Worker impersonated manager';exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'Email invitation RLS passed: manager creation with email, privileged RPC denied to browsers, sent-status spoof denied, registered account resolved, no premature linking, cooldown and manager checks enforced.' as result;
rollback;