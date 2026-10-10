-- ETAPA 1.3 — CONFERÊNCIA SOMENTE LEITURA do que a migration 20261009193000 deixou no banco. Não grava nada.
-- Rodar no SQL Editor DEPOIS de aplicar a migration (antes dela, as contagens dos itens 23–25 dão "relation does not exist").
-- Cada linha: item, esperado, encontrado, ok. Tudo deve sair ok = true.
-- Itens 23–25 valem antes do primeiro envio de LMS; depois do primeiro envio, só eles mudam.
WITH
tabelas AS (
  SELECT c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace
    AND c.relname IN ('sot_lms_importacoes', 'sot_lms_linhas', 'sot_lms_importacao_eventos')
),
funcoes AS (
  SELECT p.oid, p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') AS cfg
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND (p.proname LIKE 'sot\_lms\_%' OR p.proname IN ('fn_proj_texto_norm', 'fn_proj_codigo_norm'))
),
politicas_storage AS (
  SELECT policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') AS regra
  FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
),
bucket AS (
  SELECT public, file_size_limit, array_to_string(allowed_mime_types, ',') AS mimes
  FROM storage.buckets
  WHERE id = 'proj-lms'
),
sequencia AS (
  SELECT c.oid FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S' AND c.relname = 'sot_lms_importacao_eventos_id_seq'
),
itens(ordem, item, esperado, encontrado) AS (
  SELECT 1, 'tabelas criadas', '3', (SELECT count(*) FROM tabelas)::text
  UNION ALL SELECT 2, 'RLS ENABLE + FORCE nas 3 tabelas', '3',
    (SELECT count(*) FROM tabelas WHERE relrowsecurity AND relforcerowsecurity)::text
  UNION ALL SELECT 3, 'policies nas 3 tabelas (leitura só por RPC)', '0',
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
       AND tablename IN ('sot_lms_importacoes', 'sot_lms_linhas', 'sot_lms_importacao_eventos'))::text
  UNION ALL SELECT 4, 'funções criadas', '12', (SELECT count(*) FROM funcoes)::text
  UNION ALL SELECT 5, 'funções com search_path fixo', '12',
    (SELECT count(*) FROM funcoes WHERE cfg LIKE 'search_path=%')::text
  UNION ALL SELECT 6, 'funções SECURITY DEFINER',
    'sot_lms_autorizar,sot_lms_autorizar_recebimento,sot_lms_importacao_consultar,sot_lms_importacao_registrar',
    (SELECT string_agg(proname, ',' ORDER BY proname COLLATE "C") FROM funcoes WHERE prosecdef)
  UNION ALL SELECT 7, 'gatilhos de imutabilidade', '8',
    (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg\_sot\_lms\_%' AND NOT tgisinternal)::text
  UNION ALL SELECT 8, 'colunas *_norm calculadas pelo banco', '6',
    (SELECT count(*) FROM pg_attribute
      WHERE attrelid = to_regclass('public.sot_lms_linhas') AND attgenerated = 's' AND NOT attisdropped)::text
  UNION ALL SELECT 9, 'unicidade projeto + hash', '1',
    (SELECT count(*) FROM pg_constraint WHERE conname = 'sot_lms_importacoes_projeto_hash_key')::text
  UNION ALL SELECT 10, 'FK de sot_lms_importacoes para outra tabela (sot_projetos)', '0',
    (SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND conrelid = to_regclass('public.sot_lms_importacoes'))::text
  UNION ALL SELECT 11, 'FKs de linhas/eventos para importações', '2',
    (SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND confrelid = to_regclass('public.sot_lms_importacoes'))::text
  UNION ALL SELECT 12, 'anon com algum privilégio nas 3 tabelas', '0',
    (SELECT count(*) FROM tabelas t, unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) x(p)
      WHERE has_table_privilege('anon', t.oid, x.p))::text
  UNION ALL SELECT 13, 'authenticated com algum privilégio nas 3 tabelas', '0',
    (SELECT count(*) FROM tabelas t, unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) x(p)
      WHERE has_table_privilege('authenticated', t.oid, x.p))::text
  UNION ALL SELECT 14, 'privilégios de service_role nas 3 tabelas', 'sot_lms_importacoes:SELECT',
    (SELECT string_agg(t.relname || ':' || x.p, ',' ORDER BY t.relname, x.p)
       FROM tabelas t, unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) x(p)
      WHERE has_table_privilege('service_role', t.oid, x.p))
  UNION ALL SELECT 15, 'sequência dos eventos usável por anon/authenticated/service_role', '0',
    (SELECT count(*) FROM sequencia s, unnest(ARRAY['anon', 'authenticated', 'service_role']) r(papel),
                          unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) x(p)
      WHERE has_sequence_privilege(r.papel, s.oid, x.p))::text
  UNION ALL SELECT 16, 'funções executáveis por anon', '0',
    (SELECT count(*) FROM funcoes f WHERE has_function_privilege('anon', f.oid, 'EXECUTE'))::text
  UNION ALL SELECT 17, 'funções executáveis por authenticated',
    'fn_proj_codigo_norm,fn_proj_texto_norm,sot_lms_autorizar_recebimento,sot_lms_importacao_consultar,sot_lms_linha_raw_valida',
    (SELECT string_agg(f.proname, ',' ORDER BY f.proname COLLATE "C")
       FROM funcoes f WHERE has_function_privilege('authenticated', f.oid, 'EXECUTE'))
  UNION ALL SELECT 18, 'funções executáveis por service_role',
    'fn_proj_codigo_norm,fn_proj_texto_norm,sot_lms_importacao_registrar,sot_lms_linha_raw_valida',
    (SELECT string_agg(f.proname, ',' ORDER BY f.proname COLLATE "C")
       FROM funcoes f WHERE has_function_privilege('service_role', f.oid, 'EXECUTE'))
  UNION ALL SELECT 19, 'bucket proj-lms: público | limite | mime',
    'false|12582912|application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    (SELECT public::text || '|' || coalesce(file_size_limit::text, 'NULL') || '|' || coalesce(mimes, 'NULL') FROM bucket)
  UNION ALL SELECT 20, 'policies de storage.objects que valeriam para proj-lms', '0',
    (SELECT count(*) FROM politicas_storage WHERE regra NOT LIKE '%bucket_id%' OR regra LIKE '%proj-lms%')::text
  UNION ALL SELECT 21, 'normalização: '' 000123 '' | ''000000'' | ''   '' | ''abc''', '123|0|NULL|ABC',
    (SELECT coalesce(public.fn_proj_codigo_norm(' 000123 '), 'NULL') || '|' || coalesce(public.fn_proj_codigo_norm('000000'), 'NULL')
         || '|' || coalesce(public.fn_proj_codigo_norm('   '), 'NULL') || '|' || coalesce(public.fn_proj_codigo_norm('abc'), 'NULL'))
  UNION ALL SELECT 22, 'ação PROJ_IMPORTAR_LMS ativa', '1',
    (SELECT count(*) FROM public.cena_acoes WHERE codigo = 'PROJ_IMPORTAR_LMS' AND ativo IS TRUE)::text
  UNION ALL SELECT 23, 'importações (antes do primeiro envio)', '0', (SELECT count(*) FROM public.sot_lms_importacoes)::text
  UNION ALL SELECT 24, 'linhas (antes do primeiro envio)', '0', (SELECT count(*) FROM public.sot_lms_linhas)::text
  UNION ALL SELECT 25, 'eventos (antes do primeiro envio)', '0', (SELECT count(*) FROM public.sot_lms_importacao_eventos)::text
  UNION ALL SELECT 26, 'public.sot_wl não criada', 'true', (to_regclass('public.sot_wl') IS NULL)::text
  UNION ALL SELECT 27, 'wl_id / lms_linha_id em sot_materiais / sot_atividades', '0',
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name IN ('sot_materiais', 'sot_atividades')
        AND column_name IN ('wl_id', 'lms_linha_id'))::text
  UNION ALL SELECT 28, 'gatilhos LMS em sot_projetos / sot_materiais / sot_atividades', '0',
    (SELECT count(*) FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
      WHERE tg.tgrelid IN (SELECT c.oid FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
                             AND c.relname IN ('sot_projetos', 'sot_materiais', 'sot_atividades'))
        AND p.proname LIKE 'sot\_lms\_%')::text
)
SELECT ordem, item, esperado, encontrado, esperado IS NOT DISTINCT FROM encontrado AS ok
FROM itens
ORDER BY ordem;
