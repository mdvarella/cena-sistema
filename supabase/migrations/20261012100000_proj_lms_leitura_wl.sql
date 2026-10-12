-- ETAPA 1.5b-1 (ENEL/LMS/WL) — Leitura para o botão "Aplicar estrutura" e para o selo nos cards
-- Base: docs/enel-wl/ETAPA-1.5B-DIAGNOSTICO.md (decisões F2 e F3 aprovadas em 12/10/2026).
--   1. sot_lms_original_do_projeto(projeto): localiza a ORIGINAL confirmada do projeto (id, modo, estado, se já foi
--      aplicada e se o usuário pode aplicar). O front não lê sot_lms_importacoes (RLS FORCE da 1.3).
--   2. sot_lms_estado_wl_lote(projetos[]): estado WL de vários projetos numa chamada (cards da lista).
-- Somente leitura: não cria tabela/coluna, não grava nada, não altera RPC/trava/migration anterior, não toca
-- sot_lancamentos_campo, sot_med_itens, sot_atividades, sot_materiais, programação nem TMA.
-- Autorização por linha reusando as funções da 1.3 (sot_lms_autorizar = PROJ_IMPORTAR_LMS,
-- sot_lms_autorizar_confirmacao = PROJ_CONFIRMAR_LMS); estado pela regra canônica sot_lms_estado_wl_calc.
-- Não expõe caminho/bucket do Storage nem autoria.
-- Transação explícita: qualquer falha desfaz a etapa inteira.

BEGIN;

