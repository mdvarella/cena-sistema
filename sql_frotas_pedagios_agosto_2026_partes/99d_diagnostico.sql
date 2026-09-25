-- Conferir se agosto/2026 está visível para a aba (deleted_at nulo)
SELECT
  count(*) AS qtd,
  round(sum(valor),2) AS soma,
  count(*) FILTER (WHERE deleted_at IS NULL) AS ativos,
  count(*) FILTER (WHERE deleted_at IS NOT NULL) AS apagados
FROM public.frotas_pedagios
WHERE hash_deduplicacao LIKE 'imp_ago26_%'
   OR observacao LIKE 'IMPORT_AGOSTO_2026%';

-- Se ativos = 0 e apagados > 0, rode isto para reativar:
-- UPDATE public.frotas_pedagios
-- SET deleted_at = NULL
-- WHERE deleted_at IS NOT NULL
--   AND (hash_deduplicacao LIKE 'imp_ago26_%' OR observacao LIKE 'IMPORT_AGOSTO_2026%');
