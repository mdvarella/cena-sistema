-- ETAPA 1.1 (ENEL/LMS/WL) — Permissões por ação
-- Catálogo de ações (cena_acoes), matriz perfil × ação × contrato opcional (cena_permissoes_acao),
-- histórico imutável gravado no banco (cena_permissoes_acao_eventos), cena_pode(acao, contrato) e RPCs de
-- administração (conceder, negar, revogar). Nenhuma tela usa isso ainda: zero mudança de comportamento.
-- Aditiva e idempotente. Não altera usuarios_sistema, perfis_sistema, contratos, TMA nem a Programação atual.
-- Autorização só por auth.uid() → usuarios_sistema.auth_user_id. E-mail nunca autoriza.
-- Precedência: regra viva do contrato > regra viva global (contrato_id NULL) > FALSE.

-- ── 0. Pré-condições (falha inteira, nada é aplicado) ────────────────────
DO $$
BEGIN
  IF to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'auth.uid() não existe';
  END IF;
  IF to_regclass('public.usuarios_sistema') IS NULL THEN
    RAISE EXCEPTION 'public.usuarios_sistema não existe';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'usuarios_sistema'
        AND column_name IN ('perfil', 'ativo', 'deleted_at', 'auth_user_id')) <> 4 THEN
    RAISE EXCEPTION 'usuarios_sistema sem as colunas perfil, ativo, deleted_at, auth_user_id';
  END IF;
  IF to_regprocedure('public.cena_usuario_perfil_sessao()') IS NULL
     OR to_regprocedure('public.cena_usuario_id_sessao()') IS NULL
     OR to_regprocedure('public.cena_usuario_erp_ativo()') IS NULL
     OR to_regprocedure('public.cena_usuarios_pode_administrar()') IS NULL THEN
    RAISE EXCEPTION 'aplique antes 20261004190000_seguranca_usuarios_sistema.sql (helpers de sessão)';
  END IF;
  IF to_regprocedure('public.cena_prog_pode_programar_projetos()') IS NULL THEN
    RAISE EXCEPTION 'aplique antes 20261004200000_prog_projetos_agenda.sql (cena_prog_pode_programar_projetos)';
  END IF;
  IF to_regclass('public.contratos') IS NULL THEN
    RAISE EXCEPTION 'public.contratos não existe';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'contratos'
                   AND column_name = 'id' AND data_type = 'uuid') THEN
    RAISE EXCEPTION 'contratos.id não é uuid';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'contratos' AND column_name = 'status') THEN
    RAISE EXCEPTION 'contratos sem a coluna status';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = 'public.contratos'::regclass AND i.indisunique AND i.indpred IS NULL
      AND i.indnatts = 1
      AND i.indkey[0] = (SELECT attnum FROM pg_attribute
                         WHERE attrelid = 'public.contratos'::regclass AND attname = 'id')
  ) THEN
    RAISE EXCEPTION 'contratos.id sem PRIMARY KEY/UNIQUE: a FK de cena_permissoes_acao não pode ser criada';
  END IF;
  IF NOT coalesce((SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user), false) THEN
    RAISE EXCEPTION 'Rode como dono com BYPASSRLS: as funções SECURITY DEFINER leem tabelas com RLS FORCE';
  END IF;
END $$;

-- ── 1. Catálogo de ações ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cena_acoes (
  codigo    text PRIMARY KEY,
  modulo    text NOT NULL,
  descricao text NOT NULL,
  ativo     boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cena_acoes_codigo_chk CHECK (codigo ~ '^[A-Z][A-Z0-9_]{2,62}$'),
  CONSTRAINT cena_acoes_modulo_chk CHECK (btrim(modulo) <> ''),
  CONSTRAINT cena_acoes_descricao_chk CHECK (btrim(descricao) <> '')
);

