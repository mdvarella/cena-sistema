-- sql_veiculo_credenciais_tag_1b.sql
-- PORT-AUTO-SYS-1B — TAG RFID do veículo (cadastro mestre).
-- Aditivo / idempotente.
-- NÃO executar pelo ERP. Aplicar manualmente no SQL Editor do Supabase após aprovação.
--
-- GATE 22/09/2026 (schema real Supabase):
--   frotas_veiculos.id é UUID (PostgREST 22P02: invalid input syntax for type uuid).
--   IDs reais = uuid canônico. prog_veiculos_dia.veiculo_id também uuid.
--   PK não alterada. veiculo_id permanece uuid REFERENCES frotas_veiculos(id).
-- NOTA 1D: fn_tag_resolver NÃO consulta frotas_portaria_bloqueios.
--   Bloqueio operacional (cadastro vs portaria_bloqueios) fica no motor cenaAcessoAvaliar*.
--
-- Unicidade do UID (coerente com RFID-CORE-1):
--   colaborador_credenciais usa UNIQUE (tipo, uid_normalizado) — NÃO é global no sistema.
--   veiculo_credenciais replica: UNIQUE (tipo, uid_normalizado) nesta tabela.
--   A mesma string de UID PODE existir como crachá de pessoa (tipo RFID) e como TAG
--   de veículo (tipo RFID_TAG) — tabelas distintas. Uma TAG física NÃO pode ficar
--   ativa em dois veículos. Histórico (BLOQUEADO/SUBSTITUIDO) também reserva o UID.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ══════════════════════════════════════════════════════════════
-- 1) Helpers (espelho RFID-CORE-1; independentes para o SQL ser aplicável sozinho)
-- ══════════════════════════════════════════════════════════════

