-- SECURITY GATE — usuarios_sistema / Auth / RLS
-- Fecha a autoelevação de privilégio:
--   * anon: zero acesso a usuarios_sistema;
--   * authenticated: lê somente se for usuário ERP ativo (auth.uid() → usuarios_sistema.auth_user_id);
--   * escrita somente por administrador de usuários, com campos sensíveis protegidos por gatilho;
--   * e-mail do JWT deixa de ser chave de autorização (cena_rh_pode_dados_pj e *_usuario_sessao).
-- Idempotente. Não altera dados. Guarda o estado anterior em cena_seg_snapshot_20261004 para o rollback.
-- PRÉ-REQUISITO: frontend publicado com o login lendo usuarios_sistema com o JWT da sessão
-- (sbFetchLoginUsuariosPorEmail / sbFetchLoginUsuariosPorAuthUid). Sem isso ninguém entra.

-- ── 0. Pré-condições (falha inteira, nada é aplicado) ────────────────────
DO $$
DECLARE
  v_pode_ler boolean;
BEGIN
  IF to_regclass('public.usuarios_sistema') IS NULL THEN
    RAISE EXCEPTION 'public.usuarios_sistema não existe';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'usuarios_sistema'
        AND column_name IN ('id', 'perfil', 'ativo', 'deleted_at', 'auth_user_id', 'email')) <> 6 THEN
    RAISE EXCEPTION 'usuarios_sistema sem as colunas id, perfil, ativo, deleted_at, auth_user_id, email';
  END IF;
  SELECT (c.relowner = r.oid) OR r.rolsuper OR r.rolbypassrls
    INTO v_pode_ler
  FROM pg_class c, pg_roles r
  WHERE c.oid = 'public.usuarios_sistema'::regclass AND r.rolname = current_user;
  IF NOT coalesce(v_pode_ler, false) THEN
    RAISE EXCEPTION 'Rode como dono de usuarios_sistema: as funções SECURITY DEFINER precisam ler a tabela sem passar pela RLS';
  END IF;
  IF EXISTS (SELECT 1 FROM public.usuarios_sistema
             WHERE auth_user_id IS NOT NULL GROUP BY auth_user_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'auth_user_id repetido em usuarios_sistema — resolver antes de aplicar';
  END IF;
END $$;

-- ── 1. Snapshot do estado anterior (só na 1ª execução) ───────────────────
CREATE TABLE IF NOT EXISTS public.cena_seg_snapshot_20261004 (
  id bigserial PRIMARY KEY,
  tipo text NOT NULL,
  nome text NOT NULL,
  definicao jsonb NOT NULL,
  capturado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cena_seg_snapshot_20261004 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cena_seg_snapshot_20261004 FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.cena_seg_snapshot_20261004) THEN
    RETURN;
  END IF;
  INSERT INTO public.cena_seg_snapshot_20261004 (tipo, nome, definicao)
  SELECT 'rls', 'usuarios_sistema',
         jsonb_build_object('enabled', c.relrowsecurity, 'forced', c.relforcerowsecurity)
  FROM pg_class c WHERE c.oid = 'public.usuarios_sistema'::regclass;

  INSERT INTO public.cena_seg_snapshot_20261004 (tipo, nome, definicao)
  SELECT 'policy', p.policyname,
         jsonb_build_object('permissive', p.permissive, 'roles', to_jsonb(p.roles::text[]),
                            'cmd', p.cmd, 'qual', p.qual, 'with_check', p.with_check)
  FROM pg_policies p
  WHERE p.schemaname = 'public' AND p.tablename = 'usuarios_sistema';

  INSERT INTO public.cena_seg_snapshot_20261004 (tipo, nome, definicao)
  SELECT 'grant', g.grantee, jsonb_build_object('privilegios', jsonb_agg(DISTINCT g.privilege_type))
  FROM (
    SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
           a.privilege_type
    FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    WHERE c.oid = 'public.usuarios_sistema'::regclass
  ) g
  WHERE g.grantee IN ('PUBLIC', 'anon', 'authenticated')
  GROUP BY g.grantee;

  INSERT INTO public.cena_seg_snapshot_20261004 (tipo, nome, definicao)
  SELECT 'funcao', p.oid::regprocedure::text, jsonb_build_object('def', pg_get_functiondef(p.oid))
  FROM pg_proc p
  WHERE p.oid IN (
    SELECT to_regprocedure(f) FROM unnest(ARRAY[
      'public.cena_rh_pode_dados_pj()',
      'public.cena_rfid_usuario_sessao()',
      'public.cena_tag_usuario_sessao()',
      'public.cena_acesso_infra_usuario_sessao()'
    ]) f
  );

  IF to_regclass('public.usuarios_sistema_auth_user_id_uidx') IS NOT NULL THEN
    INSERT INTO public.cena_seg_snapshot_20261004 (tipo, nome, definicao)
    VALUES ('indice_preexistente', 'usuarios_sistema_auth_user_id_uidx', '{}'::jsonb);
  END IF;
END $$;

-- ── 2. Quem é o usuário da sessão (somente auth.uid() → auth_user_id) ────
CREATE OR REPLACE FUNCTION public.cena_usuario_perfil_sessao()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT nullif(lower(btrim(coalesce(us.perfil, ''))), '')
  FROM public.usuarios_sistema us
  WHERE auth.uid() IS NOT NULL
    AND us.auth_user_id = auth.uid()
    AND us.ativo IS TRUE
    AND us.deleted_at IS NULL
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.cena_usuario_id_sessao()
RETURNS public.usuarios_sistema.id%TYPE
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT us.id
  FROM public.usuarios_sistema us
  WHERE auth.uid() IS NOT NULL
    AND us.auth_user_id = auth.uid()
    AND us.ativo IS TRUE
    AND us.deleted_at IS NULL
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.cena_usuario_erp_ativo()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.cena_usuario_perfil_sessao() IS NOT NULL
$$;

-- Administradores de usuários. gestor não cria nem altera admin/diretoria (gatilho abaixo).
CREATE OR REPLACE FUNCTION public.cena_usuarios_pode_administrar()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(public.cena_usuario_perfil_sessao() IN ('admin', 'gestor'), false)
$$;

REVOKE ALL ON FUNCTION public.cena_usuario_perfil_sessao() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cena_usuario_id_sessao() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cena_usuario_erp_ativo() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cena_usuarios_pode_administrar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cena_usuario_perfil_sessao() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cena_usuario_id_sessao() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cena_usuario_erp_ativo() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cena_usuarios_pode_administrar() TO authenticated;

-- ── 3. Gatilho: campos sensíveis ─────────────────────────────────────────
-- SECURITY INVOKER de propósito: current_user identifica service_role (Edge Function de
-- provisionamento) e o SQL Editor, que podem vincular auth_user_id.
CREATE OR REPLACE FUNCTION public.cena_usuarios_sistema_proteger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_perfil text;
  v_meu_id public.usuarios_sistema.id%TYPE;
  v_reservados constant text[] := ARRAY['admin', 'diretoria'];
  v_old_perfil text;
  v_new_perfil text;
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  IF current_user = 'anon' THEN
    RAISE EXCEPTION 'usuarios_sistema: acesso anônimo negado' USING ERRCODE = '42501';
  END IF;

  v_perfil := public.cena_usuario_perfil_sessao();
  IF v_perfil IS NULL OR v_perfil NOT IN ('admin', 'gestor') THEN
    RAISE EXCEPTION 'usuarios_sistema: somente administrador de usuários altera cadastros'
      USING ERRCODE = '42501';
  END IF;
  v_meu_id := public.cena_usuario_id_sessao();
  v_new_perfil := lower(btrim(coalesce(NEW.perfil, '')));

  IF TG_OP = 'INSERT' THEN
    IF NEW.auth_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'usuarios_sistema: auth_user_id só é vinculado pelo provisionamento no servidor'
        USING ERRCODE = '42501';
    END IF;
    IF v_new_perfil = ANY (v_reservados) AND v_perfil <> 'admin' THEN
      RAISE EXCEPTION 'usuarios_sistema: somente admin cria perfil %', v_new_perfil USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  v_old_perfil := lower(btrim(coalesce(OLD.perfil, '')));
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'usuarios_sistema: id não muda' USING ERRCODE = '42501';
  END IF;
  IF NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id THEN
    RAISE EXCEPTION 'usuarios_sistema: auth_user_id só é vinculado pelo provisionamento no servidor'
      USING ERRCODE = '42501';
  END IF;
  IF v_perfil <> 'admin' AND (v_old_perfil = ANY (v_reservados) OR v_new_perfil = ANY (v_reservados)) THEN
    RAISE EXCEPTION 'usuarios_sistema: somente admin altera ou concede perfil admin/diretoria'
      USING ERRCODE = '42501';
  END IF;
  IF OLD.id = v_meu_id AND (
       NEW.perfil IS DISTINCT FROM OLD.perfil
    OR NEW.ativo IS DISTINCT FROM OLD.ativo
    OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
  ) THEN
    RAISE EXCEPTION 'usuarios_sistema: ninguém altera o próprio perfil ou status' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.cena_usuarios_sistema_proteger() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_cena_usuarios_sistema_proteger ON public.usuarios_sistema;
CREATE TRIGGER trg_cena_usuarios_sistema_proteger
  BEFORE INSERT OR UPDATE ON public.usuarios_sistema
  FOR EACH ROW EXECUTE FUNCTION public.cena_usuarios_sistema_proteger();

-- ── 4. Um cadastro ERP por conta Auth ────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_sistema_auth_user_id_uidx
  ON public.usuarios_sistema (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

-- ── 5. RLS e grants ──────────────────────────────────────────────────────
-- Sem FORCE: as funções SECURITY DEFINER (dono da tabela) leem usuarios_sistema dentro das policies;
-- com FORCE a policy chamaria a própria policy.
ALTER TABLE public.usuarios_sistema ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios_sistema NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.usuarios_sistema FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.usuarios_sistema TO authenticated;
GRANT ALL ON TABLE public.usuarios_sistema TO service_role;

DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'usuarios_sistema'
      AND policyname NOT IN ('usuarios_sistema_select_erp', 'usuarios_sistema_insert_admin', 'usuarios_sistema_update_admin')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.usuarios_sistema', p.policyname);
  END LOOP;
END $$;

DROP POLICY IF EXISTS usuarios_sistema_select_erp ON public.usuarios_sistema;
CREATE POLICY usuarios_sistema_select_erp ON public.usuarios_sistema
  FOR SELECT TO authenticated
  USING ((SELECT public.cena_usuario_erp_ativo()));

DROP POLICY IF EXISTS usuarios_sistema_insert_admin ON public.usuarios_sistema;
CREATE POLICY usuarios_sistema_insert_admin ON public.usuarios_sistema
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.cena_usuarios_pode_administrar()));

