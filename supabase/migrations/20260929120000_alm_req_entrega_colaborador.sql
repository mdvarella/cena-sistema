-- ALM-CENA 8.1.165 — Transferir e depois entregar ao colaborador.
-- Origem ≠ destino: a saída na origem é transferência (sem colaborador); o recebimento dá entrada no destino;
-- a assinatura da ficha baixa o estoque do destino no nome do colaborador (fn_alm_req_entregar_colaborador).
-- Até a assinatura, o recebido para colaborador fica reservado no destino.
-- quantidade_entregue_colab NULL = não se aplica ou regra anterior (a ficha só documenta, sem baixa).
-- Não altera histórico, não recalcula saldo, não mexe em alm_movimentos (SAP/campo).

ALTER TABLE public.alm_requisicao_itens ADD COLUMN IF NOT EXISTS quantidade_entregue_colab numeric;
COMMENT ON COLUMN public.alm_requisicao_itens.quantidade_entregue_colab IS
  'ALM-CENA: quantidade já entregue ao colaborador no depósito destino (baixa na assinatura da ficha). NULL = não se aplica ou regra anterior — só pela fn_alm_req_entregar_colaborador.';

-- ---------------------------------------------------------------------------
-- 1) Reservado = reservas abertas na origem + recebido para colaborador ainda não entregue no destino
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_alm_req_reservado(
  p_deposito_id text, p_item_id text, p_codigo text, p_nome text,
  p_excluir_req uuid DEFAULT NULL, p_excluir_item uuid DEFAULT NULL
) RETURNS numeric
LANGUAGE sql STABLE
AS $$
  SELECT (
    SELECT coalesce(sum(greatest(0,
             coalesce(i.quantidade_aprovada, i.quantidade_solicitada, 0) - coalesce(i.quantidade_atendida, 0))),0)
      FROM public.alm_requisicao_itens i
      JOIN public.alm_requisicoes r ON r.id = i.requisicao_id
     WHERE r.status IN ('aprovada','separacao','separada','parcialmente_atendida')
       AND coalesce(r.deposito_id,'') = coalesce(p_deposito_id,'')
       AND (p_excluir_req IS NULL OR r.id <> p_excluir_req)
       AND (p_excluir_item IS NULL OR i.id <> p_excluir_item)
       AND coalesce(i.status,'') NOT IN ('cancelado','recusado','entregue','recebido')
       AND NOT (r.status = 'separada' AND i.quantidade_separada IS NULL)
       AND (
            (coalesce(p_item_id,'') <> '' AND i.item_id = p_item_id)
         OR (coalesce(p_codigo,'')  <> '' AND lower(coalesce(i.item_codigo,'')) = lower(p_codigo))
         OR (coalesce(p_nome,'')    <> '' AND lower(btrim(coalesce(i.item_descricao,''))) = lower(btrim(p_nome)))
       )
  ) + (
    SELECT coalesce(sum(greatest(0, coalesce(i.quantidade_atendida, 0) - i.quantidade_entregue_colab)),0)
      FROM public.alm_requisicao_itens i
      JOIN public.alm_requisicoes r ON r.id = i.requisicao_id
     WHERE r.status = 'recebida'
       AND coalesce(r.dest_deposito_id,'') = coalesce(p_deposito_id,'')
       AND coalesce(r.deposito_id,'') <> coalesce(r.dest_deposito_id,'')
       AND i.quantidade_entregue_colab IS NOT NULL
       AND coalesce(i.status,'') NOT IN ('cancelado','recusado')
       AND (p_excluir_req IS NULL OR r.id <> p_excluir_req)
       AND (p_excluir_item IS NULL OR i.id <> p_excluir_item)
       AND (
            (coalesce(p_item_id,'') <> '' AND i.item_id = p_item_id)
         OR (coalesce(p_codigo,'')  <> '' AND lower(coalesce(i.item_codigo,'')) = lower(p_codigo))
         OR (coalesce(p_nome,'')    <> '' AND lower(btrim(coalesce(i.item_descricao,''))) = lower(btrim(p_nome)))
       )
  );
$$;

CREATE OR REPLACE FUNCTION public.fn_alm_req_item_exige_colab(p_tipo_item text, p_entrega_individual boolean)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT coalesce(p_tipo_item,'') IN ('EPI','VESTIMENTA') AND coalesce(p_entrega_individual, true);
$$;

