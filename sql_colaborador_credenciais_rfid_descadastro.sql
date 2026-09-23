-- sql_colaborador_credenciais_rfid_descadastro.sql
-- 8.1.121 — Descadastrar crachá equivocado e LIBERAR o UID para novo vínculo.
-- Aplicar no SQL Editor do Supabase (NÃO pelo ERP). Idempotente.
--
-- Bloqueio / substituição CONTINUAM reservando o UID (perdido/trocado).
-- Só DESCADASTRADO libera o mesmo RFID para gravar de novo.
--
-- Diagnóstico RE 108 (só leitura — rode à parte se quiser ver o duplicado):
-- SELECT c.id, c.nome, c.re, c.ativo, c.deleted_at,
--        cc.id AS cred_id, cc.uid_normalizado, cc.status, cc.ativado_em, cc.criado_em
-- FROM public.colaboradores c
-- LEFT JOIN public.colaborador_credenciais cc
--   ON cc.colaborador_id = c.id AND cc.tipo = 'RFID'
-- WHERE regexp_replace(coalesce(c.re,''), '[^0-9]', '', 'g') IN ('108','000108')
-- ORDER BY c.criado_em NULLS LAST, cc.criado_em NULLS LAST;

-- 1) Status novo
ALTER TABLE public.colaborador_credenciais
  DROP CONSTRAINT IF EXISTS colaborador_credenciais_status_chk;
ALTER TABLE public.colaborador_credenciais
  ADD CONSTRAINT colaborador_credenciais_status_chk
  CHECK (status IN ('ATIVO','BLOQUEADO','SUBSTITUIDO','DESCADASTRADO'));

-- 2) UID único só enquanto ocupado (ATIVO / BLOQUEADO / SUBSTITUIDO).
--    DESCADASTRADO sai do índice e o mesmo UID pode ser vinculado de novo.
DROP INDEX IF EXISTS public.uq_cred_tipo_uid_norm;
DROP INDEX IF EXISTS public.uq_cred_tipo_uid_norm_ocupado;
CREATE UNIQUE INDEX uq_cred_tipo_uid_norm_ocupado
  ON public.colaborador_credenciais (tipo, uid_normalizado)
  WHERE status IN ('ATIVO','BLOQUEADO','SUBSTITUIDO');

COMMENT ON TABLE public.colaborador_credenciais IS
  'Credencial RFID do colaborador. UID ocupado (ATIVO/BLOQUEADO/SUBSTITUIDO) não se repete. DESCADASTRADO libera o UID para novo vínculo (cadastro equivocado).';

-- 3) Resolver: DESCADASTRADO = não cadastrado (UID livre)
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
  WHERE tipo = 'RFID'
    AND uid_normalizado = v_uid
    AND status IN ('ATIVO','BLOQUEADO','SUBSTITUIDO')
  ORDER BY CASE status WHEN 'ATIVO' THEN 1 WHEN 'BLOQUEADO' THEN 2 ELSE 3 END
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

-- 4) Vincular: ignora linhas DESCADASTRADO (UID livre)
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
  WHERE tipo = 'RFID'
    AND uid_normalizado = v_uid
    AND status IN ('ATIVO','BLOQUEADO','SUBSTITUIDO')
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

-- 5) Substituir: mesmo recorte de UID ocupado
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
  WHERE tipo = 'RFID'
    AND uid_normalizado = v_uid
    AND status IN ('ATIVO','BLOQUEADO','SUBSTITUIDO')
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

-- 6) Descadastrar: ATIVO ou BLOQUEADO → DESCADASTRADO (UID livre)
CREATE OR REPLACE FUNCTION public.fn_rfid_descadastrar(
  p_colaborador_id uuid,
  p_motivo text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cred public.colaborador_credenciais%ROWTYPE;
  v_col public.colaboradores%ROWTYPE;
  v_usr text;
  v_antes text;
BEGIN
  IF NOT public.cena_rfid_pode_cadastrar() THEN
    RAISE EXCEPTION 'Sem permissão para descadastrar RFID'
      USING ERRCODE = '42501', HINT = 'RFID_SEM_PERMISSAO';
  END IF;
  IF btrim(coalesce(p_motivo,'')) = '' THEN
    RAISE EXCEPTION 'Motivo de descadastro obrigatório'
      USING ERRCODE = '22023', HINT = 'RFID_MOTIVO_OBRIGATORIO';
  END IF;

  SELECT * INTO v_col FROM public.colaboradores WHERE id = p_colaborador_id;
  IF v_col.id IS NULL THEN
    RAISE EXCEPTION 'Colaborador não encontrado'
      USING ERRCODE = 'P0002', HINT = 'RFID_COLAB_NAO_ENCONTRADO';
  END IF;

  SELECT (public.cena_rfid_usuario_sessao()).nome INTO v_usr;

  SELECT * INTO v_cred
  FROM public.colaborador_credenciais
  WHERE colaborador_id = p_colaborador_id
    AND tipo = 'RFID'
    AND status IN ('ATIVO','BLOQUEADO')
  ORDER BY CASE status WHEN 'ATIVO' THEN 1 ELSE 2 END, atualizado_em DESC
  FOR UPDATE
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Colaborador não possui crachá ATIVO ou BLOQUEADO para descadastrar'
      USING ERRCODE = 'P0002', HINT = 'RFID_SEM_ATIVO';
  END IF;

  v_antes := v_cred.status;

  UPDATE public.colaborador_credenciais
  SET status = 'DESCADASTRADO',
      bloqueado_em = now(),
      bloqueado_por = v_usr,
      motivo_bloqueio = btrim(p_motivo)
  WHERE id = v_cred.id
  RETURNING * INTO v_cred;

  PERFORM public.cena_rfid_audit_registrar(
    'RFID_DESCADASTRADO',
    format('Descadastrou crachá RFID de %s — RE %s (cadastro equivocado). UID liberado.', coalesce(v_col.nome,'?'), coalesce(v_col.re,'—')),
    jsonb_build_object(
      'colaborador_id', v_col.id,
      'colaborador_nome', v_col.nome,
      'colaborador_re', v_col.re,
      'credencial_id', v_cred.id,
      'uid_normalizado', v_cred.uid_normalizado,
      'status_anterior', v_antes,
      'status_novo', 'DESCADASTRADO',
      'motivo', btrim(p_motivo)
    ),
    'rpc:fn_rfid_descadastrar'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'acao', 'RFID_DESCADASTRADO',
    'uid_liberado', true,
    'credencial', jsonb_build_object('id', v_cred.id, 'status', v_cred.status)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_rfid_resolver(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_rfid_vincular(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_rfid_substituir(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_rfid_descadastrar(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.fn_rfid_resolver(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rfid_vincular(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rfid_substituir(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rfid_descadastrar(uuid, text) TO authenticated;
