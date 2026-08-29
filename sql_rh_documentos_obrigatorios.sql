-- RH / Dossie Digital - Fase 2
-- Regras documentais obrigatorias por contrato/base/cargo/funcao/tipo de colaborador.
-- Este SQL e proposto/versionado e NAO deve ser aplicado sem aprovacao explicita.

create extension if not exists pgcrypto;

create table if not exists public.rh_documentos_obrigatorios (
  id uuid primary key default gen_random_uuid(),

  contrato_id uuid,
  contrato_nome text,
  base_id uuid,
  base_nome text,

  cargo text,
  funcao text,
  tipo_colaborador text,

  categoria text not null,
  tipo_documento text not null,

  obrigatorio boolean default true,
  exige_validade boolean default false,
  validade_meses int,
  exige_arquivo boolean default true,

  origem_esperada text not null default 'RH',

  ativo boolean not null default true,
  observacao text,

  criado_por text,
  criado_em timestamptz default now(),
  atualizado_em timestamptz default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'rh_documentos_obrigatorios_origem_chk'
      and conrelid = 'public.rh_documentos_obrigatorios'::regclass
  ) then
    alter table public.rh_documentos_obrigatorios
      add constraint rh_documentos_obrigatorios_origem_chk
      check (origem_esperada in ('RH','SESMT','Frotas','Almoxarifado','Ponto','Cliente'));
  end if;
end $$;

create index if not exists idx_rh_doc_obr_contrato
  on public.rh_documentos_obrigatorios (contrato_id);

create index if not exists idx_rh_doc_obr_base
  on public.rh_documentos_obrigatorios (base_id);

create index if not exists idx_rh_doc_obr_cargo
  on public.rh_documentos_obrigatorios (cargo);

create index if not exists idx_rh_doc_obr_funcao
  on public.rh_documentos_obrigatorios (funcao);

create index if not exists idx_rh_doc_obr_tipo_documento
  on public.rh_documentos_obrigatorios (tipo_documento);

create index if not exists idx_rh_doc_obr_ativo
  on public.rh_documentos_obrigatorios (ativo);

create or replace function public.rh_documentos_obrigatorios_set_updated_at()
returns trigger as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_rh_documentos_obrigatorios_updated_at
  on public.rh_documentos_obrigatorios;

create trigger trg_rh_documentos_obrigatorios_updated_at
before update on public.rh_documentos_obrigatorios
for each row execute function public.rh_documentos_obrigatorios_set_updated_at();
