-- sql_frotas_pedagios_1.sql
-- FROTAS-PEDAGIOS-1 — passagens de pedágio (fonte operacional única).
-- Aditivo / idempotente.
-- NÃO executar pelo ERP. Aplicar manualmente no SQL Editor do Supabase após aprovação.
--
-- Se a tabela já existir (tentativa anterior incompleta), este script
-- SÓ COMENTA colunas DEPOIS de garantir que elas existem (ADD COLUMN).
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
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

-- 1) Colunas primeiro (a tabela pode já existir sem elas).
ALTER TABLE public.frotas_pedagios ADD COLUMN IF NOT EXISTS veiculo_id uuid;
ALTER TABLE public.frotas_pedagios ADD COLUMN IF NOT EXISTS placa text;
ALTER TABLE public.frotas_pedagios ADD COLUMN IF NOT EXISTS placa_normalizada text;
ALTER TABLE public.frotas_pedagios ADD COLUMN IF NOT EXISTS modelo text;
ALTER TABLE public.frotas_pedagios ADD COLUMN IF NOT EXISTS motorista text;
ALTER TABLE public.frotas_pedagios ADD COLUMN IF NOT EXISTS colaborador_id uuid;
ALTER TABLE public.frotas_pedagios ADD COLUMN IF NOT EXISTS data_hora timestamptz DEFAULT now();
ALTER TABLE public.frotas_pedagios ADD COLUMN IF NOT EXISTS valor numeric DEFAULT 0;
ALTER TABLE public.frotas_pedagios ADD COLUMN IF NOT EXISTS praca text;
ALTER TABLE public.frotas_pedagios ADD COLUMN IF NOT EXISTS rodovia text;
ALTER TABLE public.frotas_pedagios ADD COLUMN IF NOT EXISTS concessionaria text;
ALTER TABLE public.frotas_pedagios ADD COLUMN IF NOT EXISTS origem text DEFAULT 'manual';
ALTER TABLE public.frotas_pedagios ADD COLUMN IF NOT EXISTS tipo text DEFAULT 'PASSAGEM';
ALTER TABLE public.frotas_pedagios ADD COLUMN IF NOT EXISTS status text DEFAULT 'PENDENTE';
ALTER TABLE public.frotas_pedagios ADD COLUMN IF NOT EXISTS apropriacao_status text DEFAULT 'PENDENTE';
ALTER TABLE public.frotas_pedagios ADD COLUMN IF NOT EXISTS portaria_saida_id uuid;
ALTER TABLE public.frotas_pedagios ADD COLUMN IF NOT EXISTS equipe_id uuid;
ALTER TABLE public.frotas_pedagios ADD COLUMN IF NOT EXISTS equipe_nome text;
ALTER TABLE public.frotas_pedagios ADD COLUMN IF NOT EXISTS contrato_id uuid;
ALTER TABLE public.frotas_pedagios ADD COLUMN IF NOT EXISTS contrato_nome text;
ALTER TABLE public.frotas_pedagios ADD COLUMN IF NOT EXISTS projeto_id uuid;
ALTER TABLE public.frotas_pedagios ADD COLUMN IF NOT EXISTS projeto_nome text;
ALTER TABLE public.frotas_pedagios ADD COLUMN IF NOT EXISTS centro_custo text;
ALTER TABLE public.frotas_pedagios ADD COLUMN IF NOT EXISTS filial_id uuid;
ALTER TABLE public.frotas_pedagios ADD COLUMN IF NOT EXISTS base_nome text;
ALTER TABLE public.frotas_pedagios ADD COLUMN IF NOT EXISTS fatura_id uuid;
ALTER TABLE public.frotas_pedagios ADD COLUMN IF NOT EXISTS hash_deduplicacao text;
ALTER TABLE public.frotas_pedagios ADD COLUMN IF NOT EXISTS motivo_sem_apropriacao text;
ALTER TABLE public.frotas_pedagios ADD COLUMN IF NOT EXISTS observacao text;
ALTER TABLE public.frotas_pedagios ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.frotas_pedagios ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.frotas_pedagios ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.frotas_pedagios ADD COLUMN IF NOT EXISTS criado_por text;
ALTER TABLE public.frotas_pedagios ADD COLUMN IF NOT EXISTS atualizado_por text;

-- 2) Comentários só depois das colunas existirem.
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
