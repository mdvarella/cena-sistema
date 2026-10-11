-- ETAPA 1.4 (ENEL/LMS/WL) — WL oficial, unicidade e proteção estrutural
-- Base: docs/enel-wl/ETAPA-1.4-WL-DIAGNOSTICO.md (decisões D1–D13 aprovadas em 11/10/2026).
--   - sot_wl: única WL operacional (projeto ESTRUTURADO). Escrita só por função; leitura por authenticated.
--   - sot_atividades / sot_materiais: colunas wl_id, lms_linha_id, ctg, ft, kit (nulas, sem default). Linhas existentes
--     continuam legadas e sem nenhuma proteção nova.
--   - Unicidade: legado de atividades = mesma regra de hoje (UNIQUE (projeto_id, codigo)), agora como índice parcial
--     WHERE wl_id IS NULL (D2); linhas com WL = projeto + WL + código normalizado + FT + KIT (D1).
--   - Proteção (D10): linha ligada a WL/LMS não muda campo estrutural nem é apagada por anon/authenticated (inclui o
--     fallback físico do sbDelete, TRUNCATE e a exclusão do projeto). Campos operacionais continuam livres.
--   - Estado derivado ESTRUTURA_PENDENTE (D8) e função fn_proj_lms_aplicar_estrutura_nova (D3–D7, D9, D13).
-- NÃO cria nenhuma WL, NÃO altera nem remove linha existente de sot_atividades/sot_materiais (o material legado de
-- teste do TESTE 1 — das123 é tratado por ação explícita do dono, nunca aqui), NÃO toca programação, composicao_dia,
-- estoque/almoxarifado, medição nem TMA. Aditiva sobre 1.3 / confirmação / listagem (não edita migrations aplicadas).
-- Transação explícita: qualquer falha desfaz a etapa inteira.

BEGIN;

-- ── 0. Pré-condições (falha inteira, nada é aplicado) ────────────────────
DO $$
DECLARE
  v_def text;
BEGIN
  IF NOT coalesce((SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user), false) THEN
    RAISE EXCEPTION 'Rode como dono com BYPASSRLS: as funções SECURITY DEFINER leem tabelas com RLS FORCE';
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'auth.uid() não existe';
  END IF;
  IF to_regprocedure('public.sot_lms_confirmar(uuid, text, text)') IS NULL
     OR to_regprocedure('public.sot_lms_autorizar_confirmacao(uuid)') IS NULL
     OR to_regprocedure('public.sot_lms_estado_wl_calc(uuid)') IS NULL THEN
    RAISE EXCEPTION 'aplique antes 20261010120000_proj_lms_confirmacao.sql (Etapa 1.3 Confirmação)';
  END IF;
  IF to_regprocedure('public.sot_lms_rascunhos_listar()') IS NULL THEN
    RAISE EXCEPTION 'aplique antes 20261011120000_proj_lms_rascunhos_listar.sql';
  END IF;
  IF to_regclass('public.sot_atividades') IS NULL OR to_regclass('public.sot_materiais') IS NULL
     OR to_regclass('public.sot_projetos') IS NULL OR to_regclass('public.servicos_contrato') IS NULL THEN
    RAISE EXCEPTION 'tabelas sot_atividades / sot_materiais / sot_projetos / servicos_contrato ausentes';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE oid IN ('public.fn_proj_codigo_norm(text)'::regprocedure,
        'public.fn_proj_texto_norm(text)'::regprocedure) AND provolatile = 'i') <> 2 THEN
    RAISE EXCEPTION 'fn_proj_codigo_norm / fn_proj_texto_norm precisam ser IMMUTABLE (vão em índice)';
  END IF;
  -- valor_total precisa ser gerada: a função de aplicação não grava nela.
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.sot_atividades'::regclass
                 AND attname = 'valor_total' AND attgenerated = 's') THEN
    RAISE EXCEPTION 'sot_atividades.valor_total não é coluna gerada: revise a função de aplicação antes';
  END IF;
  -- Regra legada de unicidade de atividades: ou ainda é a constraint original, ou já virou o índice parcial (reaplicação).
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.sot_atividades'::regclass AND conname = 'sot_atividades_projeto_codigo_unique';
  IF v_def IS NOT NULL AND v_def <> 'UNIQUE (projeto_id, codigo)' THEN
    RAISE EXCEPTION 'sot_atividades_projeto_codigo_unique mudou (%): revise a 1.4 antes de aplicar', v_def;
  END IF;
  IF v_def IS NULL AND to_regclass('public.sot_atividades_projeto_codigo_legado_uidx') IS NULL THEN
    RAISE EXCEPTION 'regra de unicidade de sot_atividades não encontrada (nem constraint original nem índice legado)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sot_atividades WHERE codigo IS NOT NULL
             GROUP BY projeto_id, codigo HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'sot_atividades tem (projeto_id, codigo) duplicado: a regra legada não pode ser recriada';
  END IF;
  -- Colunas novas: se já existirem, precisam ter o tipo previsto.
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name IN ('sot_atividades', 'sot_materiais')
               AND ((column_name IN ('wl_id', 'lms_linha_id') AND data_type <> 'uuid')
                 OR (column_name IN ('ctg', 'ft', 'kit') AND data_type <> 'text'))) THEN
    RAISE EXCEPTION 'colunas wl_id/lms_linha_id/ctg/ft/kit já existem com outro tipo';
  END IF;
END $$;

