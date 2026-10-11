-- ETAPA 1.3 (ENEL/LMS/WL) — Confirmação Humana do RASCUNHO
-- Transforma um RASCUNHO/ORIGINAL (recebido na 1.3) em ORIGINAL CONFIRMADA, com autoria/histórico, em dois modos
-- (ESTRUTURA_NOVA / CONCILIACAO). Camada de BANCO apenas: sem frontend, sem Edge nova, sem alterar a Edge
-- proj-lms-receber, sem sot_wl, sem tocar sot_materiais/sot_atividades/estoque/programação/composicao_dia/TMA.
--   - ESTRUTURA_NOVA: status CONFIRMADA + modo + autoria + evento; se não houver perfil congelado, congela o perfil
--     derivado (sugestão contratual válida; senão BASE_PROJETOS v1) com origem LMS_ORIGINAL_ESTRUTURA_NOVA (1.2);
--     perfil já congelado é preservado. NÃO cria WL.
--   - CONCILIACAO: status CONFIRMADA + modo + autoria + evento; não congela/muda perfil; legado segue.
-- Aditiva: NÃO edita a migration 1.3 já aplicada. Autorização só por auth.uid() + cena_pode('PROJ_CONFIRMAR_LMS').
-- Transação explícita: qualquer falha desfaz a etapa inteira.

BEGIN;

-- ── 0. Pré-condições (falha inteira, nada é aplicado) ────────────────────
DO $$
BEGIN
  IF NOT coalesce((SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user), false) THEN
    RAISE EXCEPTION 'Rode como dono com BYPASSRLS: as funções SECURITY DEFINER leem tabelas com RLS FORCE';
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'auth.uid() não existe';
  END IF;
  IF to_regprocedure('public.cena_pode(text, uuid)') IS NULL OR to_regclass('public.cena_acoes') IS NULL THEN
    RAISE EXCEPTION 'aplique antes 20261007190000_cena_permissoes_acao.sql (Etapa 1.1)';
  END IF;
  IF to_regclass('public.sot_lms_importacoes') IS NULL
     OR to_regprocedure('public.sot_lms_importacoes_proteger()') IS NULL
     OR to_regprocedure('public.sot_lms_autorizar(uuid)') IS NULL THEN
    RAISE EXCEPTION 'aplique antes 20261009193000_proj_lms_origem.sql (Etapa 1.3)';
  END IF;
  IF to_regprocedure('public.sot_projeto_processo_gravar(uuid, text, text, integer, text, text, text, integer, jsonb)') IS NULL
     OR to_regprocedure('public.sot_projeto_processo_sugestao(text)') IS NULL
     OR to_regprocedure('public.sot_projeto_processo_contexto(uuid)') IS NULL THEN
    RAISE EXCEPTION 'aplique antes 20261009173000_proj_perfil_processo.sql (Etapa 1.2)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cena_processo_perfis WHERE codigo_perfil = 'BASE_PROJETOS' AND versao = 1 AND ativo IS TRUE) THEN
    RAISE EXCEPTION 'catálogo (1.2) sem BASE_PROJETOS v1 ativo: fallback de congelamento impossível';
  END IF;
END $$;

-- ── 1. Nova ação PROJ_CONFIRMAR_LMS + matriz global (aditiva, idempotente) ──
-- Importar e confirmar são permissões DIFERENTES. Confirmar: admin, gestor, coordenador, escritorio.
-- (administrativo recebe PROJ_IMPORTAR_LMS na 1.1, mas NÃO PROJ_CONFIRMAR_LMS.)
INSERT INTO public.cena_acoes (codigo, modulo, descricao) VALUES
  ('PROJ_CONFIRMAR_LMS', 'PROJETOS', 'Confirmar o LMS ORIGINAL do projeto (RASCUNHO para CONFIRMADA)')
ON CONFLICT (codigo) DO NOTHING;

