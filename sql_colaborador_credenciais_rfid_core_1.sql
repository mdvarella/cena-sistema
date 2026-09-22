-- sql_colaborador_credenciais_rfid_core_1.sql
-- RFID-CORE-1 — identidade RFID do colaborador (cadastro mestre).
-- Aditivo / idempotente.
-- NÃO executar pelo ERP. Aplicar manualmente no SQL Editor do Supabase após aprovação.
-- O UID físico NÃO é reutilizado por outro colaborador: UNIQUE (tipo, uid_normalizado) em toda a tabela.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ══════════════════════════════════════════════════════════════
-- 1) Helpers
-- ══════════════════════════════════════════════════════════════

-- UID opaco: trim, remove espaço/hífen/quebra de linha, caixa alta.
-- NÃO converte hex↔decimal.
CREATE OR REPLACE FUNCTION public.cena_rfid_normalizar_uid(p_uid text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT upper(regexp_replace(btrim(regexp_replace(coalesce(p_uid, ''), E'[\\n\\r\\t]+', '', 'g')), '[\s\-]+', '', 'g'));
$$;

-- Usuário da sessão Auth: 1º por auth_user_id; senão e-mail do JWT (login dual / vínculo pendente).
CREATE OR REPLACE FUNCTION public.cena_rfid_usuario_sessao()
RETURNS public.usuarios_sistema
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_us public.usuarios_sistema%ROWTYPE;
  v_email text;
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
  IF v_us.id IS NOT NULL THEN
    RETURN v_us;
  END IF;

  v_email := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  IF v_email = '' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_us
  FROM public.usuarios_sistema us
  WHERE lower(btrim(us.email)) = v_email
    AND us.ativo IS TRUE
    AND us.deleted_at IS NULL
  ORDER BY CASE WHEN us.auth_user_id = auth.uid() THEN 0 WHEN us.auth_user_id IS NULL THEN 1 ELSE 2 END
  LIMIT 1;
  RETURN v_us;
END;
$$;

-- Cadastro/bloqueio/substituição/reativação: admin, diretoria, dp, rh, gestor.
-- NÃO supervisor / portaria / almoxarife / equipe.
CREATE OR REPLACE FUNCTION public.cena_rfid_pode_cadastrar()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_us public.usuarios_sistema%ROWTYPE;
BEGIN
  v_us := public.cena_rfid_usuario_sessao();
  RETURN v_us.id IS NOT NULL
    AND lower(btrim(coalesce(v_us.perfil, ''))) IN ('admin','diretoria','dp','rh','gestor');
END;
$$;

-- Auditoria obrigatória na MESMA transação da RPC.
-- Reutiliza audit_log. Se o INSERT falhar, a exceção sobe e a operação RFID dá rollback.
-- NÃO conceder EXECUTE a authenticated/anon (uso interno das RPCs).
CREATE OR REPLACE FUNCTION public.cena_rfid_audit_registrar(
  p_acao text,
  p_descricao text,
  p_dados_extra jsonb,
  p_sessao_id text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_us public.usuarios_sistema%ROWTYPE;
BEGIN
  IF p_acao IS NULL OR btrim(p_acao) = '' THEN
    RAISE EXCEPTION 'Auditoria RFID: ação obrigatória'
      USING ERRCODE = '22023', HINT = 'RFID_AUDIT_ACAO';
  END IF;

  v_us := public.cena_rfid_usuario_sessao();

  INSERT INTO public.audit_log (
    acao,
    modulo,
    descricao,
    usuario_id,
    usuario_nome,
    usuario_perfil,
    dados_extra,
    data_hora,
    sessao_id
  ) VALUES (
    p_acao,
    'rh',
    coalesce(p_descricao, p_acao),
    coalesce(v_us.id::text, auth.uid()::text, ''),
    coalesce(v_us.nome, ''),
    coalesce(v_us.perfil, ''),
    jsonb_strip_nulls(coalesce(p_dados_extra, '{}'::jsonb)),
    now(),
    coalesce(p_sessao_id, 'rpc:rfid')
  );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auditoria RFID: falha ao gravar audit_log'
      USING ERRCODE = 'P0001', HINT = 'RFID_AUDIT_FALHOU';
  END IF;
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 2) Tabela
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.colaborador_credenciais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  colaborador_id uuid NOT NULL REFERENCES public.colaboradores(id),
  tipo text NOT NULL DEFAULT 'RFID',
  uid text NOT NULL,
  uid_normalizado text NOT NULL,
  status text NOT NULL DEFAULT 'ATIVO',
  emitido_em timestamptz,
  ativado_em timestamptz,
  bloqueado_em timestamptz,
  bloqueado_por text,
  motivo_bloqueio text,
  substitui_credencial_id uuid REFERENCES public.colaborador_credenciais(id),
  origem_leitura text,
  criado_por text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.colaborador_credenciais IS
  'Credencial RFID do colaborador. A pessoa continua em colaboradores. O UID físico não é reutilizado por outra pessoa.';
COMMENT ON COLUMN public.colaborador_credenciais.uid IS
  'UID bruto do leitor (auditoria). Casamento usa uid_normalizado.';
COMMENT ON COLUMN public.colaborador_credenciais.uid_normalizado IS
  'Identificador opaco normalizado. Sem conversão hex/decimal.';

ALTER TABLE public.colaborador_credenciais
  DROP CONSTRAINT IF EXISTS colaborador_credenciais_tipo_chk;
ALTER TABLE public.colaborador_credenciais
  ADD CONSTRAINT colaborador_credenciais_tipo_chk
  CHECK (btrim(tipo) <> '');

ALTER TABLE public.colaborador_credenciais
  DROP CONSTRAINT IF EXISTS colaborador_credenciais_status_chk;
ALTER TABLE public.colaborador_credenciais
  ADD CONSTRAINT colaborador_credenciais_status_chk
  CHECK (status IN ('ATIVO','BLOQUEADO','SUBSTITUIDO'));

ALTER TABLE public.colaborador_credenciais
  DROP CONSTRAINT IF EXISTS colaborador_credenciais_uid_chk;
ALTER TABLE public.colaborador_credenciais
  ADD CONSTRAINT colaborador_credenciais_uid_chk
  CHECK (btrim(uid) <> '');

ALTER TABLE public.colaborador_credenciais
  DROP CONSTRAINT IF EXISTS colaborador_credenciais_uid_norm_chk;
ALTER TABLE public.colaborador_credenciais
  ADD CONSTRAINT colaborador_credenciais_uid_norm_chk
  CHECK (btrim(uid_normalizado) <> '');

ALTER TABLE public.colaborador_credenciais
  DROP CONSTRAINT IF EXISTS colaborador_credenciais_self_sub_chk;
ALTER TABLE public.colaborador_credenciais
  ADD CONSTRAINT colaborador_credenciais_self_sub_chk
  CHECK (substitui_credencial_id IS DISTINCT FROM id);

-- Identidade histórica do UID físico (ATIVO, BLOQUEADO e SUBSTITUIDO).
CREATE UNIQUE INDEX IF NOT EXISTS uq_cred_tipo_uid_norm
  ON public.colaborador_credenciais (tipo, uid_normalizado);

-- No máximo um RFID ATIVO por colaborador.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cred_rfid_colab_ativo
  ON public.colaborador_credenciais (colaborador_id)
  WHERE tipo = 'RFID' AND status = 'ATIVO';

CREATE INDEX IF NOT EXISTS idx_cred_colaborador_status
  ON public.colaborador_credenciais (colaborador_id, status);

CREATE INDEX IF NOT EXISTS idx_cred_uid_norm
  ON public.colaborador_credenciais (uid_normalizado);

-- ══════════════════════════════════════════════════════════════
-- 3) Trigger: normaliza UID + atualizado_em em todo UPDATE
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.colaborador_credenciais_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.tipo := coalesce(nullif(btrim(NEW.tipo), ''), 'RFID');
  NEW.uid_normalizado := public.cena_rfid_normalizar_uid(coalesce(NEW.uid_normalizado, NEW.uid));
  IF NEW.uid_normalizado IS NULL OR NEW.uid_normalizado = '' THEN
    RAISE EXCEPTION 'UID RFID vazio após normalização'
      USING ERRCODE = '22023', HINT = 'RFID_UID_VAZIO';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.atualizado_em := now();
  ELSE
    NEW.atualizado_em := coalesce(NEW.atualizado_em, now());
    NEW.criado_em := coalesce(NEW.criado_em, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_colaborador_credenciais_before_write
  ON public.colaborador_credenciais;
CREATE TRIGGER trg_colaborador_credenciais_before_write
BEFORE INSERT OR UPDATE ON public.colaborador_credenciais
FOR EACH ROW EXECUTE FUNCTION public.colaborador_credenciais_before_write();

-- ══════════════════════════════════════════════════════════════
-- 4) RLS
-- Leitura administrativa: perfis autorizados.
-- Gravação: somente RPC SECURITY DEFINER (sem INSERT/UPDATE/DELETE direto).
-- Resolução operacional: fn_rfid_resolver (sem SELECT na tabela).
-- anon: nenhum acesso à tabela.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.colaborador_credenciais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.colaborador_credenciais FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.colaborador_credenciais FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.colaborador_credenciais TO authenticated;
GRANT ALL ON TABLE public.colaborador_credenciais TO service_role;

