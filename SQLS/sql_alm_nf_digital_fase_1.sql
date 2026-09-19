-- =====================================================================
-- ALM-NF-1 / ALM-NF-1.1 — NF DIGITAL VINCULADA À ENTRADA DE ESTOQUE
-- =====================================================================
-- Fase 1 · 🟠 HOMOLOGAÇÃO
-- SQL MANUAL — NÃO é executado pelo ERP. Rodar no Supabase (SQL Editor)
-- após revisão. Aditivo e idempotente (create if not exists). Sem DROP
-- de tabela, sem alteração de estruturas legadas (movimentacoes_itens,
-- alm_movimentos, estoque permanecem intocados).
--
-- Reutiliza o bucket de Storage EXISTENTE "cena-docs" (path
-- almoxarifado/notas-fiscais/{ano}/{mes}/{timestamp}_{nome}). Este script
-- NÃO altera a segurança do bucket (ver item 12 da spec).
--
-- Vínculo escolhido (menor impacto no legado): tabela RELACIONAL
-- alm_nota_fiscal_movimentacoes — NÃO adiciona coluna em movimentacoes_itens
-- nem em alm_movimentos, e cobre tanto o patrimonial (movimentacao_id)
-- quanto o SAP (alm_movimento_id) na mesma estrutura.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) alm_notas_fiscais — uma linha por NF de entrada
-- ---------------------------------------------------------------------
create table if not exists public.alm_notas_fiscais (
  id                        uuid primary key default gen_random_uuid(),
  numero_nf                 text,
  serie_nf                  text,
  chave_acesso_nfe          text,          -- 44 dígitos quando disponível
  cnpj_emitente             text,
  fornecedor                text,
  fornecedor_id             uuid,
  arquivo_nome              text,
  arquivo_path              text,          -- path no bucket cena-docs
  arquivo_url               text,          -- URL pública (legado cena-docs)
  arquivo_tipo              text,
  arquivo_tamanho           bigint,
  hash_sha256               text,
  data_emissao              date,
  data_entrada              date,
  valor_total               numeric(14,2),
  filial_id                 uuid,
  deposito_id               uuid,
  contrato_id               uuid,
  rc                        text,
  pedido                    text,
  origem                    text default 'entrada_estoque',
  destino                   text,          -- 'patrimonial' | 'sap'
  status                    text default 'ATIVA',  -- ATIVA | ESTORNADA | CANCELADA | PARCIALMENTE_ESTORNADA
  criado_por_id             uuid,
  criado_por_nome           text,
  observacao                text,
  itens_snapshot            jsonb,         -- snapshot das linhas no momento da entrada
  duplicidade_liberada      boolean default false,
  duplicidade_contra_id     uuid,          -- NF contra a qual foi liberado "registrar mesmo assim"
  duplicidade_motivo        text,
  duplicidade_justificativa text,
  criado_em                 timestamptz default now()
);

create index if not exists idx_alm_nf_chave    on public.alm_notas_fiscais (chave_acesso_nfe);
create index if not exists idx_alm_nf_cnpj_num  on public.alm_notas_fiscais (cnpj_emitente, numero_nf);
create index if not exists idx_alm_nf_status    on public.alm_notas_fiscais (status);
create index if not exists idx_alm_nf_deposito  on public.alm_notas_fiscais (deposito_id);
create index if not exists idx_alm_nf_criado    on public.alm_notas_fiscais (criado_em desc);

-- ---------------------------------------------------------------------
-- 2) alm_nota_fiscal_movimentacoes — vínculo NF <-> movimentos
--    (patrimonial via movimentacao_id, SAP via alm_movimento_id)
--    Tipos como TEXT nas referências para não travar a entrada por
--    incompatibilidade de tipo entre os dois mundos (patrimonial x SAP).
-- ---------------------------------------------------------------------
create table if not exists public.alm_nota_fiscal_movimentacoes (
  id               uuid primary key default gen_random_uuid(),
  nota_fiscal_id   uuid not null references public.alm_notas_fiscais(id) on delete restrict,
  movimentacao_id  text,          -- id em movimentacoes_itens (patrimonial)
  alm_movimento_id text,          -- id em alm_movimentos (SAP)
  origem           text,          -- 'patrimonial' | 'sap'
  papel            text default 'entrada',  -- 'entrada' | 'estorno'
  quantidade       numeric,
  item_id          text,
  item_nome        text,
  deposito_id      text,
  estoque_id       text,
  saldo_antes      numeric,
  saldo_depois     numeric,
  criado_em        timestamptz default now()
);

create index if not exists idx_alm_nfv_nf   on public.alm_nota_fiscal_movimentacoes (nota_fiscal_id);
create index if not exists idx_alm_nfv_mov  on public.alm_nota_fiscal_movimentacoes (movimentacao_id);
create index if not exists idx_alm_nfv_sap  on public.alm_nota_fiscal_movimentacoes (alm_movimento_id);

