-- =============================================================================
-- ERP CENA — Novos campos na tabela frotas_combustivel (aba Combustível)
-- posto_endereco / posto_bairro / posto_cidade: endereço do posto
-- km_anterior + media_consumo: média (km/L) = (km atual - km anterior) / litros
-- Seguro: idempotente (IF NOT EXISTS), não altera dados existentes.
-- Rodar no Supabase → SQL Editor ANTES de usar os novos campos no sistema.
-- =============================================================================

ALTER TABLE frotas_combustivel ADD COLUMN IF NOT EXISTS posto_endereco text;
ALTER TABLE frotas_combustivel ADD COLUMN IF NOT EXISTS posto_bairro   text;
ALTER TABLE frotas_combustivel ADD COLUMN IF NOT EXISTS posto_cidade   text;
ALTER TABLE frotas_combustivel ADD COLUMN IF NOT EXISTS km_anterior    numeric;
ALTER TABLE frotas_combustivel ADD COLUMN IF NOT EXISTS media_consumo  numeric;

COMMENT ON COLUMN frotas_combustivel.media_consumo IS 'km/L = (km atual - km anterior) / litros';

-- Conferência
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='frotas_combustivel'
ORDER BY ordinal_position;
