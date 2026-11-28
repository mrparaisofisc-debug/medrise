-- MedRise: assinaturas do Mercado Pago (checkout dentro do site)
-- Rodar uma vez no SQL Editor do Supabase.

create table if not exists public.subscriptions (
  mp_id text primary key,                 -- id da assinatura no Mercado Pago (ou 'cortesia-<email>')
  email text not null,                    -- e-mail usado na compra (o aluno cria a conta com ele)
  plano text,                             -- mensal | semestral | cortesia
  status text,                            -- authorized | paused | cancelled | pending | cortesia | pix (avulso, vale até next_payment_date)
  next_payment_date timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists subscriptions_email_idx on public.subscriptions (lower(email));
alter table public.subscriptions enable row level security;

-- o aluno logado só enxerga as assinaturas do próprio e-mail; ninguém grava pelo site (só as funções)
drop policy if exists "ver minha assinatura" on public.subscriptions;
create policy "ver minha assinatura" on public.subscriptions
  for select using (lower(email) = lower(auth.jwt() ->> 'email'));
grant select on public.subscriptions to authenticated;

-- acesso ativo: assinatura autorizada, cortesia, ou cancelada/pausada ainda dentro do período pago
create or replace function public.tem_acesso()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.subscriptions
    where lower(email) = lower(auth.jwt() ->> 'email')
      and (status in ('authorized', 'cortesia')
           or (status in ('paused', 'cancelled', 'pix') and next_payment_date > now()))
  );
$$;
grant execute on function public.tem_acesso() to authenticated;
