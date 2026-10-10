-- SEGURANÇA — documentos RH / Entrada Inteligente / SESMT / Frotas (fase 1, 8 tabelas)
-- Estado de produção conferido em 09/10/2026 (RLS ativo, sem FORCE):
--   policies FOR ALL USING (true) WITH CHECK (true) para anon e authenticated
--   (frotas_motorista_documentos: fmd_all para PUBLIC; sesmt_documentos_colab: "Acesso total" + cena_anon_all);
--   GRANT SELECT/INSERT/UPDATE/DELETE para anon e authenticated nas 8 tabelas.
-- Depois desta migration:
--   * anon: zero acesso às 8 tabelas;
--   * authenticated: só usuário ERP ativo (auth.uid() -> usuarios_sistema.auth_user_id), por perfil (lista fechada),
--     com regra de leitura separada da regra de escrita; perfil fora das listas não acessa nada;
--   * DELETE só em rh_contratacao_documentos (único uso no sistema); nas outras, exclusão é lógica (UPDATE).
-- Matriz aprovada pelo gestor em 09/10/2026 (grupo RH = admin, diretoria, gestor, administrativo, dp, rh):
--   rh_contratacoes, rh_contratacao_documentos  ler/editar: grupo RH
--   rh_remuneracao_pisos   ler: grupo RH; editar: admin, diretoria, dp, rh (gestor e administrativo só leem)
--   rh_colaborador_documentos, rh_documento_ia_lotes, rh_documento_ia_itens
--                          ler/editar: grupo RH + sesmt (temporário: sesmt vê tudo — ver FASE 2)
--   sesmt_documentos_colab ler/editar: grupo RH, sesmt, coordenador, supervisor, supervisor_tma, escritorio, encarregado
--   frotas_motorista_documentos
--                          ler: grupo RH, sesmt, gerente_frotas, supervisor_frotas, coordenador, supervisor,
--                               supervisor_tma, escritorio, encarregado, portaria
--                          editar: grupo RH, gerente_frotas, supervisor_frotas (sesmt não grava CNH)
--   gerente_frotas e supervisor_frotas: só leitura e escrita de documentos de motorista.
-- FASE 2 SEGURANÇA RH/SESMT (dívida obrigatória): colunas area e criado_por_auth com valores controlados e
-- preenchimento confiável na fila da Entrada Inteligente e no Dossiê; depois, policies por área/dono.
-- Sem FORCE ROW LEVEL SECURITY: o dono das tabelas (SQL Editor) segue sem RLS; em 09/10/2026 não há função
-- SECURITY DEFINER sobre estas tabelas e os 3 gatilhos existentes só preenchem atualizado_em.
-- service_role tem BYPASSRLS e não depende destas policies (Edges de DocuSign/ZapSign).
-- Guarda policies, grants (PUBLIC/anon/authenticated/service_role) e estado do RLS em cena_seg_snapshot_20261009;
-- o bloco "Para desfazer" volta exatamente a esse estado e remove as funções cena_seg_* e o snapshot.
-- PRÉ-REQUISITOS: 20261004190000 aplicada; sem uso da chave anon nessas tabelas (pg_stat_statements, 09/10/2026).
-- Não altera dados, storage, TMA, Portaria nem ENEL/WL. Idempotente.

BEGIN;

-- ── 0. Pré-condições (falha inteira, nada é aplicado) ────────────────────
DO $$
DECLARE
  v_t text;
  v_fora text;