-- ---------------------------------------------------------------------
-- 3) alm_nota_fiscal_eventos — auditoria (entrada, estorno, duplicidade)
-- ---------------------------------------------------------------------
create table if not exists public.alm_nota_fiscal_eventos (
  id             uuid primary key default gen_random_uuid(),
  nota_fiscal_id uuid not null references public.alm_notas_fiscais(id) on delete restrict,
  evento         text,   -- ENTRADA_REGISTRADA | ESTORNO_ENTRADA_NF | ESTORNO_BLOQUEADO_SALDO | DUPLICIDADE_LIBERADA_MANUALMENTE ...
  descricao      text,
  usuario_id     uuid,
  usuario_nome   text,
  dados_json     jsonb,
  criado_em      timestamptz default now()
);

create index if not exists idx_alm_nfe_nf on public.alm_nota_fiscal_eventos (nota_fiscal_id);

-- ---------------------------------------------------------------------
-- 4) RLS
--    O ERP acessa via REST com apikey anon + (quando há login Auth) JWT
--    Bearer. As funções de escrita usam requireAuth:!!_sbAuthToken, ou
--    seja, exigem JWT quando há sessão Auth e caem para anon quando não há
--    (mesmo padrão do legado — ex.: audit_log).
--
--    LIMITAÇÃO REGISTRADA (spec item 12): as policies abaixo liberam
--    também o papel anon (para não quebrar o legado sem Auth). Quando o
--    ERP migrar 100% para Supabase Auth, remover as policies "anon" e
--    manter apenas "authenticated". O bucket cena-docs continua público
--    no legado — não ampliado neste patch.
-- ---------------------------------------------------------------------
alter table public.alm_notas_fiscais               enable row level security;
alter table public.alm_nota_fiscal_movimentacoes   enable row level security;
alter table public.alm_nota_fiscal_eventos         enable row level security;

-- alm_notas_fiscais
drop policy if exists alm_nf_sel_auth  on public.alm_notas_fiscais;
drop policy if exists alm_nf_ins_auth  on public.alm_notas_fiscais;
drop policy if exists alm_nf_upd_auth  on public.alm_notas_fiscais;
drop policy if exists alm_nf_all_anon  on public.alm_notas_fiscais;
create policy alm_nf_sel_auth on public.alm_notas_fiscais for select to authenticated using (true);
create policy alm_nf_ins_auth on public.alm_notas_fiscais for insert to authenticated with check (true);
create policy alm_nf_upd_auth on public.alm_notas_fiscais for update to authenticated using (true) with check (true);
-- fallback legado (remover quando o ERP usar só Auth):
create policy alm_nf_all_anon on public.alm_notas_fiscais for all to anon using (true) with check (true);

-- alm_nota_fiscal_movimentacoes
drop policy if exists alm_nfv_sel_auth on public.alm_nota_fiscal_movimentacoes;
drop policy if exists alm_nfv_ins_auth on public.alm_nota_fiscal_movimentacoes;
drop policy if exists alm_nfv_upd_auth on public.alm_nota_fiscal_movimentacoes;
drop policy if exists alm_nfv_all_anon on public.alm_nota_fiscal_movimentacoes;
create policy alm_nfv_sel_auth on public.alm_nota_fiscal_movimentacoes for select to authenticated using (true);
create policy alm_nfv_ins_auth on public.alm_nota_fiscal_movimentacoes for insert to authenticated with check (true);
create policy alm_nfv_upd_auth on public.alm_nota_fiscal_movimentacoes for update to authenticated using (true) with check (true);
create policy alm_nfv_all_anon on public.alm_nota_fiscal_movimentacoes for all to anon using (true) with check (true);

-- alm_nota_fiscal_eventos
drop policy if exists alm_nfe_sel_auth on public.alm_nota_fiscal_eventos;
drop policy if exists alm_nfe_ins_auth on public.alm_nota_fiscal_eventos;
drop policy if exists alm_nfe_all_anon on public.alm_nota_fiscal_eventos;
create policy alm_nfe_sel_auth on public.alm_nota_fiscal_eventos for select to authenticated using (true);
create policy alm_nfe_ins_auth on public.alm_nota_fiscal_eventos for insert to authenticated with check (true);
create policy alm_nfe_all_anon on public.alm_nota_fiscal_eventos for all to anon using (true) with check (true);


-- ---------------------------------------------------------------------
-- 1b) Colunas de estorno (ALM-NF-1.1) — aditivas se a tabela já existia
-- ---------------------------------------------------------------------
alter table public.alm_notas_fiscais add column if not exists estornado_em timestamptz;
alter table public.alm_notas_fiscais add column if not exists estornado_por_id uuid;
alter table public.alm_notas_fiscais add column if not exists estornado_por_nome text;
alter table public.alm_notas_fiscais add column if not exists motivo_estorno text;
alter table public.alm_notas_fiscais add column if not exists justificativa_estorno text;

-- ---------------------------------------------------------------------
-- 5) GRANTs (PostgREST expõe as tabelas aos papéis anon/authenticated)
-- ---------------------------------------------------------------------
grant select, insert, update on public.alm_notas_fiscais             to anon, authenticated;
grant select, insert, update on public.alm_nota_fiscal_movimentacoes to anon, authenticated;
grant select, insert         on public.alm_nota_fiscal_eventos       to anon, authenticated;

-- =====================================================================
-- FIM — nada além destas 3 tabelas é criado/alterado.
-- Rollback (se necessário, manual): drop table das 3 tabelas na ordem
-- eventos -> movimentacoes -> notas_fiscais (respeitando as FKs).
-- =====================================================================