DROP POLICY IF EXISTS colaborador_credenciais_select_admin ON public.colaborador_credenciais;
CREATE POLICY colaborador_credenciais_select_admin
  ON public.colaborador_credenciais
  FOR SELECT
  TO authenticated
  USING (public.cena_rfid_pode_cadastrar());

REVOKE ALL ON FUNCTION public.cena_rfid_normalizar_uid(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cena_rfid_usuario_sessao() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cena_rfid_pode_cadastrar() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cena_rfid_audit_registrar(text, text, jsonb, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.cena_rfid_normalizar_uid(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cena_rfid_pode_cadastrar() TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- 5) RPCs
-- ══════════════════════════════════════════════════════════════

-- Resolve UID → colaborador/status. Sem escrita. Sem audit_log (leituras futuras em massa).
-- Exige sessão authenticated. Não abre portão, não baixa estoque, não registra ponto.
CREATE OR REPLACE FUNCTION public.fn_rfid_resolver(p_uid text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid text;
  v_cc public.colaborador_credenciais%ROWTYPE;
  v_col public.colaboradores%ROWTYPE;
  v_autenticavel boolean := false;
  v_motivo text := 'NAO_CADASTRADO';
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão Auth obrigatória para resolver RFID'
      USING ERRCODE = '28000', HINT = 'RFID_AUTH_REQUIRED';
  END IF;

  v_uid := public.cena_rfid_normalizar_uid(p_uid);
  IF v_uid IS NULL OR v_uid = '' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'encontrado', false,
      'autenticavel', false,
      'motivo', 'UID_VAZIO',
      'credencial', NULL,
      'colaborador', NULL
    );
  END IF;

  SELECT * INTO v_cc
  FROM public.colaborador_credenciais
  WHERE tipo = 'RFID' AND uid_normalizado = v_uid
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'encontrado', false,
      'autenticavel', false,
      'motivo', 'NAO_CADASTRADO',
      'credencial', NULL,
      'colaborador', NULL
    );
  END IF;

  SELECT * INTO v_col FROM public.colaboradores WHERE id = v_cc.colaborador_id;

  IF v_cc.status = 'ATIVO'
     AND v_col.id IS NOT NULL
     AND v_col.ativo IS TRUE
     AND v_col.deleted_at IS NULL THEN
    v_autenticavel := true;
    v_motivo := 'ATIVO';
  ELSIF v_cc.status = 'BLOQUEADO' THEN
    v_motivo := 'BLOQUEADO';
  ELSIF v_cc.status = 'SUBSTITUIDO' THEN
    v_motivo := 'SUBSTITUIDO';
  ELSIF v_col.id IS NULL OR v_col.ativo IS NOT TRUE OR v_col.deleted_at IS NOT NULL THEN
    v_motivo := 'COLABORADOR_INATIVO';
  ELSE
    v_motivo := v_cc.status;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'encontrado', true,
    'autenticavel', v_autenticavel,
    'motivo', v_motivo,
    'credencial', jsonb_build_object(
      'id', v_cc.id,
      'status', v_cc.status
    ),
    'colaborador', jsonb_build_object(
      'id', v_col.id,
      'nome', v_col.nome,
      're', v_col.re
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_rfid_vincular(
  p_colaborador_id uuid,
  p_uid text,
  p_origem_leitura text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid text;
  v_exist public.colaborador_credenciais%ROWTYPE;
  v_ativo public.colaborador_credenciais%ROWTYPE;
  v_col public.colaboradores%ROWTYPE;
  v_new public.colaborador_credenciais%ROWTYPE;
  v_usr text;
  v_holder_nome text;
  v_holder_re text;
BEGIN
  IF NOT public.cena_rfid_pode_cadastrar() THEN
    RAISE EXCEPTION 'Sem permissão para cadastrar RFID'
      USING ERRCODE = '42501', HINT = 'RFID_SEM_PERMISSAO';
  END IF;

  v_uid := public.cena_rfid_normalizar_uid(p_uid);
  IF v_uid IS NULL OR v_uid = '' THEN
    RAISE EXCEPTION 'UID RFID vazio após normalização'
      USING ERRCODE = '22023', HINT = 'RFID_UID_VAZIO';
  END IF;

  PERFORM pg_advisory_xact_lock(871001, hashtext(v_uid));

  SELECT * INTO v_col FROM public.colaboradores WHERE id = p_colaborador_id;
  IF v_col.id IS NULL THEN
    RAISE EXCEPTION 'Colaborador não encontrado'
      USING ERRCODE = 'P0002', HINT = 'RFID_COLAB_NAO_ENCONTRADO';
  END IF;

  SELECT (public.cena_rfid_usuario_sessao()).nome INTO v_usr;

  SELECT * INTO v_exist
  FROM public.colaborador_credenciais
  WHERE tipo = 'RFID' AND uid_normalizado = v_uid
  FOR UPDATE;

  IF FOUND THEN
    SELECT nome, re INTO v_holder_nome, v_holder_re
    FROM public.colaboradores WHERE id = v_exist.colaborador_id;
    RAISE EXCEPTION 'Crachá já vinculado a % — RE %.', coalesce(v_holder_nome,'?'), coalesce(v_holder_re,'—')
      USING ERRCODE = '23505', HINT = 'RFID_UID_HISTORICO';
  END IF;

  SELECT * INTO v_ativo
  FROM public.colaborador_credenciais
  WHERE colaborador_id = p_colaborador_id AND tipo = 'RFID' AND status = 'ATIVO'
  FOR UPDATE;

  IF FOUND THEN
    RAISE EXCEPTION 'Colaborador já possui RFID ATIVO. Use substituição.'
      USING ERRCODE = 'P0001', HINT = 'RFID_JA_ATIVO';
  END IF;

  INSERT INTO public.colaborador_credenciais (
    colaborador_id, tipo, uid, uid_normalizado, status,
    emitido_em, ativado_em, origem_leitura, criado_por
  ) VALUES (
    p_colaborador_id, 'RFID', btrim(p_uid), v_uid, 'ATIVO',
    now(), now(), p_origem_leitura, v_usr
  ) RETURNING * INTO v_new;

  PERFORM public.cena_rfid_audit_registrar(
    'RFID_VINCULADO',
    format('Vinculou crachá RFID a %s — RE %s.', coalesce(v_col.nome,'?'), coalesce(v_col.re,'—')),
    jsonb_build_object(
      'colaborador_id', v_col.id,
      'colaborador_nome', v_col.nome,
      'colaborador_re', v_col.re,
      'credencial_id', v_new.id,
      'uid_normalizado', v_uid,
      'status_novo', 'ATIVO',
      'origem_leitura', p_origem_leitura
    ),
    'rpc:fn_rfid_vincular'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'acao', 'RFID_VINCULADO',
    'credencial', jsonb_build_object('id', v_new.id, 'status', v_new.status)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_rfid_bloquear(
  p_colaborador_id uuid,
  p_motivo text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ativo public.colaborador_credenciais%ROWTYPE;
  v_col public.colaboradores%ROWTYPE;
  v_usr text;
BEGIN
  IF NOT public.cena_rfid_pode_cadastrar() THEN
    RAISE EXCEPTION 'Sem permissão para bloquear RFID'
      USING ERRCODE = '42501', HINT = 'RFID_SEM_PERMISSAO';
  END IF;
  IF btrim(coalesce(p_motivo,'')) = '' THEN
    RAISE EXCEPTION 'Motivo de bloqueio obrigatório'
      USING ERRCODE = '22023', HINT = 'RFID_MOTIVO_OBRIGATORIO';
  END IF;

  SELECT * INTO v_col FROM public.colaboradores WHERE id = p_colaborador_id;
  IF v_col.id IS NULL THEN
    RAISE EXCEPTION 'Colaborador não encontrado'
      USING ERRCODE = 'P0002', HINT = 'RFID_COLAB_NAO_ENCONTRADO';
  END IF;

  SELECT (public.cena_rfid_usuario_sessao()).nome INTO v_usr;

  SELECT * INTO v_ativo
  FROM public.colaborador_credenciais
  WHERE colaborador_id = p_colaborador_id AND tipo = 'RFID' AND status = 'ATIVO'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Colaborador não possui RFID ATIVO para bloquear'
      USING ERRCODE = 'P0002', HINT = 'RFID_SEM_ATIVO';
  END IF;

  UPDATE public.colaborador_credenciais
  SET status = 'BLOQUEADO',
      bloqueado_em = now(),
      bloqueado_por = v_usr,
      motivo_bloqueio = btrim(p_motivo)
  WHERE id = v_ativo.id
  RETURNING * INTO v_ativo;

  PERFORM public.cena_rfid_audit_registrar(
    'RFID_BLOQUEADO',
    format('Bloqueou crachá RFID de %s — RE %s.', coalesce(v_col.nome,'?'), coalesce(v_col.re,'—')),
    jsonb_build_object(
      'colaborador_id', v_col.id,
      'colaborador_nome', v_col.nome,
      'colaborador_re', v_col.re,
      'credencial_id', v_ativo.id,
      'uid_normalizado', v_ativo.uid_normalizado,
      'status_anterior', 'ATIVO',
      'status_novo', 'BLOQUEADO',
      'motivo', btrim(p_motivo)
    ),
    'rpc:fn_rfid_bloquear'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'acao', 'RFID_BLOQUEADO',
    'credencial', jsonb_build_object('id', v_ativo.id, 'status', v_ativo.status)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_rfid_reativar(p_colaborador_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bloq public.colaborador_credenciais%ROWTYPE;
  v_ativo_id uuid;
  v_col public.colaboradores%ROWTYPE;
BEGIN
  IF NOT public.cena_rfid_pode_cadastrar() THEN
    RAISE EXCEPTION 'Sem permissão para reativar RFID'
      USING ERRCODE = '42501', HINT = 'RFID_SEM_PERMISSAO';
  END IF;

  SELECT * INTO v_col FROM public.colaboradores WHERE id = p_colaborador_id;
  IF v_col.id IS NULL THEN
    RAISE EXCEPTION 'Colaborador não encontrado'
      USING ERRCODE = 'P0002', HINT = 'RFID_COLAB_NAO_ENCONTRADO';
  END IF;

  SELECT id INTO v_ativo_id
  FROM public.colaborador_credenciais
  WHERE colaborador_id = p_colaborador_id AND tipo = 'RFID' AND status = 'ATIVO'
  FOR UPDATE;

  IF v_ativo_id IS NOT NULL THEN
    RAISE EXCEPTION 'Colaborador já possui RFID ATIVO. Não reativar outro em paralelo.'
      USING ERRCODE = 'P0001', HINT = 'RFID_JA_ATIVO';
  END IF;

  SELECT * INTO v_bloq
  FROM public.colaborador_credenciais
  WHERE colaborador_id = p_colaborador_id AND tipo = 'RFID' AND status = 'BLOQUEADO'
  ORDER BY bloqueado_em DESC NULLS LAST, atualizado_em DESC
  FOR UPDATE
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Não há crachá BLOQUEADO deste colaborador para reativar'
      USING ERRCODE = 'P0002', HINT = 'RFID_SEM_BLOQUEADO';
  END IF;

  UPDATE public.colaborador_credenciais
  SET status = 'ATIVO',
      ativado_em = now(),
      bloqueado_em = NULL,
      bloqueado_por = NULL,
      motivo_bloqueio = NULL
  WHERE id = v_bloq.id
  RETURNING * INTO v_bloq;

  PERFORM public.cena_rfid_audit_registrar(
    'RFID_REATIVADO',
    format('Reativou crachá RFID de %s — RE %s.', coalesce(v_col.nome,'?'), coalesce(v_col.re,'—')),
    jsonb_build_object(
      'colaborador_id', v_col.id,
      'colaborador_nome', v_col.nome,
      'colaborador_re', v_col.re,
      'credencial_id', v_bloq.id,
      'uid_normalizado', v_bloq.uid_normalizado,
      'status_anterior', 'BLOQUEADO',
      'status_novo', 'ATIVO'
    ),
    'rpc:fn_rfid_reativar'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'acao', 'RFID_REATIVADO',
    'credencial', jsonb_build_object('id', v_bloq.id, 'status', v_bloq.status)
  );
END;
$$;

-- Substituição atômica: A ATIVO → SUBSTITUIDO e B → ATIVO na mesma transação,
-- inclusive o INSERT em audit_log. Falha de auditoria desfaz A e B.
CREATE OR REPLACE FUNCTION public.fn_rfid_substituir(
  p_colaborador_id uuid,
  p_uid text,
  p_origem_leitura text DEFAULT NULL,
  p_motivo text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid text;
  v_exist public.colaborador_credenciais%ROWTYPE;
  v_atual public.colaborador_credenciais%ROWTYPE;
  v_nova public.colaborador_credenciais%ROWTYPE;
  v_col public.colaboradores%ROWTYPE;
  v_usr text;
  v_outro_nome text;
  v_outro_re text;
BEGIN
  IF NOT public.cena_rfid_pode_cadastrar() THEN
    RAISE EXCEPTION 'Sem permissão para substituir RFID'
      USING ERRCODE = '42501', HINT = 'RFID_SEM_PERMISSAO';
  END IF;

  v_uid := public.cena_rfid_normalizar_uid(p_uid);
  IF v_uid IS NULL OR v_uid = '' THEN
    RAISE EXCEPTION 'UID RFID vazio após normalização'
      USING ERRCODE = '22023', HINT = 'RFID_UID_VAZIO';
  END IF;

  PERFORM pg_advisory_xact_lock(871001, hashtext(v_uid));

  SELECT * INTO v_col FROM public.colaboradores WHERE id = p_colaborador_id FOR UPDATE;
  IF v_col.id IS NULL THEN
    RAISE EXCEPTION 'Colaborador não encontrado'
      USING ERRCODE = 'P0002', HINT = 'RFID_COLAB_NAO_ENCONTRADO';
  END IF;

  SELECT (public.cena_rfid_usuario_sessao()).nome INTO v_usr;

  SELECT * INTO v_atual
  FROM public.colaborador_credenciais
  WHERE colaborador_id = p_colaborador_id AND tipo = 'RFID' AND status = 'ATIVO'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Colaborador não possui RFID ATIVO para substituir. Use vínculo ou reativação.'
      USING ERRCODE = 'P0002', HINT = 'RFID_SEM_ATIVO';
  END IF;

  IF v_atual.uid_normalizado = v_uid THEN
    RAISE EXCEPTION 'O UID lido já é o crachá ATIVO deste colaborador'
      USING ERRCODE = 'P0001', HINT = 'RFID_MESMO_UID';
  END IF;

  SELECT * INTO v_exist
  FROM public.colaborador_credenciais
  WHERE tipo = 'RFID' AND uid_normalizado = v_uid
  FOR UPDATE;

  IF FOUND THEN
    IF v_exist.colaborador_id <> p_colaborador_id THEN
      SELECT nome, re INTO v_outro_nome, v_outro_re
      FROM public.colaboradores WHERE id = v_exist.colaborador_id;
      RAISE EXCEPTION 'Crachá já vinculado a % — RE %.', coalesce(v_outro_nome,'?'), coalesce(v_outro_re,'—')
        USING ERRCODE = '23505', HINT = 'RFID_UID_HISTORICO';
    END IF;

    UPDATE public.colaborador_credenciais
    SET status = 'SUBSTITUIDO'
    WHERE id = v_atual.id;

    UPDATE public.colaborador_credenciais
    SET status = 'ATIVO',
        ativado_em = now(),
        bloqueado_em = NULL,
        bloqueado_por = NULL,
        motivo_bloqueio = NULL,
        substitui_credencial_id = v_atual.id,
        origem_leitura = coalesce(p_origem_leitura, origem_leitura)
    WHERE id = v_exist.id
    RETURNING * INTO v_nova;
  ELSE
    UPDATE public.colaborador_credenciais
    SET status = 'SUBSTITUIDO'
    WHERE id = v_atual.id;

    INSERT INTO public.colaborador_credenciais (
      colaborador_id, tipo, uid, uid_normalizado, status,
      emitido_em, ativado_em, substitui_credencial_id, origem_leitura, criado_por
    ) VALUES (
      p_colaborador_id, 'RFID', btrim(p_uid), v_uid, 'ATIVO',
      now(), now(), v_atual.id, p_origem_leitura, v_usr
    ) RETURNING * INTO v_nova;
  END IF;

  PERFORM public.cena_rfid_audit_registrar(
    'RFID_SUBSTITUIDO',
    format('Substituiu crachá RFID de %s — RE %s.', coalesce(v_col.nome,'?'), coalesce(v_col.re,'—')),
    jsonb_build_object(
      'colaborador_id', v_col.id,
      'colaborador_nome', v_col.nome,
      'colaborador_re', v_col.re,
      'uid_normalizado', v_uid,
      'status_anterior', 'ATIVO',
      'status_novo', 'ATIVO',
      'motivo', nullif(btrim(coalesce(p_motivo,'')), ''),
      'credencial_anterior_id', v_atual.id,
      'credencial_nova_id', v_nova.id,
      'origem_leitura', p_origem_leitura
    ),
    'rpc:fn_rfid_substituir'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'acao', 'RFID_SUBSTITUIDO',
    'credencial_anterior', jsonb_build_object('id', v_atual.id, 'status', 'SUBSTITUIDO'),
    'credencial', jsonb_build_object('id', v_nova.id, 'status', v_nova.status)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_rfid_resolver(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_rfid_vincular(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_rfid_bloquear(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_rfid_reativar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_rfid_substituir(uuid, text, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.fn_rfid_resolver(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rfid_vincular(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rfid_bloquear(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rfid_reativar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rfid_substituir(uuid, text, text, text) TO authenticated;
