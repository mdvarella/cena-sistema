-- ERP CENA 8.1.225 — Portaria: encerramento administrativo sem horário fictício.
-- Desenho: docs/portaria/ENCERRAMENTO-ADMINISTRATIVO-8.1.225.md (aprovado em 20/10/2026, solução B).
--
--   * status continua sendo a situação operacional ('Em campo' / 'Retornado'); COMO a saída terminou passa a ser
--     tipo_encerramento ('RETORNO_FISICO' | 'ENCERRAMENTO_ADMINISTRATIVO');
--   * encerramento novo (fn_portaria_encerrar_saida_admin): data_retorno e km_retorno ficam NULOS, a hora real da
--     regularização vai em encerrado_em, com justificativa, usuário autenticado e evidência (KM visto no pátio é
--     evidência, nunca km_retorno);
--   * os encerramentos históricos (23:59:59 convencional) só são IDENTIFICADOS: nenhuma coluna original muda;
--   * gravação direta não converte encerramento em retorno: só fn_portaria_converter_retorno_fisico, com hora e KM reais;
--   * tablets antigos que ainda gravam '[Encerramento administrativo]' + 23:59:59 são identificados automaticamente.
--
-- Idempotente. Não apaga nada. Não altera status, data_retorno, km_retorno, obs_retorno nem retorno_registrado_por
-- de nenhum registro existente (conferido por assinatura dentro da própria migration).

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.frotas_portaria_saidas') IS NULL OR to_regclass('public.cena_acoes') IS NULL
     OR to_regclass('public.cena_permissoes_acao') IS NULL OR to_regclass('public.audit_log') IS NULL
     OR to_regprocedure('public.cena_pode(text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'pré-requisitos ausentes (frotas_portaria_saidas, cena_acoes, cena_permissoes_acao, audit_log, cena_pode)';
  END IF;
END $$;

-- ── 0. Backups do rollback (estrutura permanente: o rollback nunca apaga estas tabelas) ──────────
-- Cada rollback acrescenta uma cópia completa dos metadados, com identificador único e data/hora, e registra
-- a contagem e a assinatura da cópia. Nada aqui é sobrescrito ou apagado; a reaplicação confere tudo antes de usar.
CREATE TABLE IF NOT EXISTS public.frotas_portaria_saidas_encerramento_bkp (
  bkp_id                      bigserial PRIMARY KEY,
  rollback_id                 uuid NOT NULL,
  copiado_em                  timestamptz NOT NULL,
  id                          uuid NOT NULL,
  tipo_encerramento           text,
  retorno_horario_conhecido   boolean,
  encerrado_em                timestamptz,
  encerrado_por               text,
  encerrado_por_auth          uuid,
  encerramento_justificativa  text,
  encerramento_evidencia      jsonb,
  encerramento_origem         text,
  data_retorno_convencional   timestamptz,
  convertido_retorno_em       timestamptz,
  convertido_retorno_por      text,
  convertido_retorno_por_auth uuid,
  conversao_origem            text,
  conversao_justificativa     text,
  conversao_evento_offline    text,
  status_no_rollback          text,
  data_retorno_no_rollback    timestamptz,
  km_retorno_no_rollback      numeric,
  obs_retorno_no_rollback     text
);
CREATE INDEX IF NOT EXISTS frotas_portaria_saidas_enc_bkp_id_idx ON public.frotas_portaria_saidas_encerramento_bkp (id, copiado_em DESC);
CREATE TABLE IF NOT EXISTS public.frotas_portaria_saidas_encerramento_rollbacks (
  rollback_id      uuid PRIMARY KEY,
  executado_em     timestamptz NOT NULL,
  executado_por    text NOT NULL DEFAULT current_user,
  linhas           int NOT NULL,
  assinatura       text NOT NULL,
  acao_desativada  boolean NOT NULL DEFAULT false
);
-- Só o banco (migration/rollback) usa estas tabelas: fora da API.
ALTER TABLE public.frotas_portaria_saidas_encerramento_bkp ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.frotas_portaria_saidas_encerramento_rollbacks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.frotas_portaria_saidas_encerramento_bkp, public.frotas_portaria_saidas_encerramento_rollbacks FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.frotas_portaria_saidas_encerramento_bkp_bkp_id_seq FROM PUBLIC, anon, authenticated;

-- Assinatura de uma cópia (independente do fuso da sessão: horários em UTC).
CREATE OR REPLACE FUNCTION public.cena_portaria_enc_bkp_assinatura(p_rollback uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT md5(coalesce(string_agg(
           b.id::text
           || '|' || coalesce(b.tipo_encerramento, '∅') || '|' || coalesce(b.retorno_horario_conhecido::text, '∅')
           || '|' || coalesce((b.encerrado_em AT TIME ZONE 'UTC')::text, '∅') || '|' || coalesce(b.encerrado_por, '∅')
           || '|' || coalesce(b.encerrado_por_auth::text, '∅') || '|' || coalesce(b.encerramento_justificativa, '∅')
           || '|' || coalesce(b.encerramento_evidencia::text, '∅') || '|' || coalesce(b.encerramento_origem, '∅')
           || '|' || coalesce((b.data_retorno_convencional AT TIME ZONE 'UTC')::text, '∅')
           || '|' || coalesce((b.convertido_retorno_em AT TIME ZONE 'UTC')::text, '∅') || '|' || coalesce(b.convertido_retorno_por, '∅')
           || '|' || coalesce(b.convertido_retorno_por_auth::text, '∅') || '|' || coalesce(b.conversao_origem, '∅')
           || '|' || coalesce(b.conversao_justificativa, '∅') || '|' || coalesce(b.conversao_evento_offline, '∅')
           || '|' || coalesce(b.status_no_rollback, '∅') || '|' || coalesce((b.data_retorno_no_rollback AT TIME ZONE 'UTC')::text, '∅')
           || '|' || coalesce(b.km_retorno_no_rollback::text, '∅') || '|' || coalesce(b.obs_retorno_no_rollback, '∅'),
           ',' ORDER BY b.id), ''))
    FROM public.frotas_portaria_saidas_encerramento_bkp b
   WHERE b.rollback_id = p_rollback;
$$;
REVOKE ALL ON FUNCTION public.cena_portaria_enc_bkp_assinatura(uuid) FROM PUBLIC, anon, authenticated;

-- ── 1. Colunas (só acréscimo) ────────────────────────────────────────────────
ALTER TABLE public.frotas_portaria_saidas
  ADD COLUMN IF NOT EXISTS tipo_encerramento           text,
  ADD COLUMN IF NOT EXISTS retorno_horario_conhecido   boolean,
  ADD COLUMN IF NOT EXISTS encerrado_em                timestamptz,
  ADD COLUMN IF NOT EXISTS encerrado_por               text,
  ADD COLUMN IF NOT EXISTS encerrado_por_auth          uuid,
  ADD COLUMN IF NOT EXISTS encerramento_justificativa  text,
  ADD COLUMN IF NOT EXISTS encerramento_evidencia      jsonb,
  ADD COLUMN IF NOT EXISTS encerramento_origem         text,
  ADD COLUMN IF NOT EXISTS data_retorno_convencional   timestamptz,
  ADD COLUMN IF NOT EXISTS convertido_retorno_em       timestamptz,
  ADD COLUMN IF NOT EXISTS convertido_retorno_por      text,
  ADD COLUMN IF NOT EXISTS convertido_retorno_por_auth uuid,
  ADD COLUMN IF NOT EXISTS conversao_origem            text,
  ADD COLUMN IF NOT EXISTS conversao_justificativa     text,
  ADD COLUMN IF NOT EXISTS conversao_evento_offline    text;

COMMENT ON COLUMN public.frotas_portaria_saidas.tipo_encerramento IS
  'Como a saída terminou: RETORNO_FISICO (veículo entrou, hora e KM reais) ou ENCERRAMENTO_ADMINISTRATIVO (regularização sem retorno). NULO = em campo ou retorno antigo não classificado.';
COMMENT ON COLUMN public.frotas_portaria_saidas.retorno_horario_conhecido IS
  'FALSE quando a hora real do retorno é desconhecida (encerramento administrativo).';
COMMENT ON COLUMN public.frotas_portaria_saidas.encerrado_em IS 'Data e hora REAL da regularização administrativa.';
COMMENT ON COLUMN public.frotas_portaria_saidas.encerramento_evidencia IS
  'Evidência da regularização: {foto, km_observado, observado_em, observado_por, local}. KM observado NÃO é km_retorno.';
COMMENT ON COLUMN public.frotas_portaria_saidas.encerramento_origem IS
  'FUNCAO (8.1.225+), LEGADO_23_59 (histórico até 8.1.224) ou TABLET_ANTIGO_23_59 (versão antiga gravando depois da 8.1.225).';
COMMENT ON COLUMN public.frotas_portaria_saidas.data_retorno_convencional IS
  'Cópia do 23:59:59 convencional dos encerramentos antigos (o valor original continua em data_retorno até uma conversão).';

-- ── 2. Regras de forma ────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'frotas_portaria_saidas_tipo_enc_chk') THEN
    ALTER TABLE public.frotas_portaria_saidas ADD CONSTRAINT frotas_portaria_saidas_tipo_enc_chk
      CHECK (tipo_encerramento IS NULL OR tipo_encerramento IN ('RETORNO_FISICO', 'ENCERRAMENTO_ADMINISTRATIVO'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'frotas_portaria_saidas_enc_origem_chk') THEN
    ALTER TABLE public.frotas_portaria_saidas ADD CONSTRAINT frotas_portaria_saidas_enc_origem_chk
      CHECK (encerramento_origem IS NULL OR encerramento_origem IN ('FUNCAO', 'LEGADO_23_59', 'TABLET_ANTIGO_23_59'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'frotas_portaria_saidas_enc_completo_chk') THEN
    ALTER TABLE public.frotas_portaria_saidas ADD CONSTRAINT frotas_portaria_saidas_enc_completo_chk
      CHECK (tipo_encerramento IS DISTINCT FROM 'ENCERRAMENTO_ADMINISTRATIVO'
             OR (retorno_horario_conhecido IS FALSE AND encerrado_em IS NOT NULL
                 AND nullif(btrim(encerramento_justificativa), '') IS NOT NULL AND encerramento_origem IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'frotas_portaria_saidas_enc_sem_horario_chk') THEN
    ALTER TABLE public.frotas_portaria_saidas ADD CONSTRAINT frotas_portaria_saidas_enc_sem_horario_chk
      CHECK (NOT (tipo_encerramento = 'ENCERRAMENTO_ADMINISTRATIVO' AND encerramento_origem = 'FUNCAO')
             OR (data_retorno IS NULL AND km_retorno IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'frotas_portaria_saidas_ret_fisico_chk') THEN
    ALTER TABLE public.frotas_portaria_saidas ADD CONSTRAINT frotas_portaria_saidas_ret_fisico_chk
      CHECK (tipo_encerramento IS DISTINCT FROM 'RETORNO_FISICO' OR (data_retorno IS NOT NULL AND retorno_horario_conhecido IS TRUE));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS frotas_portaria_saidas_enc_adm_idx
  ON public.frotas_portaria_saidas (encerrado_em) WHERE tipo_encerramento = 'ENCERRAMENTO_ADMINISTRATIVO';

-- ── 3. Permissão (catálogo + matriz) ─────────────────────────────────────────
INSERT INTO public.cena_acoes (codigo, modulo, descricao) VALUES
  ('PORT_ENCERRAR_SAIDA_ADMIN', 'PORTARIA', 'Encerrar administrativamente saída antiga sem retorno (sem horário fictício) e conciliar retorno real depois')
ON CONFLICT (codigo) DO NOTHING;
DO $$
BEGIN
  INSERT INTO public.cena_permissoes_acao (perfil, acao, contrato_id, permitido, motivo)
  SELECT m.perfil, 'PORT_ENCERRAR_SAIDA_ADMIN', NULL, TRUE, 'Matriz inicial — Portaria 8.1.225 (20/10/2026)'
  FROM unnest(ARRAY['admin', 'gestor', 'coordenador', 'diretoria']) AS m(perfil)
  WHERE NOT EXISTS (SELECT 1 FROM public.cena_permissoes_acao pa
                    WHERE pa.perfil = m.perfil AND pa.acao = 'PORT_ENCERRAR_SAIDA_ADMIN' AND pa.contrato_id IS NULL);

  -- Reaplicação depois de rollback: recria SÓ as regras que o próprio rollback revogou (marca '| rollback 8.1.225'),
  -- com o mesmo perfil, contrato e permitido (concessões e negações). Regra revogada não volta (proteção da tabela):
  -- cria-se uma nova. Regras revogadas por gestores, fora do rollback, não são recriadas.
  INSERT INTO public.cena_permissoes_acao (perfil, acao, contrato_id, permitido, motivo)
  SELECT d.perfil, d.acao, d.contrato_id, d.permitido,
         'Recriada na reaplicação da 8.1.225 (revogada pelo rollback de ' || to_char(d.deleted_at, 'YYYY-MM-DD HH24:MI') || ')'
    FROM (SELECT DISTINCT ON (pa.perfil, pa.contrato_id) pa.*
            FROM public.cena_permissoes_acao pa
           WHERE pa.acao = 'PORT_ENCERRAR_SAIDA_ADMIN' AND pa.deleted_at IS NOT NULL
           ORDER BY pa.perfil, pa.contrato_id, pa.deleted_at DESC) d
   WHERE rtrim(coalesce(d.motivo, '')) LIKE '%| rollback 8.1.225'   -- a revogação mais recente foi a do rollback
     AND NOT EXISTS (SELECT 1 FROM public.cena_permissoes_acao x
                      WHERE x.perfil = d.perfil AND x.acao = d.acao AND x.contrato_id IS NOT DISTINCT FROM d.contrato_id
                        AND x.deleted_at IS NULL);
  IF EXISTS (SELECT 1 FROM public.frotas_portaria_saidas_encerramento_rollbacks r
              WHERE r.acao_desativada
                AND r.executado_em = (SELECT max(executado_em) FROM public.frotas_portaria_saidas_encerramento_rollbacks)) THEN
    UPDATE public.cena_acoes SET ativo = TRUE WHERE codigo = 'PORT_ENCERRAR_SAIDA_ADMIN' AND ativo IS FALSE;
  END IF;
END $$;

-- ── 4. Proteção contra gravação direta + identificação automática ────────────
CREATE OR REPLACE FUNCTION public.cena_portaria_saida_encerramento_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_funcao boolean := coalesce(current_setting('cena.portaria_enc', true), '') = '1';
  v_pref   text    := '[Encerramento administrativo]';
BEGIN
  IF v_funcao THEN
    RETURN NEW;  -- gravação feita pelas funções desta migration (marca local da transação)
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.tipo_encerramento IS NOT NULL OR NEW.encerrado_em IS NOT NULL OR NEW.convertido_retorno_em IS NOT NULL THEN
      RAISE EXCEPTION 'ENCERRAMENTO_PROTEGIDO: tipo de encerramento só é gravado pelas funções da Portaria.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- Encerramento administrativo existente: hora/KM de retorno, situação e dados do encerramento são imutáveis por SQL direto.
  IF OLD.tipo_encerramento = 'ENCERRAMENTO_ADMINISTRATIVO' THEN
    IF NEW.data_retorno IS DISTINCT FROM OLD.data_retorno
       OR NEW.km_retorno IS DISTINCT FROM OLD.km_retorno
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.obs_retorno IS DISTINCT FROM OLD.obs_retorno
       OR NEW.retorno_registrado_por IS DISTINCT FROM OLD.retorno_registrado_por
       OR NEW.tipo_encerramento IS DISTINCT FROM OLD.tipo_encerramento
       OR NEW.retorno_horario_conhecido IS DISTINCT FROM OLD.retorno_horario_conhecido
       OR NEW.encerrado_em IS DISTINCT FROM OLD.encerrado_em
       OR NEW.encerrado_por IS DISTINCT FROM OLD.encerrado_por
       OR NEW.encerrado_por_auth IS DISTINCT FROM OLD.encerrado_por_auth
       OR NEW.encerramento_justificativa IS DISTINCT FROM OLD.encerramento_justificativa
       OR NEW.encerramento_evidencia IS DISTINCT FROM OLD.encerramento_evidencia
       OR NEW.encerramento_origem IS DISTINCT FROM OLD.encerramento_origem
       OR NEW.data_retorno_convencional IS DISTINCT FROM OLD.data_retorno_convencional
       OR NEW.convertido_retorno_em IS DISTINCT FROM OLD.convertido_retorno_em THEN
      RAISE EXCEPTION 'ENCERRAMENTO_PROTEGIDO: saída encerrada administrativamente; retorno real só pela conciliação (fn_portaria_converter_retorno_fisico).'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- Campos de encerramento/conversão não são graváveis por SQL direto.
  IF NEW.tipo_encerramento IS DISTINCT FROM OLD.tipo_encerramento AND NEW.tipo_encerramento = 'ENCERRAMENTO_ADMINISTRATIVO'
     OR NEW.encerrado_em IS DISTINCT FROM OLD.encerrado_em
     OR NEW.encerrado_por_auth IS DISTINCT FROM OLD.encerrado_por_auth
     OR NEW.encerramento_origem IS DISTINCT FROM OLD.encerramento_origem
     OR NEW.convertido_retorno_em IS DISTINCT FROM OLD.convertido_retorno_em THEN
    RAISE EXCEPTION 'ENCERRAMENTO_PROTEGIDO: dados de encerramento só são gravados pelas funções da Portaria.' USING ERRCODE = '42501';
  END IF;

  -- Versão antiga do app encerrando com 23:59:59: preserva o valor enviado e identifica (hora real da regularização = agora).
  IF OLD.data_retorno IS NULL AND NEW.data_retorno IS NOT NULL AND NEW.status = 'Retornado'
     AND left(coalesce(NEW.obs_retorno, ''), length(v_pref)) = v_pref THEN
    NEW.tipo_encerramento := 'ENCERRAMENTO_ADMINISTRATIVO';
    NEW.retorno_horario_conhecido := FALSE;
    NEW.encerramento_origem := 'TABLET_ANTIGO_23_59';
    NEW.encerrado_em := now();
    NEW.encerrado_por := coalesce(nullif(btrim(NEW.retorno_registrado_por), ''), 'não informado');
    NEW.encerrado_por_auth := auth.uid();
    NEW.encerramento_justificativa := coalesce(nullif(btrim(substr(NEW.obs_retorno, length(v_pref) + 1)), ''), 'saída antiga sem retorno');
    NEW.data_retorno_convencional := NEW.data_retorno;
    RETURN NEW;
  END IF;

  -- Retorno físico normal (qualquer versão): classifica automaticamente; nada muda no que o app envia.
  IF OLD.data_retorno IS NULL AND NEW.data_retorno IS NOT NULL AND NEW.tipo_encerramento IS NULL THEN
    NEW.tipo_encerramento := 'RETORNO_FISICO';
    NEW.retorno_horario_conhecido := TRUE;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_portaria_saida_encerramento_guard ON public.frotas_portaria_saidas;
CREATE TRIGGER trg_portaria_saida_encerramento_guard
  BEFORE INSERT OR UPDATE ON public.frotas_portaria_saidas
  FOR EACH ROW EXECUTE FUNCTION public.cena_portaria_saida_encerramento_guard();

-- ── 5. Encerramento administrativo ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_portaria_encerrar_saida_admin(p_saida uuid, p_justificativa text, p_evidencia jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_nome   text;
  v_perfil text;
  v_just   text := btrim(coalesce(p_justificativa, ''));
  v_ev     jsonb := coalesce(p_evidencia, '{}'::jsonb);
  v_ctr    uuid;
  v_km     numeric;
  v_foto   text;
  s        public.frotas_portaria_saidas%ROWTYPE;
  v_acomp  int := 0;
  v_pref   text := '[Encerramento administrativo] ';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'SEM_SESSAO: encerrar saída exige login autenticado.' USING ERRCODE = '42501';
  END IF;
  IF p_saida IS NULL THEN
    RAISE EXCEPTION 'NAO_ENCONTRADA: saída não informada.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO s FROM public.frotas_portaria_saidas WHERE id = p_saida FOR UPDATE;
  IF NOT FOUND OR s.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'NAO_ENCONTRADA: saída não encontrada (ou excluída).' USING ERRCODE = 'P0002';
  END IF;

  v_ctr := CASE WHEN s.contrato_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 AND public.cena_contrato_ativo(s.contrato_id::uuid) THEN s.contrato_id::uuid END;
  IF NOT coalesce(public.cena_pode('PORT_ENCERRAR_SAIDA_ADMIN', v_ctr), false) THEN
    RAISE EXCEPTION 'SEM_PERMISSAO: encerrar saída administrativamente exige PORT_ENCERRAR_SAIDA_ADMIN.' USING ERRCODE = '42501';
  END IF;

  IF s.tipo_encerramento = 'ENCERRAMENTO_ADMINISTRATIVO' THEN
    RETURN jsonb_build_object('ok', true, 'id', s.id, 'idempotente', true, 'encerrado_em', s.encerrado_em, 'acompanhantes', 0);
  END IF;
  IF s.saida_principal_id IS NOT NULL THEN
    RAISE EXCEPTION 'ACOMPANHANTE: esta saída acompanha outra; encerre a saída principal.' USING ERRCODE = '23514';
  END IF;
  IF s.status IS DISTINCT FROM 'Em campo' OR s.data_retorno IS NOT NULL THEN
    RAISE EXCEPTION 'JA_RETORNADA: a saída não está mais em campo (retorno já registrado).' USING ERRCODE = '23514';
  END IF;
  IF length(v_just) < 10 THEN
    RAISE EXCEPTION 'JUSTIFICATIVA: informe a justificativa (mínimo 10 caracteres).' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_ev) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'EVIDENCIA: evidência inválida.' USING ERRCODE = '22023';
  END IF;
  IF v_ev ? 'km_observado' AND v_ev->>'km_observado' IS NOT NULL THEN
    IF NOT pg_input_is_valid(v_ev->>'km_observado', 'numeric') THEN
      RAISE EXCEPTION 'EVIDENCIA: KM observado inválido.' USING ERRCODE = '22023';
    END IF;
    v_km := (v_ev->>'km_observado')::numeric;
    IF v_km <= 0 THEN
      RAISE EXCEPTION 'EVIDENCIA: KM observado inválido.' USING ERRCODE = '22023';
    END IF;
  END IF;
  v_foto := v_ev->>'foto';
  IF v_foto IS NOT NULL AND length(v_foto) > 400000 THEN
    RAISE EXCEPTION 'EVIDENCIA: foto grande demais para a evidência (envie a foto reduzida).' USING ERRCODE = '22023';
  END IF;

  SELECT u.nome, u.perfil INTO v_nome, v_perfil FROM public.usuarios_sistema u
   WHERE u.auth_user_id = v_uid AND u.deleted_at IS NULL ORDER BY u.ativo DESC NULLS LAST LIMIT 1;
  v_nome := coalesce(nullif(btrim(v_nome), ''), nullif(auth.jwt()->>'email', ''), 'usuário autenticado');
  v_ev := v_ev || jsonb_build_object('registrado_em', now());

  PERFORM set_config('cena.portaria_enc', '1', true);

  -- Acompanhantes primeiro (o gatilho atual só fecha acompanhantes quando data_retorno é preenchida).
  UPDATE public.frotas_portaria_saidas a SET
    status = 'Retornado', data_retorno = NULL, km_retorno = NULL,
    obs_retorno = v_pref || 'acompanhante da saída ' || s.id::text || ' — ' || v_just,
    retorno_registrado_por = v_nome, status_devolucao = NULL,
    tipo_encerramento = 'ENCERRAMENTO_ADMINISTRATIVO', retorno_horario_conhecido = FALSE,
    encerrado_em = now(), encerrado_por = v_nome, encerrado_por_auth = v_uid,
    encerramento_justificativa = 'Encerrada junto com a saída principal ' || s.id::text || ': ' || v_just,
    encerramento_evidencia = v_ev, encerramento_origem = 'FUNCAO'
  WHERE a.saida_principal_id = s.id AND a.deleted_at IS NULL AND a.status = 'Em campo' AND a.data_retorno IS NULL;
  GET DIAGNOSTICS v_acomp = ROW_COUNT;

  UPDATE public.frotas_portaria_saidas SET
    status = 'Retornado', data_retorno = NULL, km_retorno = NULL,
    obs_retorno = v_pref || v_just,
    retorno_registrado_por = v_nome, status_devolucao = NULL,
    tipo_encerramento = 'ENCERRAMENTO_ADMINISTRATIVO', retorno_horario_conhecido = FALSE,
    encerrado_em = now(), encerrado_por = v_nome, encerrado_por_auth = v_uid,
    encerramento_justificativa = v_just, encerramento_evidencia = v_ev, encerramento_origem = 'FUNCAO'
  WHERE id = s.id;

  PERFORM set_config('cena.portaria_enc', '', true);

  INSERT INTO public.audit_log (acao, modulo, descricao, usuario_id, usuario_nome, usuario_perfil, dados_extra)
  VALUES ('encerrar_admin', 'portaria',
          'Encerramento administrativo da saída ' || s.id::text || ' (' || coalesce(s.placa, 'sem placa') || ') sem horário de retorno',
          v_uid::text, v_nome, v_perfil,
          jsonb_build_object('tabela', 'frotas_portaria_saidas', 'id', s.id, 'placa', s.placa, 'equipe', s.equipe,
                             'data_saida', s.data_saida, 'justificativa', v_just, 'acompanhantes', v_acomp,
                             'km_observado', v_km, 'tem_foto', v_foto IS NOT NULL));

  RETURN jsonb_build_object('ok', true, 'id', s.id, 'idempotente', false, 'encerrado_em', now(),
                            'encerrado_por', v_nome, 'acompanhantes', v_acomp);
END;
$$;

-- ── 6. Conciliação: encerramento administrativo → retorno físico real ────────
CREATE OR REPLACE FUNCTION public.fn_portaria_converter_retorno_fisico(
  p_saida uuid, p_data_retorno timestamptz, p_km_retorno numeric, p_origem text, p_justificativa text,
  p_evento_offline text DEFAULT NULL, p_extra jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_nome   text;
  v_perfil text;
  v_just   text := btrim(coalesce(p_justificativa, ''));
  v_ex     jsonb := coalesce(p_extra, '{}'::jsonb);
  v_ctr    uuid;
  s        public.frotas_portaria_saidas%ROWTYPE;
  v_obs    text;
  v_n      int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'SEM_SESSAO: conciliar retorno exige login autenticado.' USING ERRCODE = '42501';
  END IF;
  IF p_origem IS NULL OR p_origem NOT IN ('OFFLINE_SINCRONIZADO', 'GESTOR_COM_EVIDENCIA') THEN
    RAISE EXCEPTION 'ORIGEM: origem da conciliação inválida.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO s FROM public.frotas_portaria_saidas WHERE id = p_saida FOR UPDATE;
  IF NOT FOUND OR s.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'NAO_ENCONTRADA: saída não encontrada (ou excluída).' USING ERRCODE = 'P0002';
  END IF;
  IF s.saida_principal_id IS NOT NULL THEN
    RAISE EXCEPTION 'ACOMPANHANTE: concilie pela saída principal.' USING ERRCODE = '23514';
  END IF;
  IF s.tipo_encerramento IS DISTINCT FROM 'ENCERRAMENTO_ADMINISTRATIVO' THEN
    RAISE EXCEPTION 'NAO_ENCERRADA: a saída não está encerrada administrativamente.' USING ERRCODE = '23514';
  END IF;

  IF p_origem = 'GESTOR_COM_EVIDENCIA' THEN
    v_ctr := CASE WHEN s.contrato_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                   AND public.cena_contrato_ativo(s.contrato_id::uuid) THEN s.contrato_id::uuid END;
    IF NOT coalesce(public.cena_pode('PORT_ENCERRAR_SAIDA_ADMIN', v_ctr), false) THEN
      RAISE EXCEPTION 'SEM_PERMISSAO: conciliar retorno exige PORT_ENCERRAR_SAIDA_ADMIN.' USING ERRCODE = '42501';
    END IF;
    IF length(v_just) < 10 THEN
      RAISE EXCEPTION 'JUSTIFICATIVA: informe a justificativa e a evidência (mínimo 10 caracteres).' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF nullif(btrim(coalesce(p_evento_offline, '')), '') IS NULL THEN
      RAISE EXCEPTION 'EVENTO: retorno offline sem identificador do evento.' USING ERRCODE = '22023';
    END IF;
    IF v_ex ? 'placa' AND upper(regexp_replace(coalesce(v_ex->>'placa', ''), '[^A-Za-z0-9]', '', 'g'))
         <> upper(regexp_replace(coalesce(s.placa, ''), '[^A-Za-z0-9]', '', 'g')) THEN
      RAISE EXCEPTION 'VEICULO: a placa do retorno não é a da saída.' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF p_data_retorno IS NULL OR p_data_retorno < s.data_saida OR p_data_retorno > now() + interval '10 minutes' THEN
    RAISE EXCEPTION 'HORARIO: horário do retorno inválido (antes da saída ou no futuro).' USING ERRCODE = '22023';
  END IF;
  IF p_km_retorno IS NULL OR p_km_retorno <= 0 OR (s.km_saida IS NOT NULL AND p_km_retorno < s.km_saida) THEN
    RAISE EXCEPTION 'KM: KM de retorno inválido (vazio ou menor que o da saída).' USING ERRCODE = '22023';
  END IF;

  SELECT u.nome, u.perfil INTO v_nome, v_perfil FROM public.usuarios_sistema u
   WHERE u.auth_user_id = v_uid AND u.deleted_at IS NULL ORDER BY u.ativo DESC NULLS LAST LIMIT 1;
  v_nome := coalesce(nullif(btrim(v_nome), ''), nullif(auth.jwt()->>'email', ''), 'usuário autenticado');
  v_obs := '[Retorno físico conciliado após encerramento administrativo] ' || coalesce(nullif(btrim(v_ex->>'obs_retorno'), ''), v_just, '');

  PERFORM set_config('cena.portaria_enc', '1', true);

  -- Acompanhantes encerradas junto voltam junto (antes da principal: o gatilho atual só olha data_retorno nula).
  UPDATE public.frotas_portaria_saidas a SET
    data_retorno_convencional = coalesce(a.data_retorno_convencional, a.data_retorno),
    data_retorno = p_data_retorno, tipo_encerramento = 'RETORNO_FISICO', retorno_horario_conhecido = TRUE,
    obs_retorno = v_obs, retorno_registrado_por = coalesce(nullif(btrim(v_ex->>'retorno_registrado_por'), ''), v_nome),
    convertido_retorno_em = now(), convertido_retorno_por = v_nome, convertido_retorno_por_auth = v_uid,
    conversao_origem = p_origem, conversao_justificativa = nullif(v_just, ''), conversao_evento_offline = p_evento_offline
  WHERE a.saida_principal_id = s.id AND a.deleted_at IS NULL AND a.tipo_encerramento = 'ENCERRAMENTO_ADMINISTRATIVO';
  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE public.frotas_portaria_saidas SET
    data_retorno_convencional = coalesce(data_retorno_convencional, data_retorno),
    data_retorno = p_data_retorno, km_retorno = p_km_retorno,
    tipo_encerramento = 'RETORNO_FISICO', retorno_horario_conhecido = TRUE,
    obs_retorno = v_obs,
    retorno_registrado_por = coalesce(nullif(btrim(v_ex->>'retorno_registrado_por'), ''), v_nome),
    base_retorno = coalesce(nullif(btrim(v_ex->>'base_retorno'), ''), base_retorno),
    status_devolucao = coalesce(nullif(btrim(v_ex->>'status_devolucao'), ''), status_devolucao),
    foto_carga_retorno_b64 = coalesce(nullif(v_ex->>'foto_carga_retorno_b64', ''), foto_carga_retorno_b64),
    foto_carga_retorno_ts = coalesce(CASE WHEN pg_input_is_valid(v_ex->>'foto_carga_retorno_ts', 'timestamptz')
                                          THEN (v_ex->>'foto_carga_retorno_ts')::timestamptz END, foto_carga_retorno_ts),
    convertido_retorno_em = now(), convertido_retorno_por = v_nome, convertido_retorno_por_auth = v_uid,
    conversao_origem = p_origem, conversao_justificativa = nullif(v_just, ''), conversao_evento_offline = p_evento_offline
  WHERE id = s.id;

  PERFORM set_config('cena.portaria_enc', '', true);

  INSERT INTO public.audit_log (acao, modulo, descricao, usuario_id, usuario_nome, usuario_perfil, dados_extra)
  VALUES ('conciliar_retorno', 'portaria',
          'Retorno físico conciliado na saída ' || s.id::text || ' (' || coalesce(s.placa, 'sem placa') || ') encerrada administrativamente',
          v_uid::text, v_nome, v_perfil,
          jsonb_build_object('tabela', 'frotas_portaria_saidas', 'id', s.id, 'origem', p_origem, 'evento_offline', p_evento_offline,
                             'data_retorno', p_data_retorno, 'km_retorno', p_km_retorno,
                             'encerrado_em', s.encerrado_em, 'encerramento_justificativa', s.encerramento_justificativa,
                             'data_retorno_convencional', coalesce(s.data_retorno_convencional, s.data_retorno), 'acompanhantes', v_n));

  RETURN jsonb_build_object('ok', true, 'id', s.id, 'data_retorno', p_data_retorno, 'km_retorno', p_km_retorno, 'acompanhantes', v_n);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_portaria_encerrar_saida_admin(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_portaria_converter_retorno_fisico(uuid, timestamptz, numeric, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_portaria_encerrar_saida_admin(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_portaria_converter_retorno_fisico(uuid, timestamptz, numeric, text, text, text, jsonb) TO authenticated;

-- ── 7. Identificação dos encerramentos históricos (só colunas novas) ─────────
DO $$
DECLARE
  v_pref   text := '[Encerramento administrativo]';
  v_antes  text;
  v_depois text;
  v_alvo   int;
  v_feitos int;
  v_ruim   text;
  v_conf   int;
  v_rest   int;
BEGIN
  SELECT count(*), md5(coalesce(string_agg(id::text || '|' || coalesce(status, '') || '|' || coalesce(data_retorno::text, '') || '|'
           || coalesce(km_retorno::text, '') || '|' || coalesce(obs_retorno, '') || '|' || coalesce(retorno_registrado_por, ''),
           ',' ORDER BY id), ''))
    INTO v_alvo, v_antes
    FROM public.frotas_portaria_saidas
   WHERE left(coalesce(obs_retorno, ''), length(v_pref)) = v_pref AND tipo_encerramento IS NULL AND status = 'Retornado';

  PERFORM set_config('cena.portaria_enc', '1', true);

  -- Reaplicação depois de rollback(s): restaura a cópia MAIS RECENTE de cada saída, depois de conferir a integridade de
  -- TODAS as cópias e que nenhuma saída mudou de forma incompatível desde o rollback. Qualquer divergência interrompe a
  -- migration inteira (nada é restaurado, nada é apagado; os backups ficam como estavam).
  IF EXISTS (SELECT 1 FROM public.frotas_portaria_saidas_encerramento_bkp) THEN
    SELECT string_agg(r.rollback_id::text, ', ') INTO v_ruim
      FROM public.frotas_portaria_saidas_encerramento_rollbacks r
     WHERE (SELECT count(*) FROM public.frotas_portaria_saidas_encerramento_bkp b WHERE b.rollback_id = r.rollback_id) <> r.linhas
        OR public.cena_portaria_enc_bkp_assinatura(r.rollback_id) <> r.assinatura;
    IF v_ruim IS NOT NULL THEN
      RAISE EXCEPTION 'BACKUP_INCONSISTENTE: cópia(s) do rollback com contagem ou assinatura diferente do registrado: %. Nada foi restaurado; os backups foram preservados.', v_ruim;
    END IF;
    SELECT string_agg(DISTINCT b.rollback_id::text, ', ') INTO v_ruim
      FROM public.frotas_portaria_saidas_encerramento_bkp b
     WHERE NOT EXISTS (SELECT 1 FROM public.frotas_portaria_saidas_encerramento_rollbacks r WHERE r.rollback_id = b.rollback_id);
    IF v_ruim IS NOT NULL THEN
      RAISE EXCEPTION 'BACKUP_INCONSISTENTE: cópia(s) sem registro de rollback: %. Nada foi restaurado; os backups foram preservados.', v_ruim;
    END IF;

    CREATE TEMP TABLE _enc_restaurar ON COMMIT DROP AS
      SELECT DISTINCT ON (b.id) b.*
        FROM public.frotas_portaria_saidas_encerramento_bkp b
       ORDER BY b.id, b.copiado_em DESC, b.bkp_id DESC;

    -- Incompatibilidades (saída sumiu, já tem outro encerramento, ou mudou depois do rollback):
    SELECT count(*), string_agg(x.id::text || ' (' || x.motivo || ')', '; ' ORDER BY x.id)
      INTO v_conf, v_ruim
      FROM (
        SELECT r.id,
               CASE
                 WHEN s.id IS NULL THEN 'saída não existe mais'
                 WHEN s.tipo_encerramento IS NOT NULL
                      AND (s.tipo_encerramento, s.encerrado_em, s.encerramento_origem, s.convertido_retorno_em)
                          IS DISTINCT FROM (r.tipo_encerramento, r.encerrado_em, r.encerramento_origem, r.convertido_retorno_em)
                   THEN 'já tem outro encerramento'
                 WHEN s.tipo_encerramento IS NULL AND r.tipo_encerramento = 'ENCERRAMENTO_ADMINISTRATIVO'
                      AND (s.status, s.data_retorno, s.km_retorno, s.obs_retorno)
                          IS DISTINCT FROM (r.status_no_rollback, r.data_retorno_no_rollback, r.km_retorno_no_rollback, r.obs_retorno_no_rollback)
                   THEN 'encerramento alterado depois do rollback'
                 WHEN s.tipo_encerramento IS NULL AND r.tipo_encerramento = 'RETORNO_FISICO'
                      AND (s.data_retorno IS NULL OR (r.convertido_retorno_em IS NOT NULL AND s.data_retorno IS DISTINCT FROM r.data_retorno_no_rollback))
                   THEN 'retorno alterado depois do rollback'
               END AS motivo
          FROM _enc_restaurar r
          LEFT JOIN public.frotas_portaria_saidas s ON s.id = r.id
      ) x
     WHERE x.motivo IS NOT NULL;
    IF v_conf > 0 THEN
      RAISE EXCEPTION 'RESTAURACAO_INCONSISTENTE: % saída(s) não batem com o backup: %. Nada foi restaurado; os backups foram preservados — resolva estas saídas e aplique de novo.',
        v_conf, left(v_ruim, 2000);
    END IF;

    UPDATE public.frotas_portaria_saidas s SET
      tipo_encerramento = r.tipo_encerramento, retorno_horario_conhecido = r.retorno_horario_conhecido,
      encerrado_em = r.encerrado_em, encerrado_por = r.encerrado_por, encerrado_por_auth = r.encerrado_por_auth,
      encerramento_justificativa = r.encerramento_justificativa, encerramento_evidencia = r.encerramento_evidencia,
      encerramento_origem = r.encerramento_origem, data_retorno_convencional = r.data_retorno_convencional,
      convertido_retorno_em = r.convertido_retorno_em, convertido_retorno_por = r.convertido_retorno_por,
      convertido_retorno_por_auth = r.convertido_retorno_por_auth, conversao_origem = r.conversao_origem,
      conversao_justificativa = r.conversao_justificativa, conversao_evento_offline = r.conversao_evento_offline
    FROM _enc_restaurar r
    WHERE r.id = s.id AND s.tipo_encerramento IS NULL;
    GET DIAGNOSTICS v_rest = ROW_COUNT;
    RAISE NOTICE 'restaurados do backup: % (cópia mais recente de cada saída)', v_rest;

    -- os restaurados saem do alvo da identificação abaixo e da assinatura de antes
    SELECT count(*), md5(coalesce(string_agg(id::text || '|' || coalesce(status, '') || '|' || coalesce(data_retorno::text, '') || '|'
             || coalesce(km_retorno::text, '') || '|' || coalesce(obs_retorno, '') || '|' || coalesce(retorno_registrado_por, ''),
             ',' ORDER BY id), ''))
      INTO v_alvo, v_antes
      FROM public.frotas_portaria_saidas
     WHERE left(coalesce(obs_retorno, ''), length(v_pref)) = v_pref AND tipo_encerramento IS NULL AND status = 'Retornado';
  END IF;

  WITH aud AS (
    SELECT (regexp_match(a.descricao, 'id=eq\.([0-9a-f-]{36})'))[1] AS sid,
           min(a.data_hora) AS quando,
           (array_agg(a.usuario_nome ORDER BY a.data_hora))[1] AS quem
      FROM public.audit_log a
     WHERE a.descricao LIKE 'Alterou frotas_portaria_saidas%' AND a.dados_extra::text LIKE '%Encerramento administrativo%'
     GROUP BY 1)
  UPDATE public.frotas_portaria_saidas s SET
    tipo_encerramento = 'ENCERRAMENTO_ADMINISTRATIVO',
    retorno_horario_conhecido = FALSE,
    encerramento_origem = 'LEGADO_23_59',
    encerramento_justificativa = coalesce(nullif(btrim(substr(s.obs_retorno, length(v_pref) + 1)), ''), 'saída antiga sem retorno'),
    encerrado_em = coalesce(aud.quando, s.data_retorno, s.criado_em, now()),
    encerrado_por = coalesce(nullif(btrim(aud.quem), ''), nullif(btrim(s.retorno_registrado_por), ''), 'não identificado'),
    encerramento_evidencia = jsonb_build_object('fonte_regularizacao', CASE WHEN aud.sid IS NULL THEN 'sem_auditoria' ELSE 'audit_log' END),
    data_retorno_convencional = s.data_retorno
  FROM public.frotas_portaria_saidas s0
  LEFT JOIN aud ON aud.sid = s0.id::text
  WHERE s.id = s0.id
    AND left(coalesce(s.obs_retorno, ''), length(v_pref)) = v_pref AND s.tipo_encerramento IS NULL AND s.status = 'Retornado';
  GET DIAGNOSTICS v_feitos = ROW_COUNT;
  PERFORM set_config('cena.portaria_enc', '', true);

  SELECT md5(coalesce(string_agg(id::text || '|' || coalesce(status, '') || '|' || coalesce(data_retorno::text, '') || '|'
           || coalesce(km_retorno::text, '') || '|' || coalesce(obs_retorno, '') || '|' || coalesce(retorno_registrado_por, ''),
           ',' ORDER BY id), ''))
    INTO v_depois
    FROM public.frotas_portaria_saidas
   WHERE encerramento_origem = 'LEGADO_23_59' AND left(coalesce(obs_retorno, ''), length(v_pref)) = v_pref
     AND data_retorno_convencional IS NOT DISTINCT FROM data_retorno;

  IF v_feitos <> v_alvo THEN
    RAISE EXCEPTION 'identificação dos históricos: esperado %, marcado %', v_alvo, v_feitos;
  END IF;
  IF v_alvo > 0 AND (SELECT count(*) FROM public.frotas_portaria_saidas
                      WHERE encerramento_origem = 'LEGADO_23_59' AND data_retorno_convencional IS NOT DISTINCT FROM data_retorno
                        AND left(coalesce(obs_retorno, ''), length(v_pref)) = v_pref) < v_alvo THEN
    RAISE EXCEPTION 'identificação dos históricos: contagem final menor que a esperada';
  END IF;
  -- Na primeira execução as duas assinaturas cobrem exatamente os mesmos registros e precisam ser iguais.
  IF v_alvo > 0 AND v_feitos = (SELECT count(*) FROM public.frotas_portaria_saidas WHERE encerramento_origem = 'LEGADO_23_59')
     AND v_antes <> v_depois THEN
    RAISE EXCEPTION 'identificação dos históricos alterou campos originais (assinatura % → %)', v_antes, v_depois;
  END IF;
  RAISE NOTICE 'encerramentos históricos identificados: % (assinatura dos campos originais %)', v_feitos, v_depois;
END $$;

-- Validação das regras de forma depois da identificação.
ALTER TABLE public.frotas_portaria_saidas VALIDATE CONSTRAINT frotas_portaria_saidas_enc_completo_chk;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Validação (somente leitura):
-- select tipo_encerramento, encerramento_origem, count(*) from public.frotas_portaria_saidas group by 1, 2 order by 1, 2;
-- select count(*) from public.frotas_portaria_saidas
--  where encerramento_origem = 'LEGADO_23_59' and data_retorno is distinct from data_retorno_convencional;   -- deve ser 0
-- select public.cena_pode('PORT_ENCERRAR_SAIDA_ADMIN');                                                     -- como gestor: true

-- Reversão: NÃO reabre nenhuma saída (status não é tocado) e NÃO apaga backups. Cada execução ACRESCENTA uma cópia
-- completa dos metadados (rollback_id único + data/hora) e registra contagem e assinatura em
-- frotas_portaria_saidas_encerramento_rollbacks. As tabelas de backup e a função de assinatura permanecem.
-- Para desfazer (somente com autorização):
-- BEGIN;
-- DO $rb$
-- DECLARE v_rb uuid := gen_random_uuid(); v_n int; v_agora timestamptz := clock_timestamp();
-- BEGIN
--   INSERT INTO public.frotas_portaria_saidas_encerramento_bkp (rollback_id, copiado_em, id, tipo_encerramento,
--     retorno_horario_conhecido, encerrado_em, encerrado_por, encerrado_por_auth, encerramento_justificativa,
--     encerramento_evidencia, encerramento_origem, data_retorno_convencional, convertido_retorno_em,
--     convertido_retorno_por, convertido_retorno_por_auth, conversao_origem, conversao_justificativa,
--     conversao_evento_offline, status_no_rollback, data_retorno_no_rollback, km_retorno_no_rollback, obs_retorno_no_rollback)
--   SELECT v_rb, v_agora, id, tipo_encerramento, retorno_horario_conhecido, encerrado_em, encerrado_por, encerrado_por_auth,
--          encerramento_justificativa, encerramento_evidencia, encerramento_origem, data_retorno_convencional,
--          convertido_retorno_em, convertido_retorno_por, convertido_retorno_por_auth, conversao_origem,
--          conversao_justificativa, conversao_evento_offline, status, data_retorno, km_retorno, obs_retorno
--     FROM public.frotas_portaria_saidas
--    WHERE tipo_encerramento IS NOT NULL OR encerrado_em IS NOT NULL OR convertido_retorno_em IS NOT NULL;
--   GET DIAGNOSTICS v_n = ROW_COUNT;
--   INSERT INTO public.frotas_portaria_saidas_encerramento_rollbacks (rollback_id, executado_em, linhas, assinatura, acao_desativada)
--   VALUES (v_rb, v_agora, v_n, public.cena_portaria_enc_bkp_assinatura(v_rb),
--           EXISTS (SELECT 1 FROM public.cena_acoes WHERE codigo = 'PORT_ENCERRAR_SAIDA_ADMIN' AND ativo));
--   RAISE NOTICE 'rollback %: % registro(s) de encerramento copiados', v_rb, v_n;
-- END $rb$;
-- DROP TRIGGER IF EXISTS trg_portaria_saida_encerramento_guard ON public.frotas_portaria_saidas;
-- DROP FUNCTION IF EXISTS public.cena_portaria_saida_encerramento_guard();
-- DROP FUNCTION IF EXISTS public.fn_portaria_encerrar_saida_admin(uuid, text, jsonb);
-- DROP FUNCTION IF EXISTS public.fn_portaria_converter_retorno_fisico(uuid, timestamptz, numeric, text, text, text, jsonb);
-- UPDATE public.cena_permissoes_acao SET deleted_at = now(), motivo = coalesce(motivo, '') || ' | rollback 8.1.225'
--  WHERE acao = 'PORT_ENCERRAR_SAIDA_ADMIN' AND deleted_at IS NULL;
-- UPDATE public.cena_acoes SET ativo = FALSE WHERE codigo = 'PORT_ENCERRAR_SAIDA_ADMIN';
-- DROP INDEX IF EXISTS public.frotas_portaria_saidas_enc_adm_idx;
-- ALTER TABLE public.frotas_portaria_saidas
--   DROP CONSTRAINT IF EXISTS frotas_portaria_saidas_ret_fisico_chk,
--   DROP CONSTRAINT IF EXISTS frotas_portaria_saidas_enc_sem_horario_chk,
--   DROP CONSTRAINT IF EXISTS frotas_portaria_saidas_enc_completo_chk,
--   DROP CONSTRAINT IF EXISTS frotas_portaria_saidas_enc_origem_chk,
--   DROP CONSTRAINT IF EXISTS frotas_portaria_saidas_tipo_enc_chk,
--   DROP COLUMN IF EXISTS conversao_evento_offline, DROP COLUMN IF EXISTS conversao_justificativa,
--   DROP COLUMN IF EXISTS conversao_origem, DROP COLUMN IF EXISTS convertido_retorno_por_auth,
--   DROP COLUMN IF EXISTS convertido_retorno_por, DROP COLUMN IF EXISTS convertido_retorno_em,
--   DROP COLUMN IF EXISTS data_retorno_convencional, DROP COLUMN IF EXISTS encerramento_origem,
--   DROP COLUMN IF EXISTS encerramento_evidencia, DROP COLUMN IF EXISTS encerramento_justificativa,
--   DROP COLUMN IF EXISTS encerrado_por_auth, DROP COLUMN IF EXISTS encerrado_por,
--   DROP COLUMN IF EXISTS encerrado_em, DROP COLUMN IF EXISTS retorno_horario_conhecido,
--   DROP COLUMN IF EXISTS tipo_encerramento;
-- COMMIT;
-- NOTIFY pgrst, 'reload schema';
