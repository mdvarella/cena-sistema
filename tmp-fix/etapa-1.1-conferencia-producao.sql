-- ETAPA 1.1 — CONFERÊNCIA SOMENTE LEITURA do que a migration 20261007190000 deixou no banco. Não grava nada.
-- Cada linha: item, esperado, encontrado, ok. Tudo deve sair ok = true.
WITH
tabelas AS (
  SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace
    AND c.relname IN ('cena_acoes', 'cena_permissoes_acao', 'cena_permissoes_acao_eventos')
),
funcoes AS (
  SELECT p.oid, p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') AS cfg
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND (p.proname LIKE 'cena_permiss%' OR p.proname IN ('cena_pode', 'cena_contrato_ativo'))
),
politicas AS (
  SELECT tablename, policyname, cmd, roles::text AS roles
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('cena_acoes', 'cena_permissoes_acao', 'cena_permissoes_acao_eventos')
),
matriz AS (
  SELECT acao, string_agg(perfil, ',' ORDER BY perfil COLLATE "C") AS perfis
  FROM public.cena_permissoes_acao
  WHERE contrato_id IS NULL AND deleted_at IS NULL AND permitido
  GROUP BY acao
),
esperado(acao, perfis) AS (VALUES
  ('PROJ_ALTERAR_PERFIL_PROCESSO', 'admin,gestor'),
  ('PROJ_APROVAR_AVALIACAO_CENA', 'admin,coordenador,gestor'),
  ('PROJ_AVALIAR_CENA', 'admin,coordenador,escritorio,gestor'),
  ('PROJ_CONCILIAR_LMS', 'admin,administrativo,coordenador,escritorio,gestor'),
  ('PROJ_EDITAR_WL', 'admin,administrativo,coordenador,escritorio,gestor'),
  ('PROJ_IMPORTAR_LMS', 'admin,administrativo,coordenador,escritorio,gestor'),
  ('PROJ_PROGRAMAR', 'admin,administrativo,coordenador,diretoria,escritorio,gestor,supervisor'),
  ('PROJ_REALIZAR_VIABILIDADE', 'admin,coordenador,gestor,supervisor'),
  ('PROJ_REGISTRAR_RETORNO_ENEL', 'admin,administrativo,coordenador,escritorio,gestor')
),
itens(ordem, item, esperado, encontrado) AS (
  SELECT 1, 'tabelas criadas', '3', (SELECT count(*) FROM tabelas)::text
  UNION ALL SELECT 2, 'RLS ENABLE + FORCE nas 3 tabelas', '3',
    (SELECT count(*) FROM tabelas WHERE relrowsecurity AND relforcerowsecurity)::text
  UNION ALL SELECT 3, 'policies próprias (SELECT, authenticated)', '3',
    (SELECT count(*) FROM politicas
      WHERE policyname IN ('cena_acoes_select_erp', 'cena_permissoes_acao_select_admin',
                           'cena_permissoes_acao_eventos_select_admin')
        AND cmd = 'SELECT' AND roles = '{authenticated}')::text
  UNION ALL SELECT 4, 'policies totais nas 3 tabelas', '3', (SELECT count(*) FROM politicas)::text
  UNION ALL SELECT 5, 'funções criadas', '10', (SELECT count(*) FROM funcoes)::text
  UNION ALL SELECT 6, 'funções com search_path = public, pg_temp', '10',
    (SELECT count(*) FROM funcoes WHERE cfg LIKE '%search_path=public, pg_temp%')::text
  UNION ALL SELECT 7, 'gatilhos da matriz e do histórico', '4',
    (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_cena_permissoes%')::text
  UNION ALL SELECT 8, 'ações no catálogo', '9', (SELECT count(*) FROM public.cena_acoes)::text
  UNION ALL SELECT 9, 'regras globais vivas permitidas', '40',
    (SELECT count(*) FROM public.cena_permissoes_acao WHERE contrato_id IS NULL AND deleted_at IS NULL AND permitido)::text
  UNION ALL SELECT 10, 'regras por contrato', '0',
    (SELECT count(*) FROM public.cena_permissoes_acao WHERE contrato_id IS NOT NULL)::text
  UNION ALL SELECT 11, 'ações com perfis diferentes da matriz aprovada', '0',
    (SELECT count(*) FROM esperado e FULL JOIN matriz m USING (acao) WHERE e.perfis IS DISTINCT FROM m.perfis)::text
  UNION ALL SELECT 12, 'eventos do seed (CONCEDER, sem autor)', '40',
    (SELECT count(*) FROM public.cena_permissoes_acao_eventos
      WHERE operacao = 'CONCEDER' AND por_auth IS NULL AND motivo LIKE 'Matriz inicial%')::text
  UNION ALL SELECT 13, 'anon com algum privilégio nas 3 tabelas', '0',
    (SELECT count(*) FROM tabelas t, unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) x(p)
      WHERE has_table_privilege('anon', ('public.' || t.relname)::regclass, x.p))::text
  UNION ALL SELECT 14, 'authenticated com escrita nas 3 tabelas', '0',
    (SELECT count(*) FROM tabelas t, unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) x(p)
      WHERE has_table_privilege('authenticated', ('public.' || t.relname)::regclass, x.p))::text
  UNION ALL SELECT 15, 'funções novas executáveis por anon', '0',
    (SELECT count(*) FROM funcoes f WHERE has_function_privilege('anon', f.oid, 'EXECUTE'))::text
  UNION ALL SELECT 16, 'funções executáveis por authenticated', 'cena_pode,cena_permissao_acao_conceder,cena_permissao_acao_negar,cena_permissao_acao_revogar',
    (SELECT string_agg(f.proname, ',' ORDER BY CASE f.proname WHEN 'cena_pode' THEN 0 ELSE 1 END, f.proname)
       FROM funcoes f WHERE has_function_privilege('authenticated', f.oid, 'EXECUTE'))
)
SELECT ordem, item, esperado, encontrado, esperado = encontrado AS ok
FROM itens
ORDER BY ordem;
