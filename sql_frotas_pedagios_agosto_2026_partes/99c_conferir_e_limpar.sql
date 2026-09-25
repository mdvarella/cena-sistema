-- 99c — conferência + remove staging
-- Rode depois de 99 e 99b.

SELECT count(*) AS qtd, round(sum(valor),2) AS soma
FROM public.frotas_pedagios
WHERE observacao LIKE 'IMPORT_AGOSTO_2026%'
  AND deleted_at IS NULL;
-- esperado: qtd 5427 | soma 41159.75

DROP TABLE IF EXISTS public._stg_ped_ago26;
