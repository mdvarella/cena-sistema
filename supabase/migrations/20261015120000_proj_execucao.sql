-- ETAPA 1.7a (ENEL/LMS/WL) — Execução por projeto, equipe e data (só banco; interruptor geral DESLIGADO)
-- Base: docs/enel-wl/ETAPA-1.7-EXECUCAO-DIAGNOSTICO.md §10 (D1–D9 aprovadas em 15/10/2026) e plano técnico da 1.7a
-- (A1–A7 aprovadas em 15/10/2026).
--   D1 fonte única: lançamentos individuais (só inclusão; estorno referencia o original). Em atividade estruturada,
--      sot_atividades.qtd_executada vira cópia derivada (soma dos lançamentos), gravada só pela função do banco.
--   D2 atividade estruturada = projeto ESTRUTURADO + wl_id preenchido. Atividade sem WL e projeto legado/em conciliação:
--      nada muda. D3 travas no banco contra os caminhos antigos: criadas aqui, INERTES com o interruptor desligado.
--   D5 várias WLs por equipe/dia; várias equipes por WL; nada é apagado (cancelamento só sem lançamento líquido).
--   D6 retroativo até 7 dias; acima, só gestão (A1: quem tem PROJ_ESTORNAR_EXECUCAO) com justificativa; nunca futuro.
--   D7 PROJ_LANCAR_EXECUCAO e PROJ_ESTORNAR_EXECUCAO (A2). A3 estorno sempre do lançamento inteiro. A4 acima do previsto
--      é permitido e sai marcado como excedente. A5 leitura por funções (sem views). A7 "hoje" = America/Sao_Paulo.
--   Condição 7 (fail-closed): interruptor ausente/inconsistente → trava os caminhos antigos E recusa o novo lançamento
--      para atividade estruturada; legado nunca é afetado.
-- Fora: telas (1.7b/1.7c), ligar o interruptor (1.7d), saldo inicial na conciliação (D9), materiais (1.8),
--      trava de retirar projeto da composição (A6 → 1.7b). fn_proj_lms_aplicar_conciliacao NÃO é alterada.
-- Transação explícita: qualquer falha desfaz a etapa inteira.

BEGIN;

-- ── 0. Pré-condições (falha inteira, nada é aplicado) ────────────────────
DO $$
BEGIN
  IF NOT coalesce((SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user), false) THEN
    RAISE EXCEPTION 'Rode como dono com BYPASSRLS: as funções SECURITY DEFINER leem e gravam tabelas com RLS FORCE';
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'auth.uid() não existe';
  END IF;
  IF to_regprocedure('public.cena_pode(text,uuid)') IS NULL
     OR to_regprocedure('public.cena_prog_pode_programar_projetos()') IS NULL
     OR to_regprocedure('public.cena_usuario_id_sessao()') IS NULL
     OR to_regclass('public.cena_acoes') IS NULL OR to_regclass('public.cena_permissoes_acao') IS NULL THEN
    RAISE EXCEPTION 'aplique antes as migrations de sessão, Programação de Projetos e permissões por ação (Etapa 1.1)';
  END IF;
  IF to_regprocedure('public.sot_lms_estado_wl_calc(uuid)') IS NULL
     OR to_regprocedure('public.sot_projeto_processo_contexto(uuid)') IS NULL
     OR to_regprocedure('public.sot_projeto_processo_contrato_uuid(text)') IS NULL
     OR to_regclass('public.sot_wl') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                    AND table_name = 'sot_atividades' AND column_name = 'wl_id') THEN
    RAISE EXCEPTION 'aplique antes as migrations da Etapa 1.4 (estrutura por WL)';
  END IF;
  IF to_regprocedure('public.fn_proj_lms_aplicar_conciliacao(uuid)') IS NULL THEN
    RAISE EXCEPTION 'aplique antes 20261012200000_proj_lms_conciliacao.sql (Etapa 1.6a)';
  END IF;
  IF to_regclass('public.prog_projetos_agenda') IS NULL THEN
    RAISE EXCEPTION 'public.prog_projetos_agenda não existe (aplique 20261004200000_prog_projetos_agenda.sql)';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'composicao_dia'
      AND column_name IN ('id', 'equipe_id', 'data', 'projeto_ids', 'confirmada', 'deleted_at')) <> 6 THEN
    RAISE EXCEPTION 'composicao_dia sem as colunas id, equipe_id, data, projeto_ids, confirmada, deleted_at';
  END IF;
  IF to_regclass('public.sot_atividades_historico') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                    AND table_name = 'sot_atividades_historico' AND column_name = 'atividade_id') THEN
    RAISE EXCEPTION 'sot_atividades_historico sem a coluna atividade_id';
  END IF;
END $$;

-- ── 1. Permissões (A2) ───────────────────────────────────────────────────
INSERT INTO public.cena_acoes (codigo, modulo, descricao) VALUES
  ('PROJ_LANCAR_EXECUCAO', 'PROJETOS', 'Lançar quantidade executada por execução (projeto estruturado por WL)'),
  ('PROJ_ESTORNAR_EXECUCAO', 'PROJETOS', 'Estornar lançamento de execução e lançar retroativo acima de 7 dias (gestão)')
ON CONFLICT (codigo) DO NOTHING;

DO $$
BEGIN
  INSERT INTO public.cena_permissoes_acao (perfil, acao, contrato_id, permitido, motivo)
  SELECT m.perfil, 'PROJ_LANCAR_EXECUCAO', NULL, TRUE, 'Matriz inicial aprovada pelo gestor — Etapa 1.7a (15/10/2026)'
  FROM unnest(ARRAY['admin', 'coordenador', 'gestor', 'supervisor', 'encarregado']) AS m(perfil)
  WHERE NOT EXISTS (SELECT 1 FROM public.cena_permissoes_acao pa
                    WHERE pa.perfil = m.perfil AND pa.acao = 'PROJ_LANCAR_EXECUCAO' AND pa.contrato_id IS NULL);
  INSERT INTO public.cena_permissoes_acao (perfil, acao, contrato_id, permitido, motivo)
  SELECT m.perfil, 'PROJ_ESTORNAR_EXECUCAO', NULL, TRUE, 'Matriz inicial aprovada pelo gestor — Etapa 1.7a (15/10/2026)'
  FROM unnest(ARRAY['admin', 'coordenador', 'gestor']) AS m(perfil)
  WHERE NOT EXISTS (SELECT 1 FROM public.cena_permissoes_acao pa
                    WHERE pa.perfil = m.perfil AND pa.acao = 'PROJ_ESTORNAR_EXECUCAO' AND pa.contrato_id IS NULL);
END $$;

