-- RH / Dossie Digital - Fase 1
-- Tabela unificada de arquivos/documentos do dossie do colaborador.
-- Nao substitui o checklist SESMT (sesmt_documentos_colab).

create extension if not exists pgcrypto;

create table if not exists public.rh_colaborador_documentos (
  id uuid primary key default gen_random_uuid(),

  colaborador_id uuid not null references public.colaboradores(id),
  colaborador_re text,
  cpf text,

  contrato_id uuid,
  contrato_nome text,
  base_id uuid,
  base_nome text,

  categoria text not null,
  tipo_documento text not null,
  doc_id_sesmt text,

  numero_documento text,
  data_emissao date,
  data_validade date,
  data_vencimento date,

  status text not null default 'Pendente',
  obrigatorio boolean default false,

  arquivo_url text,
  arquivo_nome text,
  arquivo_tipo text,
  arquivo_tamanho numeric,

  origem text not null default 'RH',
  referencia_modulo text,
  referencia_id uuid,

  versao int not null default 1,
  substitui_documento_id uuid,
  ativo boolean not null default true,

  validado_por text,
  validado_em timestamptz,

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
    where conname = 'rh_colaborador_documentos_status_chk'
      and conrelid = 'public.rh_colaborador_documentos'::regclass
  ) then
    alter table public.rh_colaborador_documentos
      add constraint rh_colaborador_documentos_status_chk
      check (status in (
        'Pendente',
        'Válido',
        'A vencer',
        'Vencido',
        'Entregue',
        'Entregue sem arquivo',
        'Cancelado',
        'Não se aplica'
      ));
  end if;
end $$;

create index if not exists idx_rh_colab_docs_colaborador
  on public.rh_colaborador_documentos (colaborador_id);

create index if not exists idx_rh_colab_docs_tipo
  on public.rh_colaborador_documentos (tipo_documento);

create index if not exists idx_rh_colab_docs_categoria
  on public.rh_colaborador_documentos (categoria);

create index if not exists idx_rh_colab_docs_status
  on public.rh_colaborador_documentos (status);

create index if not exists idx_rh_colab_docs_vencimento
  on public.rh_colaborador_documentos (data_vencimento);

create index if not exists idx_rh_colab_docs_doc_sesmt
  on public.rh_colaborador_documentos (doc_id_sesmt);

create index if not exists idx_rh_colab_docs_ativo
  on public.rh_colaborador_documentos (ativo);

create or replace function public.rh_colaborador_documentos_set_updated_at()
returns trigger as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_rh_colaborador_documentos_updated_at
  on public.rh_colaborador_documentos;

create trigger trg_rh_colaborador_documentos_updated_at
before update on public.rh_colaborador_documentos
for each row execute function public.rh_colaborador_documentos_set_updated_at();
