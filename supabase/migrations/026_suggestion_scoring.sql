-- EST-161: scoring metadata for estimate suggestion rules.

alter table public.estimate_suggestion_rules
  add column if not exists usage_count integer not null default 0;

alter table public.estimate_suggestion_rules
  add column if not exists last_used_at timestamptz;

alter table public.estimate_suggestion_rules
  drop constraint if exists estimate_suggestion_rules_usage_count_check;

alter table public.estimate_suggestion_rules
  add constraint estimate_suggestion_rules_usage_count_check
  check (usage_count >= 0);

create index if not exists estimate_suggestion_rules_usage_count_idx
  on public.estimate_suggestion_rules (usage_count desc);
