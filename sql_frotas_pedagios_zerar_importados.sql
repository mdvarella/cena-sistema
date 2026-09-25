-- sql_frotas_pedagios_zerar_importados.sql
-- Soft-delete de pedágios IMPORTADOS em public.frotas_pedagios.
-- NÃO apaga origem = manual.
-- Aplicar no SQL Editor do Supabase. Idempotente.
-- Para reverter: UPDATE frotas_pedagios SET deleted_at = NULL WHERE ...

UPDATE public.frotas_pedagios
SET deleted_at = now()
WHERE deleted_at IS NULL
  AND lower(btrim(coalesce(origem, ''))) NOT IN ('manual');

-- Conferência:
-- SELECT origem, count(*) FROM public.frotas_pedagios WHERE deleted_at IS NULL GROUP BY 1;
