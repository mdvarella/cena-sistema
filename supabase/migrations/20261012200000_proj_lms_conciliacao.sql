-- ETAPA 1.6a (ENEL/LMS/WL) — Conciliação de projeto com legado × LMS ORIGINAL confirmado em CONCILIACAO
-- Base: docs/enel-wl/ETAPA-1.6-CONCILIACAO-DIAGNOSTICO.md (G1–G9 e P1/P2 aprovadas em 12/10/2026).
--   G1 substituição controlada: quando cada código bate (tipo + código + unidade iguais e soma exata) e nenhum item antigo
--      tem movimento, cria a estrutura do LMS (mesma regra da estrutura nova) e baixa os itens antigos (deleted_at),
--      registrando a substituição de cada um. Total por código não muda; é distribuído pelas WLs do LMS.
--   G2/P1 estrita: qualquer diferença (quantidade, unidade — inclusive UN antigo × US3/M/PC do LMS —, código só de um lado,
--      tipo trocado, item sem código) bloqueia. G3: item antigo com movimento bloqueia, com o motivo.
--   G5 nunca DELETE físico. G6 aplicar exige PROJ_CONFIRMAR_LMS (sot_lms_autorizar_confirmacao); PROJ_CONCILIAR_LMS
--      (20261007190000) existe e NÃO é usada aqui (refinamento futuro). G7/P2 uma regra de criação só: a estrutura nova da
--      1.4 passa a usar as mesmas funções internas, com o mesmo comportamento e as mesmas mensagens.
-- Fora: tela, medição de teste do ETD VARGINHA (G4: ação separada), importador antigo (G9).
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
  IF to_regprocedure('public.sot_lms_autorizar(uuid)') IS NULL
     OR to_regprocedure('public.sot_lms_autorizar_confirmacao(uuid)') IS NULL
     OR to_regprocedure('public.sot_lms_estado_wl_calc(uuid)') IS NULL
     OR to_regprocedure('public.cena_usuario_perfil_sessao()') IS NULL
     OR to_regprocedure('public.fn_proj_codigo_norm(text)') IS NULL
     OR to_regprocedure('public.fn_proj_texto_norm(text)') IS NULL THEN
    RAISE EXCEPTION 'aplique antes as migrations da Etapa 1.3 (origem e confirmação)';
  END IF;
  IF to_regprocedure('public.fn_proj_lms_aplicar_estrutura_nova(uuid)') IS NULL
     OR to_regprocedure('public.sot_projeto_processo_contexto(uuid)') IS NULL
     OR to_regclass('public.sot_wl') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                    AND table_name = 'sot_lms_importacoes' AND column_name = 'conciliacao_aplicada_em') THEN
    RAISE EXCEPTION 'aplique antes 20261011200000_proj_wl_estrutura.sql (Etapa 1.4)';
  END IF;
  -- Tabelas consultadas na checagem de movimento (G3): sem elas a checagem não seria completa.
  IF to_regclass('public.sot_med_itens') IS NULL OR to_regclass('public.plpt_requisicoes_materiais') IS NULL
     OR to_regclass('public.sot_adicionais') IS NULL OR to_regclass('public.sot_atividades_historico') IS NULL
     OR to_regclass('public.sot_materiais_historico') IS NULL THEN
    RAISE EXCEPTION 'tabelas de movimento ausentes (sot_med_itens, plpt_requisicoes_materiais, sot_adicionais, históricos)';
  END IF;
END $$;

