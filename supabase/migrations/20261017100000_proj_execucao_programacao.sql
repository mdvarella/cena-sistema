-- ETAPA 1.7b (ENEL/LMS/WL) — Programação de Projetos com WL (banco de apoio à tela)
-- Base: docs/enel-wl/ETAPA-1.7-EXECUCAO-DIAGNOSTICO.md §10 e decisões B1–B5 aprovadas em 17/10/2026.
--   Meta do dia nunca acima do saldo da atividade (previsto − soma dos lançamentos): QTD_ACIMA_DO_SALDO.
--   Leitura do dia para a tela (estado WL dos projetos + execuções e itens ativos), só para quem programa projetos.
--   Retirar projeto estruturado da equipe/dia numa transação só: cancela a execução (com motivo) e tira o projeto da
--   composição; recusa se houver quantidade lançada.
--   A6/B3: gatilho em composicao_dia (vale para todos, inclusive SQL direto): retirar o projeto, excluir ou mudar a
--   equipe/data da composição com execução que tem quantidade lançada é recusado; sem lançamento, a execução é cancelada
--   automaticamente com motivo registrado. Sem execução ativa na linha, o gatilho não faz nada (TMA e Portaria iguais).
-- Interruptor geral continua DESLIGADO; nenhum lançamento é possível. Não altera o TMA, o Diário nem a Portaria.
-- Transação explícita: qualquer falha desfaz a etapa inteira.

BEGIN;

-- ── 0. Pré-condições ─────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT coalesce((SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user), false) THEN
    RAISE EXCEPTION 'Rode como dono com BYPASSRLS: as funções SECURITY DEFINER leem e gravam tabelas com RLS FORCE';
  END IF;
  IF to_regprocedure('public.fn_proj_execucao_criar(uuid,uuid,uuid,text)') IS NULL
     OR to_regprocedure('public.fn_proj_execucao_liquido(uuid,uuid)') IS NULL
     OR to_regclass('public.prog_proj_execucoes') IS NULL THEN
    RAISE EXCEPTION 'aplique antes 20261015120000_proj_execucao.sql (Etapa 1.7a)';
  END IF;
END $$;