-- Mesmo algoritmo de cena_rfid_normalizar_uid: trim, tira espaço/hífen/quebra, caixa alta.
-- NÃO converte hex↔decimal.
CREATE OR REPLACE FUNCTION public.cena_tag_normalizar_uid(p_uid text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT upper(regexp_replace(btrim(regexp_replace(coalesce(p_uid, ''), E'[\\n\\r\\t]+', '', 'g')), '[\s\-]+', '', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.cena_tag_usuario_sessao()
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

-- Cadastro/bloqueio/substituição/reativação de TAG: frota/gestão.
-- NÃO portaria / almoxarife / equipe / rh / dp (RH cuida de crachá de pessoa).
CREATE OR REPLACE FUNCTION public.cena_tag_pode_cadastrar()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_us public.usuarios_sistema%ROWTYPE;
BEGIN
  v_us := public.cena_tag_usuario_sessao();
  RETURN v_us.id IS NOT NULL
    AND lower(btrim(coalesce(v_us.perfil, ''))) IN ('admin','diretoria','gestor','coordenador');
END;
$$;

CREATE OR REPLACE FUNCTION public.cena_tag_audit_registrar(
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
    RAISE EXCEPTION 'Auditoria TAG: ação obrigatória'
      USING ERRCODE = '22023', HINT = 'TAG_AUDIT_ACAO';
  END IF;

  v_us := public.cena_tag_usuario_sessao();

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
    'frotas',
    coalesce(p_descricao, p_acao),
    coalesce(v_us.id::text, auth.uid()::text, ''),
    coalesce(v_us.nome, ''),
    coalesce(v_us.perfil, ''),
    jsonb_strip_nulls(coalesce(p_dados_extra, '{}'::jsonb)),
    now(),
    coalesce(p_sessao_id, 'rpc:tag')
  );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auditoria TAG: falha ao gravar audit_log'
      USING ERRCODE = 'P0001', HINT = 'TAG_AUDIT_FALHOU';
  END IF;
END;
$$;

-- Classifica o veículo para o resolver. NÃO decide portão.
CREATE OR REPLACE FUNCTION public.cena_tag_veiculo_motivo_impeditivo(p_veiculo public.frotas_veiculos)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_st text;
BEGIN
  IF p_veiculo.id IS NULL THEN
    RETURN 'VEICULO_INATIVO';
  END IF;
  IF p_veiculo.ativo IS NOT TRUE THEN
    RETURN 'VEICULO_INATIVO';
  END IF;
  v_st := lower(btrim(coalesce(p_veiculo.status, '')));
  IF v_st IN ('baixado', 'inativo') OR v_st LIKE '%inativ%' THEN
    RETURN 'VEICULO_INATIVO';
  END IF;
  IF v_st IN ('bloqueado', 'quarentena') THEN
    RETURN 'VEICULO_BLOQUEADO';
  END IF;
  RETURN NULL;
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 2) Tabela
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.veiculo_credenciais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  veiculo_id uuid NOT NULL REFERENCES public.frotas_veiculos(id),
  tipo text NOT NULL DEFAULT 'RFID_TAG',
  uid text NOT NULL,
  uid_normalizado text NOT NULL,
  status text NOT NULL DEFAULT 'ATIVO',
  emitido_em timestamptz,
  ativado_em timestamptz,
  bloqueado_em timestamptz,
  bloqueado_por text,
  motivo_bloqueio text,
  substitui_credencial_id uuid REFERENCES public.veiculo_credenciais(id),
  origem_leitura text,
  criado_por text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.veiculo_credenciais IS
  'Credencial TAG RFID do veículo. O veículo continua em frotas_veiculos. Sem campo TAG na tabela de veículos.';
COMMENT ON COLUMN public.veiculo_credenciais.uid IS
  'UID bruto do leitor/simulação (auditoria). Casamento usa uid_normalizado.';
COMMENT ON COLUMN public.veiculo_credenciais.uid_normalizado IS
  'Identificador opaco normalizado. Mesmo algoritmo do RFID de colaborador.';

ALTER TABLE public.veiculo_credenciais
  DROP CONSTRAINT IF EXISTS veiculo_credenciais_tipo_chk;
ALTER TABLE public.veiculo_credenciais
  ADD CONSTRAINT veiculo_credenciais_tipo_chk
  CHECK (tipo = 'RFID_TAG');

ALTER TABLE public.veiculo_credenciais
  DROP CONSTRAINT IF EXISTS veiculo_credenciais_status_chk;
ALTER TABLE public.veiculo_credenciais
  ADD CONSTRAINT veiculo_credenciais_status_chk
  CHECK (status IN ('ATIVO','BLOQUEADO','SUBSTITUIDO'));

ALTER TABLE public.veiculo_credenciais
  DROP CONSTRAINT IF EXISTS veiculo_credenciais_uid_chk;
ALTER TABLE public.veiculo_credenciais
  ADD CONSTRAINT veiculo_credenciais_uid_chk
  CHECK (btrim(uid) <> '');

ALTER TABLE public.veiculo_credenciais
  DROP CONSTRAINT IF EXISTS veiculo_credenciais_uid_norm_chk;
ALTER TABLE public.veiculo_credenciais
  ADD CONSTRAINT veiculo_credenciais_uid_norm_chk
  CHECK (btrim(uid_normalizado) <> '');

ALTER TABLE public.veiculo_credenciais
  DROP CONSTRAINT IF EXISTS veiculo_credenciais_self_sub_chk;
ALTER TABLE public.veiculo_credenciais
  ADD CONSTRAINT veiculo_credenciais_self_sub_chk
  CHECK (substitui_credencial_id IS DISTINCT FROM id);

-- UID único por tipo nesta tabela (espelho uq_cred_tipo_uid_norm).
CREATE UNIQUE INDEX IF NOT EXISTS uq_veic_cred_tipo_uid_norm
  ON public.veiculo_credenciais (tipo, uid_normalizado);

-- No máximo uma TAG ATIVA por veículo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_veic_cred_tag_ativo
  ON public.veiculo_credenciais (veiculo_id)
  WHERE tipo = 'RFID_TAG' AND status = 'ATIVO';

CREATE INDEX IF NOT EXISTS idx_veic_cred_veiculo_status
  ON public.veiculo_credenciais (veiculo_id, status);

CREATE INDEX IF NOT EXISTS idx_veic_cred_uid_norm
  ON public.veiculo_credenciais (uid_normalizado);

-- ══════════════════════════════════════════════════════════════
-- 3) Trigger
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.veiculo_credenciais_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.tipo := 'RFID_TAG';
  NEW.uid_normalizado := public.cena_tag_normalizar_uid(coalesce(NEW.uid_normalizado, NEW.uid));
  IF NEW.uid_normalizado IS NULL OR NEW.uid_normalizado = '' THEN
    RAISE EXCEPTION 'UID TAG vazio após normalização'
      USING ERRCODE = '22023', HINT = 'TAG_UID_VAZIO';
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

DROP TRIGGER IF EXISTS trg_veiculo_credenciais_before_write
  ON public.veiculo_credenciais;
CREATE TRIGGER trg_veiculo_credenciais_before_write
BEFORE INSERT OR UPDATE ON public.veiculo_credenciais
FOR EACH ROW EXECUTE FUNCTION public.veiculo_credenciais_before_write();

-- ══════════════════════════════════════════════════════════════
-- 4) RLS
-- Leitura administrativa: perfis de frota.
-- Gravação: somente RPC SECURITY DEFINER.
-- Resolução operacional: fn_tag_resolver (sem SELECT na tabela).
-- anon: nenhum acesso.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.veiculo_credenciais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.veiculo_credenciais FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.veiculo_credenciais FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.veiculo_credenciais TO authenticated;
GRANT ALL ON TABLE public.veiculo_credenciais TO service_role;