-- ── 2. Matriz perfil × ação × contrato ───────────────────────────────────
-- Linha revogada (deleted_at preenchido) é definitiva; nova decisão = nova linha.
CREATE TABLE IF NOT EXISTS public.cena_permissoes_acao (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  perfil              text NOT NULL,
  acao                text NOT NULL REFERENCES public.cena_acoes (codigo),
  contrato_id         uuid REFERENCES public.contratos (id),
  permitido           boolean NOT NULL,
  motivo              text,
  concedido_por_auth  uuid,
  concedido_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_por_auth uuid,
  atualizado_em       timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  CONSTRAINT cena_permissoes_acao_perfil_chk CHECK (perfil ~ '^[a-z][a-z0-9_]{1,62}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS cena_permissoes_acao_global_viva_uidx
  ON public.cena_permissoes_acao (perfil, acao)
  WHERE contrato_id IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cena_permissoes_acao_contrato_viva_uidx
  ON public.cena_permissoes_acao (perfil, acao, contrato_id)
  WHERE contrato_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS cena_permissoes_acao_contrato_idx
  ON public.cena_permissoes_acao (contrato_id) WHERE contrato_id IS NOT NULL;

-- ── 3. Histórico (gravado por gatilho; ninguém altera nem apaga) ─────────
CREATE TABLE IF NOT EXISTS public.cena_permissoes_acao_eventos (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  permissao_id       uuid NOT NULL REFERENCES public.cena_permissoes_acao (id),
  operacao           text NOT NULL,
  perfil             text NOT NULL,
  acao               text NOT NULL,
  contrato_id        uuid,
  permitido_anterior boolean,
  permitido_novo     boolean,
  motivo             text,
  por_auth           uuid,
  por_usuario_id     text,
  em                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cena_permissoes_acao_eventos_operacao_chk
    CHECK (operacao IN ('CONCEDER', 'NEGAR', 'REVOGAR', 'ALTERAR'))
);
CREATE INDEX IF NOT EXISTS cena_permissoes_acao_eventos_permissao_idx
  ON public.cena_permissoes_acao_eventos (permissao_id, id);

-- ── 4. Contrato válido para autorização (estrutura real de contratos) ────
-- "Excluir" contrato no ERP grava status = 'Cancelado'; a tela lista os ativos com status = 'Ativo'.
-- Se contratos tiver deleted_at, ele também precisa estar vazio.
DO $$
DECLARE
  v_extra text := '';
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'contratos' AND column_name = 'deleted_at') THEN
    v_extra := ' AND c.deleted_at IS NULL';
  END IF;
  EXECUTE format($f$
    CREATE OR REPLACE FUNCTION public.cena_contrato_ativo(p_contrato_id uuid)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY INVOKER
    SET search_path = public, pg_temp
    AS $b$
      SELECT p_contrato_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.contratos c
        WHERE c.id = p_contrato_id
          AND lower(btrim(coalesce(c.status::text, ''))) = 'ativo'%s
      )
    $b$
  $f$, v_extra);
END $$;

-- ── 5. cena_pode ─────────────────────────────────────────────────────────
-- SECURITY DEFINER: authenticated não lê a matriz diretamente (RLS FORCE, SELECT só para administrador).
-- Sem sessão (inclusive service_role e SQL Editor) → FALSE.
CREATE OR REPLACE FUNCTION public.cena_pode(p_acao text, p_contrato_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_perfil    text;
  v_permitido boolean;
BEGIN
  IF auth.uid() IS NULL OR p_acao IS NULL THEN
    RETURN FALSE;
  END IF;
  v_perfil := public.cena_usuario_perfil_sessao();
  IF v_perfil IS NULL THEN
    RETURN FALSE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cena_acoes a WHERE a.codigo = p_acao AND a.ativo IS TRUE) THEN
    RETURN FALSE;
  END IF;

  IF p_contrato_id IS NOT NULL THEN
    IF NOT public.cena_contrato_ativo(p_contrato_id) THEN
      RETURN FALSE;
    END IF;
    SELECT pa.permitido INTO v_permitido
    FROM public.cena_permissoes_acao pa
    WHERE pa.perfil = v_perfil AND pa.acao = p_acao
      AND pa.contrato_id = p_contrato_id AND pa.deleted_at IS NULL;
    IF FOUND THEN
      RETURN coalesce(v_permitido, FALSE);
    END IF;
  END IF;

  SELECT pa.permitido INTO v_permitido
  FROM public.cena_permissoes_acao pa
  WHERE pa.perfil = v_perfil AND pa.acao = p_acao
    AND pa.contrato_id IS NULL AND pa.deleted_at IS NULL;
  RETURN coalesce(v_permitido, FALSE);
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$;