BEGIN
  IF to_regprocedure('public.cena_usuario_perfil_sessao()') IS NULL THEN
    RAISE EXCEPTION 'aplique antes 20261004190000_seguranca_usuarios_sistema.sql';
  END IF;
  FOREACH v_t IN ARRAY ARRAY['frotas_motorista_documentos', 'rh_colaborador_documentos', 'rh_contratacao_documentos',
                             'rh_contratacoes', 'rh_documento_ia_itens', 'rh_documento_ia_lotes',
                             'rh_remuneracao_pisos', 'sesmt_documentos_colab'] LOOP
    IF to_regclass('public.' || v_t) IS NULL THEN
      RAISE EXCEPTION 'tabela public.% não existe', v_t;
    END IF;
  END LOOP;

  IF to_regclass('public.cena_seg_snapshot_20261009') IS NULL
     AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'cena\_seg\_%') THEN
    RAISE EXCEPTION 'já existem funções public.cena_seg_* fora desta migration — revise antes de aplicar';
  END IF;

  SELECT string_agg(p.tablename || '.' || p.policyname, ', ' ORDER BY p.tablename, p.policyname)
    INTO v_fora
    FROM pg_policies p
   WHERE p.schemaname = 'public'
     AND p.tablename IN ('frotas_motorista_documentos', 'rh_colaborador_documentos', 'rh_contratacao_documentos',
                         'rh_contratacoes', 'rh_documento_ia_itens', 'rh_documento_ia_lotes',
                         'rh_remuneracao_pisos', 'sesmt_documentos_colab')
     AND p.policyname NOT IN ('seg_select', 'seg_insert', 'seg_update', 'seg_delete')
     AND (p.tablename, p.policyname) NOT IN (
       ('frotas_motorista_documentos', 'fmd_all'),
       ('rh_colaborador_documentos', 'rh_fase3_anon_all'), ('rh_colaborador_documentos', 'rh_fase3_authenticated_all'),
       ('rh_contratacao_documentos', 'rh_c1_anon_all'), ('rh_contratacao_documentos', 'rh_c1_authenticated_all'),
       ('rh_contratacoes', 'rh_c1_anon_all'), ('rh_contratacoes', 'rh_c1_authenticated_all'),
       ('rh_documento_ia_itens', 'rh_ia2_anon_all'), ('rh_documento_ia_itens', 'rh_ia2_authenticated_all'),
       ('rh_documento_ia_lotes', 'rh_ia2_anon_all'), ('rh_documento_ia_lotes', 'rh_ia2_authenticated_all'),
       ('rh_remuneracao_pisos', 'rh_c12_anon_all'), ('rh_remuneracao_pisos', 'rh_c12_authenticated_all'),
       ('sesmt_documentos_colab', 'Acesso total'), ('sesmt_documentos_colab', 'cena_anon_all'));
  IF v_fora IS NOT NULL THEN
    RAISE EXCEPTION 'policies fora do estado conferido em 09/10/2026: % — revise antes de aplicar', v_fora;
  END IF;
END $$;

-- ── 1. Snapshot do estado anterior (só na 1ª execução) ───────────────────
CREATE TABLE IF NOT EXISTS public.cena_seg_snapshot_20261009 (
  id bigserial PRIMARY KEY,
  tipo text NOT NULL CHECK (tipo IN ('policy', 'grant', 'rls')),
  tabela text NOT NULL,
  nome text NOT NULL,
  definicao jsonb NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cena_seg_snapshot_20261009 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cena_seg_snapshot_20261009 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.cena_seg_snapshot_20261009_id_seq FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.cena_seg_snapshot_20261009) THEN
    RETURN;
  END IF;
  INSERT INTO public.cena_seg_snapshot_20261009 (tipo, tabela, nome, definicao)
  SELECT 'policy', p.tablename, p.policyname,
         jsonb_build_object('permissive', p.permissive, 'roles', to_jsonb(p.roles::text[]),
                            'cmd', p.cmd, 'qual', p.qual, 'with_check', p.with_check)
    FROM pg_policies p
   WHERE p.schemaname = 'public'
     AND p.tablename IN ('frotas_motorista_documentos', 'rh_colaborador_documentos', 'rh_contratacao_documentos',
                         'rh_contratacoes', 'rh_documento_ia_itens', 'rh_documento_ia_lotes',
                         'rh_remuneracao_pisos', 'sesmt_documentos_colab')
   ORDER BY p.tablename, p.policyname;

  INSERT INTO public.cena_seg_snapshot_20261009 (tipo, tabela, nome, definicao)
  SELECT 'grant', c.relname, x.grantee,
         jsonb_build_object('privilegios', jsonb_agg(DISTINCT x.privilege_type ORDER BY x.privilege_type))
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    CROSS JOIN LATERAL (
      SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee, a.privilege_type
        FROM aclexplode(c.relacl) a
    ) x
   WHERE c.relname IN ('frotas_motorista_documentos', 'rh_colaborador_documentos', 'rh_contratacao_documentos',
                       'rh_contratacoes', 'rh_documento_ia_itens', 'rh_documento_ia_lotes',
                       'rh_remuneracao_pisos', 'sesmt_documentos_colab')
     AND x.grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
   GROUP BY c.relname, x.grantee
   ORDER BY c.relname, x.grantee;

  INSERT INTO public.cena_seg_snapshot_20261009 (tipo, tabela, nome, definicao)
  SELECT 'rls', c.relname, 'rls', jsonb_build_object('rls', c.relrowsecurity, 'force', c.relforcerowsecurity)
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relname IN ('frotas_motorista_documentos', 'rh_colaborador_documentos', 'rh_contratacao_documentos',
                       'rh_contratacoes', 'rh_documento_ia_itens', 'rh_documento_ia_lotes',
                       'rh_remuneracao_pisos', 'sesmt_documentos_colab')
   ORDER BY c.relname;
