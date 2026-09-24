-- sql_frotas_pedagios_1.sql
-- FROTAS-PEDAGIOS-1 — passagens de pedágio (fonte operacional única).
-- Aditivo / idempotente.
-- NÃO executar pelo ERP. Aplicar manualmente no SQL Editor do Supabase após aprovação.
--
-- Espelha o padrão de frotas_combustivel: uma tabela operacional.
-- A fatura (tipo=FATURA) é documento de conciliação/pagamento — NÃO é custo.
-- A passagem (tipo=PASSAGEM) é a base do custo da Viabilidade Econômica.
--
-- IDs reutilizados do schema real (não inventados):
--   veiculo_id          → frotas_veiculos.id
--   portaria_saida_id   → frotas_portaria_saidas.id
--   equipe_id           → equipes / equipes_disp.id
--   contrato_id         → contratos.id
--   colaborador_id      → colaboradores.id
--   filial_id           → filiais.id
--   projeto_id          → sot_projetos / projetos (quando a programação já tiver)
-- centro_custo é texto (igual lancamentos.centro_custo), não há centro_custo_id no modelo de frota.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.frotas_pedagios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  veiculo_id uuid,
  placa text,
  placa_normalizada text,
  modelo text,
  motorista text,
  colaborador_id uuid,
  data_hora timestamptz NOT NULL DEFAULT now(),
  valor numeric NOT NULL DEFAULT 0,
  praca text,
  rodovia text,
  concessionaria text,
  origem text NOT NULL DEFAULT 'manual',
  tipo text NOT NULL DEFAULT 'PASSAGEM',
  status text NOT NULL DEFAULT 'PENDENTE',
  apropriacao_status text NOT NULL DEFAULT 'PENDENTE',
  portaria_saida_id uuid,
  equipe_id uuid,
  equipe_nome text,
  contrato_id uuid,
  contrato_nome text,
  projeto_id uuid,
  projeto_nome text,
  centro_custo text,
  filial_id uuid,
  base_nome text,
  fatura_id uuid,
  hash_deduplicacao text,
  motivo_sem_apropriacao text,
  observacao text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz,
  criado_por text,
  atualizado_por text
);

COMMENT ON TABLE public.frotas_pedagios IS
  'Passagens de pedágio (Frotas → Pedágios). Fonte única do custo operacional. Fatura = conciliação, não custo.';
COMMENT ON COLUMN public.frotas_pedagios.tipo IS 'PASSAGEM (custo) ou FATURA (conciliação/pagamento).';
COMMENT ON COLUMN public.frotas_pedagios.status IS
  'PENDENTE | VALIDADO | CONCILIADO | CANCELADO | POSSIVEL_DUPLICIDADE | DIVERGENTE';
COMMENT ON COLUMN public.frotas_pedagios.apropriacao_status IS
  'PENDENTE | APROPRIADO | SEM_APROPRIACAO';
COMMENT ON COLUMN public.frotas_pedagios.data_hora IS
  'Data/hora da passagem (competência operacional). Não usar vencimento da fatura.';
COMMENT ON COLUMN public.frotas_pedagios.fatura_id IS
  'Vínculo opcional da passagem à fatura de conciliação. A fatura não entra no custo.';

ALTER TABLE public.frotas_pedagios
  ADD COLUMN IF NOT EXISTS veiculo_id uuid,
  ADD COLUMN IF NOT EXISTS placa text,
  ADD COLUMN IF NOT EXISTS placa_normalizada text,
  ADD COLUMN IF NOT EXISTS modelo text,
  ADD COLUMN IF NOT EXISTS motorista text,
  ADD COLUMN IF NOT EXISTS colaborador_id uuid,
  ADD COLUMN IF NOT EXISTS data_hora timestamptz,
  ADD COLUMN IF NOT EXISTS valor numeric,
  ADD COLUMN IF NOT EXISTS praca text,
  ADD COLUMN IF NOT EXISTS rodovia text,
  ADD COLUMN IF NOT EXISTS concessionaria text,
  ADD COLUMN IF NOT EXISTS origem text,
  ADD COLUMN IF NOT EXISTS tipo text,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS apropriacao_status text,
  ADD COLUMN IF NOT EXISTS portaria_saida_id uuid,
  ADD COLUMN IF NOT EXISTS equipe_id uuid,
  ADD COLUMN IF NOT EXISTS equipe_nome text,
  ADD COLUMN IF NOT EXISTS contrato_id uuid,
  ADD COLUMN IF NOT EXISTS contrato_nome text,
  ADD COLUMN IF NOT EXISTS projeto_id uuid,
  ADD COLUMN IF NOT EXISTS projeto_nome text,
  ADD COLUMN IF NOT EXISTS centro_custo text,
  ADD COLUMN IF NOT EXISTS filial_id uuid,
  ADD COLUMN IF NOT EXISTS base_nome text,
  ADD COLUMN IF NOT EXISTS fatura_id uuid,
  ADD COLUMN IF NOT EXISTS hash_deduplicacao text,
  ADD COLUMN IF NOT EXISTS motivo_sem_apropriacao text,
  ADD COLUMN IF NOT EXISTS observacao text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS criado_por text,
  ADD COLUMN IF NOT EXISTS atualizado_por text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_frotas_pedagios_hash
  ON public.frotas_pedagios (hash_deduplicacao)
  WHERE hash_deduplicacao IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_frotas_pedagios_data
  ON public.frotas_pedagios (data_hora DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_frotas_pedagios_placa
  ON public.frotas_pedagios (placa_normalizada, data_hora DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_frotas_pedagios_contrato
  ON public.frotas_pedagios (contrato_id, data_hora DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_frotas_pedagios_status
  ON public.frotas_pedagios (status, apropriacao_status)
  WHERE deleted_at IS NULL;

ALTER TABLE public.frotas_pedagios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS frotas_pedagios_select ON public.frotas_pedagios;
CREATE POLICY frotas_pedagios_select ON public.frotas_pedagios
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS frotas_pedagios_write ON public.frotas_pedagios;
CREATE POLICY frotas_pedagios_write ON public.frotas_pedagios
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.frotas_pedagios TO authenticated;
GRANT ALL ON public.frotas_pedagios TO service_role;