-- ── 0. Pré-condições (falha inteira, nada é aplicado) ────────────────────
DO $$
BEGIN
  IF NOT coalesce((SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user), false) THEN
    RAISE EXCEPTION 'Rode como dono com BYPASSRLS: as funções SECURITY DEFINER leem tabela com RLS FORCE';
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'auth.uid() não existe';
  END IF;
  IF to_regprocedure('public.sot_lms_autorizar(uuid)') IS NULL
     OR to_regprocedure('public.sot_lms_autorizar_confirmacao(uuid)') IS NULL
     OR to_regprocedure('public.sot_lms_estado_wl_calc(uuid)') IS NULL
     OR to_regprocedure('public.cena_usuario_perfil_sessao()') IS NULL THEN
    RAISE EXCEPTION 'aplique antes as migrations da Etapa 1.3 (origem e confirmação)';
  END IF;
  IF to_regprocedure('public.fn_proj_lms_aplicar_estrutura_nova(uuid)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                    AND table_name = 'sot_lms_importacoes' AND column_name = 'estrutura_aplicada_em') THEN
    RAISE EXCEPTION 'aplique antes 20261011200000_proj_wl_estrutura.sql (Etapa 1.4)';
  END IF;
END $$;

-- ── 1. ORIGINAL confirmada do projeto ────────────────────────────────────
-- Leitura com PROJ_IMPORTAR_LMS ou PROJ_CONFIRMAR_LMS; pode_aplicar só com PROJ_CONFIRMAR_LMS, ESTRUTURA_NOVA e
-- estrutura ainda não aplicada (a autorização final continua em fn_proj_lms_aplicar_estrutura_nova).
CREATE OR REPLACE FUNCTION public.sot_lms_original_do_projeto(p_projeto_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ler   text;
  v_conf  text;
  v_imp   record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'LMS original: sem sessão' USING ERRCODE = '42501';
  END IF;
  IF public.cena_usuario_perfil_sessao() IS NULL THEN
    RAISE EXCEPTION 'LMS original: USUARIO_ERP_INATIVO' USING ERRCODE = '42501';
  END IF;
  v_ler  := public.sot_lms_autorizar(p_projeto_id);
  v_conf := public.sot_lms_autorizar_confirmacao(p_projeto_id);
  IF v_ler <> 'OK' AND v_conf <> 'OK' THEN
    RAISE EXCEPTION 'LMS original: acesso negado (%)', v_ler USING ERRCODE = '42501';
  END IF;

  SELECT i.id, i.modo, i.status, i.confirmado_em, i.estrutura_aplicada_em,
         i.arquivo_nome_original, i.qtd_linhas, i.qtd_wls_distintas
    INTO v_imp
  FROM public.sot_lms_importacoes i
  WHERE i.projeto_id = p_projeto_id AND i.tipo_importacao = 'ORIGINAL' AND i.status = 'CONFIRMADA'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('existe', false, 'projeto_id', p_projeto_id,
      'estado', public.sot_lms_estado_wl_calc(p_projeto_id), 'pode_aplicar', false);
  END IF;

  RETURN jsonb_build_object(
    'existe', true,
    'projeto_id', p_projeto_id,
    'importacao_id', v_imp.id,
    'modo', v_imp.modo,
    'status', v_imp.status,
    'estado', public.sot_lms_estado_wl_calc(p_projeto_id),
    'confirmado_em', v_imp.confirmado_em,
    'estrutura_aplicada_em', v_imp.estrutura_aplicada_em,
    'arquivo_nome_original', v_imp.arquivo_nome_original,
    'qtd_linhas', v_imp.qtd_linhas,
    'qtd_wls_distintas', v_imp.qtd_wls_distintas,
    'pode_aplicar', (v_conf = 'OK' AND v_imp.modo = 'ESTRUTURA_NOVA' AND v_imp.estrutura_aplicada_em IS NULL));
END;
$$;

-- ── 2. Estado WL em lote (cards da lista) ────────────────────────────────
-- Devolve {projeto_id: estado} só dos projetos que o usuário pode ler (mesma autorização da função 1); os demais
-- ficam de fora, sem revelar se existem. Teto de 500 ids por chamada.
CREATE OR REPLACE FUNCTION public.sot_lms_estado_wl_lote(p_projeto_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res jsonb := '{}'::jsonb;
  v_id  uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'LMS estado lote: sem sessão' USING ERRCODE = '42501';
  END IF;
  IF public.cena_usuario_perfil_sessao() IS NULL THEN
    RAISE EXCEPTION 'LMS estado lote: USUARIO_ERP_INATIVO' USING ERRCODE = '42501';
  END IF;
  IF coalesce(cardinality(p_projeto_ids), 0) > 500 THEN
    RAISE EXCEPTION 'LMS estado lote: no máximo 500 projetos por chamada' USING ERRCODE = '22023';
  END IF;

  FOR v_id IN SELECT DISTINCT x FROM unnest(coalesce(p_projeto_ids, ARRAY[]::uuid[])) AS x WHERE x IS NOT NULL LOOP
    IF public.sot_lms_autorizar(v_id) = 'OK' OR public.sot_lms_autorizar_confirmacao(v_id) = 'OK' THEN
      v_res := v_res || jsonb_build_object(v_id::text, public.sot_lms_estado_wl_calc(v_id));
    END IF;
  END LOOP;
  RETURN v_res;
END;
$$;

-- ── 3. Grants ────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.sot_lms_original_do_projeto(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.sot_lms_estado_wl_lote(uuid[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.sot_lms_original_do_projeto(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sot_lms_estado_wl_lote(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Validação
-- SELECT p.oid::regprocedure, p.prosecdef, p.provolatile, p.proconfig,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
--        has_function_privilege('service_role', p.oid, 'EXECUTE') AS service
--   FROM pg_proc p WHERE p.proname IN ('sot_lms_original_do_projeto', 'sot_lms_estado_wl_lote');  -- t, s, search_path; t/f/f

-- Para desfazer — remove só as duas funções (nenhum dado é afetado).
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.sot_lms_estado_wl_lote(uuid[]);
-- DROP FUNCTION IF EXISTS public.sot_lms_original_do_projeto(uuid);
-- NOTIFY pgrst, 'reload schema';
-- COMMIT;
