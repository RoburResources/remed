insert into public.system_config(config_key, config_value, description) values
  ('system_status', to_jsonb('paused'::text), 'System remains paused until credentials are rotated and Michael approves live operation.'),
  ('kill_switch_active', 'true'::jsonb, 'Global kill switch; true blocks cron task claiming.'),
  ('external_contact_requires_owner_approval', 'true'::jsonb, 'Code-level invariant: non-owner external contact requires task-specific owner approval.'),
  ('max_calls_per_day', to_jsonb(20), 'Maximum outbound calls per day, including owner briefings.'),
  ('max_emails_per_day', to_jsonb(100), 'Maximum outbound emails per day.'),
  ('max_sms_per_day', to_jsonb(100), 'Maximum outbound SMS per day.'),
  ('max_api_spend_cents_per_day', to_jsonb(5000), 'Maximum estimated API spend per day.'),
  ('approval_threshold_cents', to_jsonb(50000), 'Any action above $500 estimated value requires SMS approval.'),
  ('approval_ttl_minutes', to_jsonb(60), 'Approval nonce expiry.'),
  ('stale_task_lease_seconds', to_jsonb(1800), 'Recover in-progress tasks whose lease has been stale for at least this many seconds.'),
  ('max_task_attempts', to_jsonb(3), 'Maximum stale recovery attempts before a task fails closed.'),
  ('max_tasks_per_generation_cycle', to_jsonb(5), 'Prevent task over-generation.'),
  ('min_internal_task_ratio', to_jsonb(0.6), 'At least 60% generated tasks must avoid external contact.'),
  ('public_holidays_awst', '[]'::jsonb, 'YYYY-MM-DD dates when telemarketing calls must not be made.'),
  ('retell_briefings_enabled', 'true'::jsonb, 'Allow owner briefing calls if other safety limits pass.'),
  ('external_contact_enabled', 'false'::jsonb, 'Keep external outreach disabled until compliance ledger is populated.')
on conflict(config_key) do update set
  config_value = excluded.config_value,
  description = excluded.description,
  updated_at = now();

insert into public.goals(goal_text, status, sub_goals, priority) values
  ('Acquire 50 tonnes of scrap metal per month from new sources in Perth', 'active', '[]'::jsonb, 10),
  ('Generate $10,000/month in brokering revenue from connecting suppliers to buyers', 'active', '[]'::jsonb, 9),
  ('Build a database of every auto shop, demolition site, and manufacturer in Perth metro', 'active', '[]'::jsonb, 8),
  ('Monitor AusTender for relevant government contracts', 'active', '[]'::jsonb, 7)
on conflict(goal_text) do update set
  status = excluded.status,
  sub_goals = excluded.sub_goals,
  priority = excluded.priority,
  updated_at = now();