DROP POLICY IF EXISTS usuarios_sistema_update_admin ON public.usuarios_sistema;
CREATE POLICY usuarios_sistema_update_admin ON public.usuarios_sistema
  FOR UPDATE TO authenticated
  USING ((SELECT public.cena_usuarios_pode_administrar()))
  WITH CHECK ((SELECT public.cena_usuarios_pode_administrar()));

-- ── 6. Funções existentes: e-mail do JWT deixa de autorizar ──────────────
DO $$
DECLARE
  f text;
BEGIN
  IF to_regprocedure('public.cena_rh_pode_dados_pj()') IS NOT NULL THEN
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.cena_rh_pode_dados_pj()
      RETURNS boolean
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $b$
        SELECT coalesce(public.cena_usuario_perfil_sessao()
               IN ('admin','diretoria','dp','rh','gestor','administrativo'), false)
      $b$
    $f$;
  END IF;

  FOREACH f IN ARRAY ARRAY['cena_rfid_usuario_sessao', 'cena_tag_usuario_sessao', 'cena_acesso_infra_usuario_sessao']
  LOOP
    IF to_regprocedure('public.' || f || '()') IS NOT NULL THEN
      EXECUTE format($f$
        CREATE OR REPLACE FUNCTION public.%I()
        RETURNS public.usuarios_sistema
        LANGUAGE plpgsql
        STABLE
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $b$
        DECLARE
          v_us public.usuarios_sistema%%ROWTYPE;
        BEGIN
          IF auth.uid() IS NULL THEN
            RETURN NULL;
          END IF;
          SELECT * INTO v_us
          FROM public.usuarios_sistema us
          WHERE us.auth_user_id = auth.uid()
            AND us.ativo IS TRUE
            AND us.deleted_at IS NULL
          LIMIT 1;
          IF v_us.id IS NULL THEN
            RETURN NULL;
          END IF;
          RETURN v_us;
        END;
        $b$
      $f$, f);
    END IF;
  END LOOP;
