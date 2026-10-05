alter table public.media_route_outcomes enable row level security;

comment on table public.media_route_outcomes is
  'Internal service-side media routing evidence. RLS is enabled with no client policies; service-role code records and reads this evidence.';
