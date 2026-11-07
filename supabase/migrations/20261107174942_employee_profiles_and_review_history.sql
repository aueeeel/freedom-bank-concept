-- Additive workforce schema, independent from the AI analysis routes.
create schema if not exists cqa_private;
revoke all on schema cqa_private from public, anon;
grant usage on schema cqa_private to authenticated;

create table public.cqa_managers (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.cqa_managers enable row level security;
revoke all on public.cqa_managers from anon, authenticated;
grant select on public.cqa_managers to authenticated;
create policy managers_read_self on public.cqa_managers for select to authenticated
  using(user_id=(select auth.uid()));

create table public.cqa_employees (
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(trim(name)) between 2 and 160),
  aliases text[] not null default '{}',
  user_id uuid unique references auth.users(id) on delete set null,
  account_email text,
  created_at timestamptz not null default now()
);
alter table public.cqa_employees enable row level security;
revoke all on public.cqa_employees from anon, authenticated;
grant select,insert on public.cqa_employees to authenticated;
grant update(name,aliases) on public.cqa_employees to authenticated;
create policy employees_read on public.cqa_employees for select to authenticated using(
 user_id=(select auth.uid()) or exists(select 1 from public.cqa_managers where user_id=(select auth.uid())));
create policy employees_create on public.cqa_employees for insert to authenticated with check(
 user_id is null and account_email is null and exists(select 1 from public.cqa_managers where user_id=(select auth.uid())));
create policy employees_edit on public.cqa_employees for update to authenticated
 using(exists(select 1 from public.cqa_managers where user_id=(select auth.uid())))
 with check(exists(select 1 from public.cqa_managers where user_id=(select auth.uid())));

create function public.cqa_review_score(items jsonb, evaluations jsonb) returns numeric
language plpgsql immutable security invoker set search_path='' as $$
declare c jsonb; e jsonb; a jsonb; v jsonb; w numeric; mx numeric; points numeric;
        earned numeric:=0; available numeric:=0;
