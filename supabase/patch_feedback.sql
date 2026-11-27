-- MedRise: erros reportados + estatística de respostas por alternativa
-- Rodar uma vez no SQL Editor do Supabase (Project > SQL Editor > New query > colar > Run)

create table if not exists public.reports (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  qid text not null,
  motivo text,
  texto text,
  status text default 'novo',
  created_at timestamptz default now()
);
alter table public.reports enable row level security;
create policy "reportar erro" on public.reports for insert with check (auth.uid() = user_id);
create policy "ver meus reports" on public.reports for select using (auth.uid() = user_id);
grant select, insert on public.reports to authenticated;

-- uma linha por aluno e questão (vale a primeira resposta)
create table if not exists public.answers (
  user_id uuid not null references auth.users(id) on delete cascade,
  qid text not null,
  choice int not null,
  ok boolean,
  created_at timestamptz default now(),
  primary key (user_id, qid)
);
alter table public.answers enable row level security;
create policy "respostas proprias gravar" on public.answers for insert with check (auth.uid() = user_id);
create policy "respostas proprias ler" on public.answers for select using (auth.uid() = user_id);
grant select, insert on public.answers to authenticated;

-- estatística agregada e anônima de uma questão
create or replace function public.q_stats(p_qid text)
returns table(choice int, n bigint)
language sql security definer set search_path = public stable as $$
  select choice, count(*) from public.answers where qid = p_qid group by choice;
$$;
grant execute on function public.q_stats(text) to authenticated;
