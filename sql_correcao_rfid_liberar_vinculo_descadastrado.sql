-- sql_correcao_rfid_liberar_vinculo_descadastrado.sql
-- O cadastro 0007682486 já está DESCADASTRADO, mas fn_rfid_vincular/fn_rfid_resolver
-- ainda no banco (versão CORE) consideram QUALQUER linha do UID — inclusive histórico.
-- Por isso o ERP continua: "já vinculado a … RE PJ108".
--
-- Este script NÃO mexe em colaborador nenhum.
-- Só atualiza as RPCs para ignorar status DESCADASTRADO (UID livre).
-- Rode no SQL Editor. Depois vincule o crachá na pessoa certa pelo ERP.

-- Conferência: linhas do UID (esperado: só DESCADASTRADO)
SELECT cc.id, cc.colaborador_id, c.re, cc.status, cc.uid_normalizado
FROM public.colaborador_credenciais cc
JOIN public.colaboradores c ON c.id = cc.colaborador_id
WHERE cc.tipo = 'RFID'
  AND public.cena_rfid_normalizar_uid(cc.uid_normalizado)
      = public.cena_rfid_normalizar_uid('0007682486');

-- Resolver: DESCADASTRADO = não cadastrado
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
      'ok', false, 'encontrado', false, 'autenticavel', false,
      'motivo', 'UID_VAZIO', 'credencial', NULL, 'colaborador', NULL
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
      'ok', true, 'encontrado', false, 'autenticavel', false,
      'motivo', 'NAO_CADASTRADO', 'credencial', NULL, 'colaborador', NULL
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
    'credencial', jsonb_build_object('id', v_cc.id, 'status', v_cc.status),
    'colaborador', jsonb_build_object('id', v_col.id, 'nome', v_col.nome, 're', v_col.re)
  );
END;
$$;

-- Vincular: ignora DESCADASTRADO
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

-- Substituir: mesmo recorte (DESCADASTRADO não ocupa)
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

REVOKE ALL ON FUNCTION public.fn_rfid_resolver(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_rfid_vincular(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_rfid_substituir(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_rfid_resolver(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rfid_vincular(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rfid_substituir(uuid, text, text, text) TO authenticated;
