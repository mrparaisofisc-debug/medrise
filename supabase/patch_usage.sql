create or replace function public.usar_ia_eu(p_lim int) returns int language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if auth.uid() is null then raise exception 'login'; end if;
  insert into ai_usage(user_id, dia, n) values (auth.uid(), current_date, 1)
  on conflict (user_id, dia) do update set n = ai_usage.n + 1 returning n into v;
  if v > p_lim then raise exception 'limite'; end if;
  return v;
end $$;
revoke execute on function public.usar_ia_eu(int) from public, anon;
grant execute on function public.usar_ia_eu(int) to authenticated;