-- ── 1. sot_wl (nova) ─────────────────────────────────────────────────────
-- Sem FK física para sot_projetos (D11, padrão LMS/1.2): existência validada pela função de aplicação.
CREATE TABLE IF NOT EXISTS public.sot_wl (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id           uuid NOT NULL,
  codigo               text NOT NULL,
  codigo_norm          text GENERATED ALWAYS AS (public.fn_proj_texto_norm(codigo)) STORED,
  origem               text NOT NULL,
  importacao_id        uuid REFERENCES public.sot_lms_importacoes (id),
  ordem                integer NOT NULL,
  criado_em            timestamptz NOT NULL DEFAULT now(),
  criado_por_auth      uuid NOT NULL,
  cancelada_em         timestamptz,
  cancelada_por_auth   uuid,
  motivo_cancelamento  text,
  CONSTRAINT sot_wl_origem_chk CHECK (origem IN ('LMS', 'MANUAL')),
  CONSTRAINT sot_wl_origem_lms_chk CHECK (origem <> 'LMS' OR importacao_id IS NOT NULL),
  CONSTRAINT sot_wl_codigo_chk CHECK (public.fn_proj_texto_norm(codigo) IS NOT NULL AND length(codigo) <= 100),
  CONSTRAINT sot_wl_ordem_chk CHECK (ordem >= 1),
  CONSTRAINT sot_wl_cancelamento_chk CHECK (
    (cancelada_em IS NULL AND cancelada_por_auth IS NULL AND motivo_cancelamento IS NULL)
    OR (cancelada_em IS NOT NULL AND cancelada_por_auth IS NOT NULL AND btrim(coalesce(motivo_cancelamento, '')) <> ''))
);
CREATE UNIQUE INDEX IF NOT EXISTS sot_wl_projeto_codigo_uidx ON public.sot_wl (projeto_id, codigo_norm) WHERE cancelada_em IS NULL;
CREATE INDEX IF NOT EXISTS sot_wl_importacao_idx ON public.sot_wl (importacao_id);
COMMENT ON TABLE public.sot_wl IS
  'Etapa 1.4: WL oficial (única WL operacional de projeto ESTRUTURADO). Nasce só de linha de LMS confirmada (origem LMS). '
  'Não confundir com a "WL do croqui (IA)" de sot_projetos.wl_distribuicao/plano_execucao.';

-- Imutável: sem DELETE/TRUNCATE; UPDATE só nos campos de cancelamento, dentro de transação marcada por função.
CREATE OR REPLACE FUNCTION public.sot_wl_proteger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'sot_wl: WL oficial não é apagada (WL_SO_POR_FUNCAO)' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - 'cancelada_em' - 'cancelada_por_auth' - 'motivo_cancelamento')
     IS DISTINCT FROM (to_jsonb(OLD) - 'cancelada_em' - 'cancelada_por_auth' - 'motivo_cancelamento') THEN
    RAISE EXCEPTION 'sot_wl: WL oficial não é reescrita (WL_SO_POR_FUNCAO)' USING ERRCODE = '42501';
  END IF;
  IF coalesce(current_setting('cena.wl_cancelamento_autorizado', true), '') IS DISTINCT FROM OLD.id::text THEN
    RAISE EXCEPTION 'sot_wl: cancelamento só por função controlada (WL_SO_POR_FUNCAO)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sot_wl_proteger ON public.sot_wl;
CREATE TRIGGER trg_sot_wl_proteger BEFORE UPDATE OR DELETE ON public.sot_wl
  FOR EACH ROW EXECUTE FUNCTION public.sot_wl_proteger();
DROP TRIGGER IF EXISTS trg_sot_wl_sem_truncate ON public.sot_wl;
CREATE TRIGGER trg_sot_wl_sem_truncate BEFORE TRUNCATE ON public.sot_wl
  FOR EACH STATEMENT EXECUTE FUNCTION public.sot_wl_proteger();

ALTER TABLE public.sot_wl ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sot_wl FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sot_wl_leitura ON public.sot_wl;
CREATE POLICY sot_wl_leitura ON public.sot_wl FOR SELECT TO authenticated USING (true);
REVOKE ALL ON TABLE public.sot_wl FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.sot_wl TO authenticated;

-- ── 2. Colunas novas em sot_atividades e sot_materiais ───────────────────
ALTER TABLE public.sot_atividades
  ADD COLUMN IF NOT EXISTS wl_id        uuid,
  ADD COLUMN IF NOT EXISTS lms_linha_id uuid,
  ADD COLUMN IF NOT EXISTS ctg          text,
  ADD COLUMN IF NOT EXISTS ft           text,
  ADD COLUMN IF NOT EXISTS kit          text;
ALTER TABLE public.sot_materiais
  ADD COLUMN IF NOT EXISTS wl_id        uuid,
  ADD COLUMN IF NOT EXISTS lms_linha_id uuid,
  ADD COLUMN IF NOT EXISTS ctg          text,
  ADD COLUMN IF NOT EXISTS ft           text,
  ADD COLUMN IF NOT EXISTS kit          text;

ALTER TABLE public.sot_atividades DROP CONSTRAINT IF EXISTS sot_atividades_wl_fkey;
ALTER TABLE public.sot_atividades ADD  CONSTRAINT sot_atividades_wl_fkey
  FOREIGN KEY (wl_id) REFERENCES public.sot_wl (id) ON DELETE RESTRICT;
ALTER TABLE public.sot_atividades DROP CONSTRAINT IF EXISTS sot_atividades_lms_linha_fkey;
ALTER TABLE public.sot_atividades ADD  CONSTRAINT sot_atividades_lms_linha_fkey
  FOREIGN KEY (lms_linha_id) REFERENCES public.sot_lms_linhas (id) ON DELETE RESTRICT;
ALTER TABLE public.sot_materiais DROP CONSTRAINT IF EXISTS sot_materiais_wl_fkey;
ALTER TABLE public.sot_materiais ADD  CONSTRAINT sot_materiais_wl_fkey
  FOREIGN KEY (wl_id) REFERENCES public.sot_wl (id) ON DELETE RESTRICT;
ALTER TABLE public.sot_materiais DROP CONSTRAINT IF EXISTS sot_materiais_lms_linha_fkey;
ALTER TABLE public.sot_materiais ADD  CONSTRAINT sot_materiais_lms_linha_fkey
  FOREIGN KEY (lms_linha_id) REFERENCES public.sot_lms_linhas (id) ON DELETE RESTRICT;

-- Linha com WL tem código com conteúdo (mesmo critério de "fn_proj_codigo_norm IS NOT NULL": algo além de espaço, tab,
-- quebra de linha e NBSP); WL e linha do LMS andam juntas (só origem LMS nesta etapa); ctg/ft/kit só em linha estruturada.
-- Sem chamada de função: CHECK é avaliado com o privilégio de quem grava, e anon (login legado/sessão não restaurada) não
-- tem EXECUTE nas funções de normalização — uma função aqui quebraria TODA gravação de anon, inclusive em linha legada.
ALTER TABLE public.sot_atividades DROP CONSTRAINT IF EXISTS sot_atividades_wl_chk;
ALTER TABLE public.sot_atividades ADD  CONSTRAINT sot_atividades_wl_chk CHECK (
  (wl_id IS NULL OR coalesce(codigo, '') ~ '[^ \t\r\n ]')
  AND ((wl_id IS NULL) = (lms_linha_id IS NULL))
  AND (wl_id IS NOT NULL OR (ctg IS NULL AND ft IS NULL AND kit IS NULL)));
