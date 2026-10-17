-- ETAPA 1.7b (ENEL/LMS/WL) — Programação de Projetos com WL (banco de apoio à tela)
-- Base: docs/enel-wl/ETAPA-1.7-EXECUCAO-DIAGNOSTICO.md §10, decisões B1–B5 (17/10/2026) e ajustes aprovados após 5325894.
--   Saldo comprometido: saldo livre = previsto − executado − metas em aberto (meta − lançado no item, nunca negativa) de
--   itens ativos de programações ativas de HOJE em diante (programação vencida libera o saldo; histórico fica).
--   Meta acima do saldo livre: bloqueada por padrão; exceção só com PROJ_AUTORIZAR_EXCESSO_META + justificativa, gravadas
--   no item (quem, quando, saldo livre no momento). Validação e gravação sob trava das atividades (ordem por id).
--   Leitura do dia para a tela (só leitura; não grava), só para quem programa projetos.
--   Retirar projeto estruturado da equipe/dia numa transação só (motivo obrigatório; recusa com quantidade lançada).
--   A6/B3: gatilho em composicao_dia — com programação ativa: quantidade lançada recusa; sessão de tela sem login
--   autenticado recusa (sem autoria); login autenticado cancela registrando o usuário; operação técnica (SQL direto,
--   serviço) cancela com origem SISTEMA e o papel no motivo. Nunca autoria fictícia. Sem programação ativa: nada muda.
-- Interruptor geral continua DESLIGADO; nenhum lançamento é possível. Não altera o TMA, o Diário, a Portaria nem o SOT.
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

-- ── 1. Permissão de exceção (só linhas novas no catálogo e na matriz; nenhuma estrutura compartilhada muda) ──
INSERT INTO public.cena_acoes (codigo, modulo, descricao) VALUES
  ('PROJ_AUTORIZAR_EXCESSO_META', 'PROJETOS', 'Programar meta do dia acima do saldo livre da atividade (com justificativa)')
ON CONFLICT (codigo) DO NOTHING;
DO $$
BEGIN
  INSERT INTO public.cena_permissoes_acao (perfil, acao, contrato_id, permitido, motivo)
  SELECT m.perfil, 'PROJ_AUTORIZAR_EXCESSO_META', NULL, TRUE, 'Matriz inicial — Etapa 1.7b (17/10/2026)'
  FROM unnest(ARRAY['admin', 'coordenador', 'gestor']) AS m(perfil)
  WHERE NOT EXISTS (SELECT 1 FROM public.cena_permissoes_acao pa
                    WHERE pa.perfil = m.perfil AND pa.acao = 'PROJ_AUTORIZAR_EXCESSO_META' AND pa.contrato_id IS NULL);
END $$;

-- ── 2. Colunas novas (auditoria da exceção e origem do cancelamento) ─────
ALTER TABLE public.prog_proj_execucao_itens
  ADD COLUMN IF NOT EXISTS excesso_justificativa      text,
  ADD COLUMN IF NOT EXISTS excesso_autorizado_por_auth uuid,
  ADD COLUMN IF NOT EXISTS excesso_saldo_livre        numeric(14,3),
  ADD COLUMN IF NOT EXISTS cancelado_origem           text;
ALTER TABLE public.prog_proj_execucoes
  ADD COLUMN IF NOT EXISTS cancelada_origem           text;

ALTER TABLE public.prog_proj_execucao_itens DROP CONSTRAINT IF EXISTS prog_proj_execucao_itens_excesso_chk;
ALTER TABLE public.prog_proj_execucao_itens ADD CONSTRAINT prog_proj_execucao_itens_excesso_chk CHECK (
  (excesso_justificativa IS NULL AND excesso_autorizado_por_auth IS NULL AND excesso_saldo_livre IS NULL)
  OR (btrim(coalesce(excesso_justificativa, '')) <> '' AND excesso_autorizado_por_auth IS NOT NULL
      AND excesso_saldo_livre IS NOT NULL AND qtd_programada IS NOT NULL));