-- ── 1. Soma oficial por atividade (interna) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_proj_execucao_soma_atividade(p_atividade_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(sum(CASE WHEN l.tipo = 'ESTORNO' THEN -l.qtd ELSE l.qtd END), 0)
  FROM public.prog_proj_execucao_lancamentos l WHERE l.atividade_id = p_atividade_id
$$;

-- ── 2. Itens: meta do dia nunca acima do saldo ───────────────────────────
-- Mesmo corpo da 1.7a + checagem QTD_ACIMA_DO_SALDO (saldo = previsto − soma dos lançamentos da atividade).
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
  v_saldo     numeric;
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
      IF v_qtd IS NOT NULL THEN
        SELECT coalesce(a.qtd_prevista, 0) - public.fn_proj_execucao_soma_atividade(a.id) INTO v_saldo
        FROM public.sot_atividades a WHERE a.id = v_ativ;
        IF v_qtd > greatest(v_saldo, 0) THEN
          RAISE EXCEPTION 'QTD_ACIMA_DO_SALDO: meta % maior que o saldo % da atividade', v_qtd, greatest(v_saldo, 0)
            USING ERRCODE = 'P0001';
        END IF;
      END IF;
      v_alvo := v_alvo || jsonb_build_array(jsonb_build_object('wl', v_wl, 'a', v_ativ, 'q', v_qtd));
    END IF;
  END LOOP;

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

-- ── 3. Leitura do dia para a Programação de Projetos ─────────────────────
-- p_projeto_ids: projetos que aparecem nas composições do dia (até 500). Devolve o estado WL de cada um, as execuções
-- ativas do dia e os itens ativos (WL, atividade, meta, lançado, saldo, quem incluiu e quando).
CREATE OR REPLACE FUNCTION public.fn_proj_execucao_dia(p_data date, p_projeto_ids uuid[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_estados jsonb := '{}'::jsonb;
  v_id      uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'SEM_SESSAO: entre pelo login autenticado' USING ERRCODE = '42501';
  END IF;
  IF NOT public.cena_prog_pode_programar_projetos() THEN
    RAISE EXCEPTION 'SEM_PERMISSAO: sem permissão para programar projetos' USING ERRCODE = '42501';
  END IF;
  IF p_data IS NULL THEN
    RAISE EXCEPTION 'PARAMETRO_OBRIGATORIO: informe a data' USING ERRCODE = 'P0001';
  END IF;
  IF coalesce(cardinality(p_projeto_ids), 0) > 500 THEN
    RAISE EXCEPTION 'LIMITE: no máximo 500 projetos por chamada' USING ERRCODE = '22023';
  END IF;
  FOR v_id IN SELECT DISTINCT x FROM unnest(coalesce(p_projeto_ids, ARRAY[]::uuid[])) x WHERE x IS NOT NULL LOOP
    v_estados := v_estados || jsonb_build_object(v_id::text, public.sot_lms_estado_wl_calc(v_id));
  END LOOP;
  RETURN jsonb_build_object('data', p_data, 'estados', v_estados, 'execucoes', coalesce((
    SELECT jsonb_agg(jsonb_build_object('execucao_id', e.id, 'projeto_id', e.projeto_id, 'equipe_id', e.equipe_id,
             'composicao_dia_id', e.composicao_dia_id, 'criado_em', e.criado_em,
             'criado_por', (SELECT us.nome FROM public.usuarios_sistema us WHERE us.auth_user_id = e.criado_por_auth LIMIT 1),
             'itens', coalesce((
               SELECT jsonb_agg(jsonb_build_object('item_id', i.id, 'wl_id', i.wl_id, 'wl_codigo', w.codigo,
                        'atividade_id', i.atividade_id, 'codigo', a.codigo, 'descricao', a.descricao, 'unidade', a.unidade,
                        'qtd_programada', i.qtd_programada, 'qtd_lancada', public.fn_proj_execucao_liquido(i.id, NULL),
                        'qtd_prevista', a.qtd_prevista, 'qtd_executada', public.fn_proj_execucao_soma_atividade(a.id),
                        'criado_em', i.criado_em,
                        'criado_por', (SELECT us.nome FROM public.usuarios_sistema us WHERE us.auth_user_id = i.criado_por_auth LIMIT 1))
                      ORDER BY w.ordem, a.ordem_exec, a.codigo, i.id)
               FROM public.prog_proj_execucao_itens i
               JOIN public.sot_wl w ON w.id = i.wl_id
               JOIN public.sot_atividades a ON a.id = i.atividade_id
               WHERE i.execucao_id = e.id AND i.cancelado_em IS NULL), '[]'::jsonb))
           ORDER BY e.equipe_id, e.criado_em)
    FROM public.prog_proj_execucoes e
    WHERE e.data = p_data AND e.cancelada_em IS NULL), '[]'::jsonb));
END;
$$;

-- ── 4. Retirar projeto estruturado da equipe/dia (uma transação) ─────────
CREATE OR REPLACE FUNCTION public.fn_proj_execucao_retirar_projeto(p_composicao_dia_id uuid, p_projeto_id uuid, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_comp   record;
  v_exec   public.prog_proj_execucoes%ROWTYPE;
  v_n      integer := 0;
  v_ids    jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'SEM_SESSAO: entre pelo login autenticado' USING ERRCODE = '42501';
  END IF;
  IF NOT public.cena_prog_pode_programar_projetos() THEN
    RAISE EXCEPTION 'SEM_PERMISSAO: sem permissão para programar projetos' USING ERRCODE = '42501';
  END IF;
  IF btrim(coalesce(p_motivo, '')) = '' THEN
    RAISE EXCEPTION 'MOTIVO_OBRIGATORIO: informe o motivo da retirada' USING ERRCODE = 'P0001';
  END IF;
  SELECT c.id, c.projeto_ids, c.deleted_at INTO v_comp FROM public.composicao_dia c WHERE c.id = p_composicao_dia_id FOR UPDATE;
  IF NOT FOUND OR v_comp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'COMPOSICAO_INEXISTENTE: equipe/dia não encontrado ou excluído' USING ERRCODE = 'P0001';
  END IF;
  FOR v_exec IN SELECT * FROM public.prog_proj_execucoes e
                WHERE e.composicao_dia_id = p_composicao_dia_id AND e.projeto_id = p_projeto_id AND e.cancelada_em IS NULL
                FOR UPDATE LOOP
    IF public.fn_proj_execucao_liquido(NULL, v_exec.id) <> 0 THEN
      RAISE EXCEPTION 'EXECUCAO_COM_LANCAMENTO: há quantidade lançada nesta equipe/dia; o projeto não pode ser retirado'
        USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.prog_proj_execucao_itens
       SET cancelado_em = now(), cancelado_por_auth = auth.uid(), motivo_cancelamento = btrim(p_motivo)
     WHERE execucao_id = v_exec.id AND cancelado_em IS NULL;
    UPDATE public.prog_proj_execucoes
       SET cancelada_em = now(), cancelada_por_auth = auth.uid(), motivo_cancelamento = btrim(p_motivo)
     WHERE id = v_exec.id;
    v_n := v_n + 1;
  END LOOP;
  BEGIN
    SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO v_ids
    FROM jsonb_array_elements_text(coalesce(nullif(btrim(v_comp.projeto_ids), ''), '[]')::jsonb) x
    WHERE x <> p_projeto_id::text;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'COMPOSICAO_INVALIDA: lista de projetos da equipe/dia ilegível' USING ERRCODE = 'P0001';
  END;
  UPDATE public.composicao_dia SET projeto_ids = v_ids::text WHERE id = p_composicao_dia_id;
  RETURN jsonb_build_object('operacao', 'PROJETO_RETIRADO', 'composicao_dia_id', p_composicao_dia_id,
    'projeto_id', p_projeto_id, 'execucoes_canceladas', v_n, 'projeto_ids', v_ids);
END;
$$;

-- ── 5. A6/B3: proteção da composição (vale para todos, inclusive SQL direto) ──
-- Só age quando a linha tem execução ativa. Projeto retirado / composição excluída / equipe ou data trocada:
-- com quantidade lançada → recusa; sem lançamento → cancela a execução com motivo automático registrado.
CREATE OR REPLACE FUNCTION public.fn_proj_execucao_protege_composicao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_exec   public.prog_proj_execucoes%ROWTYPE;
  v_sai    boolean;
  v_motivo text;
  v_por    uuid := coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.prog_proj_execucoes e WHERE e.composicao_dia_id = OLD.id AND e.cancelada_em IS NULL) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  FOR v_exec IN SELECT * FROM public.prog_proj_execucoes e
                WHERE e.composicao_dia_id = OLD.id AND e.cancelada_em IS NULL FOR UPDATE LOOP
    IF TG_OP = 'DELETE' THEN
      v_sai := true;
      v_motivo := 'Composição do dia excluída (automático)';
    ELSIF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
      v_sai := true;
      v_motivo := 'Composição do dia excluída (automático)';
    ELSIF NEW.equipe_id IS DISTINCT FROM OLD.equipe_id OR NEW.data IS DISTINCT FROM OLD.data THEN
      v_sai := true;
      v_motivo := 'Equipe ou data da composição alterada (automático)';
    ELSE
      v_sai := NOT public.fn_proj_execucao_projeto_na_composicao(NEW.projeto_ids, v_exec.projeto_id);
      v_motivo := 'Projeto retirado da composição fora da Programação de Projetos (automático)';
    END IF;
    IF v_sai THEN
      IF public.fn_proj_execucao_liquido(NULL, v_exec.id) <> 0 THEN
        RAISE EXCEPTION 'composicao_dia: execução com quantidade lançada; projeto/equipe/dia não podem ser retirados (EXECUCAO_COM_LANCAMENTO)'
          USING ERRCODE = '42501';
      END IF;
      UPDATE public.prog_proj_execucao_itens
         SET cancelado_em = now(), cancelado_por_auth = v_por, motivo_cancelamento = v_motivo
       WHERE execucao_id = v_exec.id AND cancelado_em IS NULL;
      UPDATE public.prog_proj_execucoes
         SET cancelada_em = now(), cancelada_por_auth = v_por, motivo_cancelamento = v_motivo
       WHERE id = v_exec.id;
    END IF;
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
DROP TRIGGER IF EXISTS proj_execucao_protege_composicao_trg ON public.composicao_dia;
CREATE TRIGGER proj_execucao_protege_composicao_trg
  BEFORE UPDATE OF projeto_ids, equipe_id, data, deleted_at OR DELETE ON public.composicao_dia
  FOR EACH ROW EXECUTE FUNCTION public.fn_proj_execucao_protege_composicao();

-- ── 6. Grants ────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.fn_proj_execucao_soma_atividade(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_execucao_protege_composicao() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_execucao_definir_itens(uuid, jsonb) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_execucao_dia(date, uuid[]) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_execucao_retirar_projeto(uuid, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_proj_execucao_definir_itens(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_proj_execucao_dia(date, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_proj_execucao_retirar_projeto(uuid, uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Validação
-- SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'proj_execucao_protege_composicao_trg';
-- SELECT has_function_privilege('authenticated', 'public.fn_proj_execucao_dia(date,uuid[])', 'EXECUTE');   -- t
-- SELECT has_function_privilege('anon', 'public.fn_proj_execucao_retirar_projeto(uuid,uuid,text)', 'EXECUTE');  -- f

-- Para desfazer — remove o gatilho e as funções novas e devolve a definir_itens da 1.7a (sem QTD_ACIMA_DO_SALDO,
-- texto original abaixo, idêntico ao de 20261015120000_proj_execucao.sql). Nenhum dado é apagado.
-- BEGIN;
-- DROP TRIGGER IF EXISTS proj_execucao_protege_composicao_trg ON public.composicao_dia;
-- DROP FUNCTION IF EXISTS public.fn_proj_execucao_protege_composicao();
-- DROP FUNCTION IF EXISTS public.fn_proj_execucao_retirar_projeto(uuid, uuid, text);
-- DROP FUNCTION IF EXISTS public.fn_proj_execucao_dia(date, uuid[]);
-- CREATE OR REPLACE FUNCTION public.fn_proj_execucao_definir_itens(p_execucao_id uuid, p_itens jsonb)
-- RETURNS jsonb
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- SET search_path = public, pg_temp
-- AS $$
-- DECLARE
--   v_exec      public.prog_proj_execucoes%ROWTYPE;
--   v_el        jsonb;
--   v_wl        uuid;
--   v_ativ      uuid;
--   v_qtd       numeric;
--   v_alvo      jsonb := '[]'::jsonb;
--   v_par       jsonb;
--   v_id        uuid;
--   v_incluidos integer := 0;
--   v_existiam  integer := 0;
--   v_ids       uuid[] := ARRAY[]::uuid[];
-- BEGIN
--   IF auth.uid() IS NULL THEN
--     RAISE EXCEPTION 'SEM_SESSAO: entre pelo login autenticado' USING ERRCODE = '42501';
--   END IF;
--   IF NOT public.cena_prog_pode_programar_projetos() THEN
--     RAISE EXCEPTION 'SEM_PERMISSAO: sem permissão para programar projetos' USING ERRCODE = '42501';
--   END IF;
--   SELECT * INTO v_exec FROM public.prog_proj_execucoes WHERE id = p_execucao_id FOR UPDATE;
--   IF NOT FOUND OR v_exec.cancelada_em IS NOT NULL THEN
--     RAISE EXCEPTION 'EXECUCAO_INVALIDA: execução não encontrada ou cancelada' USING ERRCODE = 'P0001';
--   END IF;
--   IF public.sot_lms_estado_wl_calc(v_exec.projeto_id) <> 'ESTRUTURADO' THEN
--     RAISE EXCEPTION 'PROJETO_NAO_ESTRUTURADO: projeto deixou de estar estruturado' USING ERRCODE = 'P0001';
--   END IF;
--   IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) = 0 THEN
--     RAISE EXCEPTION 'ITENS_VAZIOS: informe ao menos uma WL ou atividade' USING ERRCODE = 'P0001';
--   END IF;
--
--   -- 1) Valida tudo e monta a lista final (WL inteira expandida).
--   FOR v_el IN SELECT x FROM jsonb_array_elements(p_itens) x LOOP
--     BEGIN
--       v_wl := nullif(v_el->>'wl_id', '')::uuid;
--       v_ativ := nullif(v_el->>'atividade_id', '')::uuid;
--       v_qtd := nullif(v_el->>'qtd_programada', '')::numeric;
--     EXCEPTION WHEN OTHERS THEN
--       RAISE EXCEPTION 'ITEM_INVALIDO: item mal formado (%)', v_el::text USING ERRCODE = 'P0001';
--     END;
--     IF v_wl IS NULL OR NOT EXISTS (SELECT 1 FROM public.sot_wl w WHERE w.id = v_wl AND w.projeto_id = v_exec.projeto_id
--                                      AND w.cancelada_em IS NULL) THEN
--       RAISE EXCEPTION 'WL_INVALIDA: WL não pertence ao projeto ou está cancelada' USING ERRCODE = 'P0001';
--     END IF;
--     IF v_qtd IS NOT NULL AND (v_qtd < 0 OR v_qtd <> round(v_qtd, 3)) THEN
--       RAISE EXCEPTION 'QTD_INVALIDA: meta do dia deve ser zero ou positiva (até 3 casas)' USING ERRCODE = 'P0001';
--     END IF;
--     IF v_ativ IS NULL THEN
--       IF v_qtd IS NOT NULL THEN
--         RAISE EXCEPTION 'QTD_WL_INTEIRA: meta só por atividade, não para a WL inteira' USING ERRCODE = 'P0001';
--       END IF;
--       IF NOT EXISTS (SELECT 1 FROM public.sot_atividades a WHERE a.wl_id = v_wl AND a.projeto_id = v_exec.projeto_id
--                        AND a.deleted_at IS NULL AND NOT a.somente_descritivo) THEN
--         RAISE EXCEPTION 'WL_SEM_ATIVIDADES: a WL não tem atividade a executar' USING ERRCODE = 'P0001';
--       END IF;
--       SELECT v_alvo || coalesce(jsonb_agg(jsonb_build_object('wl', v_wl, 'a', a.id, 'q', NULL) ORDER BY a.ordem_exec, a.id), '[]'::jsonb)
--         INTO v_alvo
--       FROM public.sot_atividades a
--       WHERE a.wl_id = v_wl AND a.projeto_id = v_exec.projeto_id AND a.deleted_at IS NULL AND NOT a.somente_descritivo;
--     ELSE
--       IF NOT EXISTS (SELECT 1 FROM public.sot_atividades a WHERE a.id = v_ativ AND a.projeto_id = v_exec.projeto_id
--                        AND a.wl_id = v_wl AND a.deleted_at IS NULL AND NOT a.somente_descritivo) THEN
--         RAISE EXCEPTION 'ATIVIDADE_INVALIDA: atividade não é do projeto, não é desta WL, está excluída ou é só descritiva'
--           USING ERRCODE = 'P0001';
--       END IF;
--       v_alvo := v_alvo || jsonb_build_array(jsonb_build_object('wl', v_wl, 'a', v_ativ, 'q', v_qtd));
--     END IF;
--   END LOOP;
--
--   -- 2) Grava (ignora repetidos e os que já estão ativos).
--   FOR v_par IN SELECT x FROM jsonb_array_elements(v_alvo) x LOOP
--     SELECT i.id INTO v_id FROM public.prog_proj_execucao_itens i
--     WHERE i.execucao_id = v_exec.id AND i.wl_id = (v_par->>'wl')::uuid AND i.atividade_id = (v_par->>'a')::uuid
--       AND i.cancelado_em IS NULL;
--     IF FOUND THEN
--       IF NOT (v_id = ANY (v_ids)) THEN
--         v_existiam := v_existiam + 1;
--       END IF;
--       CONTINUE;
--     END IF;
--     INSERT INTO public.prog_proj_execucao_itens (execucao_id, projeto_id, wl_id, atividade_id, qtd_programada, criado_por_auth)
--     VALUES (v_exec.id, v_exec.projeto_id, (v_par->>'wl')::uuid, (v_par->>'a')::uuid, (v_par->>'q')::numeric, auth.uid())
--     RETURNING id INTO v_id;
--     v_ids := v_ids || v_id;
--     v_incluidos := v_incluidos + 1;
--   END LOOP;
--   RETURN jsonb_build_object('operacao', 'ITENS_DEFINIDOS', 'execucao_id', v_exec.id, 'incluidos', v_incluidos,
--     'ja_existentes', v_existiam, 'itens', to_jsonb(v_ids));
-- END;
-- $$;
-- DROP FUNCTION IF EXISTS public.fn_proj_execucao_soma_atividade(uuid);
-- NOTIFY pgrst, 'reload schema';
-- COMMIT;
