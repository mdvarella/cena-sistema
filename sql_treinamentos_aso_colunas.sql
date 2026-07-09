-- =============================================================================
-- ERP CENA — Adicionar colunas de ASO na tabela treinamentos
-- Objetivo: permitir guardar RESULTADO, MEDICO e CLINICA dos exames ASO.
-- Seguro: idempotente (IF NOT EXISTS), nao altera dados nem colunas existentes.
-- Rodar no Supabase → SQL Editor.
-- =============================================================================

ALTER TABLE treinamentos ADD COLUMN IF NOT EXISTS resultado text;
ALTER TABLE treinamentos ADD COLUMN IF NOT EXISTS medico    text;
ALTER TABLE treinamentos ADD COLUMN IF NOT EXISTS clinica   text;

COMMENT ON COLUMN treinamentos.resultado IS 'ASO: Apto / Apto com restricao / Inapto (preenchido em registros nr=ASO)';
COMMENT ON COLUMN treinamentos.medico    IS 'ASO: nome do medico examinador';
COMMENT ON COLUMN treinamentos.clinica   IS 'ASO: clinica/hospital que realizou o exame';

-- Conferencia: mostra as colunas da tabela apos o ALTER
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema='public' AND table_name='treinamentos'
ORDER BY ordinal_position;