END $$;

-- ── 7. Avisos para revisão (não alteram nada) ────────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT schemaname || '.' || tablename || ' / ' || policyname AS alvo
    FROM pg_policies
    WHERE tablename <> 'usuarios_sistema'
      AND (coalesce(qual, '') || coalesce(with_check, '')) ILIKE '%usuarios_sistema%'
  LOOP
    RAISE NOTICE 'Policy de outra tabela consulta usuarios_sistema: %', r.alvo;
  END LOOP;
  FOR r IN
    SELECT DISTINCT v.oid::regclass::text AS alvo
    FROM pg_depend d
    JOIN pg_rewrite rw ON rw.oid = d.objid
    JOIN pg_class v ON v.oid = rw.ev_class
    WHERE d.refobjid = 'public.usuarios_sistema'::regclass AND v.oid <> d.refobjid
  LOOP
    RAISE NOTICE 'View depende de usuarios_sistema (roda como dono, fora da RLS): %', r.alvo;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- Validação
-- SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.usuarios_sistema'::regclass;
-- SELECT policyname, cmd, roles, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'usuarios_sistema';
-- SELECT r.rolname,
--        has_table_privilege(r.rolname, 'public.usuarios_sistema', 'SELECT') AS sel,
--        has_table_privilege(r.rolname, 'public.usuarios_sistema', 'INSERT') AS ins,
--        has_table_privilege(r.rolname, 'public.usuarios_sistema', 'UPDATE') AS upd,
--        has_table_privilege(r.rolname, 'public.usuarios_sistema', 'DELETE') AS del
-- FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated');
-- SELECT tipo, nome FROM public.cena_seg_snapshot_20261004 ORDER BY id;

