-- Viabilidade: regime tributário (Lucro Real / Presumido) + ISS
-- Rodar no Supabase SQL Editor.

ALTER TABLE contrato_viabilidade_premissas
  ADD COLUMN IF NOT EXISTS regime_tributario text DEFAULT 'presumido';

ALTER TABLE contrato_viabilidade_premissas
  ADD COLUMN IF NOT EXISTS iss_percentual numeric(6,3) DEFAULT 5;

COMMENT ON COLUMN contrato_viabilidade_premissas.regime_tributario IS
  'Lucro Real ou Presumido — abatimento de impostos na DRE da Viabilidade (presumido|real).';

COMMENT ON COLUMN contrato_viabilidade_premissas.iss_percentual IS
  'Alíquota ISS % aplicada sobre a receita bruta na simulação de resultado.';

-- Garante valores válidos em linhas existentes
UPDATE contrato_viabilidade_premissas
SET regime_tributario = COALESCE(NULLIF(TRIM(regime_tributario), ''), 'presumido')
WHERE regime_tributario IS NULL OR TRIM(regime_tributario) = '';

UPDATE contrato_viabilidade_premissas
SET iss_percentual = 5
WHERE iss_percentual IS NULL;