-- Cancelamento: por usuário (auth obrigatório) ou por origem técnica SISTEMA (sem auth, com motivo). Nunca auth fictício.
ALTER TABLE public.prog_proj_execucao_itens DROP CONSTRAINT IF EXISTS prog_proj_execucao_itens_cancelamento_chk;
ALTER TABLE public.prog_proj_execucao_itens ADD CONSTRAINT prog_proj_execucao_itens_cancelamento_chk CHECK (
  (cancelado_em IS NULL AND cancelado_por_auth IS NULL AND motivo_cancelamento IS NULL AND cancelado_origem IS NULL)
  OR (cancelado_em IS NOT NULL AND btrim(coalesce(motivo_cancelamento, '')) <> '' AND (
        (coalesce(cancelado_origem, 'USUARIO') = 'USUARIO' AND cancelado_por_auth IS NOT NULL)
     OR (cancelado_origem = 'SISTEMA' AND cancelado_por_auth IS NULL))));
ALTER TABLE public.prog_proj_execucoes DROP CONSTRAINT IF EXISTS prog_proj_execucoes_cancelamento_chk;
ALTER TABLE public.prog_proj_execucoes ADD CONSTRAINT prog_proj_execucoes_cancelamento_chk CHECK (
  (cancelada_em IS NULL AND cancelada_por_auth IS NULL AND motivo_cancelamento IS NULL AND cancelada_origem IS NULL)
  OR (cancelada_em IS NOT NULL AND btrim(coalesce(motivo_cancelamento, '')) <> '' AND (
        (coalesce(cancelada_origem, 'USUARIO') = 'USUARIO' AND cancelada_por_auth IS NOT NULL)
     OR (cancelada_origem = 'SISTEMA' AND cancelada_por_auth IS NULL))));

-- Integridade (1.7a) com as colunas novas de cancelamento na lista do que pode mudar (uma vez só).
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
    v_cols := ARRAY['cancelada_em', 'cancelada_por_auth', 'motivo_cancelamento', 'cancelada_origem'];
    IF OLD.cancelada_em IS NOT NULL THEN
      RAISE EXCEPTION 'prog_proj_execucoes: execução cancelada não muda' USING ERRCODE = '42501';
    END IF;
  ELSE
    v_cols := ARRAY['cancelado_em', 'cancelado_por_auth', 'motivo_cancelamento', 'cancelado_origem'];
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