END $$;

-- ── 2. Quem pode (somente auth.uid() -> usuarios_sistema.auth_user_id) ───
CREATE OR REPLACE FUNCTION public.cena_seg_perfil_em(p_perfis text[])
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(public.cena_usuario_perfil_sessao() = ANY (p_perfis), false)
$$;

-- Contratação / promoção / seleção (rhModuloPermitido).
CREATE OR REPLACE FUNCTION public.cena_seg_rh_ler()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT public.cena_seg_perfil_em(ARRAY['admin', 'diretoria', 'gestor', 'administrativo', 'dp', 'rh'])
$$;
CREATE OR REPLACE FUNCTION public.cena_seg_rh_editar()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT public.cena_seg_perfil_em(ARRAY['admin', 'diretoria', 'gestor', 'administrativo', 'dp', 'rh'])
$$;

-- Pisos: lidos por Contratação e Benefícios; gravados em Pisos e Benefícios.
CREATE OR REPLACE FUNCTION public.cena_seg_remuneracao_ler()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT public.cena_seg_perfil_em(ARRAY['admin', 'diretoria', 'gestor', 'administrativo', 'dp', 'rh'])
$$;
CREATE OR REPLACE FUNCTION public.cena_seg_remuneracao_editar()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT public.cena_seg_perfil_em(ARRAY['admin', 'diretoria', 'dp', 'rh'])
$$;

-- Dossiê: sesmt grava pela Entrada Inteligente e lê na Evolução (sem escopo por área: não há coluna confiável).
CREATE OR REPLACE FUNCTION public.cena_seg_dossie_ler()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT public.cena_seg_perfil_em(ARRAY['admin', 'diretoria', 'gestor', 'administrativo', 'dp', 'rh', 'sesmt'])
$$;
CREATE OR REPLACE FUNCTION public.cena_seg_dossie_editar()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT public.cena_seg_perfil_em(ARRAY['admin', 'diretoria', 'gestor', 'administrativo', 'dp', 'rh', 'sesmt'])
$$;

-- Entrada Inteligente (rh-entrada-ia): a fila não tem criador nem área confiáveis.
CREATE OR REPLACE FUNCTION public.cena_seg_entrada_ia_ler()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT public.cena_seg_perfil_em(ARRAY['admin', 'diretoria', 'gestor', 'administrativo', 'dp', 'rh', 'sesmt'])
$$;
CREATE OR REPLACE FUNCTION public.cena_seg_entrada_ia_editar()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT public.cena_seg_perfil_em(ARRAY['admin', 'diretoria', 'gestor', 'administrativo', 'dp', 'rh', 'sesmt'])
$$;

-- Checklist SESMT: lido no Dashboard SESMT / Evolução; gravado na Evolução e no Dossiê RH.
CREATE OR REPLACE FUNCTION public.cena_seg_checklist_sesmt_ler()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT public.cena_seg_perfil_em(ARRAY['admin', 'diretoria', 'gestor', 'administrativo', 'dp', 'rh', 'sesmt',
                                         'coordenador', 'supervisor', 'supervisor_tma', 'escritorio', 'encarregado'])
$$;
CREATE OR REPLACE FUNCTION public.cena_seg_checklist_sesmt_editar()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT public.cena_seg_perfil_em(ARRAY['admin', 'diretoria', 'gestor', 'administrativo', 'dp', 'rh', 'sesmt',
                                         'coordenador', 'supervisor', 'supervisor_tma', 'escritorio', 'encarregado'])
$$;

-- CNH: lida nas páginas de Frotas (inclusive Portaria), no RH e na Entrada Inteligente;
-- gravada em Frotas → Documentos e pela Entrada Inteligente do RH.
CREATE OR REPLACE FUNCTION public.cena_seg_motorista_ler()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT public.cena_seg_perfil_em(ARRAY['admin', 'diretoria', 'gestor', 'administrativo', 'dp', 'rh', 'sesmt',
                                         'gerente_frotas', 'supervisor_frotas', 'coordenador', 'supervisor',
                                         'supervisor_tma', 'escritorio', 'encarregado', 'portaria'])