begin
 if jsonb_typeof(items)<>'array' or jsonb_array_length(items)=0 then return null; end if;
 for c in select value from jsonb_array_elements(items) loop
  e:=evaluations->(c->>'id'); v:=e->'value';
  for a in select value from jsonb_array_elements(coalesce(e->'appeals','[]'::jsonb)) loop
   if a->'decision' is not null then v:=a->'decision'->'value'; end if;
  end loop;
  if v is null or v='null'::jsonb then return null; end if;
  if v='"na"'::jsonb and coalesce((c->>'allowNA')::boolean,false) then continue; end if;
  if c->>'type'='flag' then
   if v not in ('"yes"'::jsonb,'"no"'::jsonb) then return null; end if;
   continue;
  end if;
  w:=(c->>'weight')::numeric;
  if w<0 or w>1000 then return null; end if;
  if c->>'type'='scale' then
   select max(value::numeric) into mx from jsonb_array_elements_text(c->'scale');
   if mx is null or mx<=0 or jsonb_typeof(v)<>'number' or not (c->'scale' @> jsonb_build_array(v)) then return null; end if;
   points:=(v#>>'{}')::numeric/mx*w;
  else
   if v not in ('"yes"'::jsonb,'"no"'::jsonb) then return null; end if;
   points:=case when v='"yes"'::jsonb then w else 0 end;
  end if;
  available:=available+w; earned:=earned+points;
 end loop;
 if available=0 then return null; end if;
 return round(earned/available*100,2);
end $$;
revoke all on function public.cqa_review_score(jsonb,jsonb) from public,anon;
grant execute on function public.cqa_review_score(jsonb,jsonb) to authenticated,service_role;

create table public.cqa_conversations (
 id uuid primary key default gen_random_uuid(),
 employee_id uuid references public.cqa_employees(id) on delete restrict,
 fingerprint text not null unique check(fingerprint ~ '^[a-f0-9]{64}$'),
 source_id text,
 name text not null check(length(name) between 1 and 160),
 language text not null default 'Не указан',
 channel text not null default 'agent chat',
 transcript jsonb not null check(jsonb_typeof(transcript)='array' and jsonb_array_length(transcript)<=5000),
 checklist jsonb not null check(jsonb_typeof(checklist)='array' and jsonb_array_length(checklist) between 1 and 30),
 evaluations jsonb not null default '{}' check(jsonb_typeof(evaluations)='object'),
 assignment_evidence jsonb not null default '[]' check(jsonb_typeof(assignment_evidence)='array'),
 review_source text not null default 'manual' check(review_source in ('manual','ai','demo')),
 score numeric generated always as(public.cqa_review_score(checklist,evaluations)) stored,
 version integer not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index cqa_conversations_employee_idx on public.cqa_conversations(employee_id,created_at desc);
alter table public.cqa_conversations enable row level security;
revoke all on public.cqa_conversations from anon,authenticated;
grant select,insert,update on public.cqa_conversations to authenticated;
create policy conversations_read on public.cqa_conversations for select to authenticated using(
 exists(select 1 from public.cqa_employees e where e.id=employee_id and e.user_id=(select auth.uid()))
 or exists(select 1 from public.cqa_managers where user_id=(select auth.uid())));
create policy conversations_create on public.cqa_conversations for insert to authenticated with check(
 exists(select 1 from public.cqa_managers where user_id=(select auth.uid())));
create policy conversations_edit on public.cqa_conversations for update to authenticated
 using(exists(select 1 from public.cqa_managers where user_id=(select auth.uid())))
 with check(exists(select 1 from public.cqa_managers where user_id=(select auth.uid())));
create function cqa_private.bump_review_version() returns trigger language plpgsql security invoker set search_path='' as $$
begin new.version:=old.version+1; new.updated_at:=now(); return new; end $$;
revoke all on function cqa_private.bump_review_version() from public,anon,authenticated;
create trigger cqa_review_version before update on public.cqa_conversations for each row execute function cqa_private.bump_review_version();

create table public.cqa_appeals (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.cqa_conversations(id) on delete restrict,
 criterion_id text not null check(length(criterion_id) between 1 and 160),
 comment text not null check(length(trim(comment)) between 1 and 4000),
 author_id uuid not null references auth.users(id) on delete restrict,
 status text not null default 'pending' check(status in ('pending','accepted','rejected')),
 decision_reason text,
 decided_by uuid references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(),
 decided_at timestamptz,
 check((status='pending' and decided_by is null and decided_at is null and decision_reason is null)
 or (status<>'pending' and decided_by is not null and decided_at is not null and decision_reason is not null and length(trim(decision_reason))>0))
);
create unique index cqa_one_pending_appeal on public.cqa_appeals(conversation_id,criterion_id) where status='pending';
create index cqa_appeals_author_idx on public.cqa_appeals(author_id);
create index cqa_appeals_conversation_idx on public.cqa_appeals(conversation_id);
create index cqa_appeals_reviewer_idx on public.cqa_appeals(decided_by);
alter table public.cqa_appeals enable row level security;
revoke all on public.cqa_appeals from anon,authenticated;
grant select on public.cqa_appeals to authenticated;
grant insert(conversation_id,criterion_id,comment,author_id) on public.cqa_appeals to authenticated;
grant update(status,decision_reason,decided_by,decided_at) on public.cqa_appeals to authenticated;
create policy appeals_read on public.cqa_appeals for select to authenticated using(
 (author_id=(select auth.uid()) and exists(select 1 from public.cqa_conversations r join public.cqa_employees e on e.id=r.employee_id where r.id=conversation_id and e.user_id=(select auth.uid())))
 or exists(select 1 from public.cqa_managers where user_id=(select auth.uid())));
create policy appeals_create on public.cqa_appeals for insert to authenticated with check(
 author_id=(select auth.uid()) and status='pending' and decided_by is null and decided_at is null and decision_reason is null
 and exists(select 1 from public.cqa_conversations r join public.cqa_employees e on e.id=r.employee_id where r.id=conversation_id and e.user_id=(select auth.uid())
 and exists(select 1 from jsonb_array_elements(r.checklist) c where c->>'id'=criterion_id)));
create policy appeals_decide on public.cqa_appeals for update to authenticated
 using(exists(select 1 from public.cqa_managers where user_id=(select auth.uid())))
 with check(decided_by=(select auth.uid()) and exists(select 1 from public.cqa_managers where user_id=(select auth.uid())));

create view public.cqa_employee_ratings with(security_invoker=true) as
 select e.id,e.name,e.user_id,count(r.id)::int review_count,count(r.score)::int rated_count,
 round(avg(r.score),2) average_score,round(avg(r.score)/20,2) stars,
 (select count(*)::int from public.cqa_appeals a join public.cqa_conversations cr on cr.id=a.conversation_id where cr.employee_id=e.id and a.status='pending') open_appeals
 from public.cqa_employees e left join public.cqa_conversations r on r.employee_id=e.id group by e.id;
revoke all on public.cqa_employee_ratings from anon,authenticated;
grant select on public.cqa_employee_ratings to authenticated;

-- Only this narrow function needs auth.users access; it never returns a list of accounts.
create function cqa_private.link_employee(p_employee_id uuid,p_email text) returns void
language plpgsql security definer set search_path='' as $$
declare target_id uuid; target_email text;
begin
 if auth.uid() is null or not exists(select 1 from public.cqa_managers where user_id=auth.uid()) then raise exception 'Only a manager can link accounts' using errcode='42501'; end if;
 select id,email into target_id,target_email from auth.users where lower(email)=lower(trim(p_email));
 if target_id is null then raise exception 'Аккаунт с таким email ещё не зарегистрирован'; end if;
 update public.cqa_employees set user_id=target_id,account_email=target_email where id=p_employee_id;
 if not found then raise exception 'Сотрудник не найден'; end if;
end $$;
revoke all on function cqa_private.link_employee(uuid,text) from public,anon,authenticated;
grant execute on function cqa_private.link_employee(uuid,text) to authenticated;
create function public.cqa_link_employee(p_employee_id uuid,p_email text) returns void
language sql security invoker set search_path='' as $$ select cqa_private.link_employee(p_employee_id,p_email); $$;
revoke all on function public.cqa_link_employee(uuid,text) from public,anon;
grant execute on function public.cqa_link_employee(uuid,text) to authenticated;

create function public.cqa_resolve_appeal(p_id uuid,p_status text,p_value jsonb,p_reason text) returns void
language plpgsql security invoker set search_path='' as $$
declare a public.cqa_appeals; r public.cqa_conversations; c jsonb; e jsonb; decision jsonb;
begin
 if not exists(select 1 from public.cqa_managers where user_id=(select auth.uid())) then raise exception 'Only a manager can review appeals' using errcode='42501'; end if;
 if p_status is null or p_status not in ('accepted','rejected') or p_reason is null or length(trim(p_reason))=0 then raise exception 'Укажите решение и причину'; end if;
 select * into a from public.cqa_appeals where id=p_id for update;
 if a.id is null or a.status<>'pending' then raise exception 'Апелляция уже рассмотрена или не найдена'; end if;
 select * into r from public.cqa_conversations where id=a.conversation_id for update;
 if p_status='accepted' then
  select value into c from jsonb_array_elements(r.checklist) where value->>'id'=a.criterion_id;
  if c is null or p_value is null or p_value='null'::jsonb then raise exception 'Выберите новую оценку'; end if;
  if not ((p_value='"na"'::jsonb and coalesce((c->>'allowNA')::boolean,false))
   or (c->>'type'='scale' and jsonb_typeof(p_value)='number' and c->'scale' @> jsonb_build_array(p_value))
   or (c->>'type'<>'scale' and p_value in ('"yes"'::jsonb,'"no"'::jsonb))) then raise exception 'Недопустимая оценка'; end if;
  e:=coalesce(r.evaluations->a.criterion_id,jsonb_build_object('value',null,'reason','','evidence','[]'::jsonb,'appeals','[]'::jsonb));
  decision:=jsonb_build_object('id',a.id,'comment',a.comment,'createdAt',a.created_at,'decision',jsonb_build_object('value',p_value,'reason',trim(p_reason),'at',now()));
  e:=jsonb_set(e,'{appeals}',coalesce(e->'appeals','[]'::jsonb)||jsonb_build_array(decision));
  update public.cqa_conversations set evaluations=jsonb_set(evaluations,array[a.criterion_id],e) where id=r.id;
 end if;
 update public.cqa_appeals set status=p_status,decision_reason=trim(p_reason),decided_by=auth.uid(),decided_at=now() where id=p_id;
end $$;
revoke all on function public.cqa_resolve_appeal(uuid,text,jsonb,text) from public,anon;
grant execute on function public.cqa_resolve_appeal(uuid,text,jsonb,text) to authenticated;
grant select,insert,update,delete on public.cqa_managers,public.cqa_employees,public.cqa_conversations,public.cqa_appeals to service_role;
notify pgrst,'reload schema';