-- ── 3. Saldo oficial e saldo comprometido (internas) ─────────────────────
CREATE OR REPLACE FUNCTION public.fn_proj_execucao_soma_atividade(p_atividade_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(sum(CASE WHEN l.tipo = 'ESTORNO' THEN -l.qtd ELSE l.qtd END), 0)
  FROM public.prog_proj_execucao_lancamentos l WHERE l.atividade_id = p_atividade_id
$$;

-- Metas em aberto que prendem saldo: item ativo, programação ativa, dia ≥ p_hoje, com meta; aberto = meta − lançado no
-- item (nunca negativo). O lançado já está no executado; aqui só entra o que falta da meta (sem dupla contagem).
-- p_exceto_execucao: a programação que está sendo alterada não conta contra ela mesma.
CREATE OR REPLACE FUNCTION public.fn_proj_execucao_compromissos(p_atividade_id uuid, p_hoje date, p_exceto_execucao uuid DEFAULT NULL)
RETURNS TABLE (item_id uuid, execucao_id uuid, equipe_id text, data date, qtd_programada numeric, qtd_lancada numeric, qtd_aberta numeric)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT i.id, e.id, e.equipe_id, e.data, i.qtd_programada, x.liq, greatest(i.qtd_programada - x.liq, 0)
  FROM public.prog_proj_execucao_itens i
  JOIN public.prog_proj_execucoes e ON e.id = i.execucao_id
  CROSS JOIN LATERAL (SELECT public.fn_proj_execucao_liquido(i.id, NULL) AS liq) x
  WHERE i.atividade_id = p_atividade_id AND i.cancelado_em IS NULL AND i.qtd_programada IS NOT NULL
    AND e.cancelada_em IS NULL AND e.data >= p_hoje
    AND (p_exceto_execucao IS NULL OR e.id <> p_exceto_execucao)
$$;

CREATE OR REPLACE FUNCTION public.fn_proj_execucao_saldo_livre(p_atividade_id uuid, p_hoje date, p_exceto_execucao uuid DEFAULT NULL)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT greatest(coalesce(a.qtd_prevista, 0) - public.fn_proj_execucao_soma_atividade(a.id)
           - coalesce((SELECT sum(c.qtd_aberta) FROM public.fn_proj_execucao_compromissos(a.id, p_hoje, p_exceto_execucao) c), 0), 0)
  FROM public.sot_atividades a WHERE a.id = p_atividade_id
$$;

-- ── 4. Itens: meta do dia ≤ saldo livre (exceção autorizada e auditada) ──
-- p_itens: [{"wl_id", "atividade_id"|null, "qtd_programada"|null, "excesso_justificativa"|null}]
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
  v_just      text;
  v_livre     numeric;
  v_hoje      date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_ctr       uuid;
  v_alvo      jsonb := '[]'::jsonb;
  v_par       jsonb;
  v_final     jsonb := '[]'::jsonb;
  v_id        uuid;
  v_incluidos integer := 0;
  v_existiam  integer := 0;
  v_excessos  integer := 0;
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

  -- 1) Valida a forma e monta a lista final (WL inteira expandida, sem meta).
  FOR v_el IN SELECT x FROM jsonb_array_elements(p_itens) x LOOP
    BEGIN
      v_wl := nullif(v_el->>'wl_id', '')::uuid;
      v_ativ := nullif(v_el->>'atividade_id', '')::uuid;
      v_qtd := nullif(v_el->>'qtd_programada', '')::numeric;
      v_just := nullif(btrim(coalesce(v_el->>'excesso_justificativa', '')), '');
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
      SELECT v_alvo || coalesce(jsonb_agg(jsonb_build_object('wl', v_wl, 'a', a.id, 'q', NULL, 'j', NULL) ORDER BY a.ordem_exec, a.id), '[]'::jsonb)
        INTO v_alvo
      FROM public.sot_atividades a
      WHERE a.wl_id = v_wl AND a.projeto_id = v_exec.projeto_id AND a.deleted_at IS NULL AND NOT a.somente_descritivo;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM public.sot_atividades a WHERE a.id = v_ativ AND a.projeto_id = v_exec.projeto_id
                       AND a.wl_id = v_wl AND a.deleted_at IS NULL AND NOT a.somente_descritivo) THEN
        RAISE EXCEPTION 'ATIVIDADE_INVALIDA: atividade não é do projeto, não é desta WL, está excluída ou é só descritiva'
          USING ERRCODE = 'P0001';
      END IF;
      v_alvo := v_alvo || jsonb_build_array(jsonb_build_object('wl', v_wl, 'a', v_ativ, 'q', v_qtd, 'j', v_just));
    END IF;
  END LOOP;

  -- 2) Concorrência: trava as atividades envolvidas (ordem fixa por id) antes de conferir o saldo livre.
  PERFORM 1 FROM public.sot_atividades a
  WHERE a.id IN (SELECT DISTINCT (x->>'a')::uuid FROM jsonb_array_elements(v_alvo) x)
  ORDER BY a.id FOR UPDATE;

  -- 3) Saldo livre (previsto − executado − metas em aberto de outras programações de hoje em diante).
  FOR v_par IN SELECT x FROM jsonb_array_elements(v_alvo) x LOOP
    IF EXISTS (SELECT 1 FROM public.prog_proj_execucao_itens i
               WHERE i.execucao_id = v_exec.id AND i.wl_id = (v_par->>'wl')::uuid AND i.atividade_id = (v_par->>'a')::uuid
                 AND i.cancelado_em IS NULL) THEN
      v_final := v_final || jsonb_build_array(v_par);
      CONTINUE;
    END IF;
    IF v_par->>'q' IS NOT NULL THEN
      v_qtd := (v_par->>'q')::numeric;
      v_livre := public.fn_proj_execucao_saldo_livre((v_par->>'a')::uuid, v_hoje, v_exec.id);
      IF v_qtd > v_livre THEN
        IF v_par->>'j' IS NULL THEN
          RAISE EXCEPTION 'QTD_ACIMA_DO_SALDO: meta % maior que o saldo livre % da atividade', v_qtd, v_livre USING ERRCODE = 'P0001';
        END IF;
        IF v_ctr IS NULL THEN
          v_ctr := public.fn_proj_execucao_contrato(v_exec.projeto_id);
        END IF;
        IF NOT coalesce(public.cena_pode('PROJ_AUTORIZAR_EXCESSO_META', v_ctr), false) THEN
          RAISE EXCEPTION 'EXCESSO_SEM_PERMISSAO: meta % acima do saldo livre % exige PROJ_AUTORIZAR_EXCESSO_META', v_qtd, v_livre
            USING ERRCODE = '42501';
        END IF;
        v_par := v_par || jsonb_build_object('livre', v_livre);
      ELSE
        v_par := v_par || jsonb_build_object('j', NULL);
      END IF;
    END IF;
    v_final := v_final || jsonb_build_array(v_par);
  END LOOP;

  -- 4) Grava (ignora repetidos e os que já estão ativos).
  FOR v_par IN SELECT x FROM jsonb_array_elements(v_final) x LOOP
    SELECT i.id INTO v_id FROM public.prog_proj_execucao_itens i
    WHERE i.execucao_id = v_exec.id AND i.wl_id = (v_par->>'wl')::uuid AND i.atividade_id = (v_par->>'a')::uuid
      AND i.cancelado_em IS NULL;
    IF FOUND THEN
      IF NOT (v_id = ANY (v_ids)) THEN
        v_existiam := v_existiam + 1;
      END IF;
      CONTINUE;
    END IF;
    INSERT INTO public.prog_proj_execucao_itens (execucao_id, projeto_id, wl_id, atividade_id, qtd_programada, criado_por_auth,
      excesso_justificativa, excesso_autorizado_por_auth, excesso_saldo_livre)
    VALUES (v_exec.id, v_exec.projeto_id, (v_par->>'wl')::uuid, (v_par->>'a')::uuid, (v_par->>'q')::numeric, auth.uid(),
      CASE WHEN v_par ? 'livre' THEN v_par->>'j' END,
      CASE WHEN v_par ? 'livre' THEN auth.uid() END,
      CASE WHEN v_par ? 'livre' THEN (v_par->>'livre')::numeric END)
    RETURNING id INTO v_id;
    IF v_par ? 'livre' THEN
      v_excessos := v_excessos + 1;
    END IF;
    v_ids := v_ids || v_id;
    v_incluidos := v_incluidos + 1;
  END LOOP;
  RETURN jsonb_build_object('operacao', 'ITENS_DEFINIDOS', 'execucao_id', v_exec.id, 'incluidos', v_incluidos,
    'ja_existentes', v_existiam, 'excessos_autorizados', v_excessos, 'itens', to_jsonb(v_ids));