ALTER TABLE public.sot_materiais DROP CONSTRAINT IF EXISTS sot_materiais_wl_chk;
ALTER TABLE public.sot_materiais ADD  CONSTRAINT sot_materiais_wl_chk CHECK (
  (wl_id IS NULL OR coalesce(codigo_sap, '') ~ '[^ \t\r\n ]')
  AND ((wl_id IS NULL) = (lms_linha_id IS NULL))
  AND (wl_id IS NOT NULL OR (ctg IS NULL AND ft IS NULL AND kit IS NULL)));

-- ── 3. Unicidade ─────────────────────────────────────────────────────────
-- D2: mesma regra legada (código cru, inclui excluídas), só para linhas sem WL.
ALTER TABLE public.sot_atividades DROP CONSTRAINT IF EXISTS sot_atividades_projeto_codigo_unique;
CREATE UNIQUE INDEX IF NOT EXISTS sot_atividades_projeto_codigo_legado_uidx
  ON public.sot_atividades (projeto_id, codigo) WHERE wl_id IS NULL;

-- D1: com WL = projeto + WL + código normalizado + FT + KIT (ativos).
CREATE UNIQUE INDEX IF NOT EXISTS sot_atividades_wl_chave_uidx ON public.sot_atividades
  (projeto_id, wl_id, public.fn_proj_codigo_norm(codigo),
   coalesce(public.fn_proj_texto_norm(ft), ''), coalesce(public.fn_proj_texto_norm(kit), ''))
  WHERE wl_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sot_materiais_wl_chave_uidx ON public.sot_materiais
  (projeto_id, wl_id, public.fn_proj_codigo_norm(codigo_sap),
   coalesce(public.fn_proj_texto_norm(ft), ''), coalesce(public.fn_proj_texto_norm(kit), ''))
  WHERE wl_id IS NOT NULL AND deleted_at IS NULL;

-- Uma linha do LMS vira no máximo uma linha ativa.
CREATE UNIQUE INDEX IF NOT EXISTS sot_atividades_lms_linha_uidx ON public.sot_atividades (lms_linha_id)
  WHERE lms_linha_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sot_materiais_lms_linha_uidx ON public.sot_materiais (lms_linha_id)
  WHERE lms_linha_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sot_atividades_wl_idx ON public.sot_atividades (wl_id) WHERE wl_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sot_materiais_wl_idx ON public.sot_materiais (wl_id) WHERE wl_id IS NOT NULL;

-- ── 4. sot_lms_importacoes: marca de estrutura aplicada (D8) ─────────────
ALTER TABLE public.sot_lms_importacoes
  ADD COLUMN IF NOT EXISTS estrutura_aplicada_em       timestamptz,
  ADD COLUMN IF NOT EXISTS estrutura_aplicada_por_auth uuid;

ALTER TABLE public.sot_lms_importacoes DROP CONSTRAINT IF EXISTS sot_lms_importacoes_estrutura_chk;
ALTER TABLE public.sot_lms_importacoes ADD  CONSTRAINT sot_lms_importacoes_estrutura_chk CHECK (
  (estrutura_aplicada_em IS NULL AND estrutura_aplicada_por_auth IS NULL)
  OR (estrutura_aplicada_em IS NOT NULL AND estrutura_aplicada_por_auth IS NOT NULL
      AND status = 'CONFIRMADA' AND modo = 'ESTRUTURA_NOVA'));

ALTER TABLE public.sot_lms_importacao_eventos DROP CONSTRAINT IF EXISTS sot_lms_importacao_eventos_tipo_chk;
ALTER TABLE public.sot_lms_importacao_eventos ADD  CONSTRAINT sot_lms_importacao_eventos_tipo_chk
  CHECK (tipo_evento IN ('CRIADA', 'REENVIO', 'CONFIRMADA', 'ESTRUTURA_APLICADA'));

-- Trava da importação: mesma da confirmação + estrutura_aplicada_* na whitelist (só via função marcada).
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
  v_old_rest := (to_jsonb(OLD) - 'status' - 'modo' - 'confirmado_por_auth' - 'confirmado_por_usuario_id'
                  - 'confirmado_em' - 'conciliacao_aplicada_em' - 'conciliacao_aplicada_por_auth'
                  - 'estrutura_aplicada_em' - 'estrutura_aplicada_por_auth');
  v_new_rest := (to_jsonb(NEW) - 'status' - 'modo' - 'confirmado_por_auth' - 'confirmado_por_usuario_id'
                  - 'confirmado_em' - 'conciliacao_aplicada_em' - 'conciliacao_aplicada_por_auth'
                  - 'estrutura_aplicada_em' - 'estrutura_aplicada_por_auth');
  IF v_new_rest IS DISTINCT FROM v_old_rest THEN
    RAISE EXCEPTION 'sot_lms_importacoes: fonte LMS não é reescrita' USING ERRCODE = '42501';
  END IF;
  v_mudou_ctrl := NEW.status IS DISTINCT FROM OLD.status
    OR NEW.modo IS DISTINCT FROM OLD.modo
    OR NEW.confirmado_por_auth IS DISTINCT FROM OLD.confirmado_por_auth
    OR NEW.confirmado_por_usuario_id IS DISTINCT FROM OLD.confirmado_por_usuario_id
    OR NEW.confirmado_em IS DISTINCT FROM OLD.confirmado_em
    OR NEW.conciliacao_aplicada_em IS DISTINCT FROM OLD.conciliacao_aplicada_em
    OR NEW.conciliacao_aplicada_por_auth IS DISTINCT FROM OLD.conciliacao_aplicada_por_auth
    OR NEW.estrutura_aplicada_em IS DISTINCT FROM OLD.estrutura_aplicada_em
    OR NEW.estrutura_aplicada_por_auth IS DISTINCT FROM OLD.estrutura_aplicada_por_auth;
  IF v_mudou_ctrl AND NOT v_autorizado THEN
    RAISE EXCEPTION 'sot_lms_importacoes: confirmação só por função controlada' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- ── 5. Estado derivado (regra canônica; D8) ──────────────────────────────
