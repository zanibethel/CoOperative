alter table public.personal_ai_settings
add column if not exists web_access_mode text not null default 'off';

alter table public.personal_ai_settings
drop constraint if exists personal_ai_settings_web_access_mode_check;

alter table public.personal_ai_settings
add constraint personal_ai_settings_web_access_mode_check
check (web_access_mode in ('off','auto','always'));
