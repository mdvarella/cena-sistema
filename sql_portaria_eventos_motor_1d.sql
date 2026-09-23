-- sql_portaria_eventos_motor_1d.sql
-- REV 2 — 23/09/2026 — sem GOTO / sem <<GRAVAR>> (Supabase 42601).
-- PORT-AUTO-SYS-1D — eventos + motor fail-closed.
-- Aditivo / idempotente.
-- NÃO executar pelo ERP. Aplicar manualmente no SQL Editor após GATE 1B/1C = APROVADO.
-- NÃO abre portão, NÃO tira foto, NÃO grava frotas_portaria_saidas, NÃO fala com hardware.
-- Sem GOTO (o SQL Editor do Supabase rejeita 42601).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.cena_acesso_ctx_text(p jsonb, p_a text, p_b text DEFAULT NULL)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT nullif(btrim(coalesce(p ->> p_a, CASE WHEN p_b IS NULL THEN NULL ELSE p ->> p_b END, '')), '');
$$;

CREATE OR REPLACE FUNCTION public.cena_acesso_norm_placa(p_placa text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT upper(regexp_replace(coalesce(p_placa, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.cena_acesso_mensagem(p_codigo text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_codigo
    WHEN 'SEM_PROGRAMACAO' THEN 'Não há programação válida para esta tentativa.'
    WHEN 'PROGRAMACAO_NAO_CONFIRMADA' THEN 'A programação da equipe não está confirmada.'
    WHEN 'COLABORADOR_FORA_EQUIPE' THEN 'O colaborador apresentado não pertence à equipe programada.'
    WHEN 'PARCEIRO_DIVERGENTE' THEN 'O parceiro apresentado não confere com a composição.'
    WHEN 'VEICULO_DIVERGENTE' THEN 'O veículo apresentado não corresponde ao veículo programado.'
    WHEN 'DIARIO_NAO_INICIADO' THEN 'Nenhum Diário ativo foi encontrado para a equipe.'
    WHEN 'CHECKLIST_PENDENTE' THEN 'Checklist obrigatório de EPI ou veicular está pendente.'
    WHEN 'KM_NAO_INFORMADO' THEN 'KM inicial do Diário/turno não foi informado.'
    WHEN 'RFID_DESCONHECIDO' THEN 'Crachá RFID não cadastrado.'
    WHEN 'RFID_BLOQUEADO' THEN 'Crachá RFID bloqueado.'
    WHEN 'COLABORADOR_INATIVO' THEN 'Colaborador inativo ou sem cadastro válido.'
    WHEN 'TAG_DESCONHECIDA' THEN 'TAG do veículo não cadastrada.'
    WHEN 'TAG_BLOQUEADA' THEN 'TAG do veículo bloqueada.'
    WHEN 'TAG_SUBSTITUIDA' THEN 'Esta TAG foi substituída.'
    WHEN 'VEICULO_INATIVO' THEN 'Veículo inativo no cadastro.'
    WHEN 'VEICULO_BLOQUEADO' THEN 'Veículo bloqueado para circulação.'
    WHEN 'VEICULO_JA_EM_CAMPO' THEN 'Já existe viagem em campo para este veículo.'
    WHEN 'DISPOSITIVO_INATIVO' THEN 'Dispositivo ou ponto de acesso inativo.'
    WHEN 'DISPOSITIVO_OFFLINE' THEN 'Dispositivo offline ou em erro.'
    WHEN 'ERRO_INTERNO' THEN 'Falha técnica. Acesso não autorizado.'
    WHEN 'UID_VAZIO' THEN 'Identificador vazio.'
    ELSE coalesce(p_codigo, 'Falha de avaliação.')
  END;
$$;

CREATE OR REPLACE FUNCTION public.cena_acesso_pode_avaliar()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_us public.usuarios_sistema%ROWTYPE;
BEGIN
  IF to_regprocedure('public.cena_acesso_infra_usuario_sessao()') IS NOT NULL THEN
    v_us := public.cena_acesso_infra_usuario_sessao();
  ELSIF to_regprocedure('public.cena_tag_usuario_sessao()') IS NOT NULL THEN
    v_us := public.cena_tag_usuario_sessao();
  ELSE
    RETURN false;
  END IF;
  RETURN v_us.id IS NOT NULL
    AND lower(btrim(coalesce(v_us.perfil, ''))) IN (
      'admin','diretoria','gestor','coordenador','supervisor','supervisor_tma','portaria','escritorio'
    );
END;
$$;

CREATE TABLE IF NOT EXISTS public.portaria_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlacao_id uuid NOT NULL,
  tipo_evento text NOT NULL DEFAULT 'TENTATIVA_ACESSO',
  base_id uuid,
  portaria_id uuid,
  ponto_acesso_id uuid,
  dispositivo_id uuid,
  sentido text,
  colaborador_id uuid,
  veiculo_id uuid,
  equipe_id uuid,
  portaria_saida_id uuid,
  resultado text NOT NULL,
  motivo_codigo text,
  motivo_descricao text,
  origem text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  processado_em timestamptz,
  dados_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL
);

COMMENT ON TABLE public.portaria_eventos IS
  'Histórico imutável de tentativas de acesso. Motor fail-closed. Sem comando de portão.';

ALTER TABLE public.portaria_eventos
  DROP CONSTRAINT IF EXISTS portaria_eventos_resultado_chk;
ALTER TABLE public.portaria_eventos
  ADD CONSTRAINT portaria_eventos_resultado_chk
  CHECK (resultado IN ('PENDENTE','AUTORIZADO','NEGADO','CCO','ERRO'));

ALTER TABLE public.portaria_eventos
  DROP CONSTRAINT IF EXISTS portaria_eventos_origem_chk;
ALTER TABLE public.portaria_eventos
  ADD CONSTRAINT portaria_eventos_origem_chk
  CHECK (origem IN ('SIMULADOR','AUTOMATICA','MANUAL_PORTARIA','CCO'));

ALTER TABLE public.portaria_eventos
  DROP CONSTRAINT IF EXISTS portaria_eventos_sentido_chk;
ALTER TABLE public.portaria_eventos
  ADD CONSTRAINT portaria_eventos_sentido_chk
  CHECK (sentido IS NULL OR sentido IN ('ENTRADA','SAIDA','BIDIRECIONAL'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_portaria_eventos_idem
  ON public.portaria_eventos (idempotency_key);

CREATE INDEX IF NOT EXISTS idx_portaria_eventos_corr
  ON public.portaria_eventos (correlacao_id, criado_em DESC);

CREATE INDEX IF NOT EXISTS idx_portaria_eventos_veic
  ON public.portaria_eventos (veiculo_id, criado_em DESC);

ALTER TABLE public.portaria_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portaria_eventos FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.portaria_eventos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.portaria_eventos TO authenticated;
GRANT ALL ON TABLE public.portaria_eventos TO service_role;

DROP POLICY IF EXISTS portaria_eventos_select ON public.portaria_eventos;
CREATE POLICY portaria_eventos_select ON public.portaria_eventos
  FOR SELECT TO authenticated
  USING (public.cena_acesso_pode_avaliar());

CREATE OR REPLACE FUNCTION public.fn_portaria_avaliar_acesso(p_contexto jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ctx jsonb := coalesce(p_contexto, '{}'::jsonb);
  v_origem text;
  v_idem text;
  v_corr uuid;
  v_base uuid;
  v_port uuid;
  v_ponto uuid;
  v_disp uuid;
  v_sentido text;
  v_uid_tag text;
  v_uids text[];
  v_equipe uuid;
  v_veic_ctx uuid;
  v_exist public.portaria_eventos%ROWTYPE;
  v_res text := 'NEGADO';
  v_cod text;
  v_msg text;
  v_extra jsonb := '{}'::jsonb;
  v_done boolean := false;
  v_tag jsonb;
  v_rfid jsonb;
  v_col_id uuid;
  v_col_ids uuid[] := ARRAY[]::uuid[];
  v_lidos jsonb := '[]'::jsonb;
  v_vei public.frotas_veiculos%ROWTYPE;
  v_placa_ap text;
  v_placa_esp text;
  v_veic_prog uuid;
  v_comp record;
  v_disp_row record;
  v_ponto_row record;
  v_confirmada boolean;
  v_esperados text[] := ARRAY[]::text[];
  v_motorista text;
  v_sess record;
  v_km numeric;
  v_epi boolean;
  v_vei_ok boolean;
  v_pend text[] := ARRAY[]::text[];
  v_ja boolean;
  v_blk boolean;
  v_imp text;
  v_uid text;
  v_i int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão Auth obrigatória para avaliar acesso'
      USING ERRCODE = '28000', HINT = 'ACESSO_AUTH_REQUIRED';
  END IF;
  IF NOT public.cena_acesso_pode_avaliar() THEN
    RAISE EXCEPTION 'Sem permissão para avaliar acesso'
      USING ERRCODE = '42501', HINT = 'ACESSO_SEM_PERMISSAO';
  END IF;

  v_origem := upper(coalesce(public.cena_acesso_ctx_text(v_ctx,'origem','origin'), 'SIMULADOR'));
  IF v_origem NOT IN ('SIMULADOR','AUTOMATICA','MANUAL_PORTARIA','CCO') THEN
    v_origem := 'SIMULADOR';
  END IF;
  v_idem := coalesce(
    public.cena_acesso_ctx_text(v_ctx,'idempotency_key','idempotencyKey'),
    public.cena_acesso_ctx_text(v_ctx,'idempotencykey', NULL)
  );
  IF v_idem IS NULL OR v_idem = '' THEN
    v_res := 'ERRO'; v_cod := 'ERRO_INTERNO';
    v_msg := 'idempotency_key é obrigatória.';
    v_corr := gen_random_uuid();
    v_idem := 'missing-' || v_corr::text;
    v_extra := jsonb_build_object('falha', 'IDEM_AUSENTE');
    v_done := true;
  END IF;

  IF NOT v_done THEN
    SELECT * INTO v_exist FROM public.portaria_eventos WHERE idempotency_key = v_idem;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'ok', true,
        'idempotente', true,
        'evento_id', v_exist.id,
        'correlacao_id', v_exist.correlacao_id,
        'resultado', v_exist.resultado,
        'motivo_codigo', v_exist.motivo_codigo,
        'mensagem', coalesce(v_exist.motivo_descricao, public.cena_acesso_mensagem(v_exist.motivo_codigo)),
        'dados_extra', v_exist.dados_extra
      );
    END IF;

    BEGIN
      v_corr := coalesce(public.cena_acesso_ctx_text(v_ctx,'correlacao_id','correlacaoId')::uuid, gen_random_uuid());
    EXCEPTION WHEN OTHERS THEN
      v_corr := gen_random_uuid();
    END;
    BEGIN
      v_base := public.cena_acesso_ctx_text(v_ctx,'base_id','baseId')::uuid;
    EXCEPTION WHEN OTHERS THEN v_base := NULL; END;
    BEGIN
      v_port := public.cena_acesso_ctx_text(v_ctx,'portaria_id','portariaId')::uuid;
    EXCEPTION WHEN OTHERS THEN v_port := NULL; END;
    BEGIN
      v_ponto := public.cena_acesso_ctx_text(v_ctx,'ponto_acesso_id','pontoAcessoId')::uuid;
    EXCEPTION WHEN OTHERS THEN v_ponto := NULL; END;
    BEGIN
      v_disp := public.cena_acesso_ctx_text(v_ctx,'dispositivo_id','dispositivoId')::uuid;
    EXCEPTION WHEN OTHERS THEN v_disp := NULL; END;
    BEGIN
      v_equipe := public.cena_acesso_ctx_text(v_ctx,'equipe_id','equipeId')::uuid;
    EXCEPTION WHEN OTHERS THEN v_equipe := NULL; END;
    BEGIN
      v_veic_ctx := public.cena_acesso_ctx_text(v_ctx,'veiculo_id','veiculoId')::uuid;
    EXCEPTION WHEN OTHERS THEN v_veic_ctx := NULL; END;

    v_sentido := upper(coalesce(public.cena_acesso_ctx_text(v_ctx,'sentido','direction'), ''));
    IF v_sentido NOT IN ('ENTRADA','SAIDA','BIDIRECIONAL') THEN
      v_sentido := NULL;
    END IF;
    v_uid_tag := public.cena_acesso_ctx_text(v_ctx,'uid_tag','uidTag');

    IF jsonb_typeof(v_ctx -> 'uidsRfid') = 'array' THEN
      SELECT coalesce(array_agg(nullif(btrim(x), '')), ARRAY[]::text[])
        INTO v_uids FROM jsonb_array_elements_text(v_ctx -> 'uidsRfid') x;
    ELSIF jsonb_typeof(v_ctx -> 'uids_rfid') = 'array' THEN
      SELECT coalesce(array_agg(nullif(btrim(x), '')), ARRAY[]::text[])
        INTO v_uids FROM jsonb_array_elements_text(v_ctx -> 'uids_rfid') x;
    ELSE
      v_uids := ARRAY[]::text[];
    END IF;
  END IF;

  -- 1) Dispositivo / ponto
  IF NOT v_done AND v_disp IS NOT NULL THEN
    SELECT * INTO v_disp_row FROM public.portaria_dispositivos WHERE id = v_disp;
    IF NOT FOUND THEN
      v_cod := 'DISPOSITIVO_INATIVO'; v_res := 'NEGADO'; v_done := true;
      v_msg := public.cena_acesso_mensagem(v_cod);
      v_extra := jsonb_build_object('dispositivo_id', v_disp, 'motivo', 'NAO_ENCONTRADO');
    ELSIF v_disp_row.ativo IS NOT TRUE THEN
      v_cod := 'DISPOSITIVO_INATIVO'; v_res := 'NEGADO'; v_done := true;
      v_msg := public.cena_acesso_mensagem(v_cod);
      v_extra := jsonb_build_object('codigo', v_disp_row.codigo);
    ELSIF v_disp_row.status_comunicacao IN ('OFFLINE','ERRO') THEN
      v_cod := 'DISPOSITIVO_OFFLINE'; v_res := 'NEGADO'; v_done := true;
      v_msg := public.cena_acesso_mensagem(v_cod);
      v_extra := jsonb_build_object('codigo', v_disp_row.codigo, 'status', v_disp_row.status_comunicacao);
    ELSIF v_ponto IS NOT NULL AND v_disp_row.ponto_acesso_id IS NOT NULL
          AND v_disp_row.ponto_acesso_id IS DISTINCT FROM v_ponto THEN
      v_cod := 'DISPOSITIVO_INATIVO'; v_res := 'NEGADO'; v_done := true;
      v_msg := 'Dispositivo não pertence ao ponto de acesso informado.';
      v_extra := jsonb_build_object('dispositivo', v_disp_row.codigo, 'ponto_esperado', v_ponto, 'ponto_real', v_disp_row.ponto_acesso_id);
    ELSE
      v_ponto := coalesce(v_ponto, v_disp_row.ponto_acesso_id);
      v_base := coalesce(v_base, v_disp_row.base_id);
      v_port := coalesce(v_port, v_disp_row.portaria_id);
      v_sentido := coalesce(v_sentido, v_disp_row.sentido);
    END IF;
  END IF;

  IF NOT v_done AND v_ponto IS NOT NULL THEN
    SELECT * INTO v_ponto_row FROM public.portaria_pontos_acesso WHERE id = v_ponto;
    IF NOT FOUND OR v_ponto_row.ativo IS NOT TRUE THEN
      v_cod := 'DISPOSITIVO_INATIVO'; v_res := 'NEGADO'; v_done := true;
      v_msg := public.cena_acesso_mensagem(v_cod);
      v_extra := jsonb_build_object('ponto_acesso_id', v_ponto);
    ELSE
      v_base := coalesce(v_base, v_ponto_row.base_id);
      v_port := coalesce(v_port, v_ponto_row.portaria_id);
      v_sentido := coalesce(v_sentido, v_ponto_row.sentido);
    END IF;
  END IF;

  -- 2) TAG
  IF NOT v_done AND v_uid_tag IS NOT NULL THEN
    v_tag := public.fn_tag_resolver(v_uid_tag);
    IF coalesce((v_tag->>'ok')::boolean, false) IS NOT TRUE AND v_tag->>'motivo' = 'UID_VAZIO' THEN
      v_cod := 'UID_VAZIO'; v_res := 'NEGADO'; v_done := true;
      v_msg := public.cena_acesso_mensagem(v_cod);
    ELSIF coalesce((v_tag->>'encontrado')::boolean, false) IS NOT TRUE THEN
      v_cod := coalesce(v_tag->>'motivo', 'TAG_DESCONHECIDA');
      IF v_cod = 'NAO_CADASTRADO' THEN v_cod := 'TAG_DESCONHECIDA'; END IF;
      v_res := 'NEGADO'; v_done := true;
      v_msg := public.cena_acesso_mensagem(v_cod);
      v_extra := jsonb_build_object('tag', v_tag);
    ELSIF v_tag->>'motivo' IN ('TAG_BLOQUEADA','TAG_SUBSTITUIDA') THEN
      v_cod := v_tag->>'motivo'; v_res := 'NEGADO'; v_done := true;
      v_msg := public.cena_acesso_mensagem(v_cod);
      v_extra := jsonb_build_object('tag', v_tag);
    ELSE
      BEGIN
        v_veic_ctx := coalesce(v_veic_ctx, (v_tag #>> '{veiculo,id}')::uuid);
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
  END IF;

  IF NOT v_done AND v_veic_ctx IS NOT NULL THEN
    SELECT * INTO v_vei FROM public.frotas_veiculos WHERE id = v_veic_ctx;
    v_placa_ap := public.cena_acesso_norm_placa(v_vei.placa);
    v_imp := public.cena_tag_veiculo_motivo_impeditivo(v_vei);
    IF v_imp IS NOT NULL THEN
      v_cod := v_imp; v_res := 'NEGADO'; v_done := true;
      v_msg := public.cena_acesso_mensagem(v_cod);
      v_extra := jsonb_build_object('fonte', 'frotas_veiculos', 'placa', v_vei.placa, 'status', v_vei.status);
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM public.frotas_portaria_bloqueios b
        WHERE public.cena_acesso_norm_placa(b.placa) = v_placa_ap
          AND v_placa_ap <> ''
      ) INTO v_blk;
      IF v_blk THEN
        v_cod := 'VEICULO_BLOQUEADO'; v_res := 'NEGADO'; v_done := true;
        v_msg := public.cena_acesso_mensagem(v_cod);
        v_extra := jsonb_build_object('fonte', 'frotas_portaria_bloqueios', 'placa', v_vei.placa);
      END IF;
    END IF;
  END IF;

  -- 3) RFIDs
  IF NOT v_done AND v_uids IS NOT NULL THEN
    FOR v_i IN 1..coalesce(array_length(v_uids, 1), 0) LOOP
      EXIT WHEN v_done;
      v_uid := v_uids[v_i];
      IF v_uid IS NULL OR btrim(v_uid) = '' THEN
        CONTINUE;
      END IF;
      v_rfid := public.fn_rfid_resolver(v_uid);
      IF coalesce((v_rfid->>'encontrado')::boolean, false) IS NOT TRUE THEN
        v_cod := 'RFID_DESCONHECIDO'; v_res := 'NEGADO'; v_done := true;
        v_msg := public.cena_acesso_mensagem(v_cod);
        v_extra := jsonb_build_object('uid_idx', v_i, 'rfid', v_rfid);
      ELSIF v_rfid->>'motivo' = 'BLOQUEADO' THEN
        v_cod := 'RFID_BLOQUEADO'; v_res := 'NEGADO'; v_done := true;
        v_msg := public.cena_acesso_mensagem(v_cod);
        v_extra := jsonb_build_object('rfid', v_rfid);
      ELSIF v_rfid->>'motivo' = 'COLABORADOR_INATIVO'
            OR coalesce((v_rfid->>'autenticavel')::boolean, false) IS NOT TRUE THEN
        v_cod := CASE WHEN v_rfid->>'motivo' = 'COLABORADOR_INATIVO' THEN 'COLABORADOR_INATIVO' ELSE 'RFID_BLOQUEADO' END;
        v_res := 'NEGADO'; v_done := true;
        v_msg := public.cena_acesso_mensagem(v_cod);
        v_extra := jsonb_build_object('rfid', v_rfid);
      ELSE
        BEGIN
          v_col_id := (v_rfid #>> '{colaborador,id}')::uuid;
        EXCEPTION WHEN OTHERS THEN v_col_id := NULL; END;
        IF v_col_id IS NOT NULL THEN
          v_col_ids := array_append(v_col_ids, v_col_id);
          v_lidos := v_lidos || jsonb_build_array(jsonb_build_object(
            'id', v_col_id,
            'nome', v_rfid #>> '{colaborador,nome}',
            're', v_rfid #>> '{colaborador,re}'
          ));
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- 4) Programação (hoje e ontem)
  IF NOT v_done AND v_equipe IS NULL AND coalesce(array_length(v_col_ids, 1), 0) > 0 THEN
    SELECT c.equipe_id INTO v_equipe
    FROM public.composicao_dia c
    WHERE c.data::date IN (CURRENT_DATE, CURRENT_DATE - 1)
      AND (
        c.colaborador_ids::text ILIKE '%' || v_col_ids[1]::text || '%'
        OR c.motorista_id::text = v_col_ids[1]::text
      )
    ORDER BY c.data::date DESC
    LIMIT 1;
  END IF;

  IF NOT v_done AND v_equipe IS NULL THEN
    v_cod := 'SEM_PROGRAMACAO'; v_res := 'NEGADO'; v_done := true;
    v_msg := public.cena_acesso_mensagem(v_cod);
    v_extra := jsonb_build_object('colaboradores_lidos', v_lidos, 'veiculo_apresentado', v_veic_ctx);
  END IF;

  IF NOT v_done THEN
    PERFORM pg_advisory_xact_lock(871003, hashtext(coalesce(v_veic_ctx::text, v_equipe::text)));

    SELECT c.id, c.equipe_id, c.data, c.confirmada, c.motorista_id, c.placa, c.veiculo_id, c.colaborador_ids
      INTO v_comp
    FROM public.composicao_dia c
    WHERE c.equipe_id = v_equipe
      AND c.data::date IN (CURRENT_DATE, CURRENT_DATE - 1)
    ORDER BY c.data::date DESC, c.confirmada DESC NULLS LAST
    LIMIT 1;

    IF v_comp.id IS NULL THEN
      v_cod := 'SEM_PROGRAMACAO'; v_res := 'NEGADO'; v_done := true;
      v_msg := public.cena_acesso_mensagem(v_cod);
      v_extra := jsonb_build_object('equipe_id', v_equipe);
    ELSE
      v_confirmada := (v_comp.confirmada IS TRUE OR v_comp.confirmada::text IN ('true','t','1'));
      IF NOT v_confirmada THEN
        v_cod := 'PROGRAMACAO_NAO_CONFIRMADA'; v_res := 'NEGADO'; v_done := true;
        v_msg := public.cena_acesso_mensagem(v_cod);
        v_extra := jsonb_build_object('equipe_id', v_equipe, 'composicao_id', v_comp.id, 'data', v_comp.data);
      END IF;
    END IF;
  END IF;

  IF NOT v_done THEN
    BEGIN
      SELECT coalesce(array_agg(elem), ARRAY[]::text[])
        INTO v_esperados
      FROM jsonb_array_elements_text(
        CASE
          WHEN v_comp.colaborador_ids IS NULL THEN '[]'::jsonb
          ELSE v_comp.colaborador_ids::jsonb
        END
      ) AS elem;
    EXCEPTION WHEN OTHERS THEN
      v_esperados := ARRAY[]::text[];
    END;
    v_motorista := v_comp.motorista_id::text;

    BEGIN
      SELECT p.veiculo_id, p.placa
        INTO v_veic_prog, v_placa_esp
      FROM public.prog_veiculos_dia p
      WHERE p.equipe_id = v_equipe
        AND p.data::date IN (CURRENT_DATE, CURRENT_DATE - 1)
        AND (p.deleted_at IS NULL)
      ORDER BY p.data::date DESC
      LIMIT 1;
    EXCEPTION WHEN undefined_column THEN
      SELECT p.veiculo_id, p.placa
        INTO v_veic_prog, v_placa_esp
      FROM public.prog_veiculos_dia p
      WHERE p.equipe_id = v_equipe
        AND p.data::date IN (CURRENT_DATE, CURRENT_DATE - 1)
      ORDER BY p.data::date DESC
      LIMIT 1;
    END;
    IF v_veic_prog IS NULL THEN
      v_veic_prog := v_comp.veiculo_id;
      v_placa_esp := public.cena_acesso_norm_placa(v_comp.placa);
    ELSE
      v_placa_esp := public.cena_acesso_norm_placa(v_placa_esp);
    END IF;

    IF v_veic_ctx IS NOT NULL AND v_veic_prog IS NOT NULL AND v_veic_ctx IS DISTINCT FROM v_veic_prog THEN
      v_cod := 'VEICULO_DIVERGENTE'; v_res := 'NEGADO'; v_done := true;
      v_msg := public.cena_acesso_mensagem(v_cod);
      v_extra := jsonb_build_object(
        'veiculo_esperado', v_veic_prog,
        'placa_esperada', v_placa_esp,
        'veiculo_apresentado', v_veic_ctx,
        'placa_apresentada', v_placa_ap
      );
    ELSIF v_veic_ctx IS NOT NULL AND v_veic_prog IS NULL AND v_placa_esp <> '' AND v_placa_ap <> ''
          AND v_placa_esp IS DISTINCT FROM v_placa_ap THEN
      v_cod := 'VEICULO_DIVERGENTE'; v_res := 'NEGADO'; v_done := true;
      v_msg := public.cena_acesso_mensagem(v_cod);
      v_extra := jsonb_build_object('placa_esperada', v_placa_esp, 'placa_apresentada', v_placa_ap);
    END IF;
  END IF;

  IF NOT v_done AND coalesce(array_length(v_col_ids, 1), 0) > 0 THEN
    FOR v_i IN 1..array_length(v_col_ids, 1) LOOP
      EXIT WHEN v_done;
      IF NOT (v_col_ids[v_i]::text = ANY (v_esperados) OR v_col_ids[v_i]::text = v_motorista) THEN
        v_cod := 'COLABORADOR_FORA_EQUIPE'; v_res := 'NEGADO'; v_done := true;
        v_msg := public.cena_acesso_mensagem(v_cod);
        v_extra := jsonb_build_object(
          'colaboradores_esperados', to_jsonb(v_esperados),
          'colaboradores_lidos', v_lidos,
          'motorista_esperado', v_motorista,
          'fora', v_col_ids[v_i]
        );
      END IF;
    END LOOP;
  END IF;

  IF NOT v_done THEN
    SELECT s.id, s.data, s.login_ts, s.logout_ts, s.km_inicial
      INTO v_sess
    FROM public.sessoes_disponibilidade s
    WHERE s.equipe_id = v_equipe
      AND s.login_ts IS NOT NULL
      AND s.logout_ts IS NULL
    ORDER BY s.login_ts DESC
    LIMIT 1;
    IF v_sess.id IS NULL THEN
      v_cod := 'DIARIO_NAO_INICIADO'; v_res := 'NEGADO'; v_done := true;
      v_msg := public.cena_acesso_mensagem(v_cod);
      v_extra := jsonb_build_object('equipe_id', v_equipe, 'data_comp', v_comp.data, 'sessoes_ativas', 0);
    END IF;
  END IF;

  IF NOT v_done THEN
    SELECT t.checklist_epi_ok, t.checklist_vei_ok, t.km_inicial
      INTO v_epi, v_vei_ok, v_km
    FROM public.turnos_abertos t
    WHERE t.equipe_id = v_equipe
      AND coalesce(t.status, 'aberto') IN ('aberto', 'Aberto')
    ORDER BY t.data DESC NULLS LAST
    LIMIT 1;
    IF v_epi IS NOT TRUE THEN v_pend := array_append(v_pend, 'EPI'); END IF;
    IF v_vei_ok IS NOT TRUE THEN v_pend := array_append(v_pend, 'VEICULAR'); END IF;
    IF array_length(v_pend, 1) IS NOT NULL THEN
      v_cod := 'CHECKLIST_PENDENTE'; v_res := 'NEGADO'; v_done := true;
      v_msg := public.cena_acesso_mensagem(v_cod);
      v_extra := jsonb_build_object('pendentes', to_jsonb(v_pend), 'equipe_id', v_equipe);
    END IF;
  END IF;

  IF NOT v_done THEN
    v_km := coalesce(v_km, v_sess.km_inicial);
    IF v_km IS NULL OR v_km <= 0 THEN
      v_cod := 'KM_NAO_INFORMADO'; v_res := 'NEGADO'; v_done := true;
      v_msg := public.cena_acesso_mensagem(v_cod);
      v_extra := jsonb_build_object('km_inicial', v_km, 'fonte', 'diario_turno');
    END IF;
  END IF;

  IF NOT v_done THEN
    SELECT EXISTS (
      SELECT 1 FROM public.frotas_portaria_saidas s
      WHERE s.deleted_at IS NULL
        AND s.status = 'Em campo'
        AND (
          (v_veic_ctx IS NOT NULL AND s.veiculo_id = v_veic_ctx)
          OR (v_placa_ap <> '' AND public.cena_acesso_norm_placa(s.placa) = v_placa_ap)
        )
    ) INTO v_ja;
    IF v_ja THEN
      v_cod := 'VEICULO_JA_EM_CAMPO'; v_res := 'NEGADO'; v_done := true;
      v_msg := public.cena_acesso_mensagem(v_cod);
      v_extra := jsonb_build_object('placa', v_placa_ap, 'veiculo_id', v_veic_ctx);
    END IF;
  END IF;

  IF NOT v_done THEN
    v_res := 'AUTORIZADO';
    v_cod := NULL;
    v_msg := 'Acesso autorizado. Decisão lógica — nenhum portão foi acionado.';
    v_extra := jsonb_build_object(
      'placa_esperada', v_placa_esp,
      'placa_apresentada', v_placa_ap,
      'equipe_id', v_equipe,
      'colaboradores_esperados', to_jsonb(v_esperados),
      'colaboradores_lidos', v_lidos,
      'motorista_esperado', v_motorista,
      'km_inicial', v_km,
      'previsao_retorno', NULL,
      'simulado', true
    );
  END IF;

  v_msg := coalesce(v_msg, public.cena_acesso_mensagem(v_cod));
  v_extra := jsonb_strip_nulls(coalesce(v_extra, '{}'::jsonb) || jsonb_build_object(
    'correlacao_id', v_corr,
    'sem_segredo', true
  ));

  INSERT INTO public.portaria_eventos (
    correlacao_id, tipo_evento, base_id, portaria_id, ponto_acesso_id, dispositivo_id,
    sentido, colaborador_id, veiculo_id, equipe_id, resultado, motivo_codigo, motivo_descricao,
    origem, processado_em, dados_extra, idempotency_key
  ) VALUES (
    coalesce(v_corr, gen_random_uuid()), 'TENTATIVA_ACESSO', v_base, v_port, v_ponto, v_disp,
    v_sentido, v_col_ids[1], v_veic_ctx, v_equipe, v_res, v_cod, v_msg,
    v_origem, now(), v_extra, v_idem
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  SELECT * INTO v_exist FROM public.portaria_eventos WHERE idempotency_key = v_idem;

  BEGIN
    INSERT INTO public.audit_log (
      acao, modulo, descricao, usuario_id, usuario_nome, usuario_perfil,
      dados_extra, data_hora, sessao_id
    ) VALUES (
      'ACESSO_AVALIADO', 'frotas',
      format('Avaliou acesso %s %s', v_exist.resultado, coalesce(v_exist.motivo_codigo, '')),
      coalesce(auth.uid()::text, ''),
      '',
      '',
      jsonb_build_object(
        'evento_id', v_exist.id,
        'correlacao_id', v_exist.correlacao_id,
        'resultado', v_exist.resultado,
        'motivo_codigo', v_exist.motivo_codigo
      ),
      now(), 'rpc:fn_portaria_avaliar_acesso'
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotente', false,
    'evento_id', v_exist.id,
    'correlacao_id', v_exist.correlacao_id,
    'resultado', v_exist.resultado,
    'motivo_codigo', v_exist.motivo_codigo,
    'mensagem', v_exist.motivo_descricao,
    'dados_extra', v_exist.dados_extra
  );
EXCEPTION WHEN OTHERS THEN
  v_res := 'ERRO';
  v_cod := 'ERRO_INTERNO';
  v_msg := public.cena_acesso_mensagem(v_cod);
  v_corr := coalesce(v_corr, gen_random_uuid());
  v_idem := coalesce(nullif(v_idem, ''), 'err-' || v_corr::text);
  v_extra := jsonb_build_object('sqlstate', SQLSTATE);
  BEGIN
    INSERT INTO public.portaria_eventos (
      correlacao_id, tipo_evento, resultado, motivo_codigo, motivo_descricao,
      origem, processado_em, dados_extra, idempotency_key
    ) VALUES (
      v_corr, 'TENTATIVA_ACESSO', 'ERRO', 'ERRO_INTERNO', v_msg,
      coalesce(v_origem, 'SIMULADOR'), now(), v_extra, v_idem
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN jsonb_build_object(
    'ok', false,
    'resultado', 'ERRO',
    'motivo_codigo', 'ERRO_INTERNO',
    'mensagem', v_msg,
    'correlacao_id', v_corr
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_portaria_avaliar_acesso(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cena_acesso_ctx_text(jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_portaria_avaliar_acesso(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cena_acesso_pode_avaliar() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cena_acesso_mensagem(text) TO authenticated;