-- LEGADO_SEM_WL (sem ORIGINAL confirmada) · EM_CONCILIACAO (CONCILIACAO não aplicada) ·
-- ESTRUTURA_PENDENTE (ESTRUTURA_NOVA confirmada, estrutura ainda não aplicada) · ESTRUTURADO.
CREATE OR REPLACE FUNCTION public.sot_lms_estado_wl_calc(p_projeto_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_modo      text;
  v_aplic     timestamptz;
  v_estrutura timestamptz;
BEGIN
  SELECT i.modo, i.conciliacao_aplicada_em, i.estrutura_aplicada_em INTO v_modo, v_aplic, v_estrutura
  FROM public.sot_lms_importacoes i
  WHERE i.projeto_id = p_projeto_id AND i.tipo_importacao = 'ORIGINAL' AND i.status = 'CONFIRMADA'
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN 'LEGADO_SEM_WL';
  END IF;
  IF v_modo = 'CONCILIACAO' AND v_aplic IS NULL THEN
    RETURN 'EM_CONCILIACAO';
  END IF;
  IF v_modo = 'ESTRUTURA_NOVA' AND v_estrutura IS NULL THEN
    RETURN 'ESTRUTURA_PENDENTE';
  END IF;
  RETURN 'ESTRUTURADO';
END;
$$;

-- ── 6. Proteção estrutural (D10) ─────────────────────────────────────────
-- SECURITY INVOKER: age só quando quem grava é anon/authenticated. Dentro de função SECURITY DEFINER o current_user é
-- o dono e a gravação passa. Lista FECHADA de campos estruturais; todo o resto (executado, viabilizado, medido,
-- faturado, requisitado, entregue, aplicado, devolvido, processado SAP, valores, status, etapa, ordem, observações…)
-- continua livre, inclusive em linha estruturada. Regravar o mesmo valor passa (comparação IS DISTINCT FROM).
CREATE OR REPLACE FUNCTION public.fn_proj_protege_linha_estruturada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wl_cols  text[] := ARRAY['wl_id', 'lms_linha_id', 'ctg', 'ft', 'kit'];
  v_estrut   text[];
  v_old      jsonb;
  v_new      jsonb;
  v_col      text;
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_TABLE_NAME = 'sot_atividades' THEN
    v_estrut := ARRAY['projeto_id', 'codigo', 'descricao', 'unidade', 'qtd_prevista', 'somente_descritivo',
                      'wl_id', 'lms_linha_id', 'ctg', 'ft', 'kit', 'deleted_at'];
  ELSE
    v_estrut := ARRAY['projeto_id', 'codigo_sap', 'descricao', 'unidade', 'qtd_projetada', 'somente_descritivo',
                      'wl_id', 'lms_linha_id', 'ctg', 'ft', 'kit', 'deleted_at'];
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW);
    FOREACH v_col IN ARRAY v_wl_cols LOOP
      IF v_new->>v_col IS NOT NULL THEN
        RAISE EXCEPTION '%: linha com WL/LMS só por função (WL_SO_POR_FUNCAO: %)', TG_TABLE_NAME, v_col USING ERRCODE = '42501';
      END IF;
    END LOOP;
    RETURN NEW;
  END IF;

  v_old := to_jsonb(OLD);
  IF v_old->>'wl_id' IS NULL AND v_old->>'lms_linha_id' IS NULL THEN
    -- Linha legada: comportamento de hoje, exceto preencher campos de WL.
    IF TG_OP = 'UPDATE' THEN
      v_new := to_jsonb(NEW);
      FOREACH v_col IN ARRAY v_wl_cols LOOP
        IF v_new->v_col IS DISTINCT FROM v_old->v_col THEN
          RAISE EXCEPTION '%: linha legada não recebe WL pela tela (WL_SO_POR_FUNCAO: %)', TG_TABLE_NAME, v_col USING ERRCODE = '42501';
        END IF;
      END LOOP;
      RETURN NEW;
    END IF;
    RETURN OLD;
  END IF;

  -- Linha estruturada.
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '%: linha estruturada (WL) não é apagada pela tela (LINHA_ESTRUTURADA_SEM_EXCLUSAO)', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  v_new := to_jsonb(NEW);
  FOREACH v_col IN ARRAY v_estrut LOOP
    IF v_new->v_col IS DISTINCT FROM v_old->v_col THEN
      RAISE EXCEPTION '%: campo estrutural de linha com WL não muda pela tela (LINHA_ESTRUTURADA_CAMPO_PROTEGIDO: %)',
        TG_TABLE_NAME, v_col USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

-- TRUNCATE por anon/authenticated recusado quando há linha estruturada (legado sem mudança).
CREATE OR REPLACE FUNCTION public.fn_proj_protege_truncate_estruturado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') AND (
       EXISTS (SELECT 1 FROM public.sot_atividades WHERE wl_id IS NOT NULL OR lms_linha_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.sot_materiais WHERE wl_id IS NOT NULL OR lms_linha_id IS NOT NULL)) THEN
    RAISE EXCEPTION '%: há linhas estruturadas (WL); TRUNCATE recusado (LINHA_ESTRUTURADA_SEM_EXCLUSAO)', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  RETURN NULL;
END;
$$;

-- Exclusão de projeto com linhas estruturadas (a cascata de FK roda como dono da tabela e não passaria pelo gatilho
-- das linhas): recusada para anon/authenticated. Projeto sem estrutura: comportamento de hoje.
CREATE OR REPLACE FUNCTION public.fn_proj_protege_projeto_estruturado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') AND (
       EXISTS (SELECT 1 FROM public.sot_atividades a WHERE a.projeto_id = OLD.id AND (a.wl_id IS NOT NULL OR a.lms_linha_id IS NOT NULL))
    OR EXISTS (SELECT 1 FROM public.sot_materiais m WHERE m.projeto_id = OLD.id AND (m.wl_id IS NOT NULL OR m.lms_linha_id IS NOT NULL))) THEN
    RAISE EXCEPTION 'sot_projetos: projeto com estrutura de WL não é apagado pela tela (PROJETO_ESTRUTURADO_SEM_EXCLUSAO)'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_sot_atividades_protege_estrutura ON public.sot_atividades;