END;
$$;

-- ── 5. Saldo por atividade para a tela (1.7a + comprometido, livre e onde está comprometido) ──
CREATE OR REPLACE FUNCTION public.fn_proj_saldo_atividades(p_projeto_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_estado text;
  v_hoje   date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'SEM_SESSAO: entre pelo login autenticado' USING ERRCODE = '42501';
  END IF;
  IF NOT public.fn_proj_execucao_pode_ler(p_projeto_id) THEN
    RAISE EXCEPTION 'SEM_PERMISSAO: sem permissão para ver a execução deste projeto' USING ERRCODE = '42501';
  END IF;
  v_estado := public.sot_lms_estado_wl_calc(p_projeto_id);
  RETURN jsonb_build_object('projeto_id', p_projeto_id, 'estado_wl', v_estado, 'hoje', v_hoje, 'atividades', coalesce((
    SELECT jsonb_agg(jsonb_build_object('atividade_id', a.id, 'wl_id', a.wl_id, 'wl_codigo', w.codigo, 'codigo', a.codigo,
             'descricao', a.descricao, 'unidade', a.unidade, 'qtd_prevista', a.qtd_prevista, 'qtd_executada', s.soma,
             'saldo', coalesce(a.qtd_prevista, 0) - s.soma, 'excedente', s.soma > coalesce(a.qtd_prevista, 0),
             'campo_diverge', coalesce(a.qtd_executada, 0) <> s.soma,
             'qtd_comprometida', c.total,
             'saldo_livre', greatest(coalesce(a.qtd_prevista, 0) - s.soma - c.total, 0),
             'compromissos', c.lista)
           ORDER BY w.ordem, a.ordem_exec, a.codigo, a.id)
    FROM public.sot_atividades a
    JOIN public.sot_wl w ON w.id = a.wl_id
    CROSS JOIN LATERAL (SELECT public.fn_proj_execucao_soma_atividade(a.id) AS soma) s
    CROSS JOIN LATERAL (
      SELECT coalesce(sum(k.qtd_aberta), 0) AS total,
             coalesce(jsonb_agg(jsonb_build_object('execucao_id', k.execucao_id, 'equipe_id', k.equipe_id, 'data', k.data,
               'qtd_programada', k.qtd_programada, 'qtd_lancada', k.qtd_lancada, 'qtd_aberta', k.qtd_aberta)
               ORDER BY k.data, k.equipe_id) FILTER (WHERE k.qtd_aberta > 0), '[]'::jsonb) AS lista
      FROM public.fn_proj_execucao_compromissos(a.id, v_hoje, NULL) k) c
    WHERE a.projeto_id = p_projeto_id AND a.deleted_at IS NULL AND NOT a.somente_descritivo
      AND v_estado = 'ESTRUTURADO'), '[]'::jsonb));
END;
$$;

-- ── 6. Leitura do dia para a Programação de Projetos (só leitura) ────────
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
                        'excesso_justificativa', i.excesso_justificativa,
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

-- ── 7. Retirar projeto estruturado da equipe/dia (uma transação) ─────────
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
       SET cancelado_em = now(), cancelado_por_auth = auth.uid(), motivo_cancelamento = btrim(p_motivo), cancelado_origem = 'USUARIO'
     WHERE execucao_id = v_exec.id AND cancelado_em IS NULL;
    UPDATE public.prog_proj_execucoes
       SET cancelada_em = now(), cancelada_por_auth = auth.uid(), motivo_cancelamento = btrim(p_motivo), cancelada_origem = 'USUARIO'
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

-- ── 8. A6/B3: proteção da composição (vale para todos, inclusive SQL direto) ──
-- Só age quando a linha tem programação ativa e ela sai (projeto retirado, composição excluída, equipe/data trocada):
--   quantidade lançada → recusa; tela sem login autenticado (anon/authenticated sem auth.uid) → recusa (sem autoria);
--   login autenticado → cancela com o usuário; operação técnica (dono, serviço) → cancela com origem SISTEMA.
-- O papel de quem grava é lido pela função INVOKER do gatilho e passado à DEFINER que grava. A DEFINER só aceita a
-- chamada vinda do gatilho: ele marca a transação com o id da composição (set_config local), o que uma chamada pela API
-- não consegue fazer (set_config não é exposto). O autor é sempre auth.uid() da sessão — nunca parâmetro.
CREATE OR REPLACE FUNCTION public.fn_proj_execucao_cancelar_por_composicao(p_composicao_dia_id uuid, p_tg_op text,
  p_new_projeto_ids text, p_excluida boolean, p_troca boolean, p_papel text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_exec   public.prog_proj_execucoes%ROWTYPE;
  v_sai    boolean;
  v_motivo text;
  v_origem text;
  v_auth   uuid := auth.uid();
BEGIN
  IF coalesce(current_setting('cena.exec_comp_trg', true), '') <> p_composicao_dia_id::text THEN
    RAISE EXCEPTION 'fn_proj_execucao_cancelar_por_composicao: só pelo gatilho da composição' USING ERRCODE = '42501';
  END IF;
  FOR v_exec IN SELECT * FROM public.prog_proj_execucoes e
                WHERE e.composicao_dia_id = p_composicao_dia_id AND e.cancelada_em IS NULL FOR UPDATE LOOP
    IF p_tg_op = 'DELETE' OR p_excluida THEN
      v_sai := true; v_motivo := 'Composição do dia excluída';
    ELSIF p_troca THEN
      v_sai := true; v_motivo := 'Equipe ou data da composição alterada';
    ELSE
      v_sai := NOT public.fn_proj_execucao_projeto_na_composicao(p_new_projeto_ids, v_exec.projeto_id);
      v_motivo := 'Projeto retirado da composição fora da Programação de Projetos';
    END IF;
    CONTINUE WHEN NOT v_sai;
    IF public.fn_proj_execucao_liquido(NULL, v_exec.id) <> 0 THEN
      RAISE EXCEPTION 'composicao_dia: programação com quantidade lançada; projeto/equipe/dia não podem ser retirados (EXECUCAO_COM_LANCAMENTO)'
        USING ERRCODE = '42501';
    END IF;
    IF v_auth IS NOT NULL THEN
      v_origem := 'USUARIO';
    ELSIF p_papel IN ('anon', 'authenticated') THEN
      RAISE EXCEPTION 'composicao_dia: projeto com WLs programadas; retire pela Programação de Projetos com login autenticado (EXECUCAO_SEM_AUTORIA)'
        USING ERRCODE = '42501';
    ELSE
      v_origem := 'SISTEMA';
      v_motivo := v_motivo || ' — operação técnica (papel ' || coalesce(p_papel, '?') || ')';
    END IF;
    UPDATE public.prog_proj_execucao_itens
       SET cancelado_em = now(), cancelado_por_auth = v_auth, motivo_cancelamento = v_motivo, cancelado_origem = v_origem
     WHERE execucao_id = v_exec.id AND cancelado_em IS NULL;
    UPDATE public.prog_proj_execucoes
       SET cancelada_em = now(), cancelada_por_auth = v_auth, motivo_cancelamento = v_motivo, cancelada_origem = v_origem
     WHERE id = v_exec.id;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_proj_execucao_protege_composicao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.fn_proj_execucao_composicao_tem_ativa(OLD.id) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  PERFORM set_config('cena.exec_comp_trg', OLD.id::text, true);
  IF TG_OP = 'DELETE' THEN
    PERFORM public.fn_proj_execucao_cancelar_por_composicao(OLD.id, TG_OP, NULL, true, false, current_user::text);
  ELSE
    PERFORM public.fn_proj_execucao_cancelar_por_composicao(OLD.id, TG_OP, NEW.projeto_ids,
      NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL,
      NEW.equipe_id IS DISTINCT FROM OLD.equipe_id OR NEW.data IS DISTINCT FROM OLD.data,
      current_user::text);
  END IF;
  PERFORM set_config('cena.exec_comp_trg', '', true);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

-- Atalho do gatilho (só true/false): a composição tem programação ativa?
CREATE OR REPLACE FUNCTION public.fn_proj_execucao_composicao_tem_ativa(p_composicao_dia_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.prog_proj_execucoes e WHERE e.composicao_dia_id = p_composicao_dia_id AND e.cancelada_em IS NULL)
$$;

DROP TRIGGER IF EXISTS proj_execucao_protege_composicao_trg ON public.composicao_dia;
CREATE TRIGGER proj_execucao_protege_composicao_trg
  BEFORE UPDATE OF projeto_ids, equipe_id, data, deleted_at OR DELETE ON public.composicao_dia
  FOR EACH ROW EXECUTE FUNCTION public.fn_proj_execucao_protege_composicao();

-- ── 9. Grants ────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.fn_proj_execucao_soma_atividade(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_execucao_compromissos(uuid, date, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_execucao_saldo_livre(uuid, date, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_execucao_cancelar_por_composicao(uuid, text, text, boolean, boolean, text) FROM PUBLIC, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_execucao_composicao_tem_ativa(uuid) FROM PUBLIC, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_execucao_protege_composicao() FROM PUBLIC, anon, authenticated, service_role;
-- Chamadas pelo gatilho no contexto de quem grava a composição (TMA em sessão legada = anon).
GRANT EXECUTE ON FUNCTION public.fn_proj_execucao_composicao_tem_ativa(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_proj_execucao_cancelar_por_composicao(uuid, text, text, boolean, boolean, text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_proj_execucao_definir_itens(uuid, jsonb) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_saldo_atividades(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_execucao_dia(date, uuid[]) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_execucao_retirar_projeto(uuid, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_proj_execucao_definir_itens(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_proj_saldo_atividades(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_proj_execucao_dia(date, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_proj_execucao_retirar_projeto(uuid, uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Validação
-- SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'proj_execucao_protege_composicao_trg';
-- SELECT has_function_privilege('authenticated', 'public.fn_proj_execucao_dia(date,uuid[])', 'EXECUTE');   -- t
-- SELECT has_function_privilege('anon', 'public.fn_proj_execucao_retirar_projeto(uuid,uuid,text)', 'EXECUTE');  -- f
-- SELECT perfil FROM public.cena_permissoes_acao WHERE acao = 'PROJ_AUTORIZAR_EXCESSO_META' AND deleted_at IS NULL;

-- Para desfazer — recusado se já houver exceção de meta ou cancelamento com origem registrada (para não perder auditoria).
-- Remove o gatilho e as funções novas, devolve as três funções da 1.7a com o texto original e as regras da 1.7a.
-- BEGIN;
-- DO $$ BEGIN
--   IF EXISTS (SELECT 1 FROM public.prog_proj_execucao_itens WHERE excesso_justificativa IS NOT NULL OR cancelado_origem IS NOT NULL)
--      OR EXISTS (SELECT 1 FROM public.prog_proj_execucoes WHERE cancelada_origem IS NOT NULL) THEN
--     RAISE EXCEPTION 'há exceção de meta ou cancelamento com origem registrada: rollback automático recusado';
--   END IF;
-- END $$;
-- DROP TRIGGER IF EXISTS proj_execucao_protege_composicao_trg ON public.composicao_dia;
-- DROP FUNCTION IF EXISTS public.fn_proj_execucao_protege_composicao();
-- DROP FUNCTION IF EXISTS public.fn_proj_execucao_composicao_tem_ativa(uuid);
-- DROP FUNCTION IF EXISTS public.fn_proj_execucao_cancelar_por_composicao(uuid, text, text, boolean, boolean, text);
-- DROP FUNCTION IF EXISTS public.fn_proj_execucao_retirar_projeto(uuid, uuid, text);
-- DROP FUNCTION IF EXISTS public.fn_proj_execucao_dia(date, uuid[]);
-- CREATE OR REPLACE FUNCTION public.prog_proj_execucao_proteger()
-- RETURNS trigger
-- LANGUAGE plpgsql
-- SECURITY INVOKER
-- SET search_path = public, pg_temp
-- AS $$
-- DECLARE
--   v_cols text[];
-- BEGIN
--   IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
--     RAISE EXCEPTION '%: exclusão não permitida (histórico de execução preservado)', TG_TABLE_NAME USING ERRCODE = '42501';
--   END IF;
--   IF TG_TABLE_NAME = 'prog_proj_execucao_lancamentos' THEN
--     RAISE EXCEPTION 'prog_proj_execucao_lancamentos: lançamento não é alterado; use estorno' USING ERRCODE = '42501';
--   END IF;
--   IF TG_TABLE_NAME = 'prog_proj_execucoes' THEN
--     v_cols := ARRAY['cancelada_em', 'cancelada_por_auth', 'motivo_cancelamento'];
--     IF OLD.cancelada_em IS NOT NULL THEN
--       RAISE EXCEPTION 'prog_proj_execucoes: execução cancelada não muda' USING ERRCODE = '42501';
--     END IF;
--   ELSE
--     v_cols := ARRAY['cancelado_em', 'cancelado_por_auth', 'motivo_cancelamento'];
--     IF OLD.cancelado_em IS NOT NULL THEN
--       RAISE EXCEPTION 'prog_proj_execucao_itens: item cancelado não muda' USING ERRCODE = '42501';
--     END IF;
--   END IF;
--   IF (to_jsonb(NEW) - v_cols) IS DISTINCT FROM (to_jsonb(OLD) - v_cols) THEN
--     RAISE EXCEPTION '%: só o cancelamento pode ser registrado', TG_TABLE_NAME USING ERRCODE = '42501';
--   END IF;
--   RETURN NEW;
-- END;
-- $$;
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
-- CREATE OR REPLACE FUNCTION public.fn_proj_saldo_atividades(p_projeto_id uuid)
-- RETURNS jsonb
-- LANGUAGE plpgsql
-- STABLE
-- SECURITY DEFINER
-- SET search_path = public, pg_temp
-- AS $$
-- DECLARE
--   v_estado text;
-- BEGIN
--   IF auth.uid() IS NULL THEN
--     RAISE EXCEPTION 'SEM_SESSAO: entre pelo login autenticado' USING ERRCODE = '42501';
--   END IF;
--   IF NOT public.fn_proj_execucao_pode_ler(p_projeto_id) THEN
--     RAISE EXCEPTION 'SEM_PERMISSAO: sem permissão para ver a execução deste projeto' USING ERRCODE = '42501';
--   END IF;
--   v_estado := public.sot_lms_estado_wl_calc(p_projeto_id);
--   RETURN jsonb_build_object('projeto_id', p_projeto_id, 'estado_wl', v_estado, 'atividades', coalesce((
--     SELECT jsonb_agg(jsonb_build_object('atividade_id', a.id, 'wl_id', a.wl_id, 'wl_codigo', w.codigo, 'codigo', a.codigo,
--              'descricao', a.descricao, 'unidade', a.unidade, 'qtd_prevista', a.qtd_prevista, 'qtd_executada', s.soma,
--              'saldo', coalesce(a.qtd_prevista, 0) - s.soma, 'excedente', s.soma > coalesce(a.qtd_prevista, 0),
--              'campo_diverge', coalesce(a.qtd_executada, 0) <> s.soma)
--            ORDER BY w.ordem, a.ordem_exec, a.codigo, a.id)
--     FROM public.sot_atividades a
--     JOIN public.sot_wl w ON w.id = a.wl_id
--     CROSS JOIN LATERAL (SELECT coalesce(sum(CASE WHEN l.tipo = 'ESTORNO' THEN -l.qtd ELSE l.qtd END), 0) AS soma
--                         FROM public.prog_proj_execucao_lancamentos l WHERE l.atividade_id = a.id) s
--     WHERE a.projeto_id = p_projeto_id AND a.deleted_at IS NULL AND NOT a.somente_descritivo
--       AND v_estado = 'ESTRUTURADO'), '[]'::jsonb));
-- END;
-- $$;
-- DROP FUNCTION IF EXISTS public.fn_proj_execucao_saldo_livre(uuid, date, uuid);
-- DROP FUNCTION IF EXISTS public.fn_proj_execucao_compromissos(uuid, date, uuid);
-- DROP FUNCTION IF EXISTS public.fn_proj_execucao_soma_atividade(uuid);
-- ALTER TABLE public.prog_proj_execucao_itens DROP CONSTRAINT IF EXISTS prog_proj_execucao_itens_excesso_chk;
-- ALTER TABLE public.prog_proj_execucao_itens DROP CONSTRAINT IF EXISTS prog_proj_execucao_itens_cancelamento_chk;
-- ALTER TABLE public.prog_proj_execucao_itens ADD CONSTRAINT prog_proj_execucao_itens_cancelamento_chk CHECK (
--   (cancelado_em IS NULL AND cancelado_por_auth IS NULL AND motivo_cancelamento IS NULL)
--   OR (cancelado_em IS NOT NULL AND cancelado_por_auth IS NOT NULL AND btrim(coalesce(motivo_cancelamento, '')) <> ''));
-- ALTER TABLE public.prog_proj_execucoes DROP CONSTRAINT IF EXISTS prog_proj_execucoes_cancelamento_chk;
-- ALTER TABLE public.prog_proj_execucoes ADD CONSTRAINT prog_proj_execucoes_cancelamento_chk CHECK (
--   (cancelada_em IS NULL AND cancelada_por_auth IS NULL AND motivo_cancelamento IS NULL)
--   OR (cancelada_em IS NOT NULL AND cancelada_por_auth IS NOT NULL AND btrim(coalesce(motivo_cancelamento, '')) <> ''));
-- ALTER TABLE public.prog_proj_execucao_itens DROP COLUMN IF EXISTS excesso_justificativa, DROP COLUMN IF EXISTS excesso_autorizado_por_auth,
--   DROP COLUMN IF EXISTS excesso_saldo_livre, DROP COLUMN IF EXISTS cancelado_origem;
-- ALTER TABLE public.prog_proj_execucoes DROP COLUMN IF EXISTS cancelada_origem;
-- UPDATE public.cena_acoes SET ativo = false WHERE codigo = 'PROJ_AUTORIZAR_EXCESSO_META';
-- NOTIFY pgrst, 'reload schema';
-- COMMIT;