-- ── 1. Registro da substituição (G5) ─────────────────────────────────────
-- Uma linha por item antigo substituído: retrato completo antes da baixa + linhas do LMS e itens novos que o substituíram.
-- Só inclusão: sem UPDATE/DELETE/TRUNCATE por ninguém. Sem grants: lido e gravado só pelas funções.
CREATE TABLE IF NOT EXISTS public.sot_lms_conciliacao (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  importacao_id            uuid NOT NULL REFERENCES public.sot_lms_importacoes(id) ON DELETE RESTRICT,
  projeto_id               uuid NOT NULL,
  legado_tipo              text NOT NULL CHECK (legado_tipo IN ('ATIVIDADE', 'MATERIAL')),
  legado_id                uuid NOT NULL,
  codigo_norm              text NOT NULL,
  unidade_norm             text,
  decisao                  text NOT NULL CHECK (decisao IN ('SUBSTITUIDO')),
  retrato                  jsonb NOT NULL,
  lms_linha_ids            uuid[] NOT NULL,
  novos_ids                uuid[] NOT NULL,
  aplicado_em              timestamptz NOT NULL DEFAULT now(),
  aplicado_por_auth        uuid NOT NULL,
  aplicado_por_usuario_id  text NOT NULL,
  CONSTRAINT sot_lms_conciliacao_vinculos_chk CHECK (cardinality(lms_linha_ids) > 0 AND cardinality(novos_ids) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS sot_lms_conciliacao_legado_uidx ON public.sot_lms_conciliacao (legado_tipo, legado_id);
CREATE INDEX IF NOT EXISTS sot_lms_conciliacao_importacao_idx ON public.sot_lms_conciliacao (importacao_id);

ALTER TABLE public.sot_lms_conciliacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sot_lms_conciliacao FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sot_lms_conciliacao FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sot_lms_conciliacao_proteger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'sot_lms_conciliacao: registro de conciliação não é alterado nem apagado' USING ERRCODE = '42501';
END;
$$;
DROP TRIGGER IF EXISTS sot_lms_conciliacao_proteger_trg ON public.sot_lms_conciliacao;
CREATE TRIGGER sot_lms_conciliacao_proteger_trg BEFORE UPDATE OR DELETE ON public.sot_lms_conciliacao
  FOR EACH ROW EXECUTE FUNCTION public.sot_lms_conciliacao_proteger();
DROP TRIGGER IF EXISTS sot_lms_conciliacao_truncate_trg ON public.sot_lms_conciliacao;
CREATE TRIGGER sot_lms_conciliacao_truncate_trg BEFORE TRUNCATE ON public.sot_lms_conciliacao
  FOR EACH STATEMENT EXECUTE FUNCTION public.sot_lms_conciliacao_proteger();

-- ── 2. Marca de conciliação aplicada e evento ────────────────────────────
ALTER TABLE public.sot_lms_importacoes DROP CONSTRAINT IF EXISTS sot_lms_importacoes_conciliacao_chk;
ALTER TABLE public.sot_lms_importacoes ADD  CONSTRAINT sot_lms_importacoes_conciliacao_chk CHECK (
  (conciliacao_aplicada_em IS NULL AND conciliacao_aplicada_por_auth IS NULL)
  OR (conciliacao_aplicada_em IS NOT NULL AND conciliacao_aplicada_por_auth IS NOT NULL
      AND status = 'CONFIRMADA' AND modo = 'CONCILIACAO'));

ALTER TABLE public.sot_lms_importacao_eventos DROP CONSTRAINT IF EXISTS sot_lms_importacao_eventos_tipo_chk;
ALTER TABLE public.sot_lms_importacao_eventos ADD  CONSTRAINT sot_lms_importacao_eventos_tipo_chk
  CHECK (tipo_evento IN ('CRIADA', 'REENVIO', 'CONFIRMADA', 'ESTRUTURA_APLICADA', 'CONCILIACAO_APLICADA'));

-- ── 3. Regra compartilhada (G7/P2): problemas de linha, validação e criação da estrutura ──
-- Problemas de linha do LMS (mesmas consultas, limites e ordem da 1.4). null = sem problema.
CREATE OR REPLACE FUNCTION public.fn_proj_lms_linhas_problemas(p_importacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_nao_class text;
  v_sem_wl    text;
  v_repetidas text;
BEGIN
  -- D3: toda linha precisa ser serviço (I-/R-) ou material (numérico), ter WL e descrição.
  SELECT string_agg(l.linha_excel::text, ', ' ORDER BY l.linha_excel) INTO v_nao_class
  FROM (SELECT linha_excel FROM public.sot_lms_linhas
        WHERE importacao_id = p_importacao_id
          AND (codigo_norm IS NULL OR NOT (codigo_norm ~ '^[IR]-' OR codigo_norm ~ '^[0-9]+$'))
        ORDER BY linha_excel LIMIT 50) l;
  SELECT string_agg(l.linha_excel::text, ', ' ORDER BY l.linha_excel) INTO v_sem_wl
  FROM (SELECT linha_excel FROM public.sot_lms_linhas
        WHERE importacao_id = p_importacao_id AND (wl_norm IS NULL OR nullif(btrim(coalesce(descricao_raw, '')), '') IS NULL)
        ORDER BY linha_excel LIMIT 50) l;
  -- D1: a chave WL + código + FT + KIT não pode repetir dentro do arquivo.
  SELECT string_agg(g.linhas, ' | ') INTO v_repetidas
  FROM (SELECT string_agg(linha_excel::text, ',' ORDER BY linha_excel) AS linhas
        FROM public.sot_lms_linhas WHERE importacao_id = p_importacao_id
        GROUP BY wl_norm, codigo_norm, coalesce(ft_norm, ''), coalesce(kit_norm, '')
        HAVING count(*) > 1 LIMIT 20) g;
  RETURN jsonb_build_object('nao_classificada', v_nao_class, 'sem_wl_ou_descricao', v_sem_wl, 'repetidas', v_repetidas);
END;
$$;

-- Recusa (mesmas mensagens da 1.4 com o prefixo de quem chama: 'WL aplicar' ou 'Conciliação').
CREATE OR REPLACE FUNCTION public.fn_proj_lms_validar_linhas(p_importacao_id uuid, p_prefixo text)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_p jsonb := public.fn_proj_lms_linhas_problemas(p_importacao_id);
BEGIN
  IF v_p->>'nao_classificada' IS NOT NULL THEN
    RAISE EXCEPTION '%: LINHA_NAO_CLASSIFICADA (linhas %)', p_prefixo, v_p->>'nao_classificada' USING ERRCODE = '55000';
  END IF;
  IF v_p->>'sem_wl_ou_descricao' IS NOT NULL THEN
    RAISE EXCEPTION '%: LINHA_SEM_WL_OU_DESCRICAO (linhas %)', p_prefixo, v_p->>'sem_wl_ou_descricao' USING ERRCODE = '55000';
  END IF;
  IF v_p->>'repetidas' IS NOT NULL THEN
    RAISE EXCEPTION '%: LINHAS_REPETIDAS_NA_CHAVE (linhas %)', p_prefixo, v_p->>'repetidas' USING ERRCODE = '55000';
  END IF;
END;
$$;

-- Criação da estrutura (WLs, atividades, materiais) a partir das linhas do LMS — a mesma regra da 1.4 (D4/D5/D6).
-- Quem chama já autorizou, travou, validou as linhas e conferiu que o projeto não tem WL.
CREATE OR REPLACE FUNCTION public.fn_proj_lms_criar_estrutura(p_importacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_imp        public.sot_lms_importacoes%ROWTYPE;
  v_contrato   text;
  v_n_wl       integer;
  v_n_ativ     integer;
  v_n_mat_op   integer;
  v_n_mat_desc integer;
BEGIN
  SELECT * INTO v_imp FROM public.sot_lms_importacoes WHERE id = p_importacao_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'estrutura LMS: importação inexistente' USING ERRCODE = 'P0002';
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

  RETURN jsonb_build_object('wls', v_n_wl, 'atividades', v_n_ativ, 'materiais_operacionais', v_n_mat_op,
                            'materiais_retirada_descritivos', v_n_mat_desc);
END;
$$;

-- ── 4. Estrutura nova da 1.4 reescrita sobre a regra compartilhada (mesmo comportamento e mensagens) ──
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
  v_leg_ativ  integer;
  v_leg_mat   integer;
  v_res       jsonb;
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

  -- D3/D1 (regra compartilhada).
  PERFORM public.fn_proj_lms_validar_linhas(v_imp.id, 'WL aplicar');

  -- D4/D5/D6 (regra compartilhada).
  v_res := public.fn_proj_lms_criar_estrutura(v_imp.id);

  -- Marca de estrutura aplicada (marcador vinculado a ESTA importação) + evento.
  PERFORM set_config('cena.lms_status_autorizado', v_imp.id::text, true);
  UPDATE public.sot_lms_importacoes
     SET estrutura_aplicada_em = now(), estrutura_aplicada_por_auth = auth.uid()
   WHERE id = v_imp.id;
  PERFORM set_config('cena.lms_status_autorizado', '', true);

  INSERT INTO public.sot_lms_importacao_eventos (importacao_id, tipo_evento, por_auth, por_usuario_id, detalhe)
  VALUES (v_imp.id, 'ESTRUTURA_APLICADA', auth.uid(), v_usuario,
    jsonb_build_object('projeto_id', v_imp.projeto_id, 'hash', v_imp.hash_sha256, 'wls', v_res->'wls',
                       'atividades', v_res->'atividades', 'materiais_operacionais', v_res->'materiais_operacionais',
                       'materiais_retirada_descritivos', v_res->'materiais_retirada_descritivos'));

  RETURN jsonb_build_object('operacao', 'ESTRUTURA_APLICADA', 'importacao_id', v_imp.id, 'projeto_id', v_imp.projeto_id,
    'wls', v_res->'wls', 'atividades', v_res->'atividades', 'materiais_operacionais', v_res->'materiais_operacionais',
    'materiais_retirada_descritivos', v_res->'materiais_retirada_descritivos',
    'estado_wl', public.sot_lms_estado_wl_calc(v_imp.projeto_id));
END;
$$;

-- ── 5. Análise da conciliação (usada pela prévia e revalidada pela aplicação) ──
-- Chave: tipo (serviço I-/R- = atividade; numérico = material) + código normalizado. Itens antigos = ativos sem WL
-- (inclusive só descritivos). Bate: uma única unidade normalizada igual nos dois lados e soma exata das quantidades.
-- Movimento (G3): qualquer quantidade operacional ≠ 0, item de medição, requisição que cite o id, adicional, histórico.
-- Projeto sem item antigo: não há batimento (conciliação = estrutura do LMS).
CREATE OR REPLACE FUNCTION public.fn_proj_lms_conciliacao_analise(p_importacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_imp       public.sot_lms_importacoes%ROWTYPE;
  v_itens     jsonb;
  v_n_legado  integer;
  v_bloq      jsonb;
BEGIN
  SELECT * INTO v_imp FROM public.sot_lms_importacoes WHERE id = p_importacao_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'conciliação: importação inexistente' USING ERRCODE = 'P0002';
  END IF;

  WITH leg AS (
    SELECT 'ATIVIDADE'::text AS tipo, a.id, public.fn_proj_codigo_norm(a.codigo) AS cod,
           public.fn_proj_texto_norm(a.unidade) AS un, a.qtd_prevista AS qtd, a.descricao,
           array_remove(ARRAY[
             CASE WHEN coalesce(a.qtd_viabilizada, 0) <> 0 THEN 'QTD_VIABILIZADA' END,
             CASE WHEN coalesce(a.qtd_executada, 0) <> 0 THEN 'QTD_EXECUTADA' END,
             CASE WHEN coalesce(a.qtd_medida, 0) <> 0 THEN 'QTD_MEDIDA' END,
             CASE WHEN coalesce(a.qtd_faturada, 0) <> 0 THEN 'QTD_FATURADA' END,
             CASE WHEN EXISTS (SELECT 1 FROM public.sot_med_itens mi WHERE mi.atividade_id::text = a.id::text) THEN 'MEDICAO' END,
             CASE WHEN EXISTS (SELECT 1 FROM public.sot_atividades_historico h WHERE h.atividade_id::text = a.id::text) THEN 'HISTORICO' END
           ], NULL) AS mov
    FROM public.sot_atividades a
    WHERE a.projeto_id = v_imp.projeto_id AND a.wl_id IS NULL AND a.deleted_at IS NULL
    UNION ALL
    SELECT 'MATERIAL', m.id, public.fn_proj_codigo_norm(m.codigo_sap), public.fn_proj_texto_norm(m.unidade),
           m.qtd_projetada, m.descricao,
           array_remove(ARRAY[
             CASE WHEN coalesce(m.qtd_viabilizada, 0) <> 0 THEN 'QTD_VIABILIZADA' END,
             CASE WHEN coalesce(m.qtd_requisitada, 0) <> 0 THEN 'QTD_REQUISITADA' END,
             CASE WHEN coalesce(m.qtd_entregue, 0) <> 0 THEN 'QTD_ENTREGUE' END,
             CASE WHEN coalesce(m.qtd_aplicada, 0) <> 0 THEN 'QTD_APLICADA' END,
             CASE WHEN coalesce(m.qtd_devolvida, 0) <> 0 THEN 'QTD_DEVOLVIDA' END,
             CASE WHEN coalesce(m.qtd_processada_sap, 0) <> 0 THEN 'QTD_PROCESSADA_SAP' END,
             -- itens é JSON (array ou texto JSON): qualquer menção ao id conta (conservador: só pode bloquear a mais)
             CASE WHEN EXISTS (SELECT 1 FROM public.plpt_requisicoes_materiais r
                               WHERE r.projeto_id::text = v_imp.projeto_id::text AND r.deleted_at IS NULL
                                 AND position(m.id::text IN coalesce(r.itens::text, '')) > 0) THEN 'REQUISICAO' END,
             CASE WHEN EXISTS (SELECT 1 FROM public.sot_adicionais ad
                               WHERE ad.catalog_id::text = m.id::text AND ad.deleted_at IS NULL) THEN 'ADICIONAL' END,
             CASE WHEN EXISTS (SELECT 1 FROM public.sot_materiais_historico h WHERE h.material_id::text = m.id::text) THEN 'HISTORICO' END
           ], NULL)
    FROM public.sot_materiais m
    WHERE m.projeto_id = v_imp.projeto_id AND m.wl_id IS NULL AND m.deleted_at IS NULL
  ),
  leg_g AS (
    SELECT tipo, cod,
           count(DISTINCT coalesce(un, '∅')) AS n_un, min(coalesce(un, '∅')) AS un,
           sum(qtd) AS soma, bool_or(qtd IS NULL) AS qtd_nula,
           bool_or(cardinality(mov) > 0) AS com_mov,
           jsonb_agg(jsonb_build_object('id', id, 'descricao', descricao, 'unidade', un, 'qtd', qtd, 'movimento', to_jsonb(mov))
                     ORDER BY descricao, id) AS itens
    FROM leg GROUP BY tipo, cod
  ),
  lms AS (
    SELECT CASE WHEN l.codigo_norm ~ '^[IR]-' THEN 'ATIVIDADE' WHEN l.codigo_norm ~ '^[0-9]+$' THEN 'MATERIAL' END AS tipo,
           l.codigo_norm AS cod, l.umd_norm AS un, l.qtd_plan AS qtd, l.wl_norm, l.ft_norm, l.kit_norm, l.linha_excel, l.ordem
    FROM public.sot_lms_linhas l WHERE l.importacao_id = v_imp.id
  ),
  lms_g AS (
    SELECT tipo, cod,
           count(DISTINCT coalesce(un, '∅')) AS n_un, min(coalesce(un, '∅')) AS un,
           sum(qtd) AS soma, bool_or(qtd IS NULL) AS qtd_nula,
           jsonb_agg(jsonb_build_object('wl', wl_norm, 'ft', ft_norm, 'kit', kit_norm, 'unidade', un, 'qtd', qtd,
                                        'linha_excel', linha_excel) ORDER BY ordem) AS linhas
    FROM lms WHERE tipo IS NOT NULL GROUP BY tipo, cod
  ),
  junto AS (
    SELECT coalesce(g.tipo, s.tipo) AS tipo, coalesce(g.cod, s.cod) AS cod, g.n_un AS g_n_un, g.un AS g_un, g.soma AS g_soma,
           g.qtd_nula AS g_nula, coalesce(g.com_mov, false) AS com_mov, g.itens,
           s.n_un AS s_n_un, s.un AS s_un, s.soma AS s_soma, s.qtd_nula AS s_nula, s.linhas
    FROM leg_g g FULL JOIN lms_g s ON s.tipo = g.tipo AND s.cod = g.cod
  ),
  cls AS (
    SELECT j.*,
      CASE
        WHEN j.cod IS NULL THEN 'SEM_CODIGO'
        WHEN j.itens IS NOT NULL AND NOT ((j.tipo = 'ATIVIDADE' AND j.cod ~ '^[IR]-') OR (j.tipo = 'MATERIAL' AND j.cod ~ '^[0-9]+$'))
          THEN 'TIPO_DIFERENTE'
        WHEN j.linhas IS NULL THEN 'SO_NO_LEGADO'
        WHEN j.itens IS NULL THEN 'SO_NO_LMS'
        WHEN j.g_n_un <> 1 OR j.s_n_un <> 1 OR j.g_un = '∅' OR j.s_un = '∅' OR j.g_un <> j.s_un THEN 'UNIDADE_DIFERENTE'
        WHEN j.g_nula OR j.s_nula OR j.g_soma <> j.s_soma THEN 'QTD_DIFERENTE'
        WHEN j.com_mov THEN 'COM_MOVIMENTO'
        ELSE 'BATE'
      END AS situacao
    FROM junto j
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'tipo', c.tipo, 'codigo', c.cod, 'situacao', c.situacao, 'com_movimento', c.com_mov,
           'unidade_legado', nullif(c.g_un, '∅'), 'unidade_lms', nullif(c.s_un, '∅'),
           'qtd_legado', c.g_soma, 'qtd_lms', c.s_soma,
           'legado', coalesce(c.itens, '[]'::jsonb), 'lms', coalesce(c.linhas, '[]'::jsonb))
         ORDER BY c.tipo, c.cod), '[]'::jsonb)
    INTO v_itens
  FROM cls c;

  SELECT count(*) INTO v_n_legado FROM (
    SELECT 1 FROM public.sot_atividades a WHERE a.projeto_id = v_imp.projeto_id AND a.wl_id IS NULL AND a.deleted_at IS NULL
    UNION ALL
    SELECT 1 FROM public.sot_materiais m WHERE m.projeto_id = v_imp.projeto_id AND m.wl_id IS NULL AND m.deleted_at IS NULL) x;

  IF v_n_legado = 0 THEN
    -- sem item antigo: nada a bater; a estrutura do LMS entra inteira (situação informativa)
    SELECT coalesce(jsonb_agg(e || jsonb_build_object('situacao', 'SEM_LEGADO') ORDER BY e->>'tipo', e->>'codigo'), '[]'::jsonb)
      INTO v_itens FROM jsonb_array_elements(v_itens) e;
    v_bloq := '{}'::jsonb;
  ELSE
    -- G3: com movimento conta mesmo quando o código também tem outra diferença
    SELECT coalesce(jsonb_object_agg(s, n), '{}'::jsonb) INTO v_bloq
    FROM (SELECT s, count(*) AS n FROM (
            SELECT e->>'situacao' AS s FROM jsonb_array_elements(v_itens) e WHERE e->>'situacao' <> 'BATE'
            UNION ALL
            SELECT 'COM_MOVIMENTO' FROM jsonb_array_elements(v_itens) e
             WHERE (e->>'com_movimento')::boolean AND e->>'situacao' NOT IN ('BATE', 'COM_MOVIMENTO')) t
          GROUP BY s) q;
  END IF;

  RETURN jsonb_build_object('legado_itens', v_n_legado, 'bloqueios', v_bloq,
    'linhas_problema', public.fn_proj_lms_linhas_problemas(v_imp.id), 'itens', v_itens);
END;
$$;

-- ── 6. Prévia (somente leitura) ──────────────────────────────────────────
-- Leitura com PROJ_IMPORTAR_LMS ou PROJ_CONFIRMAR_LMS; pode_aplicar só com PROJ_CONFIRMAR_LMS e nenhum bloqueio.
CREATE OR REPLACE FUNCTION public.sot_lms_conciliacao_previa(p_importacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_imp     public.sot_lms_importacoes%ROWTYPE;
  v_ler     text;
  v_conf    text;
  v_an      jsonb;
  v_bloq    jsonb := '[]'::jsonb;
  v_lp      jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Conciliação prévia: sem sessão' USING ERRCODE = '42501';
  END IF;
  IF public.cena_usuario_perfil_sessao() IS NULL THEN
    RAISE EXCEPTION 'Conciliação prévia: USUARIO_ERP_INATIVO' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_imp FROM public.sot_lms_importacoes WHERE id = p_importacao_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conciliação prévia: importação inexistente' USING ERRCODE = 'P0002';
  END IF;
  v_ler  := public.sot_lms_autorizar(v_imp.projeto_id);
  v_conf := public.sot_lms_autorizar_confirmacao(v_imp.projeto_id);
  IF v_ler <> 'OK' AND v_conf <> 'OK' THEN
    RAISE EXCEPTION 'Conciliação prévia: acesso negado (%)', v_ler USING ERRCODE = '42501';
  END IF;

  IF v_imp.conciliacao_aplicada_em IS NOT NULL THEN
    RETURN jsonb_build_object('importacao_id', v_imp.id, 'projeto_id', v_imp.projeto_id,
      'estado', public.sot_lms_estado_wl_calc(v_imp.projeto_id), 'aplicada', true,
      'conciliacao_aplicada_em', v_imp.conciliacao_aplicada_em, 'pode_aplicar', false, 'bloqueios', jsonb_build_array('JA_APLICADA'),
      'itens_substituidos', (SELECT count(*) FROM public.sot_lms_conciliacao c WHERE c.importacao_id = v_imp.id));
  END IF;
  IF v_imp.tipo_importacao <> 'ORIGINAL' OR v_imp.status <> 'CONFIRMADA' OR v_imp.modo IS DISTINCT FROM 'CONCILIACAO' THEN
    RETURN jsonb_build_object('importacao_id', v_imp.id, 'projeto_id', v_imp.projeto_id,
      'estado', public.sot_lms_estado_wl_calc(v_imp.projeto_id), 'aplicada', false, 'pode_aplicar', false,
      'bloqueios', jsonb_build_array('IMPORTACAO_NAO_ELEGIVEL'));
  END IF;
  IF EXISTS (SELECT 1 FROM public.sot_wl w WHERE w.projeto_id = v_imp.projeto_id AND w.cancelada_em IS NULL) THEN
    v_bloq := v_bloq || jsonb_build_array('PROJETO_JA_TEM_WL');
  END IF;

  v_an := public.fn_proj_lms_conciliacao_analise(v_imp.id);
  v_lp := v_an->'linhas_problema';
  IF v_lp->>'nao_classificada' IS NOT NULL THEN v_bloq := v_bloq || jsonb_build_array('LINHA_NAO_CLASSIFICADA'); END IF;
  IF v_lp->>'sem_wl_ou_descricao' IS NOT NULL THEN v_bloq := v_bloq || jsonb_build_array('LINHA_SEM_WL_OU_DESCRICAO'); END IF;
  IF v_lp->>'repetidas' IS NOT NULL THEN v_bloq := v_bloq || jsonb_build_array('LINHAS_REPETIDAS_NA_CHAVE'); END IF;
  SELECT v_bloq || coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb) INTO v_bloq FROM jsonb_object_keys(v_an->'bloqueios') k;

  RETURN jsonb_build_object(
    'importacao_id', v_imp.id, 'projeto_id', v_imp.projeto_id,
    'estado', public.sot_lms_estado_wl_calc(v_imp.projeto_id), 'aplicada', false,
    'pode_aplicar', (v_conf = 'OK' AND jsonb_array_length(v_bloq) = 0),
    'bloqueios', v_bloq,
    'resumo', jsonb_build_object(
      'legado_itens', v_an->'legado_itens',
      'codigos', jsonb_array_length(v_an->'itens'),
      'por_situacao', (SELECT coalesce(jsonb_object_agg(s, n), '{}'::jsonb) FROM (
                         SELECT e->>'situacao' AS s, count(*) AS n FROM jsonb_array_elements(v_an->'itens') e GROUP BY 1) q),
      'linhas_lms', (SELECT count(*) FROM public.sot_lms_linhas l WHERE l.importacao_id = v_imp.id),
      'wls', (SELECT count(DISTINCT l.wl_norm) FROM public.sot_lms_linhas l WHERE l.importacao_id = v_imp.id)),
    'linhas_problema', v_lp,
    'itens', v_an->'itens');
END;
$$;

-- ── 7. Aplicar conciliação (atômica, fail-closed) ────────────────────────
CREATE OR REPLACE FUNCTION public.fn_proj_lms_aplicar_conciliacao(p_importacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_imp       public.sot_lms_importacoes%ROWTYPE;
  v_motivo    text;
  v_usuario   text;
  v_an        jsonb;
  v_resumo    text;
  v_res       jsonb;
  v_reg_a     integer;
  v_reg_m     integer;
  v_baixa_a   integer;
  v_baixa_m   integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Conciliação: sem sessão' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_imp FROM public.sot_lms_importacoes WHERE id = p_importacao_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conciliação: importação inexistente' USING ERRCODE = 'P0002';
  END IF;

  -- G6: mesma autorização da estrutura nova (PROJ_CONFIRMAR_LMS). PROJ_CONCILIAR_LMS fica para refinamento futuro.
  v_motivo := public.sot_lms_autorizar_confirmacao(v_imp.projeto_id);
  IF v_motivo <> 'OK' THEN
    RAISE EXCEPTION 'Conciliação: %', v_motivo USING ERRCODE = '42501';
  END IF;
  SELECT us.id::text INTO v_usuario FROM public.usuarios_sistema us
  WHERE us.auth_user_id = auth.uid() AND us.ativo IS TRUE AND us.deleted_at IS NULL
  LIMIT 1;
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Conciliação: usuário ERP inexistente ou inativo' USING ERRCODE = '42501';
  END IF;

  -- Serializa com a confirmação/estrutura do mesmo projeto e relê sob lock.
  PERFORM pg_advisory_xact_lock(hashtextextended('sot_lms_confirmar|' || v_imp.projeto_id::text, 0));
  SELECT * INTO v_imp FROM public.sot_lms_importacoes WHERE id = p_importacao_id FOR UPDATE;

  IF v_imp.conciliacao_aplicada_em IS NOT NULL THEN
    RETURN jsonb_build_object('operacao', 'JA_APLICADA', 'importacao_id', v_imp.id, 'projeto_id', v_imp.projeto_id,
      'wls', (SELECT count(*) FROM public.sot_wl w WHERE w.importacao_id = v_imp.id AND w.cancelada_em IS NULL),
      'itens_antigos_substituidos', (SELECT count(*) FROM public.sot_lms_conciliacao c WHERE c.importacao_id = v_imp.id),
      'estado_wl', public.sot_lms_estado_wl_calc(v_imp.projeto_id));
  END IF;
  IF v_imp.tipo_importacao <> 'ORIGINAL' OR v_imp.status <> 'CONFIRMADA' OR v_imp.modo IS DISTINCT FROM 'CONCILIACAO' THEN
    RAISE EXCEPTION 'Conciliação: IMPORTACAO_NAO_ELEGIVEL (tipo %, status %, modo %)',
      v_imp.tipo_importacao, v_imp.status, coalesce(v_imp.modo, '-') USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sot_wl w WHERE w.projeto_id = v_imp.projeto_id AND w.cancelada_em IS NULL) THEN
    RAISE EXCEPTION 'Conciliação: PROJETO_JA_TEM_WL' USING ERRCODE = '55000';
  END IF;

  -- Trava os itens antigos (ninguém altera quantidade/código entre a análise e a baixa).
  PERFORM 1 FROM public.sot_atividades a WHERE a.projeto_id = v_imp.projeto_id AND a.wl_id IS NULL AND a.deleted_at IS NULL FOR UPDATE;
  PERFORM 1 FROM public.sot_materiais m WHERE m.projeto_id = v_imp.projeto_id AND m.wl_id IS NULL AND m.deleted_at IS NULL FOR UPDATE;

  -- Linhas do LMS (regra compartilhada) e batimento/movimento revalidados aqui (a prévia não é confiável sozinha).
  PERFORM public.fn_proj_lms_validar_linhas(v_imp.id, 'Conciliação');
  v_an := public.fn_proj_lms_conciliacao_analise(v_imp.id);
  IF v_an->'bloqueios' <> '{}'::jsonb THEN
    SELECT string_agg(k || ' ' || (v_an->'bloqueios'->>k), ', ' ORDER BY k) INTO v_resumo FROM jsonb_object_keys(v_an->'bloqueios') k;
    RAISE EXCEPTION 'Conciliação: CONCILIACAO_BLOQUEADA (%)', v_resumo USING ERRCODE = '55000';
  END IF;

  -- Estrutura do LMS (regra compartilhada com a estrutura nova).
  v_res := public.fn_proj_lms_criar_estrutura(v_imp.id);

  -- Registro da substituição (uma linha por item antigo) e baixa sem DELETE.
  INSERT INTO public.sot_lms_conciliacao (importacao_id, projeto_id, legado_tipo, legado_id, codigo_norm, unidade_norm,
                                          decisao, retrato, lms_linha_ids, novos_ids, aplicado_por_auth, aplicado_por_usuario_id)
  SELECT v_imp.id, v_imp.projeto_id, 'ATIVIDADE', a.id, public.fn_proj_codigo_norm(a.codigo), public.fn_proj_texto_norm(a.unidade),
         'SUBSTITUIDO', to_jsonb(a),
         ARRAY(SELECT l.id FROM public.sot_lms_linhas l
                WHERE l.importacao_id = v_imp.id AND l.codigo_norm = public.fn_proj_codigo_norm(a.codigo) ORDER BY l.ordem),
         ARRAY(SELECT x.id FROM public.sot_atividades x JOIN public.sot_lms_linhas l ON l.id = x.lms_linha_id
                WHERE l.importacao_id = v_imp.id AND l.codigo_norm = public.fn_proj_codigo_norm(a.codigo)
                  AND x.deleted_at IS NULL ORDER BY l.ordem),
         auth.uid(), v_usuario
  FROM public.sot_atividades a
  WHERE a.projeto_id = v_imp.projeto_id AND a.wl_id IS NULL AND a.deleted_at IS NULL;
  GET DIAGNOSTICS v_reg_a = ROW_COUNT;

  INSERT INTO public.sot_lms_conciliacao (importacao_id, projeto_id, legado_tipo, legado_id, codigo_norm, unidade_norm,
                                          decisao, retrato, lms_linha_ids, novos_ids, aplicado_por_auth, aplicado_por_usuario_id)
  SELECT v_imp.id, v_imp.projeto_id, 'MATERIAL', m.id, public.fn_proj_codigo_norm(m.codigo_sap), public.fn_proj_texto_norm(m.unidade),
         'SUBSTITUIDO', to_jsonb(m),
         ARRAY(SELECT l.id FROM public.sot_lms_linhas l
                WHERE l.importacao_id = v_imp.id AND l.codigo_norm = public.fn_proj_codigo_norm(m.codigo_sap) ORDER BY l.ordem),
         ARRAY(SELECT x.id FROM public.sot_materiais x JOIN public.sot_lms_linhas l ON l.id = x.lms_linha_id
                WHERE l.importacao_id = v_imp.id AND l.codigo_norm = public.fn_proj_codigo_norm(m.codigo_sap)
                  AND x.deleted_at IS NULL ORDER BY l.ordem),
         auth.uid(), v_usuario
  FROM public.sot_materiais m
  WHERE m.projeto_id = v_imp.projeto_id AND m.wl_id IS NULL AND m.deleted_at IS NULL;
  GET DIAGNOSTICS v_reg_m = ROW_COUNT;

  UPDATE public.sot_atividades SET deleted_at = now()
   WHERE projeto_id = v_imp.projeto_id AND wl_id IS NULL AND deleted_at IS NULL;
  GET DIAGNOSTICS v_baixa_a = ROW_COUNT;
  UPDATE public.sot_materiais SET deleted_at = now()
   WHERE projeto_id = v_imp.projeto_id AND wl_id IS NULL AND deleted_at IS NULL;
  GET DIAGNOSTICS v_baixa_m = ROW_COUNT;
  IF v_baixa_a <> v_reg_a OR v_baixa_m <> v_reg_m THEN
    RAISE EXCEPTION 'Conciliação: registro e baixa divergentes (atividades %/%, materiais %/%)', v_reg_a, v_baixa_a, v_reg_m, v_baixa_m
      USING ERRCODE = '55000';
  END IF;

  -- Marca de conciliação aplicada (marcador vinculado a ESTA importação) + evento.
  PERFORM set_config('cena.lms_status_autorizado', v_imp.id::text, true);
  UPDATE public.sot_lms_importacoes
     SET conciliacao_aplicada_em = now(), conciliacao_aplicada_por_auth = auth.uid()
   WHERE id = v_imp.id;
  PERFORM set_config('cena.lms_status_autorizado', '', true);

  INSERT INTO public.sot_lms_importacao_eventos (importacao_id, tipo_evento, por_auth, por_usuario_id, detalhe)
  VALUES (v_imp.id, 'CONCILIACAO_APLICADA', auth.uid(), v_usuario,
    jsonb_build_object('projeto_id', v_imp.projeto_id, 'hash', v_imp.hash_sha256, 'wls', v_res->'wls',
                       'atividades', v_res->'atividades', 'materiais_operacionais', v_res->'materiais_operacionais',
                       'materiais_retirada_descritivos', v_res->'materiais_retirada_descritivos',
                       'atividades_antigas_substituidas', v_reg_a, 'materiais_antigos_substituidos', v_reg_m));

  RETURN jsonb_build_object('operacao', 'CONCILIACAO_APLICADA', 'importacao_id', v_imp.id, 'projeto_id', v_imp.projeto_id,
    'wls', v_res->'wls', 'atividades', v_res->'atividades', 'materiais_operacionais', v_res->'materiais_operacionais',
    'materiais_retirada_descritivos', v_res->'materiais_retirada_descritivos',
    'itens_antigos_substituidos', v_reg_a + v_reg_m,
    'estado_wl', public.sot_lms_estado_wl_calc(v_imp.projeto_id));
END;
$$;

-- ── 8. Grants ────────────────────────────────────────────────────────────
-- Internas (regra compartilhada, análise, trava): ninguém chama direto pela API.
REVOKE ALL ON FUNCTION public.fn_proj_lms_linhas_problemas(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_lms_validar_linhas(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_lms_criar_estrutura(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_lms_conciliacao_analise(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sot_lms_conciliacao_proteger() FROM PUBLIC, anon, authenticated, service_role;
-- Públicas da etapa: só authenticated (sessão real).
REVOKE ALL ON FUNCTION public.sot_lms_conciliacao_previa(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_lms_aplicar_conciliacao(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.fn_proj_lms_aplicar_estrutura_nova(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.sot_lms_conciliacao_previa(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_proj_lms_aplicar_conciliacao(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_proj_lms_aplicar_estrutura_nova(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Validação
-- SELECT p.oid::regprocedure, p.prosecdef, p.provolatile, p.proconfig,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
--        has_function_privilege('service_role', p.oid, 'EXECUTE') AS service
--   FROM pg_proc p WHERE p.proname IN ('sot_lms_conciliacao_previa', 'fn_proj_lms_aplicar_conciliacao', 'fn_proj_lms_aplicar_estrutura_nova',
--     'fn_proj_lms_linhas_problemas', 'fn_proj_lms_validar_linhas', 'fn_proj_lms_criar_estrutura', 'fn_proj_lms_conciliacao_analise');
--   -- previa/aplicar/estrutura nova: t, auth t, anon f, service f; internas: auth f, anon f, service f
-- SELECT count(*) FROM public.sot_lms_conciliacao;   -- 0 logo após aplicar a migration

-- Para desfazer — só enquanto nenhuma conciliação tiver sido aplicada (conciliação aplicada não é desfeita por aqui:
-- os itens antigos ficam com deleted_at e a estrutura do LMS permanece). Restaura a estrutura nova da 1.4 (texto original).
-- BEGIN;
-- DO $$ BEGIN
--   IF EXISTS (SELECT 1 FROM public.sot_lms_conciliacao)
--      OR EXISTS (SELECT 1 FROM public.sot_lms_importacoes WHERE conciliacao_aplicada_em IS NOT NULL)
--      OR EXISTS (SELECT 1 FROM public.sot_lms_importacao_eventos WHERE tipo_evento = 'CONCILIACAO_APLICADA') THEN
--     RAISE EXCEPTION 'há conciliação aplicada: rollback automático recusado';
--   END IF;
-- END $$;
-- CREATE OR REPLACE FUNCTION public.fn_proj_lms_aplicar_estrutura_nova(p_importacao_id uuid)
-- RETURNS jsonb
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- SET search_path = public, pg_temp
-- AS $$
-- DECLARE
--   v_imp       public.sot_lms_importacoes%ROWTYPE;
--   v_motivo    text;
--   v_usuario   text;
--   v_contrato  text;
--   v_leg_ativ  integer;
--   v_leg_mat   integer;
--   v_lista     text;
--   v_n_wl      integer;
--   v_n_ativ    integer;
--   v_n_mat_op  integer;
--   v_n_mat_desc integer;
-- BEGIN
--   IF auth.uid() IS NULL THEN
--     RAISE EXCEPTION 'WL aplicar: sem sessão' USING ERRCODE = '42501';
--   END IF;
--   SELECT * INTO v_imp FROM public.sot_lms_importacoes WHERE id = p_importacao_id;
--   IF NOT FOUND THEN
--     RAISE EXCEPTION 'WL aplicar: importação inexistente' USING ERRCODE = 'P0002';
--   END IF;
--
--   -- D9: mesma autorização da confirmação (PROJ_CONFIRMAR_LMS, regra de contrato da 1.1).
--   v_motivo := public.sot_lms_autorizar_confirmacao(v_imp.projeto_id);
--   IF v_motivo <> 'OK' THEN
--     RAISE EXCEPTION 'WL aplicar: %', v_motivo USING ERRCODE = '42501';
--   END IF;
--   SELECT us.id::text INTO v_usuario FROM public.usuarios_sistema us
--   WHERE us.auth_user_id = auth.uid() AND us.ativo IS TRUE AND us.deleted_at IS NULL
--   LIMIT 1;
--   IF v_usuario IS NULL THEN
--     RAISE EXCEPTION 'WL aplicar: usuário ERP inexistente ou inativo' USING ERRCODE = '42501';
--   END IF;
--
--   -- Serializa com a confirmação do mesmo projeto e relê sob lock.
--   PERFORM pg_advisory_xact_lock(hashtextextended('sot_lms_confirmar|' || v_imp.projeto_id::text, 0));
--   SELECT * INTO v_imp FROM public.sot_lms_importacoes WHERE id = p_importacao_id FOR UPDATE;
--
--   IF v_imp.estrutura_aplicada_em IS NOT NULL THEN
--     RETURN jsonb_build_object('operacao', 'JA_APLICADA', 'importacao_id', v_imp.id, 'projeto_id', v_imp.projeto_id,
--       'wls', (SELECT count(*) FROM public.sot_wl w WHERE w.importacao_id = v_imp.id AND w.cancelada_em IS NULL),
--       'estado_wl', public.sot_lms_estado_wl_calc(v_imp.projeto_id));
--   END IF;
--   IF v_imp.tipo_importacao <> 'ORIGINAL' OR v_imp.status <> 'CONFIRMADA' OR v_imp.modo IS DISTINCT FROM 'ESTRUTURA_NOVA' THEN
--     RAISE EXCEPTION 'WL aplicar: IMPORTACAO_NAO_ELEGIVEL (tipo %, status %, modo %)',
--       v_imp.tipo_importacao, v_imp.status, coalesce(v_imp.modo, '-') USING ERRCODE = '55000';
--   END IF;
--   IF EXISTS (SELECT 1 FROM public.sot_wl w WHERE w.projeto_id = v_imp.projeto_id AND w.cancelada_em IS NULL) THEN
--     RAISE EXCEPTION 'WL aplicar: PROJETO_JA_TEM_WL' USING ERRCODE = '55000';
--   END IF;
--
--   -- D7: projeto com linha legada ativa não recebe estrutura nova (usar CONCILIACAO). Nada é removido aqui.
--   SELECT count(*) INTO v_leg_ativ FROM public.sot_atividades a
--    WHERE a.projeto_id = v_imp.projeto_id AND a.wl_id IS NULL AND a.deleted_at IS NULL;
--   SELECT count(*) INTO v_leg_mat FROM public.sot_materiais m
--    WHERE m.projeto_id = v_imp.projeto_id AND m.wl_id IS NULL AND m.deleted_at IS NULL;
--   IF v_leg_ativ > 0 OR v_leg_mat > 0 THEN
--     RAISE EXCEPTION 'WL aplicar: PROJETO_COM_LEGADO (atividades %, materiais %)', v_leg_ativ, v_leg_mat
--       USING ERRCODE = '55000';
--   END IF;
--
--   -- D3: toda linha precisa ser serviço (I-/R-) ou material (numérico), ter WL e descrição.
--   SELECT string_agg(l.linha_excel::text, ', ' ORDER BY l.linha_excel) INTO v_lista
--   FROM (SELECT linha_excel FROM public.sot_lms_linhas
--         WHERE importacao_id = v_imp.id
--           AND (codigo_norm IS NULL OR NOT (codigo_norm ~ '^[IR]-' OR codigo_norm ~ '^[0-9]+$'))
--         ORDER BY linha_excel LIMIT 50) l;
--   IF v_lista IS NOT NULL THEN
--     RAISE EXCEPTION 'WL aplicar: LINHA_NAO_CLASSIFICADA (linhas %)', v_lista USING ERRCODE = '55000';
--   END IF;
--   SELECT string_agg(l.linha_excel::text, ', ' ORDER BY l.linha_excel) INTO v_lista
--   FROM (SELECT linha_excel FROM public.sot_lms_linhas
--         WHERE importacao_id = v_imp.id AND (wl_norm IS NULL OR nullif(btrim(coalesce(descricao_raw, '')), '') IS NULL)
--         ORDER BY linha_excel LIMIT 50) l;
--   IF v_lista IS NOT NULL THEN
--     RAISE EXCEPTION 'WL aplicar: LINHA_SEM_WL_OU_DESCRICAO (linhas %)', v_lista USING ERRCODE = '55000';
--   END IF;
--   -- D1: a chave WL + código + FT + KIT não pode repetir dentro do arquivo.
--   SELECT string_agg(g.linhas, ' | ') INTO v_lista
--   FROM (SELECT string_agg(linha_excel::text, ',' ORDER BY linha_excel) AS linhas
--         FROM public.sot_lms_linhas WHERE importacao_id = v_imp.id
--         GROUP BY wl_norm, codigo_norm, coalesce(ft_norm, ''), coalesce(kit_norm, '')
--         HAVING count(*) > 1 LIMIT 20) g;
--   IF v_lista IS NOT NULL THEN
--     RAISE EXCEPTION 'WL aplicar: LINHAS_REPETIDAS_NA_CHAVE (linhas %)', v_lista USING ERRCODE = '55000';
--   END IF;
--
--   SELECT c.o_contrato INTO v_contrato FROM public.sot_projeto_processo_contexto(v_imp.projeto_id) c;
--
--   -- WLs: uma por WL distinta; ordem numérica quando o WL é número.
--   INSERT INTO public.sot_wl (projeto_id, codigo, origem, importacao_id, ordem, criado_por_auth)
--   SELECT v_imp.projeto_id, w.codigo, 'LMS', v_imp.id,
--          row_number() OVER (ORDER BY (w.wl_norm ~ '^[0-9]+$') DESC,
--                                      CASE WHEN w.wl_norm ~ '^[0-9]+$' THEN lpad(w.wl_norm, 30, '0') END, w.wl_norm),
--          auth.uid()
--   FROM (SELECT wl_norm, (array_agg(btrim(wl_raw) ORDER BY ordem))[1] AS codigo
--         FROM public.sot_lms_linhas WHERE importacao_id = v_imp.id GROUP BY wl_norm) w;
--   GET DIAGNOSTICS v_n_wl = ROW_COUNT;
--
--   -- D5/D6: serviços (I-/R-) → atividades. valor_unitario = valor_ups_item do LMS; servico_id só se casar 1 serviço
--   -- do catálogo do mesmo contrato. valor_total é gerada (não entra).
--   INSERT INTO public.sot_atividades (projeto_id, codigo, descricao, unidade, qtd_prevista, valor_unitario, servico_id,
--                                      ordem_exec, wl_id, lms_linha_id, ctg, ft, kit)
--   SELECT v_imp.projeto_id, btrim(l.codigo_raw), btrim(l.descricao_raw), nullif(btrim(coalesce(l.umd_raw, '')), ''),
--          l.qtd_plan, coalesce(round(l.valor_ups_item, 4), 0),
--          (SELECT min(sc.id::text) FROM public.servicos_contrato sc
--            WHERE sc.deleted_at IS NULL AND v_contrato IS NOT NULL AND btrim(sc.contrato_id) = v_contrato
--              AND public.fn_proj_codigo_norm(sc.codigo) = l.codigo_norm
--           HAVING count(*) = 1),
--          l.ordem, w.id, l.id,
--          nullif(btrim(coalesce(l.ctg_raw, '')), ''), nullif(btrim(coalesce(l.ft_raw, '')), ''), nullif(btrim(coalesce(l.kit_raw, '')), '')
--   FROM public.sot_lms_linhas l
--   JOIN public.sot_wl w ON w.projeto_id = v_imp.projeto_id AND w.importacao_id = v_imp.id
--                       AND w.codigo_norm = l.wl_norm AND w.cancelada_em IS NULL
--   WHERE l.importacao_id = v_imp.id AND l.codigo_norm ~ '^[IR]-'
--   ORDER BY l.ordem;
--   GET DIAGNOSTICS v_n_ativ = ROW_COUNT;
--
--   -- D4: materiais (numéricos). FT=R (retirada) = somente_descritivo: o CHECK existente impede qualquer quantidade
--   -- operacional (requisição, entrega, aplicação, devolução, SAP) nessas linhas.
--   INSERT INTO public.sot_materiais (projeto_id, codigo_sap, descricao, unidade, qtd_projetada, somente_descritivo,
--                                     observacao, wl_id, lms_linha_id, ctg, ft, kit)
--   SELECT v_imp.projeto_id, btrim(l.codigo_raw), btrim(l.descricao_raw), nullif(btrim(coalesce(l.umd_raw, '')), ''),
--          l.qtd_plan, coalesce(l.ft_norm = 'R', false),
--          CASE WHEN l.ft_norm = 'R' THEN 'LMS: retirada (FT=R) — somente descritivo, fora de requisição/almoxarifado' END,
--          w.id, l.id,
--          nullif(btrim(coalesce(l.ctg_raw, '')), ''), nullif(btrim(coalesce(l.ft_raw, '')), ''), nullif(btrim(coalesce(l.kit_raw, '')), '')
--   FROM public.sot_lms_linhas l
--   JOIN public.sot_wl w ON w.projeto_id = v_imp.projeto_id AND w.importacao_id = v_imp.id
--                       AND w.codigo_norm = l.wl_norm AND w.cancelada_em IS NULL
--   WHERE l.importacao_id = v_imp.id AND l.codigo_norm ~ '^[0-9]+$'
--   ORDER BY l.ordem;
--   SELECT count(*) FILTER (WHERE NOT m.somente_descritivo), count(*) FILTER (WHERE m.somente_descritivo)
--     INTO v_n_mat_op, v_n_mat_desc
--   FROM public.sot_materiais m
--   JOIN public.sot_lms_linhas l ON l.id = m.lms_linha_id AND l.importacao_id = v_imp.id
--   WHERE m.deleted_at IS NULL;
--
--   -- Marca de estrutura aplicada (marcador vinculado a ESTA importação) + evento.
--   PERFORM set_config('cena.lms_status_autorizado', v_imp.id::text, true);
--   UPDATE public.sot_lms_importacoes
--      SET estrutura_aplicada_em = now(), estrutura_aplicada_por_auth = auth.uid()
--    WHERE id = v_imp.id;
--   PERFORM set_config('cena.lms_status_autorizado', '', true);
--
--   INSERT INTO public.sot_lms_importacao_eventos (importacao_id, tipo_evento, por_auth, por_usuario_id, detalhe)
--   VALUES (v_imp.id, 'ESTRUTURA_APLICADA', auth.uid(), v_usuario,
--     jsonb_build_object('projeto_id', v_imp.projeto_id, 'hash', v_imp.hash_sha256, 'wls', v_n_wl,
--                        'atividades', v_n_ativ, 'materiais_operacionais', v_n_mat_op,
--                        'materiais_retirada_descritivos', v_n_mat_desc));
--
--   RETURN jsonb_build_object('operacao', 'ESTRUTURA_APLICADA', 'importacao_id', v_imp.id, 'projeto_id', v_imp.projeto_id,
--     'wls', v_n_wl, 'atividades', v_n_ativ, 'materiais_operacionais', v_n_mat_op,
--     'materiais_retirada_descritivos', v_n_mat_desc, 'estado_wl', public.sot_lms_estado_wl_calc(v_imp.projeto_id));
-- END;
-- $$;
-- REVOKE ALL ON FUNCTION public.fn_proj_lms_aplicar_estrutura_nova(uuid) FROM PUBLIC, anon, service_role;
-- GRANT EXECUTE ON FUNCTION public.fn_proj_lms_aplicar_estrutura_nova(uuid) TO authenticated;
-- DROP FUNCTION IF EXISTS public.fn_proj_lms_aplicar_conciliacao(uuid);
-- DROP FUNCTION IF EXISTS public.sot_lms_conciliacao_previa(uuid);
-- DROP FUNCTION IF EXISTS public.fn_proj_lms_conciliacao_analise(uuid);
-- DROP FUNCTION IF EXISTS public.fn_proj_lms_criar_estrutura(uuid);
-- DROP FUNCTION IF EXISTS public.fn_proj_lms_validar_linhas(uuid, text);
-- DROP FUNCTION IF EXISTS public.fn_proj_lms_linhas_problemas(uuid);
-- DROP TABLE IF EXISTS public.sot_lms_conciliacao;
-- DROP FUNCTION IF EXISTS public.sot_lms_conciliacao_proteger();
-- ALTER TABLE public.sot_lms_importacao_eventos DROP CONSTRAINT IF EXISTS sot_lms_importacao_eventos_tipo_chk;
-- ALTER TABLE public.sot_lms_importacao_eventos ADD CONSTRAINT sot_lms_importacao_eventos_tipo_chk
--   CHECK (tipo_evento IN ('CRIADA', 'REENVIO', 'CONFIRMADA', 'ESTRUTURA_APLICADA'));
-- ALTER TABLE public.sot_lms_importacoes DROP CONSTRAINT IF EXISTS sot_lms_importacoes_conciliacao_chk;
-- NOTIFY pgrst, 'reload schema';
-- COMMIT;