CREATE TRIGGER trg_sot_atividades_protege_estrutura BEFORE INSERT OR UPDATE OR DELETE ON public.sot_atividades
  FOR EACH ROW EXECUTE FUNCTION public.fn_proj_protege_linha_estruturada();
DROP TRIGGER IF EXISTS trg_sot_materiais_protege_estrutura ON public.sot_materiais;
CREATE TRIGGER trg_sot_materiais_protege_estrutura BEFORE INSERT OR UPDATE OR DELETE ON public.sot_materiais
  FOR EACH ROW EXECUTE FUNCTION public.fn_proj_protege_linha_estruturada();
DROP TRIGGER IF EXISTS trg_sot_atividades_protege_truncate ON public.sot_atividades;
CREATE TRIGGER trg_sot_atividades_protege_truncate BEFORE TRUNCATE ON public.sot_atividades
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_proj_protege_truncate_estruturado();
DROP TRIGGER IF EXISTS trg_sot_materiais_protege_truncate ON public.sot_materiais;
CREATE TRIGGER trg_sot_materiais_protege_truncate BEFORE TRUNCATE ON public.sot_materiais
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_proj_protege_truncate_estruturado();
DROP TRIGGER IF EXISTS trg_sot_projetos_protege_estrutura ON public.sot_projetos;
CREATE TRIGGER trg_sot_projetos_protege_estrutura BEFORE DELETE ON public.sot_projetos
  FOR EACH ROW EXECUTE FUNCTION public.fn_proj_protege_projeto_estruturado();