DO $$
BEGIN
  INSERT INTO public.cena_permissoes_acao (perfil, acao, contrato_id, permitido, motivo)
  SELECT m.perfil, 'PROJ_CONFIRMAR_LMS', NULL, TRUE,
         'Matriz inicial aprovada pelo gestor — Etapa 1.3 Confirmação (10/10/2026)'
  FROM unnest(ARRAY['admin', 'gestor', 'coordenador', 'escritorio']) AS m(perfil)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.cena_permissoes_acao pa
    WHERE pa.perfil = m.perfil AND pa.acao = 'PROJ_CONFIRMAR_LMS' AND pa.contrato_id IS NULL);
END $$;

-- ── 2. Colunas e CHECKs da confirmação (aditivos) ────────────────────────
ALTER TABLE public.sot_lms_importacoes
  ADD COLUMN IF NOT EXISTS modo                          text,
  ADD COLUMN IF NOT EXISTS confirmado_por_auth           uuid,
  ADD COLUMN IF NOT EXISTS confirmado_por_usuario_id     text,
  ADD COLUMN IF NOT EXISTS confirmado_em                 timestamptz,
  ADD COLUMN IF NOT EXISTS conciliacao_aplicada_em       timestamptz,
  ADD COLUMN IF NOT EXISTS conciliacao_aplicada_por_auth uuid;

ALTER TABLE public.sot_lms_importacoes DROP CONSTRAINT IF EXISTS sot_lms_importacoes_status_chk;
ALTER TABLE public.sot_lms_importacoes ADD  CONSTRAINT sot_lms_importacoes_status_chk
  CHECK (status IN ('RASCUNHO', 'CONFIRMADA'));

ALTER TABLE public.sot_lms_importacoes DROP CONSTRAINT IF EXISTS sot_lms_importacoes_modo_chk;
ALTER TABLE public.sot_lms_importacoes ADD  CONSTRAINT sot_lms_importacoes_modo_chk
  CHECK (modo IS NULL OR modo IN ('ESTRUTURA_NOVA', 'CONCILIACAO'));

-- Coerência RASCUNHO × CONFIRMADA. conciliacao_aplicada_* ficam para a etapa futura de conciliação (RPC não preenche).
ALTER TABLE public.sot_lms_importacoes DROP CONSTRAINT IF EXISTS sot_lms_importacoes_confirmacao_chk;
ALTER TABLE public.sot_lms_importacoes ADD  CONSTRAINT sot_lms_importacoes_confirmacao_chk CHECK (
  (status = 'RASCUNHO'
     AND modo IS NULL AND confirmado_por_auth IS NULL
     AND confirmado_por_usuario_id IS NULL AND confirmado_em IS NULL)
  OR
  (status = 'CONFIRMADA'
     AND modo IS NOT NULL AND confirmado_por_auth IS NOT NULL AND confirmado_em IS NOT NULL)
);

-- ── 3. No máximo uma ORIGINAL confirmada por projeto (garantia dura) ──────
CREATE UNIQUE INDEX IF NOT EXISTS sot_lms_importacoes_original_confirmada_uidx
  ON public.sot_lms_importacoes (projeto_id)
  WHERE tipo_importacao = 'ORIGINAL' AND status = 'CONFIRMADA';

-- ── 4. Eventos: + CONFIRMADA (append-only continua) ──────────────────────
ALTER TABLE public.sot_lms_importacao_eventos DROP CONSTRAINT IF EXISTS sot_lms_importacao_eventos_tipo_chk;
ALTER TABLE public.sot_lms_importacao_eventos ADD  CONSTRAINT sot_lms_importacao_eventos_tipo_chk
  CHECK (tipo_evento IN ('CRIADA', 'REENVIO', 'CONFIRMADA'));