-- ── 6. Gatilhos: integridade da matriz e histórico ───────────────────────
-- Vale para todos (inclusive service_role e SQL Editor): chave da regra não muda, revogação é definitiva,
-- DELETE físico recusado.
CREATE OR REPLACE FUNCTION public.cena_permissoes_acao_proteger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'cena_permissoes_acao: exclusão física não permitida; use cena_permissao_acao_revogar'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.perfil IS DISTINCT FROM OLD.perfil
     OR NEW.acao IS DISTINCT FROM OLD.acao
     OR NEW.contrato_id IS DISTINCT FROM OLD.contrato_id
     OR NEW.concedido_por_auth IS DISTINCT FROM OLD.concedido_por_auth
     OR NEW.concedido_em IS DISTINCT FROM OLD.concedido_em THEN
    RAISE EXCEPTION 'cena_permissoes_acao: perfil, ação, contrato e concessão original não mudam'
      USING ERRCODE = '42501';
  END IF;
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'cena_permissoes_acao: regra revogada não volta; crie uma nova' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cena_permissoes_acao_proteger ON public.cena_permissoes_acao;
CREATE TRIGGER trg_cena_permissoes_acao_proteger
  BEFORE UPDATE OR DELETE ON public.cena_permissoes_acao
  FOR EACH ROW EXECUTE FUNCTION public.cena_permissoes_acao_proteger();

CREATE OR REPLACE FUNCTION public.cena_permissoes_acao_auditar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_operacao text;
  v_anterior boolean;
  v_novo     boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_operacao := CASE WHEN NEW.permitido THEN 'CONCEDER' ELSE 'NEGAR' END;
    v_novo := NEW.permitido;
  ELSIF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    v_operacao := 'REVOGAR';
    v_anterior := OLD.permitido;
  ELSIF NEW.permitido IS DISTINCT FROM OLD.permitido THEN
    v_operacao := CASE WHEN NEW.permitido THEN 'CONCEDER' ELSE 'NEGAR' END;
    v_anterior := OLD.permitido;
    v_novo := NEW.permitido;
  ELSE
    v_operacao := 'ALTERAR';
    v_anterior := OLD.permitido;
    v_novo := NEW.permitido;
  END IF;

  INSERT INTO public.cena_permissoes_acao_eventos
    (permissao_id, operacao, perfil, acao, contrato_id, permitido_anterior, permitido_novo,
     motivo, por_auth, por_usuario_id)
  VALUES
    (NEW.id, v_operacao, NEW.perfil, NEW.acao, NEW.contrato_id, v_anterior, v_novo,
     NEW.motivo, auth.uid(), public.cena_usuario_id_sessao()::text);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_cena_permissoes_acao_auditar ON public.cena_permissoes_acao;
CREATE TRIGGER trg_cena_permissoes_acao_auditar
  AFTER INSERT OR UPDATE ON public.cena_permissoes_acao
  FOR EACH ROW EXECUTE FUNCTION public.cena_permissoes_acao_auditar();

CREATE OR REPLACE FUNCTION public.cena_permissoes_acao_eventos_imutavel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'cena_permissoes_acao_eventos: histórico não é alterado nem apagado' USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_cena_permissoes_acao_eventos_imutavel ON public.cena_permissoes_acao_eventos;
CREATE TRIGGER trg_cena_permissoes_acao_eventos_imutavel
  BEFORE UPDATE OR DELETE ON public.cena_permissoes_acao_eventos
  FOR EACH ROW EXECUTE FUNCTION public.cena_permissoes_acao_eventos_imutavel();
DROP TRIGGER IF EXISTS trg_cena_permissoes_acao_eventos_sem_truncate ON public.cena_permissoes_acao_eventos;
CREATE TRIGGER trg_cena_permissoes_acao_eventos_sem_truncate
  BEFORE TRUNCATE ON public.cena_permissoes_acao_eventos
  FOR EACH STATEMENT EXECUTE FUNCTION public.cena_permissoes_acao_eventos_imutavel();