-- ── 7. Aplicação da estrutura (D3–D7, D9, D13) ───────────────────────────
-- Chamada explícita (botão da 1.5), separada da confirmação. Cliente envia só o id da importação.
-- Uma transação: cria as WLs e as linhas de atividades/materiais a partir da ORIGINAL ESTRUTURA_NOVA confirmada.
CREATE OR REPLACE FUNCTION public.fn_proj_lms_aplicar_estrutura_nova(p_importacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_imp       public.sot_lms_importacoes%ROWTYPE;
  v_motivo    text;
  v_usuario   text;
  v_contrato  text;
  v_leg_ativ  integer;
  v_leg_mat   integer;
  v_lista     text;
  v_n_wl      integer;
  v_n_ativ    integer;
  v_n_mat_op  integer;
  v_n_mat_desc integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'WL aplicar: sem sessão' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_imp FROM public.sot_lms_importacoes WHERE id = p_importacao_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WL aplicar: importação inexistente' USING ERRCODE = 'P0002';
  END IF;

  -- D9: mesma autorização da confirmação (PROJ_CONFIRMAR_LMS, regra de contrato da 1.1).
  v_motivo := public.sot_lms_autorizar_confirmacao(v_imp.projeto_id);
  IF v_motivo <> 'OK' THEN
    RAISE EXCEPTION 'WL aplicar: %', v_motivo USING ERRCODE = '42501';
  END IF;
  SELECT us.id::text INTO v_usuario FROM public.usuarios_sistema us
  WHERE us.auth_user_id = auth.uid() AND us.ativo IS TRUE AND us.deleted_at IS NULL
  LIMIT 1;
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'WL aplicar: usuário ERP inexistente ou inativo' USING ERRCODE = '42501';
  END IF;

  -- Serializa com a confirmação do mesmo projeto e relê sob lock.
  PERFORM pg_advisory_xact_lock(hashtextextended('sot_lms_confirmar|' || v_imp.projeto_id::text, 0));
  SELECT * INTO v_imp FROM public.sot_lms_importacoes WHERE id = p_importacao_id FOR UPDATE;

  IF v_imp.estrutura_aplicada_em IS NOT NULL THEN
    RETURN jsonb_build_object('operacao', 'JA_APLICADA', 'importacao_id', v_imp.id, 'projeto_id', v_imp.projeto_id,
      'wls', (SELECT count(*) FROM public.sot_wl w WHERE w.importacao_id = v_imp.id AND w.cancelada_em IS NULL),
      'estado_wl', public.sot_lms_estado_wl_calc(v_imp.projeto_id));
  END IF;
  IF v_imp.tipo_importacao <> 'ORIGINAL' OR v_imp.status <> 'CONFIRMADA' OR v_imp.modo IS DISTINCT FROM 'ESTRUTURA_NOVA' THEN
    RAISE EXCEPTION 'WL aplicar: IMPORTACAO_NAO_ELEGIVEL (tipo %, status %, modo %)',
      v_imp.tipo_importacao, v_imp.status, coalesce(v_imp.modo, '-') USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sot_wl w WHERE w.projeto_id = v_imp.projeto_id AND w.cancelada_em IS NULL) THEN
    RAISE EXCEPTION 'WL aplicar: PROJETO_JA_TEM_WL' USING ERRCODE = '55000';
  END IF;

  -- D7: projeto com linha legada ativa não recebe estrutura nova (usar CONCILIACAO). Nada é removido aqui.
  SELECT count(*) INTO v_leg_ativ FROM public.sot_atividades a
   WHERE a.projeto_id = v_imp.projeto_id AND a.wl_id IS NULL AND a.deleted_at IS NULL;
  SELECT count(*) INTO v_leg_mat FROM public.sot_materiais m
   WHERE m.projeto_id = v_imp.projeto_id AND m.wl_id IS NULL AND m.deleted_at IS NULL;
  IF v_leg_ativ > 0 OR v_leg_mat > 0 THEN
    RAISE EXCEPTION 'WL aplicar: PROJETO_COM_LEGADO (atividades %, materiais %)', v_leg_ativ, v_leg_mat
      USING ERRCODE = '55000';
  END IF;

  -- D3: toda linha precisa ser serviço (I-/R-) ou material (numérico), ter WL e descrição.
  SELECT string_agg(l.linha_excel::text, ', ' ORDER BY l.linha_excel) INTO v_lista
  FROM (SELECT linha_excel FROM public.sot_lms_linhas
        WHERE importacao_id = v_imp.id
          AND (codigo_norm IS NULL OR NOT (codigo_norm ~ '^[IR]-' OR codigo_norm ~ '^[0-9]+$'))
        ORDER BY linha_excel LIMIT 50) l;
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION 'WL aplicar: LINHA_NAO_CLASSIFICADA (linhas %)', v_lista USING ERRCODE = '55000';
  END IF;
  SELECT string_agg(l.linha_excel::text, ', ' ORDER BY l.linha_excel) INTO v_lista
  FROM (SELECT linha_excel FROM public.sot_lms_linhas
        WHERE importacao_id = v_imp.id AND (wl_norm IS NULL OR nullif(btrim(coalesce(descricao_raw, '')), '') IS NULL)
        ORDER BY linha_excel LIMIT 50) l;
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION 'WL aplicar: LINHA_SEM_WL_OU_DESCRICAO (linhas %)', v_lista USING ERRCODE = '55000';
  END IF;
  -- D1: a chave WL + código + FT + KIT não pode repetir dentro do arquivo.
  SELECT string_agg(g.linhas, ' | ') INTO v_lista
  FROM (SELECT string_agg(linha_excel::text, ',' ORDER BY linha_excel) AS linhas
        FROM public.sot_lms_linhas WHERE importacao_id = v_imp.id
        GROUP BY wl_norm, codigo_norm, coalesce(ft_norm, ''), coalesce(kit_norm, '')
        HAVING count(*) > 1 LIMIT 20) g;
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION 'WL aplicar: LINHAS_REPETIDAS_NA_CHAVE (linhas %)', v_lista USING ERRCODE = '55000';
  END IF;

  SELECT c.o_contrato INTO v_contrato FROM public.sot_projeto_processo_contexto(v_imp.projeto_id) c;

  -- WLs: uma por WL distinta; ordem numérica quando o WL é número.
  INSERT INTO public.sot_wl (projeto_id, codigo, origem, importacao_id, ordem, criado_por_auth)
  SELECT v_imp.projeto_id, w.codigo, 'LMS', v_imp.id,
         row_number() OVER (ORDER BY (w.wl_norm ~ '^[0-9]+$') DESC,
                                     CASE WHEN w.wl_norm ~ '^[0-9]+$' THEN lpad(w.wl_norm, 30, '0') END, w.wl_norm),
         auth.uid()
  FROM (SELECT wl_norm, (array_agg(btrim(wl_raw) ORDER BY ordem))[1] AS codigo
        FROM public.sot_lms_linhas WHERE importacao_id = v_imp.id GROUP BY wl_norm) w;
  GET DIAGNOSTICS v_n_wl = ROW_COUNT;

  -- D5/D6: serviços (I-/R-) → atividades. valor_unitario = valor_ups_item do LMS; servico_id só se casar 1 serviço
  -- do catálogo do mesmo contrato. valor_total é gerada (não entra).
  INSERT INTO public.sot_atividades (projeto_id, codigo, descricao, unidade, qtd_prevista, valor_unitario, servico_id,
                                     ordem_exec, wl_id, lms_linha_id, ctg, ft, kit)
  SELECT v_imp.projeto_id, btrim(l.codigo_raw), btrim(l.descricao_raw), nullif(btrim(coalesce(l.umd_raw, '')), ''),
         l.qtd_plan, coalesce(round(l.valor_ups_item, 4), 0),
         (SELECT min(sc.id::text) FROM public.servicos_contrato sc
           WHERE sc.deleted_at IS NULL AND v_contrato IS NOT NULL AND btrim(sc.contrato_id) = v_contrato
             AND public.fn_proj_codigo_norm(sc.codigo) = l.codigo_norm
          HAVING count(*) = 1),
         l.ordem, w.id, l.id,
         nullif(btrim(coalesce(l.ctg_raw, '')), ''), nullif(btrim(coalesce(l.ft_raw, '')), ''), nullif(btrim(coalesce(l.kit_raw, '')), '')
  FROM public.sot_lms_linhas l
  JOIN public.sot_wl w ON w.projeto_id = v_imp.projeto_id AND w.importacao_id = v_imp.id
                      AND w.codigo_norm = l.wl_norm AND w.cancelada_em IS NULL
  WHERE l.importacao_id = v_imp.id AND l.codigo_norm ~ '^[IR]-'
  ORDER BY l.ordem;
  GET DIAGNOSTICS v_n_ativ = ROW_COUNT;

  -- D4: materiais (numéricos). FT=R (retirada) = somente_descritivo: o CHECK existente impede qualquer quantidade
  -- operacional (requisição, entrega, aplicação, devolução, SAP) nessas linhas.
  INSERT INTO public.sot_materiais (projeto_id, codigo_sap, descricao, unidade, qtd_projetada, somente_descritivo,
                                    observacao, wl_id, lms_linha_id, ctg, ft, kit)
  SELECT v_imp.projeto_id, btrim(l.codigo_raw), btrim(l.descricao_raw), nullif(btrim(coalesce(l.umd_raw, '')), ''),
         l.qtd_plan, coalesce(l.ft_norm = 'R', false),
         CASE WHEN l.ft_norm = 'R' THEN 'LMS: retirada (FT=R) — somente descritivo, fora de requisição/almoxarifado' END,
         w.id, l.id,
         nullif(btrim(coalesce(l.ctg_raw, '')), ''), nullif(btrim(coalesce(l.ft_raw, '')), ''), nullif(btrim(coalesce(l.kit_raw, '')), '')
  FROM public.sot_lms_linhas l
  JOIN public.sot_wl w ON w.projeto_id = v_imp.projeto_id AND w.importacao_id = v_imp.id
                      AND w.codigo_norm = l.wl_norm AND w.cancelada_em IS NULL
  WHERE l.importacao_id = v_imp.id AND l.codigo_norm ~ '^[0-9]+$'
  ORDER BY l.ordem;
  SELECT count(*) FILTER (WHERE NOT m.somente_descritivo), count(*) FILTER (WHERE m.somente_descritivo)
    INTO v_n_mat_op, v_n_mat_desc
  FROM public.sot_materiais m
  JOIN public.sot_lms_linhas l ON l.id = m.lms_linha_id AND l.importacao_id = v_imp.id
  WHERE m.deleted_at IS NULL;

  -- Marca de estrutura aplicada (marcador vinculado a ESTA importação) + evento.
  PERFORM set_config('cena.lms_status_autorizado', v_imp.id::text, true);
  UPDATE public.sot_lms_importacoes
     SET estrutura_aplicada_em = now(), estrutura_aplicada_por_auth = auth.uid()
   WHERE id = v_imp.id;
  PERFORM set_config('cena.lms_status_autorizado', '', true);

  INSERT INTO public.sot_lms_importacao_eventos (importacao_id, tipo_evento, por_auth, por_usuario_id, detalhe)
  VALUES (v_imp.id, 'ESTRUTURA_APLICADA', auth.uid(), v_usuario,
    jsonb_build_object('projeto_id', v_imp.projeto_id, 'hash', v_imp.hash_sha256, 'wls', v_n_wl,
                       'atividades', v_n_ativ, 'materiais_operacionais', v_n_mat_op,
                       'materiais_retirada_descritivos', v_n_mat_desc));

  RETURN jsonb_build_object('operacao', 'ESTRUTURA_APLICADA', 'importacao_id', v_imp.id, 'projeto_id', v_imp.projeto_id,
    'wls', v_n_wl, 'atividades', v_n_ativ, 'materiais_operacionais', v_n_mat_op,
    'materiais_retirada_descritivos', v_n_mat_desc, 'estado_wl', public.sot_lms_estado_wl_calc(v_imp.projeto_id));
