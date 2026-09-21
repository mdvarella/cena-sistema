-- sql_frotas_documentos_multa_extra.sql
-- Aditivo / idempotente. NÃO executar pelo ERP — aplicar manualmente no Supabase.
-- Campos extras de multa: município, código, tipo, gravidade, valor c/ desconto, exclusão.

ALTER TABLE frotas_documentos ADD COLUMN IF NOT EXISTS municipio_infracao text;
ALTER TABLE frotas_documentos ADD COLUMN IF NOT EXISTS codigo_infracao text;
ALTER TABLE frotas_documentos ADD COLUMN IF NOT EXISTS tipo_infracao text;
ALTER TABLE frotas_documentos ADD COLUMN IF NOT EXISTS gravidade text;
ALTER TABLE frotas_documentos ADD COLUMN IF NOT EXISTS valor_desconto numeric;
ALTER TABLE frotas_documentos ADD COLUMN IF NOT EXISTS exclusao_justificativa text;
ALTER TABLE frotas_documentos ADD COLUMN IF NOT EXISTS excluido_por text;
ALTER TABLE frotas_documentos ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMENT ON COLUMN frotas_documentos.municipio_infracao IS 'Município da infração (cidade/UF).';
COMMENT ON COLUMN frotas_documentos.codigo_infracao IS 'Código da infração (ex.: 745-50).';
COMMENT ON COLUMN frotas_documentos.tipo_infracao IS 'Tipo/natureza da infração.';
COMMENT ON COLUMN frotas_documentos.gravidade IS 'Leve, Média, Grave ou Gravíssima.';
COMMENT ON COLUMN frotas_documentos.valor_desconto IS 'Valor com desconto de pagamento antecipado.';
COMMENT ON COLUMN frotas_documentos.exclusao_justificativa IS 'Justificativa da exclusão operacional da multa.';
COMMENT ON COLUMN frotas_documentos.excluido_por IS 'Nome de quem excluiu a multa.';