-- ── 7. Administração da matriz (admin/gestor via cena_usuarios_pode_administrar) ──
-- Mesmo critério do gatilho de usuarios_sistema: regra dos perfis admin/diretoria só o admin altera.
CREATE OR REPLACE FUNCTION public.cena_permissao_acao_exigir_admin(p_perfil text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_meu_perfil text;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.cena_usuarios_pode_administrar(), FALSE) THEN
    RAISE EXCEPTION 'permissões por ação: somente administrador (admin/gestor) altera a matriz'
      USING ERRCODE = '42501';
  END IF;
  v_meu_perfil := public.cena_usuario_perfil_sessao();
  IF p_perfil IN ('admin', 'diretoria') AND v_meu_perfil IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'permissões por ação: somente admin altera regras do perfil %', p_perfil
      USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.cena_permissao_acao_definir(
  p_perfil text, p_acao text, p_contrato_id uuid, p_permitido boolean, p_motivo text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_perfil text := lower(btrim(coalesce(p_perfil, '')));
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_atual  public.cena_permissoes_acao%ROWTYPE;
  v_id     uuid;
BEGIN
  PERFORM public.cena_permissao_acao_exigir_admin(v_perfil);
  IF v_perfil !~ '^[a-z][a-z0-9_]{1,62}$' THEN
    RAISE EXCEPTION 'permissões por ação: perfil inválido' USING ERRCODE = '22023';
  END IF;
  IF p_permitido IS NULL THEN
    RAISE EXCEPTION 'permissões por ação: permitido obrigatório' USING ERRCODE = '22023';
  END IF;
  IF v_motivo = '' THEN
    RAISE EXCEPTION 'permissões por ação: motivo obrigatório' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cena_acoes a WHERE a.codigo = p_acao AND a.ativo IS TRUE) THEN
    RAISE EXCEPTION 'permissões por ação: ação inexistente ou inativa' USING ERRCODE = '22023';
  END IF;
  IF p_contrato_id IS NOT NULL AND NOT public.cena_contrato_ativo(p_contrato_id) THEN
    RAISE EXCEPTION 'permissões por ação: contrato inexistente ou não ativo' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('cena_permissoes_acao|' || v_perfil || '|' || p_acao || '|' || coalesce(p_contrato_id::text, ''), 0));

  SELECT * INTO v_atual
  FROM public.cena_permissoes_acao pa
  WHERE pa.perfil = v_perfil AND pa.acao = p_acao
    AND pa.contrato_id IS NOT DISTINCT FROM p_contrato_id AND pa.deleted_at IS NULL
  FOR UPDATE;

  IF FOUND THEN
    IF v_atual.permitido = p_permitido THEN
      RETURN v_atual.id;
    END IF;
    UPDATE public.cena_permissoes_acao
       SET permitido = p_permitido, motivo = v_motivo,
           atualizado_por_auth = auth.uid(), atualizado_em = now()
     WHERE id = v_atual.id;
    RETURN v_atual.id;
  END IF;

  INSERT INTO public.cena_permissoes_acao
    (perfil, acao, contrato_id, permitido, motivo, concedido_por_auth, atualizado_por_auth)
  VALUES
    (v_perfil, p_acao, p_contrato_id, p_permitido, v_motivo, auth.uid(), auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cena_permissao_acao_conceder(
  p_perfil text, p_acao text, p_motivo text, p_contrato_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.cena_permissao_acao_definir(p_perfil, p_acao, p_contrato_id, TRUE, p_motivo)
$$;

CREATE OR REPLACE FUNCTION public.cena_permissao_acao_negar(
  p_perfil text, p_acao text, p_motivo text, p_contrato_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.cena_permissao_acao_definir(p_perfil, p_acao, p_contrato_id, FALSE, p_motivo)
$$;

-- Encerra a regra viva. Sem regra → FALSE (nada muda). Depois vale a precedência normal.
CREATE OR REPLACE FUNCTION public.cena_permissao_acao_revogar(
  p_perfil text, p_acao text, p_motivo text, p_contrato_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_perfil text := lower(btrim(coalesce(p_perfil, '')));
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_id     uuid;
BEGIN
  PERFORM public.cena_permissao_acao_exigir_admin(v_perfil);
  IF v_motivo = '' THEN
    RAISE EXCEPTION 'permissões por ação: motivo obrigatório' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended('cena_permissoes_acao|' || v_perfil || '|' || coalesce(p_acao, '') || '|' || coalesce(p_contrato_id::text, ''), 0));

  SELECT pa.id INTO v_id
  FROM public.cena_permissoes_acao pa
  WHERE pa.perfil = v_perfil AND pa.acao = p_acao
    AND pa.contrato_id IS NOT DISTINCT FROM p_contrato_id AND pa.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  UPDATE public.cena_permissoes_acao
     SET deleted_at = now(), motivo = v_motivo,
         atualizado_por_auth = auth.uid(), atualizado_em = now()
   WHERE id = v_id;
  RETURN TRUE;
END;
$$;

-- ── 8. RLS e grants ──────────────────────────────────────────────────────
ALTER TABLE public.cena_acoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cena_acoes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cena_permissoes_acao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cena_permissoes_acao FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cena_permissoes_acao_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cena_permissoes_acao_eventos FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.cena_acoes FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.cena_permissoes_acao FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.cena_permissoes_acao_eventos FROM PUBLIC, anon, authenticated, service_role;
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role',
                 pg_get_serial_sequence('public.cena_permissoes_acao_eventos', 'id'));
END $$;
GRANT SELECT ON TABLE public.cena_acoes TO authenticated, service_role;
GRANT SELECT ON TABLE public.cena_permissoes_acao TO authenticated, service_role;
GRANT SELECT ON TABLE public.cena_permissoes_acao_eventos TO authenticated, service_role;

DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('cena_acoes', 'cena_permissoes_acao', 'cena_permissoes_acao_eventos')
      AND policyname NOT IN ('cena_acoes_select_erp', 'cena_permissoes_acao_select_admin',
                             'cena_permissoes_acao_eventos_select_admin')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

DROP POLICY IF EXISTS cena_acoes_select_erp ON public.cena_acoes;
CREATE POLICY cena_acoes_select_erp ON public.cena_acoes
  FOR SELECT TO authenticated USING ((SELECT public.cena_usuario_erp_ativo()));
DROP POLICY IF EXISTS cena_permissoes_acao_select_admin ON public.cena_permissoes_acao;
CREATE POLICY cena_permissoes_acao_select_admin ON public.cena_permissoes_acao
  FOR SELECT TO authenticated USING ((SELECT public.cena_usuarios_pode_administrar()));
DROP POLICY IF EXISTS cena_permissoes_acao_eventos_select_admin ON public.cena_permissoes_acao_eventos;
CREATE POLICY cena_permissoes_acao_eventos_select_admin ON public.cena_permissoes_acao_eventos
  FOR SELECT TO authenticated USING ((SELECT public.cena_usuarios_pode_administrar()));

REVOKE ALL ON FUNCTION public.cena_contrato_ativo(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cena_permissoes_acao_proteger() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cena_permissoes_acao_auditar() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cena_permissoes_acao_eventos_imutavel() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cena_permissao_acao_exigir_admin(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cena_permissao_acao_definir(text, text, uuid, boolean, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cena_pode(text, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.cena_permissao_acao_conceder(text, text, text, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.cena_permissao_acao_negar(text, text, text, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.cena_permissao_acao_revogar(text, text, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cena_pode(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cena_permissao_acao_conceder(text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cena_permissao_acao_negar(text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cena_permissao_acao_revogar(text, text, text, uuid) TO authenticated;

-- ── 9. Ações e matriz inicial aprovada (global, sem regra por contrato) ──
-- Ação existente não é sobrescrita. Regra que já existiu (mesmo revogada) não é recriada na reaplicação.
INSERT INTO public.cena_acoes (codigo, modulo, descricao) VALUES
  ('PROJ_IMPORTAR_LMS', 'PROJETOS', 'Importar LMS do projeto'),
  ('PROJ_CONCILIAR_LMS', 'PROJETOS', 'Conciliar LMS com a estrutura existente do projeto'),
  ('PROJ_EDITAR_WL', 'PROJETOS', 'Editar WL oficial do projeto'),
  ('PROJ_REALIZAR_VIABILIDADE', 'PROJETOS', 'Realizar viabilidade do projeto'),
  ('PROJ_AVALIAR_CENA', 'PROJETOS', 'Registrar avaliação CENA do projeto'),
  ('PROJ_APROVAR_AVALIACAO_CENA', 'PROJETOS', 'Aprovar avaliação CENA do projeto'),
  ('PROJ_REGISTRAR_RETORNO_ENEL', 'PROJETOS', 'Registrar retorno da ENEL'),
  ('PROJ_PROGRAMAR', 'PROJETOS', 'Programar projeto (mesmos perfis de cena_prog_pode_programar_projetos)'),
  ('PROJ_ALTERAR_PERFIL_PROCESSO', 'PROJETOS', 'Alterar o perfil de processo do projeto')
ON CONFLICT (codigo) DO NOTHING;

DO $$
DECLARE
  -- Exatamente os perfis de cena_prog_pode_programar_projetos() (20261004200000_prog_projetos_agenda.sql).
  v_programar constant text[] := ARRAY['admin','diretoria','gestor','coordenador','supervisor','administrativo','escritorio'];
  v_def text;
  v_lista text;
  v_motivo constant text := 'Matriz inicial aprovada pelo gestor — Etapa 1.1 (07/10/2026)';
BEGIN
  v_def := regexp_replace(pg_get_functiondef('public.cena_prog_pode_programar_projetos()'::regprocedure), '\s', '', 'g');
  v_lista := 'IN(' || array_to_string(ARRAY(SELECT quote_literal(x) FROM unnest(v_programar) x), ',') || ')';
  IF position(v_lista IN v_def) = 0 THEN
    RAISE EXCEPTION 'cena_prog_pode_programar_projetos() no banco não aceita exatamente %; PROJ_PROGRAMAR não foi semeada', v_lista;
  END IF;

  INSERT INTO public.cena_permissoes_acao (perfil, acao, contrato_id, permitido, motivo)
  SELECT m.perfil, m.acao, NULL, TRUE, v_motivo
  FROM (
    SELECT unnest(ARRAY['admin','gestor','coordenador','escritorio','administrativo']) AS perfil, 'PROJ_IMPORTAR_LMS' AS acao
    UNION ALL SELECT unnest(ARRAY['admin','gestor','coordenador','escritorio','administrativo']), 'PROJ_CONCILIAR_LMS'
    UNION ALL SELECT unnest(ARRAY['admin','gestor','coordenador','escritorio','administrativo']), 'PROJ_EDITAR_WL'
    UNION ALL SELECT unnest(ARRAY['admin','gestor','coordenador','supervisor']), 'PROJ_REALIZAR_VIABILIDADE'
    UNION ALL SELECT unnest(ARRAY['admin','gestor','coordenador','escritorio']), 'PROJ_AVALIAR_CENA'
    UNION ALL SELECT unnest(ARRAY['admin','gestor','coordenador']), 'PROJ_APROVAR_AVALIACAO_CENA'
    UNION ALL SELECT unnest(ARRAY['admin','gestor','coordenador','escritorio','administrativo']), 'PROJ_REGISTRAR_RETORNO_ENEL'
    UNION ALL SELECT unnest(v_programar), 'PROJ_PROGRAMAR'
    UNION ALL SELECT unnest(ARRAY['admin','gestor']), 'PROJ_ALTERAR_PERFIL_PROCESSO'
  ) m
  WHERE NOT EXISTS (
    SELECT 1 FROM public.cena_permissoes_acao pa
    WHERE pa.perfil = m.perfil AND pa.acao = m.acao AND pa.contrato_id IS NULL
  );
END $$;

NOTIFY pgrst, 'reload schema';

-- Validação
-- SELECT acao, string_agg(perfil, ', ' ORDER BY perfil) AS perfis
--   FROM public.cena_permissoes_acao WHERE deleted_at IS NULL AND contrato_id IS NULL AND permitido
--   GROUP BY acao ORDER BY acao;
-- SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c
--   WHERE c.oid IN ('public.cena_acoes'::regclass, 'public.cena_permissoes_acao'::regclass,
--                   'public.cena_permissoes_acao_eventos'::regclass);
-- SELECT tablename, policyname, cmd, roles, qual FROM pg_policies
--   WHERE tablename IN ('cena_acoes', 'cena_permissoes_acao', 'cena_permissoes_acao_eventos');
-- SELECT count(*) FROM public.cena_permissoes_acao_eventos;

-- Para desfazer (nenhuma outra tabela depende destas nesta etapa)
-- DROP FUNCTION IF EXISTS public.cena_permissao_acao_revogar(text, text, text, uuid);
-- DROP FUNCTION IF EXISTS public.cena_permissao_acao_negar(text, text, text, uuid);
-- DROP FUNCTION IF EXISTS public.cena_permissao_acao_conceder(text, text, text, uuid);
-- DROP FUNCTION IF EXISTS public.cena_permissao_acao_definir(text, text, uuid, boolean, text);
-- DROP FUNCTION IF EXISTS public.cena_permissao_acao_exigir_admin(text);
-- DROP FUNCTION IF EXISTS public.cena_pode(text, uuid);
-- DROP TABLE IF EXISTS public.cena_permissoes_acao_eventos;
-- DROP TABLE IF EXISTS public.cena_permissoes_acao;
-- DROP TABLE IF EXISTS public.cena_acoes;
-- DROP FUNCTION IF EXISTS public.cena_permissoes_acao_eventos_imutavel();
-- DROP FUNCTION IF EXISTS public.cena_permissoes_acao_auditar();
-- DROP FUNCTION IF EXISTS public.cena_permissoes_acao_proteger();
-- DROP FUNCTION IF EXISTS public.cena_contrato_ativo(uuid);
-- NOTIFY pgrst, 'reload schema';