$$;
CREATE OR REPLACE FUNCTION public.cena_seg_motorista_editar()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT public.cena_seg_perfil_em(ARRAY['admin', 'diretoria', 'gestor', 'gerente_frotas', 'supervisor_frotas',
                                         'administrativo', 'dp', 'rh'])
$$;

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['cena_seg_perfil_em(text[])', 'cena_seg_rh_ler()', 'cena_seg_rh_editar()',
                           'cena_seg_remuneracao_ler()', 'cena_seg_remuneracao_editar()',
                           'cena_seg_dossie_ler()', 'cena_seg_dossie_editar()',
                           'cena_seg_entrada_ia_ler()', 'cena_seg_entrada_ia_editar()',
                           'cena_seg_checklist_sesmt_ler()', 'cena_seg_checklist_sesmt_editar()',
                           'cena_seg_motorista_ler()', 'cena_seg_motorista_editar()'] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION public.' || f || ' FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.' || f || ' TO authenticated, service_role';
  END LOOP;
END $$;

-- ── 3. Policies antigas (nomes conferidos em produção) ───────────────────
DROP POLICY IF EXISTS fmd_all ON public.frotas_motorista_documentos;
DROP POLICY IF EXISTS rh_fase3_anon_all ON public.rh_colaborador_documentos;
DROP POLICY IF EXISTS rh_fase3_authenticated_all ON public.rh_colaborador_documentos;
DROP POLICY IF EXISTS rh_c1_anon_all ON public.rh_contratacao_documentos;
DROP POLICY IF EXISTS rh_c1_authenticated_all ON public.rh_contratacao_documentos;
DROP POLICY IF EXISTS rh_c1_anon_all ON public.rh_contratacoes;
DROP POLICY IF EXISTS rh_c1_authenticated_all ON public.rh_contratacoes;
DROP POLICY IF EXISTS rh_ia2_anon_all ON public.rh_documento_ia_itens;
DROP POLICY IF EXISTS rh_ia2_authenticated_all ON public.rh_documento_ia_itens;
DROP POLICY IF EXISTS rh_ia2_anon_all ON public.rh_documento_ia_lotes;
DROP POLICY IF EXISTS rh_ia2_authenticated_all ON public.rh_documento_ia_lotes;
DROP POLICY IF EXISTS rh_c12_anon_all ON public.rh_remuneracao_pisos;
DROP POLICY IF EXISTS rh_c12_authenticated_all ON public.rh_remuneracao_pisos;
DROP POLICY IF EXISTS "Acesso total" ON public.sesmt_documentos_colab;
DROP POLICY IF EXISTS cena_anon_all ON public.sesmt_documentos_colab;

-- ── 4. RLS, grants e policies por comando ────────────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('rh_contratacoes',             'cena_seg_rh_ler',               'cena_seg_rh_editar',               false),
      ('rh_contratacao_documentos',   'cena_seg_rh_ler',               'cena_seg_rh_editar',               true),
      ('rh_remuneracao_pisos',        'cena_seg_remuneracao_ler',      'cena_seg_remuneracao_editar',      false),
      ('rh_colaborador_documentos',   'cena_seg_dossie_ler',           'cena_seg_dossie_editar',           false),
      ('rh_documento_ia_lotes',       'cena_seg_entrada_ia_ler',       'cena_seg_entrada_ia_editar',       false),
      ('rh_documento_ia_itens',       'cena_seg_entrada_ia_ler',       'cena_seg_entrada_ia_editar',       false),
      ('sesmt_documentos_colab',      'cena_seg_checklist_sesmt_ler',  'cena_seg_checklist_sesmt_editar',  false),
      ('frotas_motorista_documentos', 'cena_seg_motorista_ler',        'cena_seg_motorista_editar',        false)
    ) AS v(tabela, ler, editar, apaga)
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tabela);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', r.tabela);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public.%I TO authenticated', r.tabela);
    IF r.apaga THEN
      EXECUTE format('GRANT DELETE ON TABLE public.%I TO authenticated', r.tabela);
    END IF;
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', r.tabela);

    EXECUTE format('DROP POLICY IF EXISTS seg_select ON public.%I', r.tabela);
    EXECUTE format('DROP POLICY IF EXISTS seg_insert ON public.%I', r.tabela);
    EXECUTE format('DROP POLICY IF EXISTS seg_update ON public.%I', r.tabela);
    EXECUTE format('DROP POLICY IF EXISTS seg_delete ON public.%I', r.tabela);
    EXECUTE format('CREATE POLICY seg_select ON public.%I FOR SELECT TO authenticated USING ((SELECT public.%I()))',
                   r.tabela, r.ler);
    EXECUTE format('CREATE POLICY seg_insert ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT public.%I()))',
                   r.tabela, r.editar);
    EXECUTE format('CREATE POLICY seg_update ON public.%I FOR UPDATE TO authenticated USING ((SELECT public.%I())) WITH CHECK ((SELECT public.%I()))',
                   r.tabela, r.editar, r.editar);
    IF r.apaga THEN
      EXECUTE format('CREATE POLICY seg_delete ON public.%I FOR DELETE TO authenticated USING ((SELECT public.%I()))',
                     r.tabela, r.editar);
    END IF;
  END LOOP;
