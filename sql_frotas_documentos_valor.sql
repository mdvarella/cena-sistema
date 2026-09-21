-- sql_frotas_documentos_valor.sql
-- Aditivo / idempotente. NÃO executar pelo ERP — aplicar manualmente no Supabase.
-- Coluna de valor da multa em frotas_documentos (sem ela a importação grava a multa e omite o valor).

ALTER TABLE frotas_documentos ADD COLUMN IF NOT EXISTS valor numeric;

COMMENT ON COLUMN frotas_documentos.valor IS 'Valor da multa (R$).';
