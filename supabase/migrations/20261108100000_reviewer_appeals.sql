-- Апелляции от проверяющих и прозрачность для сотрудников.
-- 1) Проверяющий (cqa_managers) может подать апелляцию на любой сохранённый разговор,
--    сотрудник — как и раньше, только на свой.
-- 2) Сотрудник видит все апелляции по своим разговорам, в том числе поданные проверяющим,
--    вместе с решением. Проверяющие по-прежнему видят все апелляции.

drop policy if exists appeals_create on public.cqa_appeals;
create policy appeals_create on public.cqa_appeals for insert to authenticated with check(
 author_id=(select auth.uid()) and status='pending' and decided_by is null and decided_at is null and decision_reason is null
 and exists(
  select 1 from public.cqa_conversations r
  where r.id=conversation_id
   and exists(select 1 from jsonb_array_elements(r.checklist) c where c->>'id'=criterion_id)
   and (
    exists(select 1 from public.cqa_managers m where m.user_id=(select auth.uid()))
    or exists(select 1 from public.cqa_employees e where e.id=r.employee_id and e.user_id=(select auth.uid()))
   )));

drop policy if exists appeals_read on public.cqa_appeals;
create policy appeals_read on public.cqa_appeals for select to authenticated using(
 exists(select 1 from public.cqa_conversations r join public.cqa_employees e on e.id=r.employee_id
        where r.id=conversation_id and e.user_id=(select auth.uid()))
 or exists(select 1 from public.cqa_managers where user_id=(select auth.uid())));
