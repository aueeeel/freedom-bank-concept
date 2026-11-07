alter table public.cqa_employees
 add column invitation_status text not null default 'not_sent' check(invitation_status in ('not_sent','sending','sent','error')),
 add column invited_at timestamptz,
 add column invitation_requested_at timestamptz,
 add column invitation_attempt_id uuid,
 add column invitation_error text;
create unique index cqa_employee_email_unique on public.cqa_employees(lower(account_email)) where account_email is not null;
alter policy employees_create on public.cqa_employees with check(
 user_id is null and invitation_status='not_sent' and invited_at is null and invitation_requested_at is null
 and invitation_attempt_id is null and invitation_error is null
 and (account_email is null or (length(account_email)<=254 and account_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
 and exists(select 1 from public.cqa_managers where user_id=(select auth.uid())));

-- Invitation details are writable only by this server-only operation, not the browser.
revoke insert on public.cqa_employees from authenticated;
grant insert(name,aliases,account_email) on public.cqa_employees to authenticated;
create function cqa_private.prepare_employee_invite(p_employee_id uuid,p_email text,p_manager_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.cqa_employees; target_id uuid; has_password boolean; attempt uuid:=gen_random_uuid(); email_normalized text:=lower(trim(p_email));
begin
 if p_manager_id is null or not exists(select 1 from public.cqa_managers where user_id=p_manager_id) then raise exception 'Роль руководителя не подтверждена' using errcode='42501'; end if;
 if email_normalized is null or length(email_normalized)>254 or email_normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Проверьте email сотрудника'; end if;
 select * into e from public.cqa_employees where id=p_employee_id for update;
 if e.id is null then raise exception 'Сотрудник не найден'; end if;
 if e.user_id is not null and lower(coalesce(e.account_email,''))<>email_normalized then raise exception 'Профиль уже связан с другим email'; end if;
 if e.invitation_requested_at>now()-interval '60 seconds' then raise exception 'Повторить приглашение можно через минуту'; end if;
 select id,coalesce(encrypted_password,'')<>'' into target_id,has_password from auth.users where lower(email)=email_normalized;
 if exists(select 1 from public.cqa_employees where id<>p_employee_id and (lower(account_email)=email_normalized or (target_id is not null and user_id=target_id))) then raise exception 'Этот email уже связан с другим сотрудником'; end if;
 update public.cqa_employees set account_email=email_normalized,invitation_status='sending',invitation_error=null,invitation_requested_at=now(),invitation_attempt_id=attempt where id=e.id;
 return jsonb_build_object('id',e.id,'name',e.name,'email',email_normalized,'userId',target_id,'needsPassword',not coalesce(has_password,false),'attemptId',attempt);
end $$;
revoke all on function cqa_private.prepare_employee_invite(uuid,text,uuid) from public,anon,authenticated;
grant usage on schema cqa_private to service_role;
grant execute on function cqa_private.prepare_employee_invite(uuid,text,uuid) to service_role;
create function public.cqa_prepare_employee_invite(p_employee_id uuid,p_email text,p_manager_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select cqa_private.prepare_employee_invite(p_employee_id,p_email,p_manager_id); $$;
revoke all on function public.cqa_prepare_employee_invite(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.cqa_prepare_employee_invite(uuid,text,uuid) to service_role;
notify pgrst,'reload schema';
