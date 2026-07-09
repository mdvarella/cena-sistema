-- =============================================================================
-- ERP CENA — Limpeza de abastecimentos (frotas_combustivel)
-- Situação: importação rodou mais de uma vez → ~980 registros DUPLICADOS.
-- Escolha UMA das opções abaixo. Só mexe em origem='import' (manuais preservados).
-- Rodar no Supabase → SQL Editor. Depois, recarregue o ERP (F5).
-- =============================================================================

-- ── 0) PRÉVIA (seguro rodar) — quantos duplicados existem ────────────────────
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY upper(placa), data, litros, km, valor_total
    ORDER BY criado_em, id
  ) AS rn
  FROM frotas_combustivel
  WHERE origem = 'import'
)
SELECT
  (SELECT count(*) FROM frotas_combustivel WHERE origem='import') AS total_importados,
  (SELECT count(*) FROM ranked WHERE rn = 1) AS unicos_a_manter,
  (SELECT count(*) FROM ranked WHERE rn > 1) AS duplicados_a_remover;


-- ══════════════════════════════════════════════════════════════════════════
-- OPÇÃO A (RECOMENDADA) — remover SÓ as duplicidades (mantém 1 de cada)
-- ══════════════════════════════════════════════════════════════════════════
BEGIN;
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY upper(placa), data, litros, km, valor_total
    ORDER BY criado_em, id
  ) AS rn
  FROM frotas_combustivel
  WHERE origem = 'import'
)
DELETE FROM frotas_combustivel
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
COMMIT;

-- Conferência (deve mostrar 0 duplicados restantes):
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY upper(placa), data, litros, km, valor_total
    ORDER BY criado_em, id
  ) AS rn
  FROM frotas_combustivel WHERE origem='import'
)
SELECT count(*) AS duplicados_restantes FROM ranked WHERE rn > 1;


-- ══════════════════════════════════════════════════════════════════════════
-- OPÇÃO B — ZERAR TODOS os abastecimentos importados (recomeçar do zero)
-- Use APENAS se quiser apagar tudo que foi importado e reimportar depois.
-- Remova os -- das 3 linhas abaixo para executar.
-- ══════════════════════════════════════════════════════════════════════════
-- BEGIN;
-- DELETE FROM frotas_combustivel WHERE origem = 'import';
-- COMMIT;
