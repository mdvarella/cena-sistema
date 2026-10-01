-- Projetos (SOT): exclui a lista de materiais que subiu com conteúdo binário no projeto DAC/S.NOR-25.00228
-- (AC - Alteração de Carga, R BAHIA 18, id 20002920-9d52-4b6d-878d-9870da3fb62a).
-- Causa: "Importar materiais" lê como texto qualquer arquivo que não seja .xls/.xlsx; cada trecho de bytes virou
-- um material (quantidade 1 e unidade UN por padrão).
-- Conferido em 01/10/2026 (só leitura): 1245 materiais vivos, todos criados em 01/10/2026 entre 07:36:02 e 07:36:11,
-- código/descrição ilegíveis, qtd_projetada 1, nenhuma quantidade viabilizada/requisitada/entregue/aplicada/devolvida/SAP.
-- O projeto não tem atividades, medições nem itens de medição gravados (nada a excluir em sot_atividades).
-- Exclusão suave (deleted_at), como o app faz em sot_materiais. O projeto, o histórico e o croqui ficam intactos.
-- Fail-closed: projeto ausente/excluído, quantidade diferente de 1245 linhas na janela ou material com qualquer
-- quantidade movimentada PARA sem alterar nada.
-- Grava audit_log SOT_MATERIAIS_IMPORTACAO_BINARIA_20002920 com os ids excluídos (permite desfazer).

BEGIN;

DO $$
DECLARE
  v_projeto text := '20002920-9d52-4b6d-878d-9870da3fb62a';
  v_ini timestamptz := '2026-10-01T07:36:02-03:00';
  v_fim timestamptz := '2026-10-01T07:36:12-03:00';
  v_esperado int := 1245;
  v_agora timestamptz := now();
  v_p record;
  v_janela int;
  v_vivos int;
  v_mov int;
  v_upd int;
  v_ids jsonb;
  v_restantes int;
BEGIN
  SELECT * INTO v_p FROM public.sot_projetos WHERE id::text = v_projeto;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PARAR: projeto % não encontrado. Nenhuma alteração.', v_projeto;
  END IF;
  IF v_p.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'PARAR: projeto % está excluído. Nenhuma alteração.', v_projeto;
  END IF;
  IF coalesce(v_p.codigo_cliente, '') <> 'DAC/S.NOR-25.00228' THEN
    RAISE EXCEPTION 'PARAR: projeto % tem código % (esperado DAC/S.NOR-25.00228). Nenhuma alteração.', v_projeto, v_p.codigo_cliente;
  END IF;

  PERFORM 1 FROM public.sot_materiais m
   WHERE m.projeto_id::text = v_projeto AND m.criado_em >= v_ini AND m.criado_em < v_fim
   FOR UPDATE;

  SELECT count(*),
         count(*) FILTER (WHERE m.deleted_at IS NULL),
         count(*) FILTER (WHERE coalesce(m.qtd_viabilizada, 0) <> 0 OR coalesce(m.qtd_requisitada, 0) <> 0
                            OR coalesce(m.qtd_entregue, 0) <> 0 OR coalesce(m.qtd_aplicada, 0) <> 0
                            OR coalesce(m.qtd_devolvida, 0) <> 0 OR coalesce(m.qtd_processada_sap, 0) <> 0)
    INTO v_janela, v_vivos, v_mov
    FROM public.sot_materiais m
   WHERE m.projeto_id::text = v_projeto AND m.criado_em >= v_ini AND m.criado_em < v_fim;

  IF v_janela <> v_esperado THEN
    RAISE EXCEPTION 'PARAR: % materiais na importação de 07:36 (esperado %). Nenhuma alteração.', v_janela, v_esperado;
  END IF;
  IF v_mov > 0 THEN
    RAISE EXCEPTION 'PARAR: % material(is) da importação já têm quantidade movimentada. Nenhuma alteração.', v_mov;
  END IF;
  IF v_vivos = 0 THEN
    RAISE EXCEPTION 'PARAR: nada pendente (todos os materiais da importação já estão excluídos). Nenhuma alteração.';
  END IF;

  SELECT coalesce(jsonb_agg(m.id::text ORDER BY m.criado_em, m.id::text), '[]'::jsonb) INTO v_ids
    FROM public.sot_materiais m
   WHERE m.projeto_id::text = v_projeto AND m.criado_em >= v_ini AND m.criado_em < v_fim AND m.deleted_at IS NULL;

  UPDATE public.sot_materiais m
     SET deleted_at = v_agora
   WHERE m.projeto_id::text = v_projeto AND m.criado_em >= v_ini AND m.criado_em < v_fim AND m.deleted_at IS NULL
     AND coalesce(m.qtd_viabilizada, 0) = 0 AND coalesce(m.qtd_requisitada, 0) = 0 AND coalesce(m.qtd_entregue, 0) = 0
     AND coalesce(m.qtd_aplicada, 0) = 0 AND coalesce(m.qtd_devolvida, 0) = 0 AND coalesce(m.qtd_processada_sap, 0) = 0;
  GET DIAGNOSTICS v_upd = ROW_COUNT;
  IF v_upd <> v_vivos OR v_upd <> jsonb_array_length(v_ids) THEN
    RAISE EXCEPTION 'PARAR: exclusão afetou % linhas (esperado %). Rollback.', v_upd, v_vivos;
  END IF;

  SELECT count(*) INTO v_restantes FROM public.sot_materiais m
   WHERE m.projeto_id::text = v_projeto AND m.deleted_at IS NULL;

  INSERT INTO public.audit_log (
    acao, modulo, descricao,
    usuario_id, usuario_nome, usuario_perfil,
    dados_extra, data_hora, sessao_id
  ) VALUES (
    'SOT_MATERIAIS_IMPORTACAO_BINARIA_20002920',
    'sot',
    'Projeto DAC/S.NOR-25.00228: ' || v_upd || ' material(is) da importação binária de 01/10/2026 07:36 excluído(s)'
      || CASE WHEN v_vivos < v_janela THEN ' (' || (v_janela - v_vivos) || ' já estavam excluídos).' ELSE '.' END,
    '',
    coalesce(current_user, 'sql-editor'),
    '',
    jsonb_build_object('projeto_id', v_projeto, 'codigo_cliente', v_p.codigo_cliente, 'deleted_at', v_agora,
      'ids', v_ids, 'ja_excluidos', v_janela - v_vivos, 'materiais_vivos_restantes', v_restantes,
      'registros_afetados', v_upd),
    v_agora,
    'sql:20261001120000_sot_materiais_importacao_binaria_20002920'
  );
END $$;

COMMIT;

-- Validação (após aplicar):
--   SELECT count(*) FROM public.sot_materiais
--    WHERE projeto_id::text = '20002920-9d52-4b6d-878d-9870da3fb62a' AND deleted_at IS NULL;   -- esperado: 0
--   SELECT acao, descricao, data_hora FROM public.audit_log
--    WHERE sessao_id = 'sql:20261001120000_sot_materiais_importacao_binaria_20002920' ORDER BY data_hora DESC LIMIT 1;
--
-- Para desfazer
-- UPDATE public.sot_materiais m
--    SET deleted_at = NULL
--   FROM (SELECT dados_extra FROM public.audit_log
--          WHERE sessao_id = 'sql:20261001120000_sot_materiais_importacao_binaria_20002920'
--          ORDER BY data_hora DESC LIMIT 1) x
--  WHERE m.id::text IN (SELECT jsonb_array_elements_text(x.dados_extra->'ids'))
--    AND m.deleted_at = (x.dados_extra->>'deleted_at')::timestamptz;