END $$;

-- ── 5. Conferência final (falha inteira se sobrar acesso indevido) ───────
DO $$
DECLARE
  v_t text;
BEGIN
  FOREACH v_t IN ARRAY ARRAY['frotas_motorista_documentos', 'rh_colaborador_documentos', 'rh_contratacao_documentos',
                             'rh_contratacoes', 'rh_documento_ia_itens', 'rh_documento_ia_lotes',
                             'rh_remuneracao_pisos', 'sesmt_documentos_colab'] LOOP
    IF has_table_privilege('anon', 'public.' || v_t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') THEN
      RAISE EXCEPTION 'anon ainda tem acesso a public.%', v_t;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = v_t
                AND (p.policyname NOT LIKE 'seg\_%' OR p.cmd = 'ALL'
                     OR p.qual = 'true' OR p.with_check = 'true' OR 'anon' = ANY (p.roles) OR 'public' = ANY (p.roles))) THEN
      RAISE EXCEPTION 'ainda há policy aberta em public.%', v_t;
    END IF;
  END LOOP;
END $$;

COMMIT;

-- Validação
-- SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--  WHERE n.nspname = 'public' AND c.relname IN ('frotas_motorista_documentos', 'rh_colaborador_documentos', 'rh_contratacao_documentos',
--    'rh_contratacoes', 'rh_documento_ia_itens', 'rh_documento_ia_lotes', 'rh_remuneracao_pisos', 'sesmt_documentos_colab');
-- SELECT tablename, policyname, roles, cmd, qual, with_check FROM pg_policies
--  WHERE schemaname = 'public' AND policyname LIKE 'seg\_%' ORDER BY tablename, policyname;
-- SELECT r.rolname, t.t,
--        has_table_privilege(r.rolname, 'public.' || t.t, 'SELECT') sel, has_table_privilege(r.rolname, 'public.' || t.t, 'INSERT') ins,
--        has_table_privilege(r.rolname, 'public.' || t.t, 'UPDATE') upd, has_table_privilege(r.rolname, 'public.' || t.t, 'DELETE') del
--   FROM pg_roles r CROSS JOIN unnest(ARRAY['frotas_motorista_documentos', 'rh_colaborador_documentos', 'rh_contratacao_documentos',
--        'rh_contratacoes', 'rh_documento_ia_itens', 'rh_documento_ia_lotes', 'rh_remuneracao_pisos', 'sesmt_documentos_colab']) t(t)
--  WHERE r.rolname IN ('anon', 'authenticated') ORDER BY 1, 2;
-- SELECT tipo, count(*) FROM public.cena_seg_snapshot_20261009 GROUP BY tipo ORDER BY tipo;