-- ---------------------------------------------------------------------------
-- 2) ENTREGAR ITEM (origem): com destino diferente a saída é transferência, sem colaborador.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_alm_req_entregar_item(
  p_requisicao_id uuid,
  p_item_req_id uuid,
  p_quantidade numeric,
  p_chave text,
  p_usuario text DEFAULT NULL,
  p_usuario_id text DEFAULT NULL,
  p_data_mov date DEFAULT NULL,
  p_obs text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_req public.alm_requisicoes%ROWTYPE;
  v_it public.alm_requisicao_itens%ROWTYPE;
  v_ref record;
  v_row record;
  v_dep_filial public.depositos.filial_id%TYPE;
  v_apr numeric; v_atd numeric; v_sep numeric; v_pend numeric;
  v_fis numeric; v_res_outras numeric; v_res_mesma numeric; v_livre numeric; v_permitido numeric;
  v_rest numeric; v_take numeric;
  v_movs jsonb := '[]'::jsonb;
  v_mov_id uuid;
  v_payload jsonb;
  v_st_item text; v_st_cab text;
  v_tag text;
  v_transf boolean;
BEGIN
  IF coalesce(btrim(p_chave),'') = '' THEN
    RETURN jsonb_build_object('ok',false,'codigo','SEM_CHAVE','msg','Operação sem chave de idempotência.');
  END IF;
  IF p_quantidade IS NULL OR p_quantidade <= 0 THEN
    RETURN jsonb_build_object('ok',false,'codigo','QTD_INVALIDA','msg','Informe a quantidade a entregar.');
  END IF;
  v_tag := 'idem:' || btrim(p_chave);

  SELECT * INTO v_req FROM public.alm_requisicoes WHERE id = p_requisicao_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'codigo','NAO_ENCONTRADA','msg','Requisição não encontrada.');
  END IF;
  SELECT * INTO v_it FROM public.alm_requisicao_itens
   WHERE id = p_item_req_id AND requisicao_id = p_requisicao_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'codigo','ITEM_NAO_ENCONTRADO','msg','Item não pertence a esta requisição.');
  END IF;

  IF EXISTS (SELECT 1 FROM public.movimentacoes_itens m
              WHERE m.item_id::text = v_it.item_id AND m.tipo_mov = 'entrega'
                AND position(v_tag in coalesce(m.obs,'')) > 0)
     OR EXISTS (SELECT 1 FROM public.alm_requisicao_eventos ev
                 WHERE ev.requisicao_id = p_requisicao_id AND ev.dados_json->>'chave' = btrim(p_chave)) THEN
    RETURN jsonb_build_object('ok',true,'idempotente',true,'status',v_req.status,
      'quantidade_atendida',v_it.quantidade_atendida,'item_status',v_it.status,
      'msg','Esta entrega já foi registrada. Nenhuma nova baixa foi feita.');
  END IF;

  IF v_req.status NOT IN ('separada','parcialmente_atendida') THEN
    RETURN jsonb_build_object('ok',false,'codigo','STATUS_INVALIDO','status',v_req.status,
      'msg','Só é possível entregar depois que a requisição estiver Separada.');
  END IF;
  IF coalesce(v_req.deposito_id,'') = '' THEN
    RETURN jsonb_build_object('ok',false,'codigo','SEM_DEPOSITO','msg','Requisição sem depósito origem.');
  END IF;
  IF coalesce(v_req.contrato_id::text,'') = '' THEN
    RETURN jsonb_build_object('ok',false,'codigo','SEM_CONTRATO','msg','Informe o contrato no cabeçalho para dar baixa no estoque.');
  END IF;
  IF coalesce(v_req.dest_deposito_id,'') = '' THEN
    RETURN jsonb_build_object('ok',false,'codigo','SEM_DESTINO','msg','Informe a base e o depósito de destino.');
  END IF;
  IF coalesce(v_it.status,'') IN ('cancelado','recusado','entregue','recebido') THEN
    RETURN jsonb_build_object('ok',false,'codigo','ITEM_ENCERRADO','msg','Este item já está encerrado.');
  END IF;
  v_transf := v_req.dest_deposito_id <> v_req.deposito_id;

  v_apr := coalesce(v_it.quantidade_aprovada, v_it.quantidade_solicitada, 0);
  v_atd := coalesce(v_it.quantidade_atendida, 0);
  v_sep := greatest(coalesce(v_it.quantidade_separada, 0), v_atd);
  v_pend := greatest(0, least(v_sep, v_apr) - v_atd);
  IF v_pend <= 0 THEN
    RETURN jsonb_build_object('ok',false,'codigo','NADA_SEPARADO_A_ENTREGAR',
      'msg', CASE WHEN v_it.quantidade_separada IS NULL AND v_atd > 0
                  THEN 'A saída física deste item já foi registrada pela regra antiga (na separação). Conciliação pendente — nenhuma nova baixa.'
                  ELSE 'Não há quantidade separada pendente de entrega neste item.' END);
  END IF;
  IF p_quantidade > v_pend THEN
    RETURN jsonb_build_object('ok',false,'codigo','ACIMA_DO_SEPARADO','pendente_entregar',v_pend,
      'msg','Quantidade maior que o separado ainda não entregue ('||v_pend||').');
  END IF;
  IF p_quantidade <> trunc(p_quantidade) THEN
    RETURN jsonb_build_object('ok',false,'codigo','QTD_FRACIONADA',
      'msg','O saldo físico do estoque é controlado em unidades inteiras. Informe uma quantidade inteira.');
  END IF;

  SELECT * INTO v_ref FROM public.fn_alm_req_item_ref(v_it.item_id, v_it.item_codigo, v_it.item_descricao);
  IF NOT coalesce(v_ref.r_catalogo,false) THEN
    RETURN jsonb_build_object('ok',false,'codigo','SEM_CATALOGO','msg','Item sem vínculo ao catálogo. Não é possível baixar estoque.');
  END IF;
  SELECT d.filial_id INTO v_dep_filial FROM public.depositos d WHERE d.id::text = v_req.deposito_id;

  PERFORM pg_advisory_xact_lock(hashtext('alm_req_reserva'), hashtext(v_req.deposito_id));
  PERFORM 1 FROM public.estoque e
   WHERE public.fn_alm_estoque_casa_ref(e.nome, e.codigo, e.sku, v_ref.r_nome, v_ref.r_codigo, v_ref.r_sku)
     AND (e.deposito_id IS NULL OR e.deposito_id::text = v_req.deposito_id)
     AND (e.filial_id IS NULL OR v_dep_filial IS NULL OR e.filial_id = v_dep_filial)
   FOR UPDATE OF e;

  v_fis := public.fn_alm_req_saldo_fisico(v_req.deposito_id, v_ref.r_nome, v_ref.r_codigo, v_ref.r_sku);
  v_res_outras := public.fn_alm_req_reservado(v_req.deposito_id, v_it.item_id, v_it.item_codigo, v_it.item_descricao, p_requisicao_id, NULL);
  v_res_mesma := greatest(0, public.fn_alm_req_reservado(v_req.deposito_id, v_it.item_id, v_it.item_codigo, v_it.item_descricao, NULL, p_item_req_id) - v_res_outras);
  v_livre := v_fis - v_res_outras - v_res_mesma;
  v_permitido := least(v_pend, greatest(0, v_livre));
  IF p_quantidade > v_permitido THEN
    RETURN jsonb_build_object('ok',false,'codigo','SALDO_FISICO_INSUFICIENTE',
      'saldo_fisico',v_fis,'reservado_outras',v_res_outras + v_res_mesma,'permitido',v_permitido,
      'msg','Saldo físico do depósito origem é '||v_fis||' e há '||(v_res_outras + v_res_mesma)
            ||' reservado para outras requisições. Pode entregar agora no máximo '||v_permitido||'. Verifique divergência de estoque.');
  END IF;

  v_rest := p_quantidade;
  FOR v_row IN
    SELECT e.id, coalesce(e.saldo,0) AS saldo, e.deposito_id, e.filial_id
      FROM public.estoque e
     WHERE public.fn_alm_estoque_casa_ref(e.nome, e.codigo, e.sku, v_ref.r_nome, v_ref.r_codigo, v_ref.r_sku)
       AND (e.deposito_id IS NULL OR e.deposito_id::text = v_req.deposito_id)
       AND (e.filial_id IS NULL OR v_dep_filial IS NULL OR e.filial_id = v_dep_filial)
       AND coalesce(e.saldo,0) > 0
     ORDER BY (e.deposito_id IS NOT NULL) DESC, coalesce(e.saldo,0) DESC, e.id
  LOOP
    EXIT WHEN v_rest <= 0;
    v_take := least(v_row.saldo, v_rest);
    UPDATE public.estoque SET saldo = coalesce(saldo,0) - v_take::int WHERE id = v_row.id;
    v_payload := jsonb_build_object(
      'item_id', v_it.item_id,
      'tipo_mov', 'entrega',
      'quantidade', v_take,
      'deposito_id', coalesce(v_row.deposito_id::text, v_req.deposito_id),
      'filial_id', coalesce(v_row.filial_id::text, v_dep_filial::text),
      'contrato_id', v_req.contrato_id::text,
      'colaborador_id', CASE WHEN v_transf THEN NULL ELSE nullif(v_it.colaborador_id::text,'') END,
      'equipe_id', CASE WHEN v_transf THEN NULL ELSE nullif(v_it.equipe_id::text,'') END,
      'data_mov', coalesce(p_data_mov, current_date),
      'obs', concat_ws(' · ', nullif(p_obs,''),
               CASE WHEN v_transf THEN 'transferência para '||coalesce(v_req.dest_deposito_nome, v_req.dest_deposito_id) END,
               'estoque_id:'||v_row.id, 'requisicao:'||coalesce(v_req.numero,''), v_tag),
      'status', 'Em uso',
      'motivo', CASE WHEN v_transf THEN 'Transferência requisição CENA — saída' ELSE 'Entrega requisição CENA' END,
      'registrado_por_id', nullif(p_usuario_id,''),
      'responsavel_id', nullif(p_usuario_id,''));
    INSERT INTO public.movimentacoes_itens
      (item_id, tipo_mov, quantidade, deposito_id, filial_id, contrato_id, colaborador_id, equipe_id,
       data_mov, obs, status, motivo, registrado_por_id, responsavel_id)
    SELECT r.item_id, r.tipo_mov, r.quantidade, r.deposito_id, r.filial_id, r.contrato_id, r.colaborador_id, r.equipe_id,
           r.data_mov, r.obs, r.status, r.motivo, r.registrado_por_id, r.responsavel_id
      FROM jsonb_populate_record(NULL::public.movimentacoes_itens, v_payload) r
    RETURNING id INTO v_mov_id;
    v_movs := v_movs || jsonb_build_array(jsonb_build_object('mov_id',v_mov_id,'estoque_id',v_row.id,'quantidade',v_take));
    v_rest := v_rest - v_take;
  END LOOP;
  IF v_rest > 0 THEN
    RAISE EXCEPTION 'ALM_REQ: saldo físico mudou durante a entrega (faltou %). Nada foi gravado.', v_rest;
  END IF;

  PERFORM set_config('cena.alm_req_rpc','1',true);
  v_st_item := CASE WHEN v_atd + p_quantidade >= v_apr THEN 'entregue'
                    WHEN v_sep >= v_apr THEN 'separado' ELSE 'separacao' END;
  UPDATE public.alm_requisicao_itens
     SET quantidade_atendida = v_atd + p_quantidade,
         quantidade_separada = v_sep,
         status = v_st_item
   WHERE id = p_item_req_id;
  v_st_cab := coalesce(public.fn_alm_req_status_por_itens(p_requisicao_id), v_req.status);
  UPDATE public.alm_requisicoes
     SET status = v_st_cab, atendido_por = p_usuario, atendido_em = now()
   WHERE id = p_requisicao_id;

  INSERT INTO public.alm_requisicao_eventos (requisicao_id, evento, descricao, usuario, dados_json)
  VALUES (p_requisicao_id, 'status',
    'Entregue '||p_quantidade||' × '||coalesce(v_it.item_descricao,'')
      ||CASE WHEN v_transf THEN ' — saída por transferência para '||coalesce(v_req.dest_deposito_nome,'o depósito destino')||' e consumo da reserva'
             ELSE ' — saída física e consumo da reserva' END, p_usuario,
    jsonb_build_object('tipo','saida_fisica','item_req_id',p_item_req_id,'item_id',v_it.item_id,'qtd',p_quantidade,
      'reserva_antes',v_apr - v_atd,'reserva_depois',v_apr - v_atd - p_quantidade,'saldo_fisico_antes',v_fis,
      'movimentos',v_movs,'dest_deposito_id',v_req.dest_deposito_id,'saida_transferencia',v_transf,
      'chave',btrim(p_chave),'usuario',p_usuario,'usuario_id',p_usuario_id,'data_hora',now(),'estoque_alterado',true));

  RETURN jsonb_build_object('ok',true,'status',v_st_cab,'item_status',v_st_item,
    'quantidade_atendida',v_atd + p_quantidade,'reserva_restante',v_apr - v_atd - p_quantidade,
    'saldo_fisico_antes',v_fis,'saldo_fisico_depois',v_fis - p_quantidade,'movimentos',v_movs,
    'transferencia',v_transf,
    'msg','Entregue '||p_quantidade||'. Saída física registrada.');
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) CONFIRMAR RECEBIMENTO: itens com colaborador saídos como transferência ficam
--    pendentes de entrega no destino (reservados até a assinatura da ficha).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_alm_req_confirmar_recebimento(
  p_requisicao_id uuid,
  p_usuario text DEFAULT NULL,
  p_usuario_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_req public.alm_requisicoes%ROWTYPE;
  v_legado boolean;
  v_itens jsonb;
BEGIN
  SELECT * INTO v_req FROM public.alm_requisicoes WHERE id = p_requisicao_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'codigo','NAO_ENCONTRADA','msg','Requisição não encontrada.');
  END IF;
  IF v_req.status = 'recebida' THEN
    RETURN jsonb_build_object('ok',true,'idempotente',true,'status','recebida','msg','Recebimento já estava confirmado.');
  END IF;
  v_legado := public.fn_alm_req_eh_legado_baixado(p_requisicao_id);
  IF v_req.status <> 'entregue' AND NOT v_legado THEN
    RETURN jsonb_build_object('ok',false,'codigo','NAO_ENTREGUE','status',v_req.status,
      'msg','Só é possível confirmar o recebimento depois da entrega (saída física).');
  END IF;

  PERFORM set_config('cena.alm_req_rpc','1',true);
  IF coalesce(v_req.dest_deposito_id,'') <> '' AND v_req.dest_deposito_id <> coalesce(v_req.deposito_id,'') THEN
    UPDATE public.alm_requisicao_itens i
       SET quantidade_entregue_colab = 0
     WHERE i.requisicao_id = p_requisicao_id
       AND i.quantidade_entregue_colab IS NULL
       AND coalesce(i.quantidade_atendida,0) > 0
       AND coalesce(i.status,'') NOT IN ('cancelado','recusado')
       AND public.fn_alm_req_item_exige_colab(i.tipo_item, i.entrega_individual)
       AND EXISTS (SELECT 1 FROM public.alm_requisicao_eventos ev
                    WHERE ev.requisicao_id = p_requisicao_id
                      AND ev.dados_json->>'tipo' = 'saida_fisica'
                      AND ev.dados_json->>'item_req_id' = i.id::text
                      AND ev.dados_json->>'saida_transferencia' = 'true');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('item_req_id',i.id,'item_id',i.item_id,'quantidade',coalesce(i.quantidade_atendida,0),
           'entrega_colaborador_pendente', i.quantidade_entregue_colab IS NOT NULL)), '[]'::jsonb)
    INTO v_itens
    FROM public.alm_requisicao_itens i
   WHERE i.requisicao_id = p_requisicao_id AND coalesce(i.quantidade_atendida,0) > 0
     AND coalesce(i.status,'') NOT IN ('cancelado','recusado');

  UPDATE public.alm_requisicao_itens SET status = 'recebido'
   WHERE requisicao_id = p_requisicao_id AND coalesce(quantidade_atendida,0) > 0
     AND coalesce(status,'') NOT IN ('cancelado','recusado');
  UPDATE public.alm_requisicoes
     SET status = 'recebida', recebido_por = p_usuario, recebido_em = now()
   WHERE id = p_requisicao_id;

  INSERT INTO public.alm_requisicao_eventos (requisicao_id, evento, descricao, usuario, dados_json)
  VALUES (p_requisicao_id, 'status', 'Recebimento confirmado por '||coalesce(p_usuario,''), p_usuario,
    jsonb_build_object('tipo','recebimento','legado_regra_antiga',v_legado,'status_anterior',v_req.status,'itens',v_itens,
      'usuario',p_usuario,'usuario_id',p_usuario_id,'data_hora',now(),'estoque_alterado',false));

  RETURN jsonb_build_object('ok',true,'status','recebida','legado',v_legado,'itens',v_itens,
    'msg','Recebimento confirmado. Estoque e reserva da origem não foram alterados.');
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) ENTREGAR AO COLABORADOR (destino): na assinatura da ficha. Tudo ou nada por ficha.
--    Baixa estoque.saldo do destino, movimentação 'entrega' no nome do colaborador,
--    consome a reserva do destino. Itens da regra anterior (NULL) só documentam.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_alm_req_entregar_colaborador(
  p_requisicao_id uuid,
  p_item_req_ids uuid[],
  p_chave text,
  p_ficha_id text DEFAULT NULL,
  p_usuario text DEFAULT NULL,
  p_usuario_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_req public.alm_requisicoes%ROWTYPE;
  v_it public.alm_requisicao_itens%ROWTYPE;
  v_ref record;
  v_row record;
  v_dep_filial public.depositos.filial_id%TYPE;
  v_pend numeric; v_fis numeric; v_res numeric; v_rest numeric; v_take numeric;
  v_mov_id uuid;
  v_payload jsonb;
  v_movs jsonb;
  v_itens jsonb := '[]'::jsonb;
  v_ignorados jsonb := '[]'::jsonb;
  v_falta jsonb;
  v_total numeric := 0;
  v_tag text;
  v_colab text;
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  IF coalesce(btrim(p_chave),'') = '' THEN
    RETURN jsonb_build_object('ok',false,'codigo','SEM_CHAVE','msg','Operação sem chave de idempotência.');
  END IF;
  IF p_item_req_ids IS NULL OR cardinality(p_item_req_ids) = 0 THEN
    RETURN jsonb_build_object('ok',false,'codigo','SEM_ITENS','msg','Nenhum item informado para a entrega ao colaborador.');
  END IF;

  SELECT * INTO v_req FROM public.alm_requisicoes WHERE id = p_requisicao_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'codigo','NAO_ENCONTRADA','msg','Requisição não encontrada.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.alm_requisicao_eventos ev
              WHERE ev.requisicao_id = p_requisicao_id AND ev.dados_json->>'chave' = btrim(p_chave)) THEN
    RETURN jsonb_build_object('ok',true,'idempotente',true,
      'msg','Esta entrega ao colaborador já foi registrada. Nenhuma nova baixa foi feita.');
  END IF;
  IF v_req.status <> 'recebida' THEN
    RETURN jsonb_build_object('ok',false,'codigo','STATUS_INVALIDO','status',v_req.status,
      'msg','Confirme o recebimento no depósito destino antes de entregar ao colaborador.');
  END IF;
  IF coalesce(v_req.dest_deposito_id,'') = '' THEN
    RETURN jsonb_build_object('ok',false,'codigo','SEM_DESTINO','msg','Requisição sem depósito destino.');
  END IF;
  SELECT d.filial_id INTO v_dep_filial FROM public.depositos d WHERE d.id::text = v_req.dest_deposito_id;
  v_tag := 'idem:' || btrim(p_chave);

  PERFORM pg_advisory_xact_lock(hashtext('alm_req_reserva'), hashtext(v_req.dest_deposito_id));

  BEGIN
    FOR v_it IN
      SELECT * FROM public.alm_requisicao_itens
       WHERE requisicao_id = p_requisicao_id AND id = ANY(p_item_req_ids)
       ORDER BY item_descricao, id
       FOR UPDATE
    LOOP
      IF v_it.quantidade_entregue_colab IS NULL THEN
        v_ignorados := v_ignorados || jsonb_build_array(jsonb_build_object('item_req_id',v_it.id,'motivo','regra_anterior'));
        CONTINUE;
      END IF;
      v_pend := greatest(0, coalesce(v_it.quantidade_atendida,0) - v_it.quantidade_entregue_colab);
      IF v_pend <= 0 THEN
        v_ignorados := v_ignorados || jsonb_build_array(jsonb_build_object('item_req_id',v_it.id,'motivo','ja_entregue'));
        CONTINUE;
      END IF;

      SELECT * INTO v_ref FROM public.fn_alm_req_item_ref(v_it.item_id, v_it.item_codigo, v_it.item_descricao);
      IF NOT coalesce(v_ref.r_catalogo,false) THEN
        v_falta := jsonb_build_object('material',v_it.item_descricao);
        RAISE EXCEPTION 'ALM_REQ_SEM_CATALOGO';
      END IF;
      PERFORM 1 FROM public.estoque e
       WHERE public.fn_alm_estoque_casa_ref(e.nome, e.codigo, e.sku, v_ref.r_nome, v_ref.r_codigo, v_ref.r_sku)
         AND (e.deposito_id IS NULL OR e.deposito_id::text = v_req.dest_deposito_id)
         AND (e.filial_id IS NULL OR v_dep_filial IS NULL OR e.filial_id = v_dep_filial)
       FOR UPDATE OF e;

      v_fis := public.fn_alm_req_saldo_fisico(v_req.dest_deposito_id, v_ref.r_nome, v_ref.r_codigo, v_ref.r_sku);
      v_res := public.fn_alm_req_reservado(v_req.dest_deposito_id, v_it.item_id, v_it.item_codigo, v_it.item_descricao, p_requisicao_id, NULL);
      IF v_pend > v_fis - v_res THEN
        v_falta := jsonb_build_object('material',v_it.item_descricao,'saldo_fisico',v_fis,'reservado_outras',v_res,
                                      'necessario',v_pend,'deposito',coalesce(v_req.dest_deposito_nome,v_req.dest_deposito_id));
        RAISE EXCEPTION 'ALM_REQ_SALDO_DESTINO';
      END IF;

      v_colab := CASE WHEN coalesce(v_it.colaborador_id,'') ~ v_uuid THEN v_it.colaborador_id END;
      v_movs := '[]'::jsonb;
      v_rest := v_pend;
      FOR v_row IN
        SELECT e.id, coalesce(e.saldo,0) AS saldo, e.deposito_id, e.filial_id
          FROM public.estoque e
         WHERE public.fn_alm_estoque_casa_ref(e.nome, e.codigo, e.sku, v_ref.r_nome, v_ref.r_codigo, v_ref.r_sku)
           AND (e.deposito_id IS NULL OR e.deposito_id::text = v_req.dest_deposito_id)
           AND (e.filial_id IS NULL OR v_dep_filial IS NULL OR e.filial_id = v_dep_filial)
           AND coalesce(e.saldo,0) > 0
         ORDER BY (e.deposito_id IS NOT NULL) DESC, coalesce(e.saldo,0) DESC, e.id
      LOOP
        EXIT WHEN v_rest <= 0;
        v_take := least(v_row.saldo, v_rest);
        UPDATE public.estoque SET saldo = coalesce(saldo,0) - v_take::int WHERE id = v_row.id;
        v_payload := jsonb_build_object(
          'item_id', v_it.item_id,
          'tipo_mov', 'entrega',
          'quantidade', v_take,
          'deposito_id', coalesce(v_row.deposito_id::text, v_req.dest_deposito_id),
          'filial_id', coalesce(v_row.filial_id::text, v_dep_filial::text),
          'contrato_id', v_req.contrato_id::text,
          'colaborador_id', v_colab,
          'equipe_id', CASE WHEN coalesce(v_it.equipe_id,'') ~ v_uuid THEN v_it.equipe_id END,
          'data_mov', current_date,
          'obs', concat_ws(' · ', 'Entrega ao colaborador '||coalesce(v_it.colaborador_nome,'')
                   ||CASE WHEN coalesce(v_it.colaborador_re,'') <> '' THEN ' (RE '||v_it.colaborador_re||')' ELSE '' END,
                   CASE WHEN coalesce(p_ficha_id,'') <> '' THEN 'ficha:'||p_ficha_id END,
                   'estoque_id:'||v_row.id, 'requisicao:'||coalesce(v_req.numero,''), v_tag||':'||v_it.id),
          'status', 'Em uso',
          'motivo', 'Entrega ao colaborador — requisição CENA',
          'registrado_por_id', nullif(p_usuario_id,''),
          'responsavel_id', nullif(p_usuario_id,''));
        INSERT INTO public.movimentacoes_itens
          (item_id, tipo_mov, quantidade, deposito_id, filial_id, contrato_id, colaborador_id, equipe_id,
           data_mov, obs, status, motivo, registrado_por_id, responsavel_id)
        SELECT r.item_id, r.tipo_mov, r.quantidade, r.deposito_id, r.filial_id, r.contrato_id, r.colaborador_id, r.equipe_id,
               r.data_mov, r.obs, r.status, r.motivo, r.registrado_por_id, r.responsavel_id
          FROM jsonb_populate_record(NULL::public.movimentacoes_itens, v_payload) r
        RETURNING id INTO v_mov_id;
        v_movs := v_movs || jsonb_build_array(jsonb_build_object('mov_id',v_mov_id,'estoque_id',v_row.id,'quantidade',v_take));
        v_rest := v_rest - v_take;
      END LOOP;
      IF v_rest > 0 THEN
        v_falta := jsonb_build_object('material',v_it.item_descricao,'saldo_fisico',v_fis,'reservado_outras',v_res,
                                      'necessario',v_pend,'deposito',coalesce(v_req.dest_deposito_nome,v_req.dest_deposito_id));
        RAISE EXCEPTION 'ALM_REQ_SALDO_DESTINO';
      END IF;

      PERFORM set_config('cena.alm_req_rpc','1',true);
      UPDATE public.alm_requisicao_itens
         SET quantidade_entregue_colab = quantidade_entregue_colab + v_pend
       WHERE id = v_it.id;
      v_itens := v_itens || jsonb_build_array(jsonb_build_object(
        'item_req_id',v_it.id,'item_id',v_it.item_id,'material',v_it.item_descricao,'quantidade',v_pend,
        'saldo_destino_antes',v_fis,'movimentos',v_movs));
      v_total := v_total + v_pend;
    END LOOP;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'ALM_REQ_SALDO_DESTINO' THEN
      RETURN jsonb_build_object('ok',false,'codigo','SALDO_DESTINO_INSUFICIENTE','falta',v_falta,
        'msg','Saldo insuficiente em '||coalesce(v_falta->>'deposito','depósito destino')||' para '||coalesce(v_falta->>'material','o item')
              ||': físico '||coalesce(v_falta->>'saldo_fisico','0')||', reservado para outras '||coalesce(v_falta->>'reservado_outras','0')
              ||', necessário '||coalesce(v_falta->>'necessario','0')||'. Nada foi baixado e a ficha não foi assinada.');
    ELSIF SQLERRM = 'ALM_REQ_SEM_CATALOGO' THEN
      RETURN jsonb_build_object('ok',false,'codigo','SEM_CATALOGO',
        'msg','Item sem vínculo ao catálogo ('||coalesce(v_falta->>'material','')||'). Não é possível baixar estoque.');
    END IF;
    RAISE;
  END;

  IF v_total <= 0 THEN
    RETURN jsonb_build_object('ok',true,'sem_baixa',true,'ignorados',v_ignorados,
      'msg','Nenhuma baixa necessária: itens da regra anterior ou já entregues. A ficha só documenta.');
  END IF;

  INSERT INTO public.alm_requisicao_eventos (requisicao_id, evento, descricao, usuario, dados_json)
  VALUES (p_requisicao_id, 'status',
    'Entregue ao colaborador no depósito '||coalesce(v_req.dest_deposito_nome,'destino')||' — baixa na assinatura da ficha', p_usuario,
    jsonb_build_object('tipo','entrega_colaborador','ficha_id',p_ficha_id,'itens',v_itens,'ignorados',v_ignorados,
      'dest_deposito_id',v_req.dest_deposito_id,'chave',btrim(p_chave),'usuario',p_usuario,'usuario_id',p_usuario_id,
      'data_hora',now(),'estoque_alterado',true));

  RETURN jsonb_build_object('ok',true,'itens',v_itens,'ignorados',v_ignorados,'quantidade_total',v_total,
    'msg','Baixa de '||v_total||' no depósito '||coalesce(v_req.dest_deposito_nome,'destino')||' registrada no nome do colaborador.');
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) Guarda: quantidade entregue ao colaborador só pela função oficial
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_alm_req_guarda_entrega_colab()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF coalesce(current_setting('cena.alm_req_rpc', true),'') = '1' THEN
    RETURN NEW;
  END IF;
  IF NEW.quantidade_entregue_colab IS DISTINCT FROM OLD.quantidade_entregue_colab THEN
    RAISE EXCEPTION 'ALM_REQ_RESERVA: entrega ao colaborador só pela função oficial (fn_alm_req_entregar_colaborador).'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_alm_req_guarda_entrega_colab ON public.alm_requisicao_itens;
CREATE TRIGGER trg_alm_req_guarda_entrega_colab
  BEFORE UPDATE OF quantidade_entregue_colab ON public.alm_requisicao_itens
  FOR EACH ROW EXECUTE FUNCTION public.fn_alm_req_guarda_entrega_colab();

GRANT EXECUTE ON FUNCTION public.fn_alm_req_reservado(text,text,text,text,uuid,uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_alm_req_item_exige_colab(text,boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_alm_req_entregar_item(uuid,uuid,numeric,text,text,text,date,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_alm_req_confirmar_recebimento(uuid,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_alm_req_entregar_colaborador(uuid,uuid[],text,text,text,text) TO anon, authenticated;

COMMENT ON FUNCTION public.fn_alm_req_entregar_colaborador(uuid,uuid[],text,text,text,text) IS
  'ALM-CENA: entrega ao colaborador no depósito destino na assinatura da ficha — baixa estoque.saldo do destino, movimentação entrega no nome do colaborador e consumo da reserva do destino. Tudo ou nada; idempotente por p_chave.';

NOTIFY pgrst, 'reload schema';
