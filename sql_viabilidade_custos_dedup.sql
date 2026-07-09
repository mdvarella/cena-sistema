-- =============================================================================
-- ERP CENA — Remover custos duplicados em contrato_custos_mensais
-- Duplicidade gerada porque o sbDelete de limpeza estava quebrado (id cru).
-- Mantém 1 de cada (o mais antigo). Rodar no Supabase → SQL Editor.
-- =============================================================================

-- 0) PRÉVIA (seguro) — quantos duplicados existem
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY contrato_id, competencia, categoria_custo, valor, coalesce(origem,''), coalesce(descricao,'')
    ORDER BY criado_em, id
  ) AS rn
  FROM contrato_custos_mensais
)
SELECT count(*) FILTER (WHERE rn=1) AS manter, count(*) FILTER (WHERE rn>1) AS remover
FROM ranked;

-- 1) REMOVER duplicados (mantém o mais antigo de cada)
BEGIN;
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY contrato_id, competencia, categoria_custo, valor, coalesce(origem,''), coalesce(descricao,'')
    ORDER BY criado_em, id
  ) AS rn
  FROM contrato_custos_mensais
)
DELETE FROM contrato_custos_mensais WHERE id IN (SELECT id FROM ranked WHERE rn>1);
COMMIT;

-- 2) CONFERÊNCIA — deve dar 0
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY contrato_id, competencia, categoria_custo, valor, coalesce(origem,''), coalesce(descricao,'')
    ORDER BY criado_em, id
  ) AS rn
  FROM contrato_custos_mensais
)
SELECT count(*) AS duplicados_restantes FROM ranked WHERE rn>1;