-- Para desfazer (volta exatamente ao snapshot: policies, grants de PUBLIC/anon/authenticated/service_role e RLS/FORCE
-- das 8 tabelas; remove as funções cena_seg_* e a tabela de snapshot)
-- BEGIN;
-- DO $$
-- DECLARE
--   s record;
--   v_t text;
--   v_roles text;
--   v_sql text;
-- BEGIN
--   IF to_regclass('public.cena_seg_snapshot_20261009') IS NULL THEN
--     RAISE EXCEPTION 'snapshot ausente: rollback abortado';
--   END IF;
--   IF (SELECT count(*) FROM public.cena_seg_snapshot_20261009 WHERE tipo = 'rls') <> 8 THEN
--     RAISE EXCEPTION 'snapshot incompleto: rollback abortado';
--   END IF;
--   FOREACH v_t IN ARRAY ARRAY['frotas_motorista_documentos', 'rh_colaborador_documentos', 'rh_contratacao_documentos',
--                              'rh_contratacoes', 'rh_documento_ia_itens', 'rh_documento_ia_lotes',
--                              'rh_remuneracao_pisos', 'sesmt_documentos_colab'] LOOP
--     EXECUTE format('DROP POLICY IF EXISTS seg_select ON public.%I', v_t);
--     EXECUTE format('DROP POLICY IF EXISTS seg_insert ON public.%I', v_t);
--     EXECUTE format('DROP POLICY IF EXISTS seg_update ON public.%I', v_t);
--     EXECUTE format('DROP POLICY IF EXISTS seg_delete ON public.%I', v_t);
--     EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', v_t);
--   END LOOP;
--   FOR s IN SELECT tabela, nome, definicao FROM public.cena_seg_snapshot_20261009 WHERE tipo = 'policy' ORDER BY id LOOP
--     SELECT string_agg(CASE WHEN r = 'public' THEN 'PUBLIC' ELSE quote_ident(r) END, ', ')
--       INTO v_roles FROM jsonb_array_elements_text(s.definicao -> 'roles') r;
--     v_sql := format('CREATE POLICY %I ON public.%I AS %s FOR %s TO %s', s.nome, s.tabela,
--                     s.definicao ->> 'permissive', s.definicao ->> 'cmd', v_roles);
--     IF s.definicao ->> 'qual' IS NOT NULL THEN v_sql := v_sql || format(' USING (%s)', s.definicao ->> 'qual'); END IF;
--     IF s.definicao ->> 'with_check' IS NOT NULL THEN v_sql := v_sql || format(' WITH CHECK (%s)', s.definicao ->> 'with_check'); END IF;
--     EXECUTE v_sql;
--   END LOOP;
--   FOR s IN SELECT tabela, nome, definicao FROM public.cena_seg_snapshot_20261009 WHERE tipo = 'grant' ORDER BY id LOOP
--     EXECUTE format('GRANT %s ON TABLE public.%I TO %s',
--                    (SELECT string_agg(p, ', ') FROM jsonb_array_elements_text(s.definicao -> 'privilegios') p),
--                    s.tabela, CASE WHEN s.nome = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(s.nome) END);
--   END LOOP;
--   FOR s IN SELECT tabela, definicao FROM public.cena_seg_snapshot_20261009 WHERE tipo = 'rls' ORDER BY id LOOP
--     EXECUTE format('ALTER TABLE public.%I %s ROW LEVEL SECURITY', s.tabela,
--                    CASE WHEN (s.definicao ->> 'rls')::boolean THEN 'ENABLE' ELSE 'DISABLE' END);
--     EXECUTE format('ALTER TABLE public.%I %s ROW LEVEL SECURITY', s.tabela,
--                    CASE WHEN (s.definicao ->> 'force')::boolean THEN 'FORCE' ELSE 'NO FORCE' END);
--   END LOOP;
-- END $$;
-- DROP FUNCTION IF EXISTS public.cena_seg_motorista_editar();
-- DROP FUNCTION IF EXISTS public.cena_seg_motorista_ler();
-- DROP FUNCTION IF EXISTS public.cena_seg_checklist_sesmt_editar();
-- DROP FUNCTION IF EXISTS public.cena_seg_checklist_sesmt_ler();
-- DROP FUNCTION IF EXISTS public.cena_seg_entrada_ia_editar();
-- DROP FUNCTION IF EXISTS public.cena_seg_entrada_ia_ler();
-- DROP FUNCTION IF EXISTS public.cena_seg_dossie_editar();
-- DROP FUNCTION IF EXISTS public.cena_seg_dossie_ler();
-- DROP FUNCTION IF EXISTS public.cena_seg_remuneracao_editar();
-- DROP FUNCTION IF EXISTS public.cena_seg_remuneracao_ler();
-- DROP FUNCTION IF EXISTS public.cena_seg_rh_editar();
-- DROP FUNCTION IF EXISTS public.cena_seg_rh_ler();
-- DROP FUNCTION IF EXISTS public.cena_seg_perfil_em(text[]);
-- DROP TABLE public.cena_seg_snapshot_20261009;
-- COMMIT;