-- ── 5. Trava ampliada (só os campos da confirmação, só via função controlada) ──
-- Substitui o corpo da 1.3: conteúdo-fonte continua imutável; os campos da confirmação só mudam quando a transação
-- está marcada (cena.lms_status_autorizado = id da importação). authenticated continua SEM UPDATE direto.
CREATE OR REPLACE FUNCTION public.sot_lms_importacoes_proteger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_autorizado boolean := coalesce(current_setting('cena.lms_status_autorizado', true), '') = OLD.id::text;
  v_old_rest   jsonb;
  v_new_rest   jsonb;
  v_mudou_ctrl boolean;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'sot_lms_importacoes: fonte LMS não é apagada' USING ERRCODE = '42501';
  END IF;
  -- Campos controlados pela confirmação (whitelist); o resto é imutável.
  v_old_rest := (to_jsonb(OLD) - 'status' - 'modo' - 'confirmado_por_auth' - 'confirmado_por_usuario_id'
                  - 'confirmado_em' - 'conciliacao_aplicada_em' - 'conciliacao_aplicada_por_auth');
  v_new_rest := (to_jsonb(NEW) - 'status' - 'modo' - 'confirmado_por_auth' - 'confirmado_por_usuario_id'
                  - 'confirmado_em' - 'conciliacao_aplicada_em' - 'conciliacao_aplicada_por_auth');
  IF v_new_rest IS DISTINCT FROM v_old_rest THEN
    RAISE EXCEPTION 'sot_lms_importacoes: fonte LMS não é reescrita' USING ERRCODE = '42501';
  END IF;
  v_mudou_ctrl := NEW.status IS DISTINCT FROM OLD.status
    OR NEW.modo IS DISTINCT FROM OLD.modo
    OR NEW.confirmado_por_auth IS DISTINCT FROM OLD.confirmado_por_auth
    OR NEW.confirmado_por_usuario_id IS DISTINCT FROM OLD.confirmado_por_usuario_id
    OR NEW.confirmado_em IS DISTINCT FROM OLD.confirmado_em
    OR NEW.conciliacao_aplicada_em IS DISTINCT FROM OLD.conciliacao_aplicada_em
    OR NEW.conciliacao_aplicada_por_auth IS DISTINCT FROM OLD.conciliacao_aplicada_por_auth;
  IF v_mudou_ctrl AND NOT v_autorizado THEN
    RAISE EXCEPTION 'sot_lms_importacoes: confirmação só por função controlada' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- ── 6. Autorização da confirmação (contexto do usuário; PROJ_CONFIRMAR_LMS) ──
