-- =============================================================================
-- ERP CENA — Viabilidade Fase 2: colunas da grade de tipos de equipe
-- equipes_por_veiculo: quantas equipes dividem o veículo (turnos) — para rateio
-- qtd_equipes_prevista: quantas equipes desse tipo estão previstas
-- Seguro: idempotente. Rodar no Supabase → SQL Editor ANTES de usar na grade.
-- =============================================================================
ALTER TABLE contrato_tipos_equipe_premissas
  ADD COLUMN IF NOT EXISTS equipes_por_veiculo integer DEFAULT 1;
ALTER TABLE contrato_tipos_equipe_premissas
  ADD COLUMN IF NOT EXISTS qtd_equipes_prevista numeric DEFAULT 0;

SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='contrato_tipos_equipe_premissas'
ORDER BY ordinal_position;
