-- MedRise: banco de dados (rodar uma vez no SQL Editor do Supabase)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text, apelido text, tipo text, esp text, bancas text[] default '{}',
  data_prova date, horas int default 20, fase text,
  plano text default 'gratis', created_at timestamptz default now()
);
create table if not exists public.user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);
create table if not exists public.sim_results (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  sid text, nome text, ok int, total int, pct numeric, secs int,
  created_at timestamptz default now()
);
create table if not exists public.ai_usage (
  user_id uuid references auth.users(id) on delete cascade,
  dia date default current_date, n int default 0,
  primary key (user_id, dia)
);
alter table public.profiles enable row level security;
alter table public.user_state enable row level security;
alter table public.sim_results enable row level security;
alter table public.ai_usage enable row level security;
-- cada aluno só vê e mexe nos próprios dados
create policy "perfil proprio" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "estado proprio" on public.user_state for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "simulados proprios ler" on public.sim_results for select using (auth.uid() = user_id);
create policy "simulados proprios gravar" on public.sim_results for insert with check (auth.uid() = user_id);
create policy "uso ia proprio" on public.ai_usage for select using (auth.uid() = user_id);
grant select, insert, update, delete on public.profiles, public.user_state to authenticated;
grant select, insert on public.sim_results to authenticated;
grant select on public.ai_usage to authenticated;
-- cria o perfil automaticamente no cadastro
create or replace function public.novo_usuario() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nome) values (new.id, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email,'@',1)));
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.novo_usuario();
-- ranking anônimo: melhor nota de cada aluno por simulado
create or replace function public.ranking(p_sid text default null, p_lim int default 50)
returns table(pos bigint, apelido text, pct numeric, total int, eu boolean) language sql security definer set search_path = public as $$
  with best as (
    select s.user_id, max(s.pct) pct, max(s.total) total from sim_results s
    where (p_sid is null or s.sid = p_sid) group by s.user_id)
  select rank() over (order by b.pct desc), coalesce(p.apelido, 'Aluno #' || right(replace(b.user_id::text,'-',''),4)), b.pct, b.total, b.user_id = auth.uid()
  from best b left join profiles p on p.id = b.user_id order by b.pct desc limit p_lim;
$$;
grant execute on function public.ranking(text,int) to authenticated;
-- contador de uso da IA (chamado pela função do tutor)
create or replace function public.usar_ia(p_user uuid, p_lim int) returns int language plpgsql security definer set search_path = public as $$
declare v int;
begin
  insert into ai_usage(user_id, dia, n) values (p_user, current_date, 1)
  on conflict (user_id, dia) do update set n = ai_usage.n + 1 returning n into v;
  if v > p_lim then raise exception 'limite'; end if;
  return v;
end $$;
revoke execute on function public.usar_ia(uuid,int) from public, anon, authenticated;
grant execute on function public.usar_ia(uuid,int) to service_role;
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