-- ── 2. Interruptor geral (uma linha; começa DESLIGADO) ───────────────────
-- Ligar é a 1.7d (função própria, com pré-requisitos). Aqui ninguém liga: sem grants e sem função de ativação.
CREATE TABLE IF NOT EXISTS public.proj_execucao_config (
  id                   boolean PRIMARY KEY DEFAULT true,
  ativo                boolean NOT NULL DEFAULT false,
  versao_minima        text,
  atualizado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_por_auth  uuid,
  motivo               text,
  CONSTRAINT proj_execucao_config_uma_linha_chk CHECK (id)
);
INSERT INTO public.proj_execucao_config (id, ativo, versao_minima, motivo)
VALUES (true, false, NULL, 'Criado desligado na Etapa 1.7a')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.proj_execucao_config_eventos (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ativo_anterior    boolean,
  ativo_novo        boolean,
  versao_anterior   text,
  versao_nova       text,
  motivo            text,
  por_auth          uuid,
  em                timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.proj_execucao_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proj_execucao_config FORCE ROW LEVEL SECURITY;
ALTER TABLE public.proj_execucao_config_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proj_execucao_config_eventos FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.proj_execucao_config FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.proj_execucao_config_eventos FROM PUBLIC, anon, authenticated, service_role;

-- Toda mudança do interruptor vira evento; a linha não é apagada; os eventos não mudam.
CREATE OR REPLACE FUNCTION public.proj_execucao_config_proteger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_TABLE_NAME = 'proj_execucao_config_eventos' OR TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION '%: % não permitido (interruptor e histórico são preservados)', TG_TABLE_NAME, TG_OP USING ERRCODE = '42501';
  END IF;
  IF NEW.ativo IS DISTINCT FROM OLD.ativo OR NEW.versao_minima IS DISTINCT FROM OLD.versao_minima THEN
    INSERT INTO public.proj_execucao_config_eventos (ativo_anterior, ativo_novo, versao_anterior, versao_nova, motivo, por_auth)
    VALUES (OLD.ativo, NEW.ativo, OLD.versao_minima, NEW.versao_minima, NEW.motivo, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS proj_execucao_config_proteger_trg ON public.proj_execucao_config;
CREATE TRIGGER proj_execucao_config_proteger_trg BEFORE UPDATE OR DELETE ON public.proj_execucao_config
  FOR EACH ROW EXECUTE FUNCTION public.proj_execucao_config_proteger();
DROP TRIGGER IF EXISTS proj_execucao_config_truncate_trg ON public.proj_execucao_config;
CREATE TRIGGER proj_execucao_config_truncate_trg BEFORE TRUNCATE ON public.proj_execucao_config
  FOR EACH STATEMENT EXECUTE FUNCTION public.proj_execucao_config_proteger();
DROP TRIGGER IF EXISTS proj_execucao_config_eventos_proteger_trg ON public.proj_execucao_config_eventos;
CREATE TRIGGER proj_execucao_config_eventos_proteger_trg BEFORE UPDATE OR DELETE ON public.proj_execucao_config_eventos
  FOR EACH ROW EXECUTE FUNCTION public.proj_execucao_config_proteger();
DROP TRIGGER IF EXISTS proj_execucao_config_eventos_truncate_trg ON public.proj_execucao_config_eventos;
CREATE TRIGGER proj_execucao_config_eventos_truncate_trg BEFORE TRUNCATE ON public.proj_execucao_config_eventos
  FOR EACH STATEMENT EXECUTE FUNCTION public.proj_execucao_config_proteger();

-- Versão 'x.y.z' (só números): cliente >= mínima. Formato inválido → false.
CREATE OR REPLACE FUNCTION public.fn_proj_execucao_versao_ok(p_cliente text, p_minima text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(p_cliente ~ '^\d{1,6}(\.\d{1,6}){0,3}$' AND p_minima ~ '^\d{1,6}(\.\d{1,6}){0,3}$'
    AND string_to_array(p_cliente, '.')::int[] >= string_to_array(p_minima, '.')::int[], false)
$$;

-- ATIVO · INATIVO · INCONSISTENTE (linha ausente, ou ligado sem versão mínima válida). Inconsistente = travado.
CREATE OR REPLACE FUNCTION public.fn_proj_execucao_estado()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n      integer;
  v_ativo  boolean;
  v_versao text;
BEGIN
  SELECT count(*), bool_or(c.ativo), max(c.versao_minima) INTO v_n, v_ativo, v_versao
  FROM public.proj_execucao_config c;
  IF v_n <> 1 OR v_ativo IS NULL THEN
    RETURN 'INCONSISTENTE';
  END IF;
  IF v_ativo THEN
    IF NOT public.fn_proj_execucao_versao_ok(v_versao, v_versao) THEN
      RETURN 'INCONSISTENTE';
    END IF;
    RETURN 'ATIVO';
  END IF;
  RETURN 'INATIVO';
EXCEPTION WHEN OTHERS THEN
  RETURN 'INCONSISTENTE';
END;
$$;

-- Leitura para as telas (inclusive sessão legada/anon: as telas antigas precisam saber se devem travar).
CREATE OR REPLACE FUNCTION public.fn_proj_execucao_interruptor()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_estado text := public.fn_proj_execucao_estado();
  v_versao text;
BEGIN
  SELECT c.versao_minima INTO v_versao FROM public.proj_execucao_config c WHERE c.id;
  RETURN jsonb_build_object('estado', v_estado, 'versao_minima', v_versao);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('estado', 'INCONSISTENTE', 'versao_minima', NULL);
END;
$$;

-- ── 3. Tabelas da execução ───────────────────────────────────────────────
-- Execução = projeto + equipe + dia (composicao_dia). Sem wl_id. Nunca apagada; cancelamento com motivo.
CREATE TABLE IF NOT EXISTS public.prog_proj_execucoes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id            uuid NOT NULL REFERENCES public.sot_projetos(id) ON DELETE RESTRICT,
  composicao_dia_id     uuid NOT NULL,
  equipe_id             text NOT NULL,
  data                  date NOT NULL,
  contrato_id           text,
  agenda_id             uuid REFERENCES public.prog_projetos_agenda(id) ON DELETE RESTRICT,
  orientacao_execucao   text,
  criado_por_auth       uuid NOT NULL,
  criado_por_usuario_id text,
  criado_em             timestamptz NOT NULL DEFAULT now(),
  cancelada_em          timestamptz,
  cancelada_por_auth    uuid,
  motivo_cancelamento   text,
  CONSTRAINT prog_proj_execucoes_cancelamento_chk CHECK (
    (cancelada_em IS NULL AND cancelada_por_auth IS NULL AND motivo_cancelamento IS NULL)
    OR (cancelada_em IS NOT NULL AND cancelada_por_auth IS NOT NULL AND btrim(coalesce(motivo_cancelamento, '')) <> ''))
);
CREATE UNIQUE INDEX IF NOT EXISTS prog_proj_execucoes_ativa_uidx
  ON public.prog_proj_execucoes (composicao_dia_id, projeto_id) WHERE cancelada_em IS NULL;
CREATE INDEX IF NOT EXISTS prog_proj_execucoes_projeto_idx ON public.prog_proj_execucoes (projeto_id);
CREATE INDEX IF NOT EXISTS prog_proj_execucoes_equipe_data_idx ON public.prog_proj_execucoes (equipe_id, data);

-- Item = WL + atividade daquela execução. "WL inteira" vira uma linha por atividade.
CREATE TABLE IF NOT EXISTS public.prog_proj_execucao_itens (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execucao_id           uuid NOT NULL REFERENCES public.prog_proj_execucoes(id) ON DELETE RESTRICT,
  projeto_id            uuid NOT NULL,
  wl_id                 uuid NOT NULL REFERENCES public.sot_wl(id) ON DELETE RESTRICT,
  atividade_id          uuid NOT NULL,
  qtd_programada        numeric(14,3),
  criado_por_auth       uuid NOT NULL,
  criado_em             timestamptz NOT NULL DEFAULT now(),
  cancelado_em          timestamptz,
  cancelado_por_auth    uuid,
  motivo_cancelamento   text,
  CONSTRAINT prog_proj_execucao_itens_qtd_chk CHECK (qtd_programada IS NULL OR qtd_programada >= 0),
  CONSTRAINT prog_proj_execucao_itens_cancelamento_chk CHECK (
    (cancelado_em IS NULL AND cancelado_por_auth IS NULL AND motivo_cancelamento IS NULL)
    OR (cancelado_em IS NOT NULL AND cancelado_por_auth IS NOT NULL AND btrim(coalesce(motivo_cancelamento, '')) <> ''))
);
CREATE UNIQUE INDEX IF NOT EXISTS prog_proj_execucao_itens_ativo_uidx
  ON public.prog_proj_execucao_itens (execucao_id, wl_id, atividade_id) WHERE cancelado_em IS NULL;
CREATE INDEX IF NOT EXISTS prog_proj_execucao_itens_atividade_idx ON public.prog_proj_execucao_itens (atividade_id);

-- Lançamentos: só inclusão. ESTORNO subtrai o lançamento inteiro que referencia (A3). SALDO_INICIAL reservado (D9).
CREATE TABLE IF NOT EXISTS public.prog_proj_execucao_lancamentos (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo                     text NOT NULL,
  item_id                  uuid REFERENCES public.prog_proj_execucao_itens(id) ON DELETE RESTRICT,
  execucao_id              uuid REFERENCES public.prog_proj_execucoes(id) ON DELETE RESTRICT,
  projeto_id               uuid NOT NULL,
  wl_id                    uuid NOT NULL,
  atividade_id             uuid NOT NULL,
  equipe_id                text,
  data_execucao            date NOT NULL,
  qtd                      numeric(14,3) NOT NULL,
  estorna_id               uuid REFERENCES public.prog_proj_execucao_lancamentos(id) ON DELETE RESTRICT,
  motivo                   text,
  justificativa_retroativo text,
  origem                   text NOT NULL,
  versao_cliente           text,
  por_auth                 uuid NOT NULL,
  por_usuario_id           text,
  por_nome                 text,
  registrado_em            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prog_proj_exec_lanc_tipo_chk CHECK (tipo IN ('LANCAMENTO', 'ESTORNO', 'SALDO_INICIAL')),
  CONSTRAINT prog_proj_exec_lanc_origem_chk CHECK (origem IN ('DIARIO', 'SOT', 'SALDO_INICIAL')),
  CONSTRAINT prog_proj_exec_lanc_qtd_chk CHECK (qtd > 0),
  CONSTRAINT prog_proj_exec_lanc_coerencia_chk CHECK (
    (tipo = 'LANCAMENTO' AND item_id IS NOT NULL AND execucao_id IS NOT NULL AND equipe_id IS NOT NULL
       AND estorna_id IS NULL AND origem IN ('DIARIO', 'SOT'))
    OR (tipo = 'ESTORNO' AND estorna_id IS NOT NULL AND btrim(coalesce(motivo, '')) <> '' AND origem IN ('DIARIO', 'SOT'))
    OR (tipo = 'SALDO_INICIAL' AND item_id IS NULL AND execucao_id IS NULL AND estorna_id IS NULL AND origem = 'SALDO_INICIAL'))
);
CREATE UNIQUE INDEX IF NOT EXISTS prog_proj_exec_lanc_estorno_uidx
  ON public.prog_proj_execucao_lancamentos (estorna_id) WHERE estorna_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS prog_proj_exec_lanc_atividade_idx ON public.prog_proj_execucao_lancamentos (atividade_id);
CREATE INDEX IF NOT EXISTS prog_proj_exec_lanc_item_idx ON public.prog_proj_execucao_lancamentos (item_id);
CREATE INDEX IF NOT EXISTS prog_proj_exec_lanc_execucao_idx ON public.prog_proj_execucao_lancamentos (execucao_id);

ALTER TABLE public.prog_proj_execucoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prog_proj_execucoes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.prog_proj_execucao_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prog_proj_execucao_itens FORCE ROW LEVEL SECURITY;
ALTER TABLE public.prog_proj_execucao_lancamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prog_proj_execucao_lancamentos FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.prog_proj_execucoes FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.prog_proj_execucao_itens FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.prog_proj_execucao_lancamentos FROM PUBLIC, anon, authenticated, service_role;

-- Integridade (vale para todos, inclusive dono): nada é apagado; lançamento não muda; em execução/item só mudam
-- os campos de cancelamento, e uma vez só.
CREATE OR REPLACE FUNCTION public.prog_proj_execucao_proteger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cols text[];
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION '%: exclusão não permitida (histórico de execução preservado)', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  IF TG_TABLE_NAME = 'prog_proj_execucao_lancamentos' THEN
    RAISE EXCEPTION 'prog_proj_execucao_lancamentos: lançamento não é alterado; use estorno' USING ERRCODE = '42501';
  END IF;
  IF TG_TABLE_NAME = 'prog_proj_execucoes' THEN
    v_cols := ARRAY['cancelada_em', 'cancelada_por_auth', 'motivo_cancelamento'];
    IF OLD.cancelada_em IS NOT NULL THEN
      RAISE EXCEPTION 'prog_proj_execucoes: execução cancelada não muda' USING ERRCODE = '42501';
    END IF;
  ELSE
    v_cols := ARRAY['cancelado_em', 'cancelado_por_auth', 'motivo_cancelamento'];
    IF OLD.cancelado_em IS NOT NULL THEN
      RAISE EXCEPTION 'prog_proj_execucao_itens: item cancelado não muda' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF (to_jsonb(NEW) - v_cols) IS DISTINCT FROM (to_jsonb(OLD) - v_cols) THEN
    RAISE EXCEPTION '%: só o cancelamento pode ser registrado', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['prog_proj_execucoes', 'prog_proj_execucao_itens', 'prog_proj_execucao_lancamentos'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_proteger_trg', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.prog_proj_execucao_proteger()',
                   t || '_proteger_trg', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_truncate_trg', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.prog_proj_execucao_proteger()',
                   t || '_truncate_trg', t);
  END LOOP;
END $$;

-- ── 4. Regras internas ───────────────────────────────────────────────────
-- Contrato do projeto em uuid (mesma regra da 1.1–1.6): texto que não é contratos.id → erro (nunca cai na regra global).
CREATE OR REPLACE FUNCTION public.fn_proj_execucao_contrato(p_projeto_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_excluido boolean;
  v_contrato text;
  v_ctr      uuid;
BEGIN
  SELECT c.o_excluido, c.o_contrato INTO v_excluido, v_contrato FROM public.sot_projeto_processo_contexto(p_projeto_id) c;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROJETO_INEXISTENTE: projeto não encontrado' USING ERRCODE = 'P0001';
  END IF;
  IF v_excluido THEN
    RAISE EXCEPTION 'PROJETO_EXCLUIDO: projeto excluído' USING ERRCODE = 'P0001';
  END IF;
  IF v_contrato IS NULL THEN
    RETURN NULL;
  END IF;
  v_ctr := public.sot_projeto_processo_contrato_uuid(v_contrato);
  IF v_ctr IS NULL THEN
    RAISE EXCEPTION 'CONTRATO_NAO_IDENTIFICADO: contrato do projeto não identificado' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_ctr;
END;
$$;

-- Projeto incluído em composicao_dia.projeto_ids (texto JSON). Texto inválido → não incluído.
CREATE OR REPLACE FUNCTION public.fn_proj_execucao_projeto_na_composicao(p_projeto_ids text, p_projeto_id uuid)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_projeto_ids IS NULL OR btrim(p_projeto_ids) = '' THEN
    RETURN false;
  END IF;
  RETURN EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_projeto_ids::jsonb) x WHERE x = p_projeto_id::text);
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

-- Atividade estruturada (D2): viva, com WL, em projeto ESTRUTURADO.
CREATE OR REPLACE FUNCTION public.fn_proj_execucao_atividade_estruturada(p_atividade_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce((SELECT a.wl_id IS NOT NULL AND a.deleted_at IS NULL
                          AND public.sot_lms_estado_wl_calc(a.projeto_id) = 'ESTRUTURADO'
                   FROM public.sot_atividades a WHERE a.id = p_atividade_id), false)
$$;

-- Soma oficial (D1) e cópia derivada em sot_atividades.qtd_executada. Chamada só de dentro das funções DEFINER.
CREATE OR REPLACE FUNCTION public.fn_proj_execucao_recalcular(p_atividade_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_soma numeric;
BEGIN
  SELECT coalesce(sum(CASE WHEN l.tipo = 'ESTORNO' THEN -l.qtd ELSE l.qtd END), 0) INTO v_soma
  FROM public.prog_proj_execucao_lancamentos l WHERE l.atividade_id = p_atividade_id;
  UPDATE public.sot_atividades SET qtd_executada = v_soma WHERE id = p_atividade_id;
  RETURN v_soma;
END;
$$;

-- Saldo líquido de um item ou de uma execução.
CREATE OR REPLACE FUNCTION public.fn_proj_execucao_liquido(p_item_id uuid, p_execucao_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(sum(CASE WHEN l.tipo = 'ESTORNO' THEN -l.qtd ELSE l.qtd END), 0)
  FROM public.prog_proj_execucao_lancamentos l
  WHERE (p_item_id IS NOT NULL AND l.item_id = p_item_id)
     OR (p_item_id IS NULL AND l.execucao_id = p_execucao_id)
$$;

-- ── 5. Travas contra os caminhos antigos (D3) — INERTES com o interruptor desligado ──
-- Decide se a escrita da tela deve ser recusada: só atividade estruturada e só com interruptor ATIVO ou INCONSISTENTE.
-- Atividade legada nunca é afetada, nem com interruptor ausente (a atividade é olhada antes do interruptor).
-- DEFINER (as telas não leem sot_lms_importacoes); EXECUTE para anon e authenticated porque é chamada pelos gatilhos
-- no contexto de quem grava. Devolve só true/false.
CREATE OR REPLACE FUNCTION public.fn_proj_execucao_trava_atividade(p_atividade_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wl   uuid;
  v_proj uuid;
BEGIN
  SELECT a.wl_id, a.projeto_id INTO v_wl, v_proj FROM public.sot_atividades a WHERE a.id = p_atividade_id;
  IF NOT FOUND OR v_wl IS NULL THEN
    RETURN false;
  END IF;
  IF public.sot_lms_estado_wl_calc(v_proj) <> 'ESTRUTURADO' THEN
    RETURN false;
  END IF;
  RETURN public.fn_proj_execucao_estado() <> 'INATIVO';
END;
$$;

-- SECURITY INVOKER: age só quando quem grava é anon/authenticated (telas). Dentro das funções DEFINER desta etapa o
-- current_user é o dono e a gravação passa (mesmo padrão da proteção estrutural da 1.4). Regravar o mesmo valor passa.
CREATE OR REPLACE FUNCTION public.fn_proj_execucao_protege_executado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'sot_atividades' THEN
    IF NEW.qtd_executada IS NOT DISTINCT FROM OLD.qtd_executada OR OLD.wl_id IS NULL THEN
      RETURN NEW;
    END IF;
    IF public.fn_proj_execucao_trava_atividade(OLD.id) THEN
      RAISE EXCEPTION 'sot_atividades: executado de atividade estruturada só pelo lançamento por execução (EXECUTADO_SO_POR_LANCAMENTO)'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  -- sot_atividades_historico
  IF NEW.atividade_id IS NOT NULL AND public.fn_proj_execucao_trava_atividade(NEW.atividade_id) THEN
    RAISE EXCEPTION 'sot_atividades_historico: histórico de atividade estruturada vem dos lançamentos (EXECUTADO_SO_POR_LANCAMENTO)'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS proj_execucao_protege_executado_trg ON public.sot_atividades;
CREATE TRIGGER proj_execucao_protege_executado_trg BEFORE UPDATE OF qtd_executada ON public.sot_atividades
  FOR EACH ROW EXECUTE FUNCTION public.fn_proj_execucao_protege_executado();
DROP TRIGGER IF EXISTS proj_execucao_protege_historico_trg ON public.sot_atividades_historico;
CREATE TRIGGER proj_execucao_protege_historico_trg BEFORE INSERT ON public.sot_atividades_historico
  FOR EACH ROW EXECUTE FUNCTION public.fn_proj_execucao_protege_executado();

-- ── 6. Programação (execução e itens) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_proj_execucao_criar(p_composicao_dia_id uuid, p_projeto_id uuid,
  p_agenda_id uuid DEFAULT NULL, p_orientacao text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_comp    record;
  v_estado  text;
  v_ctr     text;
  v_id      uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'SEM_SESSAO: entre pelo login autenticado' USING ERRCODE = '42501';
  END IF;
  IF NOT public.cena_prog_pode_programar_projetos() THEN
    RAISE EXCEPTION 'SEM_PERMISSAO: sem permissão para programar projetos' USING ERRCODE = '42501';
  END IF;
  IF p_composicao_dia_id IS NULL OR p_projeto_id IS NULL THEN
    RAISE EXCEPTION 'PARAMETRO_OBRIGATORIO: composição e projeto são obrigatórios' USING ERRCODE = 'P0001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('prog_proj_execucao|' || p_composicao_dia_id || '|' || p_projeto_id, 0));

  SELECT c.id, c.equipe_id, c.data, c.projeto_ids, c.deleted_at INTO v_comp
  FROM public.composicao_dia c WHERE c.id = p_composicao_dia_id FOR SHARE;
  IF NOT FOUND OR v_comp.deleted_at IS NOT NULL OR v_comp.equipe_id IS NULL OR v_comp.data IS NULL THEN
    RAISE EXCEPTION 'COMPOSICAO_INEXISTENTE: equipe/dia não encontrado ou excluído' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.fn_proj_execucao_projeto_na_composicao(v_comp.projeto_ids, p_projeto_id) THEN
    RAISE EXCEPTION 'PROJETO_FORA_DA_COMPOSICAO: o projeto não está programado nesta equipe/dia' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.fn_proj_execucao_contrato(p_projeto_id);
  v_estado := public.sot_lms_estado_wl_calc(p_projeto_id);
  IF v_estado <> 'ESTRUTURADO' THEN
    RAISE EXCEPTION 'PROJETO_NAO_ESTRUTURADO: execução por WL só em projeto estruturado (estado %)', v_estado USING ERRCODE = 'P0001';
  END IF;
  IF p_agenda_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.prog_projetos_agenda g
       WHERE g.id = p_agenda_id AND g.projeto_id = p_projeto_id AND g.data = v_comp.data
         AND g.deleted_at IS NULL AND g.status <> 'CANCELADO') THEN
    RAISE EXCEPTION 'AGENDA_INVALIDA: agenda de outro projeto, outra data ou cancelada' USING ERRCODE = 'P0001';
  END IF;

  SELECT e.id INTO v_id FROM public.prog_proj_execucoes e
  WHERE e.composicao_dia_id = p_composicao_dia_id AND e.projeto_id = p_projeto_id AND e.cancelada_em IS NULL;
  IF FOUND THEN
    RETURN jsonb_build_object('operacao', 'EXISTENTE', 'execucao_id', v_id);
  END IF;

  SELECT p.contrato_id INTO v_ctr FROM public.sot_projetos p WHERE p.id = p_projeto_id;
  INSERT INTO public.prog_proj_execucoes (projeto_id, composicao_dia_id, equipe_id, data, contrato_id, agenda_id,
    orientacao_execucao, criado_por_auth, criado_por_usuario_id)
  VALUES (p_projeto_id, p_composicao_dia_id, v_comp.equipe_id, v_comp.data, v_ctr, p_agenda_id,
    nullif(btrim(coalesce(p_orientacao, '')), ''), auth.uid(), public.cena_usuario_id_sessao()::text)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('operacao', 'CRIADA', 'execucao_id', v_id);
END;
$$;

-- p_itens: [{"wl_id": uuid, "atividade_id": uuid|null, "qtd_programada": número|null}]. atividade_id null = WL inteira
-- (expande por atividade viva e não descritiva; sem meta). Só acrescenta; item já ativo fica como está.
CREATE OR REPLACE FUNCTION public.fn_proj_execucao_definir_itens(p_execucao_id uuid, p_itens jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_exec      public.prog_proj_execucoes%ROWTYPE;
  v_el        jsonb;
  v_wl        uuid;
  v_ativ      uuid;
  v_qtd       numeric;
  v_alvo      jsonb := '[]'::jsonb;
  v_par       jsonb;
  v_id        uuid;
  v_incluidos integer := 0;
  v_existiam  integer := 0;
  v_ids       uuid[] := ARRAY[]::uuid[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'SEM_SESSAO: entre pelo login autenticado' USING ERRCODE = '42501';
  END IF;
  IF NOT public.cena_prog_pode_programar_projetos() THEN
    RAISE EXCEPTION 'SEM_PERMISSAO: sem permissão para programar projetos' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_exec FROM public.prog_proj_execucoes WHERE id = p_execucao_id FOR UPDATE;
  IF NOT FOUND OR v_exec.cancelada_em IS NOT NULL THEN
    RAISE EXCEPTION 'EXECUCAO_INVALIDA: execução não encontrada ou cancelada' USING ERRCODE = 'P0001';
  END IF;
  IF public.sot_lms_estado_wl_calc(v_exec.projeto_id) <> 'ESTRUTURADO' THEN
    RAISE EXCEPTION 'PROJETO_NAO_ESTRUTURADO: projeto deixou de estar estruturado' USING ERRCODE = 'P0001';
  END IF;
  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'ITENS_VAZIOS: informe ao menos uma WL ou atividade' USING ERRCODE = 'P0001';
  END IF;

  -- 1) Valida tudo e monta a lista final (WL inteira expandida).
  FOR v_el IN SELECT x FROM jsonb_array_elements(p_itens) x LOOP
    BEGIN
      v_wl := nullif(v_el->>'wl_id', '')::uuid;
      v_ativ := nullif(v_el->>'atividade_id', '')::uuid;
      v_qtd := nullif(v_el->>'qtd_programada', '')::numeric;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'ITEM_INVALIDO: item mal formado (%)', v_el::text USING ERRCODE = 'P0001';
    END;
    IF v_wl IS NULL OR NOT EXISTS (SELECT 1 FROM public.sot_wl w WHERE w.id = v_wl AND w.projeto_id = v_exec.projeto_id
                                     AND w.cancelada_em IS NULL) THEN
      RAISE EXCEPTION 'WL_INVALIDA: WL não pertence ao projeto ou está cancelada' USING ERRCODE = 'P0001';
    END IF;
    IF v_qtd IS NOT NULL AND (v_qtd < 0 OR v_qtd <> round(v_qtd, 3)) THEN
      RAISE EXCEPTION 'QTD_INVALIDA: meta do dia deve ser zero ou positiva (até 3 casas)' USING ERRCODE = 'P0001';
    END IF;
    IF v_ativ IS NULL THEN
      IF v_qtd IS NOT NULL THEN
        RAISE EXCEPTION 'QTD_WL_INTEIRA: meta só por atividade, não para a WL inteira' USING ERRCODE = 'P0001';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.sot_atividades a WHERE a.wl_id = v_wl AND a.projeto_id = v_exec.projeto_id
                       AND a.deleted_at IS NULL AND NOT a.somente_descritivo) THEN
        RAISE EXCEPTION 'WL_SEM_ATIVIDADES: a WL não tem atividade a executar' USING ERRCODE = 'P0001';
      END IF;
      SELECT v_alvo || coalesce(jsonb_agg(jsonb_build_object('wl', v_wl, 'a', a.id, 'q', NULL) ORDER BY a.ordem_exec, a.id), '[]'::jsonb)
        INTO v_alvo
      FROM public.sot_atividades a
      WHERE a.wl_id = v_wl AND a.projeto_id = v_exec.projeto_id AND a.deleted_at IS NULL AND NOT a.somente_descritivo;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM public.sot_atividades a WHERE a.id = v_ativ AND a.projeto_id = v_exec.projeto_id
                       AND a.wl_id = v_wl AND a.deleted_at IS NULL AND NOT a.somente_descritivo) THEN
        RAISE EXCEPTION 'ATIVIDADE_INVALIDA: atividade não é do projeto, não é desta WL, está excluída ou é só descritiva'
          USING ERRCODE = 'P0001';
      END IF;
      v_alvo := v_alvo || jsonb_build_array(jsonb_build_object('wl', v_wl, 'a', v_ativ, 'q', v_qtd));
    END IF;
  END LOOP;

  -- 2) Grava (ignora repetidos e os que já estão ativos).
  FOR v_par IN SELECT x FROM jsonb_array_elements(v_alvo) x LOOP
    SELECT i.id INTO v_id FROM public.prog_proj_execucao_itens i
    WHERE i.execucao_id = v_exec.id AND i.wl_id = (v_par->>'wl')::uuid AND i.atividade_id = (v_par->>'a')::uuid
      AND i.cancelado_em IS NULL;
    IF FOUND THEN
      IF NOT (v_id = ANY (v_ids)) THEN
        v_existiam := v_existiam + 1;
      END IF;
      CONTINUE;
    END IF;
    INSERT INTO public.prog_proj_execucao_itens (execucao_id, projeto_id, wl_id, atividade_id, qtd_programada, criado_por_auth)
    VALUES (v_exec.id, v_exec.projeto_id, (v_par->>'wl')::uuid, (v_par->>'a')::uuid, (v_par->>'q')::numeric, auth.uid())
    RETURNING id INTO v_id;
    v_ids := v_ids || v_id;
    v_incluidos := v_incluidos + 1;
  END LOOP;
  RETURN jsonb_build_object('operacao', 'ITENS_DEFINIDOS', 'execucao_id', v_exec.id, 'incluidos', v_incluidos,
    'ja_existentes', v_existiam, 'itens', to_jsonb(v_ids));
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_proj_execucao_cancelar_item(p_item_id uuid, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item public.prog_proj_execucao_itens%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'SEM_SESSAO: entre pelo login autenticado' USING ERRCODE = '42501';
  END IF;
  IF NOT public.cena_prog_pode_programar_projetos() THEN
    RAISE EXCEPTION 'SEM_PERMISSAO: sem permissão para programar projetos' USING ERRCODE = '42501';
  END IF;
  IF btrim(coalesce(p_motivo, '')) = '' THEN
    RAISE EXCEPTION 'MOTIVO_OBRIGATORIO: informe o motivo do cancelamento' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_item FROM public.prog_proj_execucao_itens WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITEM_INVALIDO: item não encontrado' USING ERRCODE = 'P0001';
  END IF;
  IF v_item.cancelado_em IS NOT NULL THEN
    RAISE EXCEPTION 'ITEM_JA_CANCELADO: item já cancelado' USING ERRCODE = 'P0001';
  END IF;
  IF public.fn_proj_execucao_liquido(v_item.id, NULL) <> 0 THEN
    RAISE EXCEPTION 'ITEM_COM_LANCAMENTO: há quantidade lançada; estorne antes de cancelar' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.prog_proj_execucao_itens
     SET cancelado_em = now(), cancelado_por_auth = auth.uid(), motivo_cancelamento = btrim(p_motivo)
   WHERE id = v_item.id;
  RETURN jsonb_build_object('operacao', 'ITEM_CANCELADO', 'item_id', v_item.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_proj_execucao_cancelar(p_execucao_id uuid, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_exec public.prog_proj_execucoes%ROWTYPE;
  v_n    integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'SEM_SESSAO: entre pelo login autenticado' USING ERRCODE = '42501';
  END IF;
  IF NOT public.cena_prog_pode_programar_projetos() THEN
    RAISE EXCEPTION 'SEM_PERMISSAO: sem permissão para programar projetos' USING ERRCODE = '42501';
  END IF;
  IF btrim(coalesce(p_motivo, '')) = '' THEN
    RAISE EXCEPTION 'MOTIVO_OBRIGATORIO: informe o motivo do cancelamento' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_exec FROM public.prog_proj_execucoes WHERE id = p_execucao_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXECUCAO_INVALIDA: execução não encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_exec.cancelada_em IS NOT NULL THEN
    RAISE EXCEPTION 'EXECUCAO_JA_CANCELADA: execução já cancelada' USING ERRCODE = 'P0001';
  END IF;
  IF public.fn_proj_execucao_liquido(NULL, v_exec.id) <> 0 THEN
    RAISE EXCEPTION 'EXECUCAO_COM_LANCAMENTO: há quantidade lançada; estorne antes de cancelar' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.prog_proj_execucao_itens
     SET cancelado_em = now(), cancelado_por_auth = auth.uid(), motivo_cancelamento = btrim(p_motivo)
   WHERE execucao_id = v_exec.id AND cancelado_em IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.prog_proj_execucoes
     SET cancelada_em = now(), cancelada_por_auth = auth.uid(), motivo_cancelamento = btrim(p_motivo)
   WHERE id = v_exec.id;
  RETURN jsonb_build_object('operacao', 'EXECUCAO_CANCELADA', 'execucao_id', v_exec.id, 'itens_cancelados', v_n);
END;
$$;

-- ── 7. Lançamento e estorno (só com interruptor ATIVO) ───────────────────
-- A data de execução é o dia da execução (equipe/dia). D6: nunca futuro; até 7 dias atrás; acima, gestão + justificativa.
CREATE OR REPLACE FUNCTION public.fn_proj_execucao_lancar(p_item_id uuid, p_qtd numeric, p_origem text,
  p_justificativa text DEFAULT NULL, p_versao_cliente text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item    public.prog_proj_execucao_itens%ROWTYPE;
  v_exec    public.prog_proj_execucoes%ROWTYPE;
  v_comp    record;
  v_ctr     uuid;
  v_minima  text;
  v_hoje    date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_retro   boolean;
  v_ativ    record;
  v_id      uuid;
  v_soma    numeric;
  v_nome    text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'SEM_SESSAO: entre pelo login autenticado' USING ERRCODE = '42501';
  END IF;
  IF public.fn_proj_execucao_estado() <> 'ATIVO' THEN
    RAISE EXCEPTION 'EXECUCAO_DESLIGADA: lançamento por execução ainda não está ativo' USING ERRCODE = 'P0001';
  END IF;
  SELECT c.versao_minima INTO v_minima FROM public.proj_execucao_config c WHERE c.id;
  IF NOT public.fn_proj_execucao_versao_ok(p_versao_cliente, v_minima) THEN
    RAISE EXCEPTION 'VERSAO_DESATUALIZADA: atualize o sistema (mínima %)', v_minima USING ERRCODE = 'P0001';
  END IF;
  IF p_origem IS NULL OR p_origem NOT IN ('DIARIO', 'SOT') THEN
    RAISE EXCEPTION 'ORIGEM_INVALIDA: origem deve ser DIARIO ou SOT' USING ERRCODE = 'P0001';
  END IF;
  IF p_qtd IS NULL OR p_qtd <= 0 OR p_qtd <> round(p_qtd, 3) THEN
    RAISE EXCEPTION 'QTD_INVALIDA: quantidade deve ser positiva (até 3 casas)' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_item FROM public.prog_proj_execucao_itens WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND OR v_item.cancelado_em IS NOT NULL THEN
    RAISE EXCEPTION 'ITEM_INVALIDO: item não encontrado ou cancelado' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_exec FROM public.prog_proj_execucoes WHERE id = v_item.execucao_id FOR SHARE;
  IF v_exec.cancelada_em IS NOT NULL THEN
    RAISE EXCEPTION 'ITEM_INVALIDO: execução cancelada' USING ERRCODE = 'P0001';
  END IF;
  v_ctr := public.fn_proj_execucao_contrato(v_exec.projeto_id);
  IF NOT coalesce(public.cena_pode('PROJ_LANCAR_EXECUCAO', v_ctr), false) THEN
    RAISE EXCEPTION 'SEM_PERMISSAO: sem permissão para lançar execução' USING ERRCODE = '42501';
  END IF;

  SELECT c.confirmada, c.deleted_at, c.projeto_ids INTO v_comp FROM public.composicao_dia c WHERE c.id = v_exec.composicao_dia_id;
  IF NOT FOUND OR v_comp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'COMPOSICAO_INEXISTENTE: equipe/dia não encontrado ou excluído' USING ERRCODE = 'P0001';
  END IF;
  IF v_comp.confirmada IS NOT TRUE THEN
    RAISE EXCEPTION 'COMPOSICAO_NAO_CONFIRMADA: confirme a equipe do dia antes de lançar' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.fn_proj_execucao_projeto_na_composicao(v_comp.projeto_ids, v_exec.projeto_id) THEN
    RAISE EXCEPTION 'PROJETO_FORA_DA_COMPOSICAO: o projeto saiu desta equipe/dia' USING ERRCODE = 'P0001';
  END IF;

  IF v_exec.data > v_hoje THEN
    RAISE EXCEPTION 'DATA_FUTURA: não se lança execução de dia futuro' USING ERRCODE = 'P0001';
  END IF;
  v_retro := v_exec.data < v_hoje - 7;
  IF v_retro THEN
    IF NOT coalesce(public.cena_pode('PROJ_ESTORNAR_EXECUCAO', v_ctr), false) THEN
      RAISE EXCEPTION 'RETROATIVO_EXIGE_GESTAO: mais de 7 dias atrás só a gestão lança' USING ERRCODE = '42501';
    END IF;
    IF btrim(coalesce(p_justificativa, '')) = '' THEN
      RAISE EXCEPTION 'JUSTIFICATIVA_OBRIGATORIA: informe a justificativa do lançamento retroativo' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT a.id, a.wl_id, a.qtd_prevista INTO v_ativ FROM public.sot_atividades a WHERE a.id = v_item.atividade_id FOR UPDATE;
  IF NOT FOUND OR v_ativ.wl_id IS DISTINCT FROM v_item.wl_id
     OR NOT public.fn_proj_execucao_atividade_estruturada(v_item.atividade_id) THEN
    RAISE EXCEPTION 'ATIVIDADE_NAO_ESTRUTURADA: atividade excluída, mudou de WL ou projeto não estruturado' USING ERRCODE = 'P0001';
  END IF;

  SELECT us.nome INTO v_nome FROM public.usuarios_sistema us WHERE us.id = public.cena_usuario_id_sessao();
  INSERT INTO public.prog_proj_execucao_lancamentos (tipo, item_id, execucao_id, projeto_id, wl_id, atividade_id, equipe_id,
    data_execucao, qtd, justificativa_retroativo, origem, versao_cliente, por_auth, por_usuario_id, por_nome)
  VALUES ('LANCAMENTO', v_item.id, v_exec.id, v_exec.projeto_id, v_item.wl_id, v_item.atividade_id, v_exec.equipe_id,
    v_exec.data, p_qtd, CASE WHEN v_retro THEN btrim(p_justificativa) END, p_origem, p_versao_cliente, auth.uid(),
    public.cena_usuario_id_sessao()::text, v_nome)
  RETURNING id INTO v_id;
  v_soma := public.fn_proj_execucao_recalcular(v_item.atividade_id);
  RETURN jsonb_build_object('operacao', 'LANCADO', 'lancamento_id', v_id, 'atividade_id', v_item.atividade_id,
    'qtd_executada', v_soma, 'qtd_prevista', v_ativ.qtd_prevista,
    'excedente', v_soma > coalesce(v_ativ.qtd_prevista, 0), 'retroativo', v_retro);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_proj_execucao_estornar(p_lancamento_id uuid, p_motivo text, p_origem text,
  p_versao_cliente text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_l      public.prog_proj_execucao_lancamentos%ROWTYPE;
  v_ctr    uuid;
  v_minima text;
  v_id     uuid;
  v_soma   numeric;
  v_nome   text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'SEM_SESSAO: entre pelo login autenticado' USING ERRCODE = '42501';
  END IF;
  IF public.fn_proj_execucao_estado() <> 'ATIVO' THEN
    RAISE EXCEPTION 'EXECUCAO_DESLIGADA: lançamento por execução ainda não está ativo' USING ERRCODE = 'P0001';
  END IF;
  SELECT c.versao_minima INTO v_minima FROM public.proj_execucao_config c WHERE c.id;
  IF NOT public.fn_proj_execucao_versao_ok(p_versao_cliente, v_minima) THEN
    RAISE EXCEPTION 'VERSAO_DESATUALIZADA: atualize o sistema (mínima %)', v_minima USING ERRCODE = 'P0001';
  END IF;
  IF p_origem IS NULL OR p_origem NOT IN ('DIARIO', 'SOT') THEN
    RAISE EXCEPTION 'ORIGEM_INVALIDA: origem deve ser DIARIO ou SOT' USING ERRCODE = 'P0001';
  END IF;
  IF btrim(coalesce(p_motivo, '')) = '' THEN
    RAISE EXCEPTION 'MOTIVO_OBRIGATORIO: informe o motivo do estorno' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_l FROM public.prog_proj_execucao_lancamentos WHERE id = p_lancamento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'LANCAMENTO_INVALIDO: lançamento não encontrado' USING ERRCODE = 'P0001';
  END IF;
  IF v_l.tipo = 'ESTORNO' THEN
    RAISE EXCEPTION 'ESTORNO_DE_ESTORNO: estorno não é estornado; faça novo lançamento' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.prog_proj_execucao_lancamentos e WHERE e.estorna_id = v_l.id) THEN
    RAISE EXCEPTION 'JA_ESTORNADO: lançamento já estornado' USING ERRCODE = 'P0001';
  END IF;
  v_ctr := public.fn_proj_execucao_contrato(v_l.projeto_id);
  IF NOT coalesce(public.cena_pode('PROJ_ESTORNAR_EXECUCAO', v_ctr), false) THEN
    RAISE EXCEPTION 'SEM_PERMISSAO: sem permissão para estornar execução' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.sot_atividades a WHERE a.id = v_l.atividade_id FOR UPDATE;

  SELECT us.nome INTO v_nome FROM public.usuarios_sistema us WHERE us.id = public.cena_usuario_id_sessao();
  INSERT INTO public.prog_proj_execucao_lancamentos (tipo, item_id, execucao_id, projeto_id, wl_id, atividade_id, equipe_id,
    data_execucao, qtd, estorna_id, motivo, origem, versao_cliente, por_auth, por_usuario_id, por_nome)
  VALUES ('ESTORNO', v_l.item_id, v_l.execucao_id, v_l.projeto_id, v_l.wl_id, v_l.atividade_id, v_l.equipe_id,
    v_l.data_execucao, v_l.qtd, v_l.id, btrim(p_motivo), p_origem, p_versao_cliente, auth.uid(),
    public.cena_usuario_id_sessao()::text, v_nome)
  RETURNING id INTO v_id;
  v_soma := public.fn_proj_execucao_recalcular(v_l.atividade_id);
  RETURN jsonb_build_object('operacao', 'ESTORNADO', 'estorno_id', v_id, 'lancamento_id', v_l.id,
    'atividade_id', v_l.atividade_id, 'qtd_executada', v_soma);
END;
$$;

-- ── 8. Conferência (usada pela ativação na 1.7d; interna) ────────────────
-- Atividades estruturadas cujo executado é diferente da soma dos lançamentos.
CREATE OR REPLACE FUNCTION public.fn_proj_execucao_consistencia()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('atividade_id', x.id, 'projeto_id', x.projeto_id,
           'qtd_executada', x.qtd_executada, 'soma_lancamentos', x.soma) ORDER BY x.projeto_id, x.id), '[]'::jsonb)
  FROM (
    SELECT a.id, a.projeto_id, coalesce(a.qtd_executada, 0) AS qtd_executada,
           coalesce((SELECT sum(CASE WHEN l.tipo = 'ESTORNO' THEN -l.qtd ELSE l.qtd END)
                     FROM public.prog_proj_execucao_lancamentos l WHERE l.atividade_id = a.id), 0) AS soma
    FROM public.sot_atividades a
    WHERE a.wl_id IS NOT NULL AND a.deleted_at IS NULL
      AND public.sot_lms_estado_wl_calc(a.projeto_id) = 'ESTRUTURADO'
  ) x
  WHERE x.qtd_executada <> x.soma
$$;

-- ── 9. Leitura (A5: funções; sem views) ──────────────────────────────────
-- Quem lê: quem programa projetos, ou quem pode lançar/estornar no contrato do projeto.
CREATE OR REPLACE FUNCTION public.fn_proj_execucao_pode_ler(p_projeto_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ctr uuid;
BEGIN
  IF public.cena_prog_pode_programar_projetos() THEN
    RETURN true;
  END IF;
  BEGIN
    v_ctr := public.fn_proj_execucao_contrato(p_projeto_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;
  RETURN coalesce(public.cena_pode('PROJ_LANCAR_EXECUCAO', v_ctr), false)
      OR coalesce(public.cena_pode('PROJ_ESTORNAR_EXECUCAO', v_ctr), false);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_proj_saldo_atividades(p_projeto_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_estado text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'SEM_SESSAO: entre pelo login autenticado' USING ERRCODE = '42501';
  END IF;
  IF NOT public.fn_proj_execucao_pode_ler(p_projeto_id) THEN
    RAISE EXCEPTION 'SEM_PERMISSAO: sem permissão para ver a execução deste projeto' USING ERRCODE = '42501';
  END IF;
  v_estado := public.sot_lms_estado_wl_calc(p_projeto_id);
  RETURN jsonb_build_object('projeto_id', p_projeto_id, 'estado_wl', v_estado, 'atividades', coalesce((
    SELECT jsonb_agg(jsonb_build_object('atividade_id', a.id, 'wl_id', a.wl_id, 'wl_codigo', w.codigo, 'codigo', a.codigo,
             'descricao', a.descricao, 'unidade', a.unidade, 'qtd_prevista', a.qtd_prevista, 'qtd_executada', s.soma,
             'saldo', coalesce(a.qtd_prevista, 0) - s.soma, 'excedente', s.soma > coalesce(a.qtd_prevista, 0),
             'campo_diverge', coalesce(a.qtd_executada, 0) <> s.soma)
           ORDER BY w.ordem, a.ordem_exec, a.codigo, a.id)
    FROM public.sot_atividades a
    JOIN public.sot_wl w ON w.id = a.wl_id
    CROSS JOIN LATERAL (SELECT coalesce(sum(CASE WHEN l.tipo = 'ESTORNO' THEN -l.qtd ELSE l.qtd END), 0) AS soma
                        FROM public.prog_proj_execucao_lancamentos l WHERE l.atividade_id = a.id) s
    WHERE a.projeto_id = p_projeto_id AND a.deleted_at IS NULL AND NOT a.somente_descritivo
      AND v_estado = 'ESTRUTURADO'), '[]'::jsonb));
END;
$$;

-- Por projeto, ou por equipe + data. Situação calculada (sem coluna): CANCELADA · PROGRAMADA (sem lançamento líquido) ·
-- CONCLUIDA (todo item ativo tem meta e atingiu) · EM_EXECUCAO.
CREATE OR REPLACE FUNCTION public.fn_proj_execucao_situacao(p_projeto_id uuid DEFAULT NULL, p_equipe_id text DEFAULT NULL,
  p_data date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'SEM_SESSAO: entre pelo login autenticado' USING ERRCODE = '42501';
  END IF;
  IF p_projeto_id IS NULL AND (p_equipe_id IS NULL OR p_data IS NULL) THEN
    RAISE EXCEPTION 'PARAMETRO_OBRIGATORIO: informe o projeto, ou a equipe e a data' USING ERRCODE = 'P0001';
  END IF;
  IF p_projeto_id IS NOT NULL AND NOT public.fn_proj_execucao_pode_ler(p_projeto_id) THEN
    RAISE EXCEPTION 'SEM_PERMISSAO: sem permissão para ver a execução deste projeto' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('execucao_id', e.id, 'projeto_id', e.projeto_id, 'equipe_id', e.equipe_id,
             'data', e.data, 'composicao_dia_id', e.composicao_dia_id, 'orientacao_execucao', e.orientacao_execucao,
             'situacao', CASE
               WHEN e.cancelada_em IS NOT NULL THEN 'CANCELADA'
               WHEN coalesce(t.lancado, 0) = 0 THEN 'PROGRAMADA'
               WHEN t.ativos > 0 AND t.ativos = t.concluidos THEN 'CONCLUIDA'
               ELSE 'EM_EXECUCAO' END,
             'itens', coalesce(t.itens, '[]'::jsonb))
           ORDER BY e.data, e.equipe_id, e.criado_em)
    FROM public.prog_proj_execucoes e
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE i.cancelado_em IS NULL) AS ativos,
             count(*) FILTER (WHERE i.cancelado_em IS NULL AND i.qtd_programada IS NOT NULL AND q.liq >= i.qtd_programada) AS concluidos,
             sum(q.liq) AS lancado,
             jsonb_agg(jsonb_build_object('item_id', i.id, 'wl_id', i.wl_id, 'atividade_id', i.atividade_id,
               'qtd_programada', i.qtd_programada, 'qtd_lancada', q.liq, 'cancelado', i.cancelado_em IS NOT NULL)
               ORDER BY i.criado_em, i.id) AS itens
      FROM public.prog_proj_execucao_itens i
      CROSS JOIN LATERAL (SELECT public.fn_proj_execucao_liquido(i.id, NULL) AS liq) q
      WHERE i.execucao_id = e.id
    ) t ON true
    WHERE (p_projeto_id IS NULL OR e.projeto_id = p_projeto_id)
      AND (p_equipe_id IS NULL OR e.equipe_id = p_equipe_id)
      AND (p_data IS NULL OR e.data = p_data)
      AND (p_projeto_id IS NOT NULL OR public.fn_proj_execucao_pode_ler(e.projeto_id))), '[]'::jsonb);
END;
$$;

-- ── 10. Grants ───────────────────────────────────────────────────────────
-- Internas: ninguém chama pela API.
REVOKE ALL ON FUNCTION public.fn_proj_execucao_versao_ok(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_execucao_estado() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_execucao_contrato(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_execucao_projeto_na_composicao(text, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_execucao_atividade_estruturada(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_execucao_recalcular(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_execucao_liquido(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_execucao_consistencia() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_execucao_pode_ler(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.proj_execucao_config_proteger() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prog_proj_execucao_proteger() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_execucao_protege_executado() FROM PUBLIC, anon, authenticated, service_role;
-- Gatilhos das telas: chamada no contexto de quem grava (anon nas sessões legadas, authenticated nas novas).
REVOKE ALL ON FUNCTION public.fn_proj_execucao_trava_atividade(uuid) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.fn_proj_execucao_trava_atividade(uuid) TO anon, authenticated;
-- Interruptor: as telas antigas (inclusive sessão legada) precisam ler para não oferecer o caminho antigo.
REVOKE ALL ON FUNCTION public.fn_proj_execucao_interruptor() FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.fn_proj_execucao_interruptor() TO anon, authenticated;
-- Públicas da etapa: só authenticated (sessão real).
REVOKE ALL ON FUNCTION public.fn_proj_execucao_criar(uuid, uuid, uuid, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_execucao_definir_itens(uuid, jsonb) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_execucao_cancelar_item(uuid, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_execucao_cancelar(uuid, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_execucao_lancar(uuid, numeric, text, text, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_execucao_estornar(uuid, text, text, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_saldo_atividades(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_execucao_situacao(uuid, text, date) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_proj_execucao_criar(uuid, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_proj_execucao_definir_itens(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_proj_execucao_cancelar_item(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_proj_execucao_cancelar(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_proj_execucao_lancar(uuid, numeric, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_proj_execucao_estornar(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_proj_saldo_atividades(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_proj_execucao_situacao(uuid, text, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Validação
-- SELECT public.fn_proj_execucao_interruptor();   -- {"estado": "INATIVO", "versao_minima": null}
-- SELECT count(*) FROM public.prog_proj_execucoes;  -- 0 logo após aplicar
-- SELECT acao, perfil FROM public.cena_permissoes_acao
--   WHERE acao IN ('PROJ_LANCAR_EXECUCAO', 'PROJ_ESTORNAR_EXECUCAO') AND contrato_id IS NULL AND deleted_at IS NULL ORDER BY 1, 2;
-- SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE tgname LIKE 'proj_execucao_protege%';

-- Para desfazer — só enquanto não houver execução, item nem lançamento (nada é apagado com histórico).
-- BEGIN;
-- DO $$ BEGIN
--   IF EXISTS (SELECT 1 FROM public.prog_proj_execucoes) OR EXISTS (SELECT 1 FROM public.prog_proj_execucao_itens)
--      OR EXISTS (SELECT 1 FROM public.prog_proj_execucao_lancamentos) THEN
--     RAISE EXCEPTION 'há execução registrada: rollback automático recusado';
--   END IF;
--   IF (SELECT ativo FROM public.proj_execucao_config WHERE id) THEN
--     RAISE EXCEPTION 'interruptor ligado: desligue antes (1.7d)';
--   END IF;
-- END $$;
-- DROP TRIGGER IF EXISTS proj_execucao_protege_executado_trg ON public.sot_atividades;
-- DROP TRIGGER IF EXISTS proj_execucao_protege_historico_trg ON public.sot_atividades_historico;
-- DROP FUNCTION IF EXISTS public.fn_proj_execucao_situacao(uuid, text, date);
-- DROP FUNCTION IF EXISTS public.fn_proj_saldo_atividades(uuid);
-- DROP FUNCTION IF EXISTS public.fn_proj_execucao_pode_ler(uuid);
-- DROP FUNCTION IF EXISTS public.fn_proj_execucao_consistencia();
-- DROP FUNCTION IF EXISTS public.fn_proj_execucao_estornar(uuid, text, text, text);
-- DROP FUNCTION IF EXISTS public.fn_proj_execucao_lancar(uuid, numeric, text, text, text);
-- DROP FUNCTION IF EXISTS public.fn_proj_execucao_cancelar(uuid, text);
-- DROP FUNCTION IF EXISTS public.fn_proj_execucao_cancelar_item(uuid, text);
-- DROP FUNCTION IF EXISTS public.fn_proj_execucao_definir_itens(uuid, jsonb);
-- DROP FUNCTION IF EXISTS public.fn_proj_execucao_criar(uuid, uuid, uuid, text);
-- DROP FUNCTION IF EXISTS public.fn_proj_execucao_protege_executado();
-- DROP FUNCTION IF EXISTS public.fn_proj_execucao_trava_atividade(uuid);
-- DROP FUNCTION IF EXISTS public.fn_proj_execucao_liquido(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.fn_proj_execucao_recalcular(uuid);
-- DROP FUNCTION IF EXISTS public.fn_proj_execucao_atividade_estruturada(uuid);
-- DROP FUNCTION IF EXISTS public.fn_proj_execucao_projeto_na_composicao(text, uuid);
-- DROP FUNCTION IF EXISTS public.fn_proj_execucao_contrato(uuid);
-- DROP TABLE IF EXISTS public.prog_proj_execucao_lancamentos;
-- DROP TABLE IF EXISTS public.prog_proj_execucao_itens;
-- DROP TABLE IF EXISTS public.prog_proj_execucoes;
-- DROP FUNCTION IF EXISTS public.prog_proj_execucao_proteger();
-- DROP FUNCTION IF EXISTS public.fn_proj_execucao_interruptor();
-- DROP FUNCTION IF EXISTS public.fn_proj_execucao_estado();
-- DROP FUNCTION IF EXISTS public.fn_proj_execucao_versao_ok(text, text);
-- DROP TABLE IF EXISTS public.proj_execucao_config_eventos;
-- DROP TABLE IF EXISTS public.proj_execucao_config;
-- DROP FUNCTION IF EXISTS public.proj_execucao_config_proteger();
-- -- Permissões: a matriz proíbe DELETE físico; revogue pelas RPCs de administração e desative as ações:
-- UPDATE public.cena_acoes SET ativo = false WHERE codigo IN ('PROJ_LANCAR_EXECUCAO', 'PROJ_ESTORNAR_EXECUCAO');
-- NOTIFY pgrst, 'reload schema';
-- COMMIT;