DROP POLICY IF EXISTS veiculo_credenciais_select_admin ON public.veiculo_credenciais;
CREATE POLICY veiculo_credenciais_select_admin
  ON public.veiculo_credenciais
  FOR SELECT
  TO authenticated
  USING (public.cena_tag_pode_cadastrar());

REVOKE ALL ON FUNCTION public.cena_tag_normalizar_uid(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cena_tag_usuario_sessao() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cena_tag_pode_cadastrar() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cena_tag_audit_registrar(text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cena_tag_veiculo_motivo_impeditivo(public.frotas_veiculos) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.cena_tag_normalizar_uid(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cena_tag_pode_cadastrar() TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- 5) RPCs
-- ══════════════════════════════════════════════════════════════

-- Resolve UID → veículo/status. Sem escrita. Sem audit_log (leituras futuras em massa).
-- Exige sessão authenticated. NÃO abre portão, NÃO grava saída, NÃO aciona hardware.
CREATE OR REPLACE FUNCTION public.fn_tag_resolver(p_uid text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid text;
  v_cc public.veiculo_credenciais%ROWTYPE;
  v_vei public.frotas_veiculos%ROWTYPE;
  v_autenticavel boolean := false;
  v_motivo text := 'TAG_DESCONHECIDA';
  v_imp text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão Auth obrigatória para resolver TAG'
      USING ERRCODE = '28000', HINT = 'TAG_AUTH_REQUIRED';
  END IF;

  v_uid := public.cena_tag_normalizar_uid(p_uid);
  IF v_uid IS NULL OR v_uid = '' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'encontrado', false,
      'autenticavel', false,
      'motivo', 'UID_VAZIO',
      'credencial', NULL,
      'veiculo', NULL
    );
  END IF;

  SELECT * INTO v_cc
  FROM public.veiculo_credenciais
  WHERE tipo = 'RFID_TAG' AND uid_normalizado = v_uid
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'encontrado', false,
      'autenticavel', false,
      'motivo', 'TAG_DESCONHECIDA',
      'credencial', NULL,
      'veiculo', NULL
    );
  END IF;

  SELECT * INTO v_vei FROM public.frotas_veiculos WHERE id = v_cc.veiculo_id;

  IF v_cc.status = 'BLOQUEADO' THEN
    v_motivo := 'TAG_BLOQUEADA';
  ELSIF v_cc.status = 'SUBSTITUIDO' THEN
    v_motivo := 'TAG_SUBSTITUIDA';
  ELSIF v_cc.status = 'ATIVO' THEN
    v_imp := public.cena_tag_veiculo_motivo_impeditivo(v_vei);
    IF v_imp IS NULL THEN
      v_autenticavel := true;
      v_motivo := NULL;
    ELSE
      v_motivo := v_imp;
    END IF;
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
    'veiculo', CASE WHEN v_vei.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_vei.id,
      'placa', v_vei.placa,
      'modelo', v_vei.modelo,
      'status', v_vei.status
    ) END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_tag_vincular(
  p_veiculo_id uuid,
  p_uid text,
  p_origem_leitura text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid text;
  v_exist public.veiculo_credenciais%ROWTYPE;
  v_ativo public.veiculo_credenciais%ROWTYPE;
  v_vei public.frotas_veiculos%ROWTYPE;
  v_new public.veiculo_credenciais%ROWTYPE;
  v_usr text;
  v_holder text;
BEGIN
  IF NOT public.cena_tag_pode_cadastrar() THEN
    RAISE EXCEPTION 'Sem permissão para cadastrar TAG de veículo'
      USING ERRCODE = '42501', HINT = 'TAG_SEM_PERMISSAO';
  END IF;

  v_uid := public.cena_tag_normalizar_uid(p_uid);
  IF v_uid IS NULL OR v_uid = '' THEN
    RAISE EXCEPTION 'UID TAG vazio após normalização'
      USING ERRCODE = '22023', HINT = 'TAG_UID_VAZIO';
  END IF;

  PERFORM pg_advisory_xact_lock(871002, hashtext(v_uid));

  SELECT * INTO v_vei FROM public.frotas_veiculos WHERE id = p_veiculo_id;
  IF v_vei.id IS NULL THEN
    RAISE EXCEPTION 'Veículo não encontrado'
      USING ERRCODE = 'P0002', HINT = 'TAG_VEIC_NAO_ENCONTRADO';
  END IF;

  SELECT (public.cena_tag_usuario_sessao()).nome INTO v_usr;

  SELECT * INTO v_exist
  FROM public.veiculo_credenciais
  WHERE tipo = 'RFID_TAG' AND uid_normalizado = v_uid
  FOR UPDATE;

  IF FOUND THEN
    SELECT placa INTO v_holder FROM public.frotas_veiculos WHERE id = v_exist.veiculo_id;
    RAISE EXCEPTION 'TAG já vinculada ao veículo % (status %).', coalesce(v_holder,'?'), v_exist.status
      USING ERRCODE = '23505', HINT = 'TAG_UID_HISTORICO';
  END IF;

  SELECT * INTO v_ativo
  FROM public.veiculo_credenciais
  WHERE veiculo_id = p_veiculo_id AND tipo = 'RFID_TAG' AND status = 'ATIVO'
  FOR UPDATE;

  IF FOUND THEN
    RAISE EXCEPTION 'Veículo já possui TAG ATIVA. Use substituição.'
      USING ERRCODE = 'P0001', HINT = 'TAG_JA_ATIVO';
  END IF;

  INSERT INTO public.veiculo_credenciais (
    veiculo_id, tipo, uid, uid_normalizado, status,
    emitido_em, ativado_em, origem_leitura, criado_por
  ) VALUES (
    p_veiculo_id, 'RFID_TAG', btrim(p_uid), v_uid, 'ATIVO',
    now(), now(), coalesce(p_origem_leitura, 'SIMULADOR'), v_usr
  ) RETURNING * INTO v_new;

  PERFORM public.cena_tag_audit_registrar(
    'TAG_VINCULADA',
    format('Vinculou TAG RFID ao veículo %s.', coalesce(v_vei.placa,'?')),
    jsonb_build_object(
      'veiculo_id', v_vei.id,
      'veiculo_placa', v_vei.placa,
      'veiculo_modelo', v_vei.modelo,
      'credencial_id', v_new.id,
      'uid_normalizado', v_uid,
      'status_novo', 'ATIVO',
      'origem_leitura', coalesce(p_origem_leitura, 'SIMULADOR')
    ),
    'rpc:fn_tag_vincular'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'acao', 'TAG_VINCULADA',
    'credencial', jsonb_build_object('id', v_new.id, 'status', v_new.status)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_tag_bloquear(
  p_veiculo_id uuid,
  p_motivo text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ativo public.veiculo_credenciais%ROWTYPE;
  v_vei public.frotas_veiculos%ROWTYPE;
  v_usr text;
BEGIN
  IF NOT public.cena_tag_pode_cadastrar() THEN
    RAISE EXCEPTION 'Sem permissão para bloquear TAG de veículo'
      USING ERRCODE = '42501', HINT = 'TAG_SEM_PERMISSAO';
  END IF;
  IF btrim(coalesce(p_motivo,'')) = '' THEN
    RAISE EXCEPTION 'Motivo de bloqueio obrigatório'
      USING ERRCODE = '22023', HINT = 'TAG_MOTIVO_OBRIGATORIO';
  END IF;

  SELECT * INTO v_vei FROM public.frotas_veiculos WHERE id = p_veiculo_id;
  IF v_vei.id IS NULL THEN
    RAISE EXCEPTION 'Veículo não encontrado'
      USING ERRCODE = 'P0002', HINT = 'TAG_VEIC_NAO_ENCONTRADO';
  END IF;

  SELECT (public.cena_tag_usuario_sessao()).nome INTO v_usr;

  SELECT * INTO v_ativo
  FROM public.veiculo_credenciais
  WHERE veiculo_id = p_veiculo_id AND tipo = 'RFID_TAG' AND status = 'ATIVO'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Veículo não possui TAG ATIVA para bloquear'
      USING ERRCODE = 'P0002', HINT = 'TAG_SEM_ATIVO';
  END IF;

  UPDATE public.veiculo_credenciais
  SET status = 'BLOQUEADO',
      bloqueado_em = now(),
      bloqueado_por = v_usr,
      motivo_bloqueio = btrim(p_motivo)
  WHERE id = v_ativo.id
  RETURNING * INTO v_ativo;

  PERFORM public.cena_tag_audit_registrar(
    'TAG_BLOQUEADA',
    format('Bloqueou TAG RFID do veículo %s.', coalesce(v_vei.placa,'?')),
    jsonb_build_object(
      'veiculo_id', v_vei.id,
      'veiculo_placa', v_vei.placa,
      'veiculo_modelo', v_vei.modelo,
      'credencial_id', v_ativo.id,
      'uid_normalizado', v_ativo.uid_normalizado,
      'status_anterior', 'ATIVO',
      'status_novo', 'BLOQUEADO',
      'motivo', btrim(p_motivo)
    ),
    'rpc:fn_tag_bloquear'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'acao', 'TAG_BLOQUEADA',
    'credencial', jsonb_build_object('id', v_ativo.id, 'status', v_ativo.status)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_tag_reativar(p_veiculo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bloq public.veiculo_credenciais%ROWTYPE;
  v_ativo_id uuid;
  v_vei public.frotas_veiculos%ROWTYPE;
BEGIN
  IF NOT public.cena_tag_pode_cadastrar() THEN
    RAISE EXCEPTION 'Sem permissão para reativar TAG de veículo'
      USING ERRCODE = '42501', HINT = 'TAG_SEM_PERMISSAO';
  END IF;

  SELECT * INTO v_vei FROM public.frotas_veiculos WHERE id = p_veiculo_id;
  IF v_vei.id IS NULL THEN
    RAISE EXCEPTION 'Veículo não encontrado'
      USING ERRCODE = 'P0002', HINT = 'TAG_VEIC_NAO_ENCONTRADO';
  END IF;

  SELECT id INTO v_ativo_id
  FROM public.veiculo_credenciais
  WHERE veiculo_id = p_veiculo_id AND tipo = 'RFID_TAG' AND status = 'ATIVO'
  FOR UPDATE;

  IF v_ativo_id IS NOT NULL THEN
    RAISE EXCEPTION 'Veículo já possui TAG ATIVA. Não reativar outra em paralelo.'
      USING ERRCODE = 'P0001', HINT = 'TAG_JA_ATIVO';
  END IF;

  SELECT * INTO v_bloq
  FROM public.veiculo_credenciais
  WHERE veiculo_id = p_veiculo_id AND tipo = 'RFID_TAG' AND status = 'BLOQUEADO'
  ORDER BY bloqueado_em DESC NULLS LAST, atualizado_em DESC
  FOR UPDATE
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Não há TAG BLOQUEADA deste veículo para reativar'
      USING ERRCODE = 'P0002', HINT = 'TAG_SEM_BLOQUEADO';
  END IF;

  UPDATE public.veiculo_credenciais
  SET status = 'ATIVO',
      ativado_em = now(),
      bloqueado_em = NULL,
      bloqueado_por = NULL,
      motivo_bloqueio = NULL
  WHERE id = v_bloq.id
  RETURNING * INTO v_bloq;

  PERFORM public.cena_tag_audit_registrar(
    'TAG_REATIVADA',
    format('Reativou TAG RFID do veículo %s.', coalesce(v_vei.placa,'?')),
    jsonb_build_object(
      'veiculo_id', v_vei.id,
      'veiculo_placa', v_vei.placa,
      'veiculo_modelo', v_vei.modelo,
      'credencial_id', v_bloq.id,
      'uid_normalizado', v_bloq.uid_normalizado,
      'status_anterior', 'BLOQUEADO',
      'status_novo', 'ATIVO'
    ),
    'rpc:fn_tag_reativar'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'acao', 'TAG_REATIVADA',
    'credencial', jsonb_build_object('id', v_bloq.id, 'status', v_bloq.status)
  );
END;
$$;

-- Substituição atômica: A ATIVO → SUBSTITUIDO e B → ATIVO + audit_log na mesma transação.
CREATE OR REPLACE FUNCTION public.fn_tag_substituir(
  p_veiculo_id uuid,
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
  v_exist public.veiculo_credenciais%ROWTYPE;
  v_atual public.veiculo_credenciais%ROWTYPE;
  v_nova public.veiculo_credenciais%ROWTYPE;
  v_vei public.frotas_veiculos%ROWTYPE;
  v_usr text;
  v_outro text;
BEGIN
  IF NOT public.cena_tag_pode_cadastrar() THEN
    RAISE EXCEPTION 'Sem permissão para substituir TAG de veículo'
      USING ERRCODE = '42501', HINT = 'TAG_SEM_PERMISSAO';
  END IF;

  v_uid := public.cena_tag_normalizar_uid(p_uid);
  IF v_uid IS NULL OR v_uid = '' THEN
    RAISE EXCEPTION 'UID TAG vazio após normalização'
      USING ERRCODE = '22023', HINT = 'TAG_UID_VAZIO';
  END IF;

  PERFORM pg_advisory_xact_lock(871002, hashtext(v_uid));

  SELECT * INTO v_vei FROM public.frotas_veiculos WHERE id = p_veiculo_id FOR UPDATE;
  IF v_vei.id IS NULL THEN
    RAISE EXCEPTION 'Veículo não encontrado'
      USING ERRCODE = 'P0002', HINT = 'TAG_VEIC_NAO_ENCONTRADO';
  END IF;

  SELECT (public.cena_tag_usuario_sessao()).nome INTO v_usr;

  SELECT * INTO v_atual
  FROM public.veiculo_credenciais
  WHERE veiculo_id = p_veiculo_id AND tipo = 'RFID_TAG' AND status = 'ATIVO'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Veículo não possui TAG ATIVA para substituir. Use vínculo ou reativação.'
      USING ERRCODE = 'P0002', HINT = 'TAG_SEM_ATIVO';
  END IF;

  IF v_atual.uid_normalizado = v_uid THEN
    RAISE EXCEPTION 'O UID lido já é a TAG ATIVA deste veículo'
      USING ERRCODE = 'P0001', HINT = 'TAG_MESMO_UID';
  END IF;

  SELECT * INTO v_exist
  FROM public.veiculo_credenciais
  WHERE tipo = 'RFID_TAG' AND uid_normalizado = v_uid
  FOR UPDATE;

  IF FOUND THEN
    IF v_exist.veiculo_id <> p_veiculo_id THEN
      SELECT placa INTO v_outro FROM public.frotas_veiculos WHERE id = v_exist.veiculo_id;
      RAISE EXCEPTION 'TAG já vinculada ao veículo % (status %).', coalesce(v_outro,'?'), v_exist.status
        USING ERRCODE = '23505', HINT = 'TAG_UID_HISTORICO';
    END IF;

    UPDATE public.veiculo_credenciais
    SET status = 'SUBSTITUIDO'
    WHERE id = v_atual.id;

    UPDATE public.veiculo_credenciais
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
    UPDATE public.veiculo_credenciais
    SET status = 'SUBSTITUIDO'
    WHERE id = v_atual.id;

    INSERT INTO public.veiculo_credenciais (
      veiculo_id, tipo, uid, uid_normalizado, status,
      emitido_em, ativado_em, substitui_credencial_id, origem_leitura, criado_por
    ) VALUES (
      p_veiculo_id, 'RFID_TAG', btrim(p_uid), v_uid, 'ATIVO',
      now(), now(), v_atual.id, coalesce(p_origem_leitura, 'SIMULADOR'), v_usr
    ) RETURNING * INTO v_nova;
  END IF;

  PERFORM public.cena_tag_audit_registrar(
    'TAG_SUBSTITUIDA',
    format('Substituiu TAG RFID do veículo %s.', coalesce(v_vei.placa,'?')),
    jsonb_build_object(
      'veiculo_id', v_vei.id,
      'veiculo_placa', v_vei.placa,
      'veiculo_modelo', v_vei.modelo,
      'uid_normalizado', v_uid,
      'status_anterior', 'ATIVO',
      'status_novo', 'ATIVO',
      'motivo', nullif(btrim(coalesce(p_motivo,'')), ''),
      'credencial_anterior_id', v_atual.id,
      'credencial_nova_id', v_nova.id,
      'origem_leitura', coalesce(p_origem_leitura, 'SIMULADOR')
    ),
    'rpc:fn_tag_substituir'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'acao', 'TAG_SUBSTITUIDA',
    'credencial_anterior', jsonb_build_object('id', v_atual.id, 'status', 'SUBSTITUIDO'),
    'credencial', jsonb_build_object('id', v_nova.id, 'status', v_nova.status)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_tag_resolver(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_tag_vincular(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_tag_bloquear(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_tag_reativar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_tag_substituir(uuid, text, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.fn_tag_resolver(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tag_vincular(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tag_bloquear(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tag_reativar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tag_substituir(uuid, text, text, text) TO authenticated;