END;
$$;

-- ── 8. Grants ────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.sot_wl_proteger() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_protege_linha_estruturada() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_protege_truncate_estruturado() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_protege_projeto_estruturado() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sot_lms_importacoes_proteger() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sot_lms_estado_wl_calc(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_lms_aplicar_estrutura_nova(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_proj_lms_aplicar_estrutura_nova(uuid) TO authenticated;
-- Índices de chave com WL usam as normalizações; o Postgres confere EXECUTE de quem grava sempre que recalcula o índice
-- (atualização não-HOT de linha estruturada). Sem isto, anon (login legado / sessão não restaurada) falharia de forma
-- imprevisível ao lançar campo OPERACIONAL em linha com WL. Funções IMMUTABLE, puras (não leem tabela nenhuma).
GRANT EXECUTE ON FUNCTION public.fn_proj_codigo_norm(text) TO anon;
GRANT EXECUTE ON FUNCTION public.fn_proj_texto_norm(text) TO anon;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Validação
-- SELECT conname FROM pg_constraint WHERE conrelid = 'public.sot_atividades'::regclass AND conname = 'sot_atividades_projeto_codigo_unique';  -- 0 linhas
-- SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'
--   AND indexname IN ('sot_atividades_projeto_codigo_legado_uidx', 'sot_atividades_wl_chave_uidx', 'sot_materiais_wl_chave_uidx',
--                     'sot_atividades_lms_linha_uidx', 'sot_materiais_lms_linha_uidx', 'sot_wl_projeto_codigo_uidx');
-- SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.sot_wl'::regclass;  -- t, t
-- SELECT tgrelid::regclass, tgname FROM pg_trigger WHERE tgname LIKE 'trg_sot_%protege%' OR tgname LIKE 'trg_sot_wl_%';
-- SELECT count(*) FROM public.sot_atividades WHERE wl_id IS NOT NULL OR lms_linha_id IS NOT NULL;  -- 0
-- SELECT count(*) FROM public.sot_materiais WHERE wl_id IS NOT NULL OR lms_linha_id IS NOT NULL;   -- 0
-- SELECT count(*) FROM public.sot_wl;  -- 0

-- Para desfazer — autossuficiente; aborta se já houver estrutura aplicada; recria a regra legada com o nome original.
-- BEGIN;
-- DO $rb$
-- BEGIN
--   IF EXISTS (SELECT 1 FROM public.sot_wl)
--      OR EXISTS (SELECT 1 FROM public.sot_atividades WHERE wl_id IS NOT NULL OR lms_linha_id IS NOT NULL)
--      OR EXISTS (SELECT 1 FROM public.sot_materiais WHERE wl_id IS NOT NULL OR lms_linha_id IS NOT NULL)
--      OR EXISTS (SELECT 1 FROM public.sot_lms_importacoes WHERE estrutura_aplicada_em IS NOT NULL) THEN
--     RAISE EXCEPTION 'ROLLBACK ABORTADO: já existe estrutura de WL aplicada; reverter apagaria a estrutura. Trate manualmente antes.';
--   END IF;
-- END $rb$;
-- DROP FUNCTION IF EXISTS public.fn_proj_lms_aplicar_estrutura_nova(uuid);
-- DROP TRIGGER IF EXISTS trg_sot_projetos_protege_estrutura ON public.sot_projetos;
-- DROP TRIGGER IF EXISTS trg_sot_atividades_protege_estrutura ON public.sot_atividades;
-- DROP TRIGGER IF EXISTS trg_sot_materiais_protege_estrutura ON public.sot_materiais;
-- DROP TRIGGER IF EXISTS trg_sot_atividades_protege_truncate ON public.sot_atividades;
-- DROP TRIGGER IF EXISTS trg_sot_materiais_protege_truncate ON public.sot_materiais;
-- DROP FUNCTION IF EXISTS public.fn_proj_protege_projeto_estruturado();
-- DROP FUNCTION IF EXISTS public.fn_proj_protege_truncate_estruturado();
-- DROP FUNCTION IF EXISTS public.fn_proj_protege_linha_estruturada();
-- DROP INDEX IF EXISTS public.sot_atividades_wl_chave_uidx;
-- DROP INDEX IF EXISTS public.sot_materiais_wl_chave_uidx;
-- DROP INDEX IF EXISTS public.sot_atividades_lms_linha_uidx;
-- DROP INDEX IF EXISTS public.sot_materiais_lms_linha_uidx;
-- DROP INDEX IF EXISTS public.sot_atividades_wl_idx;
-- DROP INDEX IF EXISTS public.sot_materiais_wl_idx;
-- DROP INDEX IF EXISTS public.sot_atividades_projeto_codigo_legado_uidx;
-- ALTER TABLE public.sot_atividades ADD CONSTRAINT sot_atividades_projeto_codigo_unique UNIQUE (projeto_id, codigo);
-- ALTER TABLE public.sot_atividades DROP CONSTRAINT IF EXISTS sot_atividades_wl_chk;
-- ALTER TABLE public.sot_materiais DROP CONSTRAINT IF EXISTS sot_materiais_wl_chk;
-- ALTER TABLE public.sot_atividades DROP CONSTRAINT IF EXISTS sot_atividades_wl_fkey;
-- ALTER TABLE public.sot_atividades DROP CONSTRAINT IF EXISTS sot_atividades_lms_linha_fkey;
-- ALTER TABLE public.sot_materiais DROP CONSTRAINT IF EXISTS sot_materiais_wl_fkey;
-- ALTER TABLE public.sot_materiais DROP CONSTRAINT IF EXISTS sot_materiais_lms_linha_fkey;
-- ALTER TABLE public.sot_atividades DROP COLUMN IF EXISTS kit, DROP COLUMN IF EXISTS ft, DROP COLUMN IF EXISTS ctg,
--   DROP COLUMN IF EXISTS lms_linha_id, DROP COLUMN IF EXISTS wl_id;
-- ALTER TABLE public.sot_materiais DROP COLUMN IF EXISTS kit, DROP COLUMN IF EXISTS ft, DROP COLUMN IF EXISTS ctg,
--   DROP COLUMN IF EXISTS lms_linha_id, DROP COLUMN IF EXISTS wl_id;
-- CREATE OR REPLACE FUNCTION public.sot_lms_estado_wl_calc(p_projeto_id uuid)
-- RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
-- DECLARE v_modo text; v_aplic timestamptz;
-- BEGIN
--   SELECT i.modo, i.conciliacao_aplicada_em INTO v_modo, v_aplic FROM public.sot_lms_importacoes i
--   WHERE i.projeto_id = p_projeto_id AND i.tipo_importacao = 'ORIGINAL' AND i.status = 'CONFIRMADA' LIMIT 1;
--   IF NOT FOUND THEN RETURN 'LEGADO_SEM_WL'; END IF;
--   IF v_modo = 'CONCILIACAO' AND v_aplic IS NULL THEN RETURN 'EM_CONCILIACAO'; END IF;
--   RETURN 'ESTRUTURADO';
-- END; $fn$;
-- REVOKE ALL ON FUNCTION public.sot_lms_estado_wl_calc(uuid) FROM PUBLIC, anon, authenticated, service_role;
-- CREATE OR REPLACE FUNCTION public.sot_lms_importacoes_proteger()
-- RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $fn$
-- DECLARE
--   v_autorizado boolean := coalesce(current_setting('cena.lms_status_autorizado', true), '') = OLD.id::text;
--   v_old_rest jsonb; v_new_rest jsonb; v_mudou_ctrl boolean;
-- BEGIN
--   IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'sot_lms_importacoes: fonte LMS não é apagada' USING ERRCODE = '42501'; END IF;
--   v_old_rest := (to_jsonb(OLD) - 'status' - 'modo' - 'confirmado_por_auth' - 'confirmado_por_usuario_id'
--                   - 'confirmado_em' - 'conciliacao_aplicada_em' - 'conciliacao_aplicada_por_auth');
--   v_new_rest := (to_jsonb(NEW) - 'status' - 'modo' - 'confirmado_por_auth' - 'confirmado_por_usuario_id'
--                   - 'confirmado_em' - 'conciliacao_aplicada_em' - 'conciliacao_aplicada_por_auth');
--   IF v_new_rest IS DISTINCT FROM v_old_rest THEN RAISE EXCEPTION 'sot_lms_importacoes: fonte LMS não é reescrita' USING ERRCODE = '42501'; END IF;
--   v_mudou_ctrl := NEW.status IS DISTINCT FROM OLD.status OR NEW.modo IS DISTINCT FROM OLD.modo
--     OR NEW.confirmado_por_auth IS DISTINCT FROM OLD.confirmado_por_auth
--     OR NEW.confirmado_por_usuario_id IS DISTINCT FROM OLD.confirmado_por_usuario_id
--     OR NEW.confirmado_em IS DISTINCT FROM OLD.confirmado_em
--     OR NEW.conciliacao_aplicada_em IS DISTINCT FROM OLD.conciliacao_aplicada_em
--     OR NEW.conciliacao_aplicada_por_auth IS DISTINCT FROM OLD.conciliacao_aplicada_por_auth;
--   IF v_mudou_ctrl AND NOT v_autorizado THEN RAISE EXCEPTION 'sot_lms_importacoes: confirmação só por função controlada' USING ERRCODE = '42501'; END IF;
--   RETURN NEW;
-- END; $fn$;
-- REVOKE ALL ON FUNCTION public.sot_lms_importacoes_proteger() FROM PUBLIC, anon, authenticated, service_role;
-- ALTER TABLE public.sot_lms_importacao_eventos DROP CONSTRAINT IF EXISTS sot_lms_importacao_eventos_tipo_chk;
-- ALTER TABLE public.sot_lms_importacao_eventos ADD  CONSTRAINT sot_lms_importacao_eventos_tipo_chk
--   CHECK (tipo_evento IN ('CRIADA', 'REENVIO', 'CONFIRMADA'));
-- ALTER TABLE public.sot_lms_importacoes DROP CONSTRAINT IF EXISTS sot_lms_importacoes_estrutura_chk;
-- ALTER TABLE public.sot_lms_importacoes DROP COLUMN IF EXISTS estrutura_aplicada_por_auth, DROP COLUMN IF EXISTS estrutura_aplicada_em;
-- DROP TABLE IF EXISTS public.sot_wl;
-- DROP FUNCTION IF EXISTS public.sot_wl_proteger();
-- REVOKE EXECUTE ON FUNCTION public.fn_proj_codigo_norm(text) FROM anon;
-- REVOKE EXECUTE ON FUNCTION public.fn_proj_texto_norm(text) FROM anon;
-- NOTIFY pgrst, 'reload schema';
-- COMMIT;
