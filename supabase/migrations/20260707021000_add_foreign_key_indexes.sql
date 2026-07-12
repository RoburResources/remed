create index if not exists idx_task_queue_goal_id on public.task_queue(goal_id);
create index if not exists idx_compliance_events_contact_id on public.compliance_events(contact_id);
create index if not exists idx_compliance_events_task_id on public.compliance_events(task_id);
create index if not exists idx_outbound_messages_contact_id on public.outbound_messages(contact_id);
create index if not exists idx_outbound_messages_task_id on public.outbound_messages(task_id);
create index if not exists idx_retell_calls_contact_id on public.retell_calls(contact_id);
create index if not exists idx_retell_calls_task_id on public.retell_calls(task_id);