-- Para desfazer
-- DROP TRIGGER IF EXISTS trg_cena_usuarios_sistema_proteger ON public.usuarios_sistema;
-- DROP POLICY IF EXISTS usuarios_sistema_select_erp ON public.usuarios_sistema;
-- DROP POLICY IF EXISTS usuarios_sistema_insert_admin ON public.usuarios_sistema;
-- DROP POLICY IF EXISTS usuarios_sistema_update_admin ON public.usuarios_sistema;
-- REVOKE ALL ON TABLE public.usuarios_sistema FROM authenticated;
-- DO $$
-- DECLARE
--   s record;
--   v_roles text;
-- BEGIN
--   FOR s IN SELECT nome, definicao FROM public.cena_seg_snapshot_20261004 WHERE tipo = 'funcao' LOOP
--     EXECUTE s.definicao ->> 'def';
--   END LOOP;
--   FOR s IN SELECT nome, definicao FROM public.cena_seg_snapshot_20261004 WHERE tipo = 'policy' LOOP
--     SELECT string_agg(CASE WHEN r = 'public' THEN 'PUBLIC' ELSE quote_ident(r) END, ', ')
--       INTO v_roles FROM jsonb_array_elements_text(s.definicao -> 'roles') r;
--     EXECUTE format('CREATE POLICY %I ON public.usuarios_sistema AS %s FOR %s TO %s%s%s',
--       s.nome, s.definicao ->> 'permissive', s.definicao ->> 'cmd', v_roles,
--       CASE WHEN s.definicao ->> 'qual' IS NOT NULL THEN ' USING (' || (s.definicao ->> 'qual') || ')' ELSE '' END,
--       CASE WHEN s.definicao ->> 'with_check' IS NOT NULL THEN ' WITH CHECK (' || (s.definicao ->> 'with_check') || ')' ELSE '' END);
--   END LOOP;
--   FOR s IN SELECT nome, definicao FROM public.cena_seg_snapshot_20261004 WHERE tipo = 'grant' LOOP
--     EXECUTE format('GRANT %s ON TABLE public.usuarios_sistema TO %s',
--       (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(s.definicao -> 'privilegios') x),
--       CASE WHEN s.nome = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(s.nome) END);
--   END LOOP;
--   FOR s IN SELECT definicao FROM public.cena_seg_snapshot_20261004 WHERE tipo = 'rls' LOOP
--     IF NOT (s.definicao ->> 'enabled')::boolean THEN
--       EXECUTE 'ALTER TABLE public.usuarios_sistema DISABLE ROW LEVEL SECURITY';
--     END IF;
--     IF (s.definicao ->> 'forced')::boolean THEN
--       EXECUTE 'ALTER TABLE public.usuarios_sistema FORCE ROW LEVEL SECURITY';
--     END IF;
--   END LOOP;
--   IF NOT EXISTS (SELECT 1 FROM public.cena_seg_snapshot_20261004 WHERE tipo = 'indice_preexistente') THEN
--     EXECUTE 'DROP INDEX IF EXISTS public.usuarios_sistema_auth_user_id_uidx';
--   END IF;
-- END $$;
-- DROP FUNCTION IF EXISTS public.cena_usuarios_sistema_proteger();
-- DROP FUNCTION IF EXISTS public.cena_usuarios_pode_administrar();
-- DROP FUNCTION IF EXISTS public.cena_usuario_erp_ativo();
-- DROP FUNCTION IF EXISTS public.cena_usuario_id_sessao();
-- DROP FUNCTION IF EXISTS public.cena_usuario_perfil_sessao();
-- DROP TABLE IF EXISTS public.cena_seg_snapshot_20261004;
-- NOTIFY pgrst, 'reload schema';