-- Mesma segurança da 1.1/1.2/1.3: projeto existe e não excluído; contrato texto que não é contratos.id → recusa
-- (nunca cai na regra global); sem contrato → regra global de cena_pode.
CREATE OR REPLACE FUNCTION public.sot_lms_autorizar_confirmacao(p_projeto_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existe   boolean;
  v_excluido boolean;
  v_contrato text;
  v_ctr      uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 'SEM_SESSAO';
  END IF;
  IF public.cena_usuario_perfil_sessao() IS NULL THEN
    RETURN 'USUARIO_ERP_INATIVO';
  END IF;
  IF p_projeto_id IS NULL THEN
    RETURN 'PROJETO_INEXISTENTE';
  END IF;
  SELECT true, c.o_excluido, c.o_contrato INTO v_existe, v_excluido, v_contrato
  FROM public.sot_projeto_processo_contexto(p_projeto_id) c;
  IF v_existe IS NULL THEN
    RETURN 'PROJETO_INEXISTENTE';
  END IF;
  IF v_excluido THEN
    RETURN 'PROJETO_EXCLUIDO';
  END IF;
  IF v_contrato IS NOT NULL THEN
    v_ctr := public.sot_projeto_processo_contrato_uuid(v_contrato);
    IF v_ctr IS NULL THEN
      RETURN 'CONTRATO_NAO_IDENTIFICADO';
    END IF;
  END IF;
  IF NOT coalesce(public.cena_pode('PROJ_CONFIRMAR_LMS', v_ctr), false) THEN
    RETURN 'SEM_PERMISSAO';
  END IF;
  RETURN 'OK';
END;
$$;

-- ── 7. Estado WL derivado (regra canônica; sem coluna de status no projeto) ──
-- sot_lms_estado_wl_calc = resolver canônico INTERNO (única fonte da regra LEGADO_SEM_WL / EM_CONCILIACAO /
--   ESTRUTURADO; ninguém mais deve duplicá-la).
-- sot_lms_estado_wl = wrapper authenticated restrito ao FLUXO LMS: autoriza por sot_lms_autorizar (PROJ_IMPORTAR_LMS,
--   a mesma permissão de leitura do LMS) para não permitir enumeração indevida de projetos.
-- Decisões documentadas:
--   • isto NÃO transforma PROJ_IMPORTAR_LMS em permissão universal de consultar estado estrutural do projeto;
--   • módulos futuros (ex.: Jornada, Programação) que precisem do estado devem criar o SEU wrapper com a
--     autorização adequada ao seu contexto, SEMPRE reusando sot_lms_estado_wl_calc (não reimplementar a regra);
--   • a distinção PROJETO_INEXISTENTE × SEM_PERMISSAO segue o débito herdado da 1.3.
CREATE OR REPLACE FUNCTION public.sot_lms_estado_wl_calc(p_projeto_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_modo   text;
  v_aplic  timestamptz;
BEGIN
  SELECT i.modo, i.conciliacao_aplicada_em INTO v_modo, v_aplic
  FROM public.sot_lms_importacoes i
  WHERE i.projeto_id = p_projeto_id AND i.tipo_importacao = 'ORIGINAL' AND i.status = 'CONFIRMADA'
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN 'LEGADO_SEM_WL';
  END IF;
  IF v_modo = 'CONCILIACAO' AND v_aplic IS NULL THEN
    RETURN 'EM_CONCILIACAO';
  END IF;
  RETURN 'ESTRUTURADO';
END;
$$;

CREATE OR REPLACE FUNCTION public.sot_lms_estado_wl(p_projeto_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_motivo text := public.sot_lms_autorizar(p_projeto_id);
BEGIN
  IF v_motivo <> 'OK' THEN
    RAISE EXCEPTION 'LMS estado: acesso negado (%)', v_motivo USING ERRCODE = '42501';
  END IF;
  RETURN public.sot_lms_estado_wl_calc(p_projeto_id);
END;
$$;

-- ── 8. RPC pública de confirmação ────────────────────────────────────────
-- Cliente envia só (importacao_id, modo, observacao?). Projeto/contrato/usuário/hash/perfil/versão são derivados.
CREATE OR REPLACE FUNCTION public.sot_lms_confirmar(
  p_importacao_id uuid, p_modo text, p_observacao text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_imp        public.sot_lms_importacoes%ROWTYPE;
  v_motivo     text;
  v_usuario    text;
  v_obs        text := nullif(btrim(coalesce(p_observacao, '')), '');
  v_outra_id   uuid;
  v_outra_modo text;
  v_outra_apl  timestamptz;
  v_contrato   text;
  v_sug_cod    text;
  v_sug_ver    integer;
  v_perfil_cod text;
  v_perfil_ver integer;
  v_ja_frozen  boolean;
  v_just       text;
  v_congelou   jsonb := NULL;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'LMS confirmar: sem sessão' USING ERRCODE = '42501';
  END IF;
  IF p_modo IS NULL OR p_modo NOT IN ('ESTRUTURA_NOVA', 'CONCILIACAO') THEN
    RAISE EXCEPTION 'LMS confirmar: modo inválido (ESTRUTURA_NOVA | CONCILIACAO)' USING ERRCODE = '22023';
  END IF;
  IF v_obs IS NOT NULL AND length(v_obs) > 2000 THEN
    RAISE EXCEPTION 'LMS confirmar: observação muito longa' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_imp FROM public.sot_lms_importacoes WHERE id = p_importacao_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'LMS confirmar: importação inexistente' USING ERRCODE = 'P0002';
  END IF;

  v_motivo := public.sot_lms_autorizar_confirmacao(v_imp.projeto_id);
  IF v_motivo <> 'OK' THEN
    RAISE EXCEPTION 'LMS confirmar: %', v_motivo USING ERRCODE = '42501';
  END IF;

  SELECT us.id::text INTO v_usuario FROM public.usuarios_sistema us
  WHERE us.auth_user_id = auth.uid() AND us.ativo IS TRUE AND us.deleted_at IS NULL
  LIMIT 1;
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'LMS confirmar: usuário ERP inexistente ou inativo' USING ERRCODE = '42501';
  END IF;

  -- Serializa por projeto e relê a importação sob lock.
  PERFORM pg_advisory_xact_lock(hashtextextended('sot_lms_confirmar|' || v_imp.projeto_id::text, 0));
  SELECT * INTO v_imp FROM public.sot_lms_importacoes WHERE id = p_importacao_id FOR UPDATE;

  -- Idempotência / recusas.
  IF v_imp.status = 'CONFIRMADA' THEN
    IF v_imp.modo = p_modo THEN
      RETURN jsonb_build_object('operacao', 'JA_CONFIRMADA', 'importacao_id', v_imp.id,
        'projeto_id', v_imp.projeto_id, 'status', v_imp.status, 'modo', v_imp.modo,
        'estado_wl', public.sot_lms_estado_wl_calc(v_imp.projeto_id));
    END IF;
    RAISE EXCEPTION 'LMS confirmar: importação já confirmada com modo % (pedido: %)', v_imp.modo, p_modo
      USING ERRCODE = '55000';
  END IF;
  IF v_imp.status <> 'RASCUNHO' THEN
    RAISE EXCEPTION 'LMS confirmar: só RASCUNHO pode ser confirmado (status %)', v_imp.status USING ERRCODE = '55000';
  END IF;

  -- Outra ORIGINAL confirmada no mesmo projeto (erro funcional antes do índice).
  SELECT o.id, o.modo, o.conciliacao_aplicada_em INTO v_outra_id, v_outra_modo, v_outra_apl
  FROM public.sot_lms_importacoes o
  WHERE o.projeto_id = v_imp.projeto_id AND o.tipo_importacao = 'ORIGINAL' AND o.status = 'CONFIRMADA'
    AND o.id <> v_imp.id
  LIMIT 1;
  IF v_outra_id IS NOT NULL THEN
    IF v_outra_modo = 'CONCILIACAO' AND v_outra_apl IS NULL THEN
      RAISE EXCEPTION 'LMS confirmar: CONCILIACAO_ABERTA' USING ERRCODE = '55000';
    END IF;
    RAISE EXCEPTION 'LMS confirmar: ORIGINAL_JA_CONFIRMADA' USING ERRCODE = '55000';
  END IF;

  -- ESTRUTURA_NOVA: congela o perfil se ainda não houver (preserva o existente); CONCILIACAO não mexe no perfil.
  IF p_modo = 'ESTRUTURA_NOVA' THEN
    SELECT EXISTS (SELECT 1 FROM public.sot_projeto_processo pp WHERE pp.projeto_id = v_imp.projeto_id)
      INTO v_ja_frozen;
    IF v_ja_frozen THEN
      v_congelou := jsonb_build_object('operacao', 'PRESERVADO');
    ELSE
      SELECT c.o_contrato INTO v_contrato FROM public.sot_projeto_processo_contexto(v_imp.projeto_id) c;
      IF v_contrato IS NOT NULL THEN
        SELECT s.o_codigo, s.o_versao INTO v_sug_cod, v_sug_ver
        FROM public.sot_projeto_processo_sugestao(v_contrato) s;
        IF v_sug_cod IS NOT NULL AND EXISTS (
             SELECT 1 FROM public.cena_processo_perfis cp
             WHERE cp.codigo_perfil = v_sug_cod AND cp.versao = v_sug_ver AND cp.ativo IS TRUE) THEN
          v_perfil_cod := v_sug_cod;
          v_perfil_ver := v_sug_ver;
        END IF;
      END IF;
      IF v_perfil_cod IS NULL THEN
        v_perfil_cod := 'BASE_PROJETOS';
        v_perfil_ver := 1;
      END IF;
      v_just := 'Confirmação do LMS ORIGINAL (ESTRUTURA_NOVA) — importação ' || v_imp.id::text
                || coalesce(' — ' || v_obs, '');
      v_congelou := public.sot_projeto_processo_gravar(
        v_imp.projeto_id, 'CONGELAR', v_perfil_cod, v_perfil_ver, 'LMS_ORIGINAL_ESTRUTURA_NOVA', v_just);
    END IF;
  END IF;

  -- Confirmação transacional (marcador vinculado a ESTA importação).
  PERFORM set_config('cena.lms_status_autorizado', v_imp.id::text, true);
  UPDATE public.sot_lms_importacoes
     SET status = 'CONFIRMADA', modo = p_modo,
         confirmado_por_auth = auth.uid(), confirmado_por_usuario_id = v_usuario, confirmado_em = now()
   WHERE id = v_imp.id;
  PERFORM set_config('cena.lms_status_autorizado', '', true);

  INSERT INTO public.sot_lms_importacao_eventos (importacao_id, tipo_evento, por_auth, por_usuario_id, detalhe)
  VALUES (v_imp.id, 'CONFIRMADA', auth.uid(), v_usuario,
    jsonb_build_object('projeto_id', v_imp.projeto_id, 'hash', v_imp.hash_sha256, 'modo', p_modo,
                       'perfil', v_congelou, 'observacao', v_obs));

  RETURN jsonb_build_object('operacao', 'CONFIRMADA', 'importacao_id', v_imp.id, 'projeto_id', v_imp.projeto_id,
    'status', 'CONFIRMADA', 'modo', p_modo, 'perfil', v_congelou,
    'estado_wl', public.sot_lms_estado_wl_calc(v_imp.projeto_id));
END;
$$;

-- ── 9. Grants ────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.sot_lms_importacoes_proteger() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sot_lms_autorizar_confirmacao(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sot_lms_estado_wl_calc(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sot_lms_estado_wl(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.sot_lms_confirmar(uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.sot_lms_estado_wl(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sot_lms_confirmar(uuid, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Validação
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'public.sot_lms_importacoes'::regclass AND conname LIKE '%status%' OR conname LIKE '%confirmacao%' OR conname LIKE '%modo%';
-- SELECT indexdef FROM pg_indexes WHERE indexname = 'sot_lms_importacoes_original_confirmada_uidx';
-- SELECT string_agg(perfil, ', ' ORDER BY perfil) FROM public.cena_permissoes_acao
--   WHERE acao = 'PROJ_CONFIRMAR_LMS' AND contrato_id IS NULL AND deleted_at IS NULL AND permitido;  -- admin, coordenador, escritorio, gestor
-- SELECT proname, prosecdef, proconfig FROM pg_proc
--   WHERE proname IN ('sot_lms_confirmar', 'sot_lms_autorizar_confirmacao', 'sot_lms_estado_wl', 'sot_lms_estado_wl_calc');
-- SELECT grantee, privilege_type FROM information_schema.role_routine_grants
--   WHERE routine_name IN ('sot_lms_confirmar', 'sot_lms_estado_wl');  -- só authenticated EXECUTE

-- Para desfazer — autossuficiente; reverte só esta etapa; aborta se houver CONFIRMADA; NÃO reaplica a 1.3.
-- BEGIN;
-- DO $rb$
-- BEGIN
--   IF EXISTS (SELECT 1 FROM public.sot_lms_importacoes WHERE status = 'CONFIRMADA') THEN
--     RAISE EXCEPTION 'ROLLBACK ABORTADO: existem importações CONFIRMADAS; reverter removeria status/modo/autoria. Trate manualmente antes.';
--   END IF;
-- END $rb$;
-- -- 1) Remove as funções desta etapa.
-- DROP FUNCTION IF EXISTS public.sot_lms_confirmar(uuid, text, text);
-- DROP FUNCTION IF EXISTS public.sot_lms_estado_wl(uuid);
-- DROP FUNCTION IF EXISTS public.sot_lms_estado_wl_calc(uuid);
-- DROP FUNCTION IF EXISTS public.sot_lms_autorizar_confirmacao(uuid);
-- -- 2) Restaura DIRETAMENTE o corpo original da trava da 1.3 (não reaplica a 1.3).
-- CREATE OR REPLACE FUNCTION public.sot_lms_importacoes_proteger()
-- RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $fn$
-- BEGIN
--   IF TG_OP <> 'UPDATE' THEN
--     RAISE EXCEPTION 'sot_lms_importacoes: fonte LMS não é apagada' USING ERRCODE = '42501';
--   END IF;
--   IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
--     RAISE EXCEPTION 'sot_lms_importacoes: fonte LMS não é reescrita' USING ERRCODE = '42501';
--   END IF;
--   IF NEW.status IS DISTINCT FROM OLD.status
--      AND coalesce(current_setting('cena.lms_status_autorizado', true), '') IS DISTINCT FROM OLD.id::text THEN
--     RAISE EXCEPTION 'sot_lms_importacoes: status só por função controlada' USING ERRCODE = '42501';
--   END IF;
--   RETURN NEW;
-- END; $fn$;
-- REVOKE ALL ON FUNCTION public.sot_lms_importacoes_proteger() FROM PUBLIC, anon, authenticated, service_role;
-- -- 3) Índice e CHECKs desta etapa → estado da 1.3.
-- DROP INDEX IF EXISTS public.sot_lms_importacoes_original_confirmada_uidx;
-- ALTER TABLE public.sot_lms_importacao_eventos DROP CONSTRAINT IF EXISTS sot_lms_importacao_eventos_tipo_chk;
-- ALTER TABLE public.sot_lms_importacao_eventos ADD  CONSTRAINT sot_lms_importacao_eventos_tipo_chk CHECK (tipo_evento IN ('CRIADA', 'REENVIO'));
-- ALTER TABLE public.sot_lms_importacoes DROP CONSTRAINT IF EXISTS sot_lms_importacoes_confirmacao_chk;
-- ALTER TABLE public.sot_lms_importacoes DROP CONSTRAINT IF EXISTS sot_lms_importacoes_modo_chk;
-- ALTER TABLE public.sot_lms_importacoes DROP CONSTRAINT IF EXISTS sot_lms_importacoes_status_chk;
-- ALTER TABLE public.sot_lms_importacoes ADD  CONSTRAINT sot_lms_importacoes_status_chk CHECK (status IN ('RASCUNHO'));
-- -- 4) Colunas desta etapa (só seguras porque nenhuma importação está CONFIRMADA — guarda acima).
-- ALTER TABLE public.sot_lms_importacoes
--   DROP COLUMN IF EXISTS conciliacao_aplicada_por_auth, DROP COLUMN IF EXISTS conciliacao_aplicada_em,
--   DROP COLUMN IF EXISTS confirmado_em, DROP COLUMN IF EXISTS confirmado_por_usuario_id,
--   DROP COLUMN IF EXISTS confirmado_por_auth, DROP COLUMN IF EXISTS modo;
-- -- 5) Ação/matriz PROJ_CONFIRMAR_LMS: a matriz tem gatilho que proíbe DELETE físico; para "remover", revogue:
-- --    SELECT public.cena_permissao_acao_revogar('admin','PROJ_CONFIRMAR_LMS','rollback'), ... (por perfil), e
-- --    UPDATE public.cena_acoes SET ativo = false WHERE codigo = 'PROJ_CONFIRMAR_LMS';  (opcional; não destrutivo)
-- NOTIFY pgrst, 'reload schema';
-- COMMIT;
