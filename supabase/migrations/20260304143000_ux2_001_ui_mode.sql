-- UX2-001: preference de mode d'interface (simplified | expert) sur profiles.

alter table public.profiles
  add column if not exists ui_mode text;

update public.profiles
set ui_mode = 'simplified'
where ui_mode is null;

alter table public.profiles
  alter column ui_mode set default 'simplified';

alter table public.profiles
  alter column ui_mode set not null;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'profiles_ui_mode_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    return;
  end if;

  alter table public.profiles
    add constraint profiles_ui_mode_check
    check (ui_mode in ('simplified', 'expert'));
exception
  when others then
    alter table public.profiles
      drop constraint if exists profiles_ui_mode_check;
    raise;
end;
$$;
