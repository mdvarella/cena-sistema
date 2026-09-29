-- ALMOXARIFADO-CENA — reserva, separação, entrega e recebimento da requisição CENA.
--
-- Fluxo: solicitada → aprovada → separacao → separada → entregue → recebida
--   aprovada / separacao / separada : material RESERVADO, saldo físico intacto
--   entregue                        : saída física (estoque.saldo + movimentacoes_itens 'entrega') e consumo da reserva
--   recebida                        : só confirmação do destinatário (quem/quando/evento)
--   parcialmente_atendida           : parte dos itens já entregue (saída física parcial)
--
-- Quantidades do item:
--   quantidade_aprovada  : reservada na aprovação
--   quantidade_separada  : (nova) apartada no almoxarifado, ainda no estoque e ainda reservada
--   quantidade_atendida  : saída física do depósito origem (= entregue). Sentido mantido: é o que
--                          recebimento, estornos, entrega ao colaborador e relatórios já consomem.
--
-- RESERVADO = aprovado − atendido, para requisições aprovada/separacao/separada/parcialmente_atendida.
-- Requisições 'separada' da regra antiga (baixa feita na separação; quantidade_separada nula) não
-- voltam a reservar: a saída física delas já está no saldo. Histórico não é alterado.
--
-- Não toca: alm_movimentos (SAP/campo), sol_materiais, epis. Não recalcula saldo nem movimentos.

-- ---------------------------------------------------------------------------
-- 0) Estrutura mínima
-- ---------------------------------------------------------------------------
ALTER TABLE public.alm_requisicao_itens
  ADD COLUMN IF NOT EXISTS quantidade_separada numeric;

COMMENT ON COLUMN public.alm_requisicao_itens.quantidade_separada IS
  'Quantidade apartada no almoxarifado (ainda no estoque físico e ainda reservada). NULL = item anterior a esta regra.';
COMMENT ON COLUMN public.alm_requisicao_itens.quantidade_atendida IS
  'Quantidade que saiu fisicamente do depósito origem (entregue). Na regra antiga a saída ocorria na separação.';

-- Amplia (nunca reduz) os CHECKs de lista de status/evento para aceitar os valores do fluxo.
DO $$
DECLARE
  c record;
  v_vals text[];
  v_add text[];
  v_new text[];
BEGIN
  FOR c IN
    SELECT con.conname, cl.relname AS tbl, a.attname AS col, pg_get_constraintdef(con.oid) AS def
      FROM pg_constraint con
      JOIN pg_class cl ON cl.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = cl.relnamespace AND ns.nspname = 'public'
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
     WHERE con.contype = 'c'
       AND array_length(con.conkey, 1) = 1
       AND ( (cl.relname = 'alm_requisicoes' AND a.attname = 'status')
          OR (cl.relname = 'alm_requisicao_itens' AND a.attname = 'status')
          OR (cl.relname = 'alm_requisicao_eventos' AND a.attname = 'evento') )
  LOOP
    IF c.def !~* '(= ANY \(|IN \()' THEN
      RAISE NOTICE 'CHECK % em %.% não é lista de valores; mantido como está.', c.conname, c.tbl, c.col;
      CONTINUE;
    END IF;
    v_add := CASE c.tbl
      WHEN 'alm_requisicoes'      THEN ARRAY['aprovada','separacao','separada','parcialmente_atendida','entregue','recebida','cancelada']
      WHEN 'alm_requisicao_itens' THEN ARRAY['aprovado','separacao','separado','entregue','recebido','cancelado']
      ELSE                             ARRAY['aprovada','cancelada','status'] END;
    -- Literais podem vir como 'a'::text, ... ou como um único '{a,b}'::text[].
    SELECT array_agg(DISTINCT v) INTO v_vals
      FROM regexp_matches(c.def, '''([^'']+)''', 'g') AS m,
           LATERAL unnest(CASE WHEN m[1] LIKE '{%}' THEN m[1]::text[] ELSE ARRAY[m[1]] END) AS v;
    IF v_add <@ coalesce(v_vals, '{}'::text[]) THEN CONTINUE; END IF;
    SELECT array_agg(DISTINCT x ORDER BY x) INTO v_new FROM unnest(coalesce(v_vals, '{}'::text[]) || v_add) AS x;
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', c.tbl, c.conname);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%I = ANY (ARRAY[%s]::text[]))', c.tbl, c.conname, c.col,
      (SELECT string_agg(quote_literal(x), ', ') FROM unnest(v_new) AS x));
    RAISE NOTICE 'CHECK % em %.% ampliado: %', c.conname, c.tbl, c.col, v_new;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1) Vínculo linha de estoque ↔ item (espelha almMatchEstoqueRef do ERP)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_alm_estoque_casa_ref(
  p_e_nome text, p_e_codigo text, p_e_sku text,
  p_nome text, p_codigo text, p_sku text
) RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT
    (btrim(coalesce(p_codigo,'')) <> '' AND btrim(p_codigo) IN (
        btrim(coalesce(p_e_codigo,'')), btrim(coalesce(p_e_nome,'')), btrim(coalesce(p_e_sku,''))))
    OR (btrim(coalesce(p_sku,'')) <> '' AND btrim(p_sku) IN (
        btrim(coalesce(p_e_sku,'')), btrim(coalesce(p_e_nome,'')), btrim(coalesce(p_e_codigo,''))))
    OR (btrim(coalesce(p_nome,'')) <> '' AND (
        lower(btrim(coalesce(p_e_nome,''))) = lower(btrim(p_nome))
        OR (btrim(coalesce(p_e_codigo,'')) <> '' AND lower(btrim(p_e_codigo)) = lower(btrim(p_nome)))));
$$;

CREATE OR REPLACE FUNCTION public.fn_alm_req_item_ref(
  p_item_id text, p_codigo text, p_descricao text,
  OUT r_nome text, OUT r_codigo text, OUT r_sku text, OUT r_catalogo boolean
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  r_catalogo := false;
  IF coalesce(p_item_id,'') <> '' THEN
    SELECT c.nome, c.codigo, c.sku INTO r_nome, r_codigo, r_sku
      FROM public.itens_catalogo c WHERE c.id::text = p_item_id LIMIT 1;
    IF FOUND THEN r_catalogo := true; RETURN; END IF;
  END IF;
  r_nome := p_descricao; r_codigo := p_codigo; r_sku := NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) Saldo físico aplicável ao depósito origem (mesma regra da baixa do ERP)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_alm_req_saldo_fisico(
  p_deposito_id text, p_nome text, p_codigo text, p_sku text
) RETURNS numeric
LANGUAGE sql STABLE
AS $$
  SELECT coalesce(sum(coalesce(e.saldo,0)),0)::numeric
    FROM public.estoque e
    LEFT JOIN public.depositos d ON d.id::text = p_deposito_id
   WHERE public.fn_alm_estoque_casa_ref(e.nome, e.codigo, e.sku, p_nome, p_codigo, p_sku)
     AND (e.deposito_id IS NULL OR e.deposito_id::text = p_deposito_id)
     AND (e.filial_id IS NULL OR d.filial_id IS NULL OR e.filial_id = d.filial_id);
$$;

-- ---------------------------------------------------------------------------
-- 3) Reservado ativo = aprovado − entregue (quantidade_atendida)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_alm_req_reservado(
  p_deposito_id text, p_item_id text, p_codigo text, p_nome text,
  p_excluir_req uuid DEFAULT NULL, p_excluir_item uuid DEFAULT NULL
) RETURNS numeric
LANGUAGE sql STABLE
AS $$
  SELECT coalesce(sum(greatest(0,
           coalesce(i.quantidade_aprovada, i.quantidade_solicitada, 0) - coalesce(i.quantidade_atendida, 0))),0)::numeric
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
     );
$$;

-- Status do cabeçalho a partir das quantidades dos itens ativos.
CREATE OR REPLACE FUNCTION public.fn_alm_req_status_por_itens(p_requisicao_id uuid)
RETURNS text
LANGUAGE sql STABLE
AS $$
  WITH it AS (
    SELECT coalesce(quantidade_aprovada, quantidade_solicitada, 0) AS apr,
           coalesce(quantidade_atendida, 0) AS atd,
           greatest(coalesce(quantidade_separada, 0), coalesce(quantidade_atendida, 0)) AS sep,
           coalesce(status,'') AS st
      FROM public.alm_requisicao_itens
     WHERE requisicao_id = p_requisicao_id
       AND coalesce(status,'') NOT IN ('cancelado','recusado'))
  SELECT CASE
           WHEN count(*) = 0 THEN NULL
           WHEN bool_and(atd >= apr OR st IN ('entregue','recebido')) THEN 'entregue'
           WHEN bool_or(atd > 0) THEN 'parcialmente_atendida'
           WHEN bool_and(sep >= apr) THEN 'separada'
           ELSE 'separacao'
         END
    FROM it;
$$;

-- Requisição 'separada' da regra antiga: saída física já feita na separação.
CREATE OR REPLACE FUNCTION public.fn_alm_req_eh_legado_baixado(p_requisicao_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT coalesce(bool_and(i.quantidade_separada IS NULL
                           AND coalesce(i.quantidade_atendida,0) > 0
                           AND coalesce(i.quantidade_atendida,0) >= coalesce(i.quantidade_aprovada, i.quantidade_solicitada, 0)), false)
    FROM public.alm_requisicao_itens i
    JOIN public.alm_requisicoes r ON r.id = i.requisicao_id
   WHERE i.requisicao_id = p_requisicao_id
     AND r.status IN ('separada','atendida')
     AND coalesce(i.status,'') NOT IN ('cancelado','recusado');
$$;

-- ---------------------------------------------------------------------------
-- 4) APROVAR: valida todos os itens e reserva tudo ou nada. Não altera estoque.saldo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_alm_req_aprovar(
  p_requisicao_id uuid,
  p_usuario text DEFAULT NULL,
  p_usuario_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_req public.alm_requisicoes%ROWTYPE;
  v_it record;
  v_ref record;
  v_itens jsonb := '[]'::jsonb;
  v_falta boolean := false;
  v_qtd_itens int := 0;
  v_fis numeric; v_res numeric; v_disp numeric; v_sol numeric; v_need numeric; v_falt numeric;
BEGIN
  SELECT * INTO v_req FROM public.alm_requisicoes WHERE id = p_requisicao_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'codigo','NAO_ENCONTRADA','msg','Requisição não encontrada.');
  END IF;
  IF v_req.status IN ('aprovada','separacao','separada','parcialmente_atendida','entregue','atendida','recebida')
     AND v_req.aprovado_em IS NOT NULL THEN
    RETURN jsonb_build_object('ok',true,'idempotente',true,'status',v_req.status,
      'msg','Requisição já estava aprovada. Nenhuma nova reserva foi feita.');
  END IF;
  IF v_req.status IS DISTINCT FROM 'solicitada' THEN
    RETURN jsonb_build_object('ok',false,'codigo','STATUS_INVALIDO','status',v_req.status,
      'msg','Só requisição Solicitada pode ser aprovada.');
  END IF;
  IF coalesce(v_req.deposito_id,'') = '' THEN
    RETURN jsonb_build_object('ok',false,'codigo','SEM_DEPOSITO','msg','Defina o depósito origem antes de aprovar.');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('alm_req_reserva'), hashtext(v_req.deposito_id));
  PERFORM 1
    FROM public.estoque e
   WHERE (e.deposito_id IS NULL OR e.deposito_id::text = v_req.deposito_id)
     AND EXISTS (
       SELECT 1 FROM public.alm_requisicao_itens i
        CROSS JOIN LATERAL public.fn_alm_req_item_ref(i.item_id, i.item_codigo, i.item_descricao) rf
        WHERE i.requisicao_id = p_requisicao_id
          AND public.fn_alm_estoque_casa_ref(e.nome, e.codigo, e.sku, rf.r_nome, rf.r_codigo, rf.r_sku))
   FOR UPDATE OF e;

  FOR v_it IN
    SELECT i.* FROM public.alm_requisicao_itens i
     WHERE i.requisicao_id = p_requisicao_id
     ORDER BY i.item_descricao, i.id
  LOOP
    v_sol := coalesce(v_it.quantidade_aprovada, v_it.quantidade_solicitada, 0);
    IF v_sol <= 0 THEN CONTINUE; END IF;
    v_qtd_itens := v_qtd_itens + 1;
    SELECT * INTO v_ref FROM public.fn_alm_req_item_ref(v_it.item_id, v_it.item_codigo, v_it.item_descricao);
    v_fis := public.fn_alm_req_saldo_fisico(v_req.deposito_id, v_ref.r_nome, v_ref.r_codigo, v_ref.r_sku);
    v_res := public.fn_alm_req_reservado(v_req.deposito_id, v_it.item_id, v_it.item_codigo, v_it.item_descricao, p_requisicao_id, NULL);
    v_disp := v_fis - v_res;
    SELECT coalesce(sum(coalesce(j.quantidade_aprovada, j.quantidade_solicitada, 0)),0) INTO v_need
      FROM public.alm_requisicao_itens j
     WHERE j.requisicao_id = p_requisicao_id
       AND ( (coalesce(v_it.item_id,'') <> '' AND j.item_id = v_it.item_id)
          OR (coalesce(v_it.item_codigo,'') <> '' AND lower(coalesce(j.item_codigo,'')) = lower(v_it.item_codigo))
          OR (coalesce(v_it.item_descricao,'') <> '' AND lower(btrim(coalesce(j.item_descricao,''))) = lower(btrim(v_it.item_descricao))) );
    v_falt := greatest(0, v_need - greatest(v_disp, 0));
    IF v_falt > 0 THEN v_falta := true; END IF;
    v_itens := v_itens || jsonb_build_array(jsonb_build_object(
      'item_req_id', v_it.id, 'item_id', v_it.item_id, 'material', v_it.item_descricao,
      'saldo_fisico', v_fis, 'reservado', v_res, 'disponivel', v_disp,
      'solicitado', v_sol, 'solicitado_total_material', v_need, 'faltante', v_falt));
  END LOOP;

  IF v_qtd_itens = 0 THEN
    RETURN jsonb_build_object('ok',false,'codigo','SEM_ITENS','msg','Requisição sem itens com quantidade.');
  END IF;
  IF v_falta THEN
    RETURN jsonb_build_object('ok',false,'codigo','SALDO_INSUFICIENTE','itens',v_itens,
      'msg','Aprovação bloqueada: disponível insuficiente em ao menos um item. Nenhum item foi reservado.');
  END IF;

  PERFORM set_config('cena.alm_req_rpc','1',true);
  UPDATE public.alm_requisicao_itens
     SET quantidade_aprovada = coalesce(quantidade_aprovada, quantidade_solicitada),
         status = 'aprovado'
   WHERE requisicao_id = p_requisicao_id;
  UPDATE public.alm_requisicoes
     SET status = 'aprovada', aprovado_por = p_usuario, aprovado_em = now()
   WHERE id = p_requisicao_id;

  INSERT INTO public.alm_requisicao_eventos (requisicao_id, evento, descricao, usuario, dados_json)
  VALUES (p_requisicao_id, 'aprovada', 'Aprovada — reserva registrada (estoque físico não alterado)', p_usuario,
    jsonb_build_object('tipo','reserva','itens',v_itens,'usuario',p_usuario,'usuario_id',p_usuario_id,
                       'data_hora',now(),'estoque_alterado',false));

  RETURN jsonb_build_object('ok',true,'status','aprovada','itens',v_itens,
    'msg','Aprovada. Quantidades reservadas; o saldo físico só baixa na entrega.');
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) SEPARAR ITEM: aparta no almoxarifado. NÃO altera estoque.saldo, NÃO consome reserva,
--    NÃO cria movimentação.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_alm_req_separar_item(
  p_requisicao_id uuid,
  p_item_req_id uuid,
  p_quantidade numeric,
  p_chave text,
  p_usuario text DEFAULT NULL,
  p_usuario_id text DEFAULT NULL,
  p_dest_base_id text DEFAULT NULL,
  p_dest_base_nome text DEFAULT NULL,
  p_dest_deposito_id text DEFAULT NULL,
  p_dest_deposito_nome text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_req public.alm_requisicoes%ROWTYPE;
  v_it public.alm_requisicao_itens%ROWTYPE;
  v_ref record;
  v_apr numeric; v_atd numeric; v_sep numeric; v_pend numeric;
  v_fis numeric; v_res_outras numeric; v_res_mesma numeric; v_livre numeric; v_permitido numeric;
  v_st_item text; v_st_cab text;
BEGIN
  IF coalesce(btrim(p_chave),'') = '' THEN
    RETURN jsonb_build_object('ok',false,'codigo','SEM_CHAVE','msg','Operação sem chave de idempotência.');
  END IF;
  IF p_quantidade IS NULL OR p_quantidade <= 0 THEN
    RETURN jsonb_build_object('ok',false,'codigo','QTD_INVALIDA','msg','Informe a quantidade a separar.');
  END IF;

  SELECT * INTO v_req FROM public.alm_requisicoes WHERE id = p_requisicao_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'codigo','NAO_ENCONTRADA','msg','Requisição não encontrada.');
  END IF;
  SELECT * INTO v_it FROM public.alm_requisicao_itens
   WHERE id = p_item_req_id AND requisicao_id = p_requisicao_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'codigo','ITEM_NAO_ENCONTRADO','msg','Item não pertence a esta requisição.');
  END IF;

  IF EXISTS (SELECT 1 FROM public.alm_requisicao_eventos ev
              WHERE ev.requisicao_id = p_requisicao_id AND ev.dados_json->>'chave' = btrim(p_chave)) THEN
    RETURN jsonb_build_object('ok',true,'idempotente',true,'status',v_req.status,
      'quantidade_separada',v_it.quantidade_separada,'item_status',v_it.status,
      'msg','Esta separação já foi registrada. Nada foi duplicado.');
  END IF;

  IF v_req.status NOT IN ('separacao','parcialmente_atendida') THEN
    RETURN jsonb_build_object('ok',false,'codigo','STATUS_INVALIDO','status',v_req.status,
      'msg','Inicie a separação antes de separar o item.');
  END IF;
  IF coalesce(v_req.deposito_id,'') = '' THEN
    RETURN jsonb_build_object('ok',false,'codigo','SEM_DEPOSITO','msg','Requisição sem depósito origem.');
  END IF;
  IF coalesce(v_it.status,'') IN ('cancelado','recusado','entregue','recebido') THEN
    RETURN jsonb_build_object('ok',false,'codigo','ITEM_ENCERRADO','msg','Este item está encerrado e não pode ser separado.');
  END IF;

  v_apr := coalesce(v_it.quantidade_aprovada, v_it.quantidade_solicitada, 0);
  v_atd := coalesce(v_it.quantidade_atendida, 0);
  v_sep := greatest(coalesce(v_it.quantidade_separada, 0), v_atd);
  v_pend := greatest(0, v_apr - v_sep);
  IF v_pend <= 0 THEN
    RETURN jsonb_build_object('ok',false,'codigo','NADA_A_SEPARAR','msg','Este item já está totalmente separado.');
  END IF;
  IF p_quantidade > v_pend THEN
    RETURN jsonb_build_object('ok',false,'codigo','ACIMA_DA_RESERVA','pendente_separar',v_pend,
      'msg','Quantidade maior que o reservado a separar nesta requisição ('||v_pend||').');
  END IF;
  IF p_quantidade <> trunc(p_quantidade) THEN
    RETURN jsonb_build_object('ok',false,'codigo','QTD_FRACIONADA',
      'msg','O saldo físico do estoque é controlado em unidades inteiras. Informe uma quantidade inteira.');
  END IF;

  SELECT * INTO v_ref FROM public.fn_alm_req_item_ref(v_it.item_id, v_it.item_codigo, v_it.item_descricao);
  IF NOT coalesce(v_ref.r_catalogo,false) THEN
    RETURN jsonb_build_object('ok',false,'codigo','SEM_CATALOGO','msg','Item sem vínculo ao catálogo. Não será possível entregar.');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('alm_req_reserva'), hashtext(v_req.deposito_id));
  v_fis := public.fn_alm_req_saldo_fisico(v_req.deposito_id, v_ref.r_nome, v_ref.r_codigo, v_ref.r_sku);
  v_res_outras := public.fn_alm_req_reservado(v_req.deposito_id, v_it.item_id, v_it.item_codigo, v_it.item_descricao, p_requisicao_id, NULL);
  v_res_mesma := greatest(0, public.fn_alm_req_reservado(v_req.deposito_id, v_it.item_id, v_it.item_codigo, v_it.item_descricao, NULL, p_item_req_id) - v_res_outras);
  -- o que já está apartado deste item e não saiu ocupa prateleira
  v_livre := v_fis - v_res_outras - v_res_mesma - (v_sep - v_atd);
  v_permitido := least(v_pend, greatest(0, v_livre));
  IF p_quantidade > v_permitido THEN
    RETURN jsonb_build_object('ok',false,'codigo','SALDO_FISICO_INSUFICIENTE',
      'saldo_fisico',v_fis,'reservado_outras',v_res_outras + v_res_mesma,'permitido',v_permitido,
      'msg','Saldo físico '||v_fis||' no depósito origem, reservado para outras requisições '||(v_res_outras + v_res_mesma)
            ||'. Pode separar agora no máximo '||v_permitido||'. Verifique divergência de estoque.');
  END IF;

  PERFORM set_config('cena.alm_req_rpc','1',true);
  v_st_item := CASE WHEN v_sep + p_quantidade >= v_apr THEN 'separado' ELSE 'separacao' END;
  UPDATE public.alm_requisicao_itens
     SET quantidade_separada = v_sep + p_quantidade, status = v_st_item
   WHERE id = p_item_req_id;
  v_st_cab := coalesce(public.fn_alm_req_status_por_itens(p_requisicao_id), v_req.status);
  UPDATE public.alm_requisicoes
     SET status = v_st_cab,
         dest_base_id = coalesce(p_dest_base_id, dest_base_id),
         dest_base_nome = coalesce(p_dest_base_nome, dest_base_nome),
         dest_deposito_id = coalesce(p_dest_deposito_id, dest_deposito_id),
         dest_deposito_nome = coalesce(p_dest_deposito_nome, dest_deposito_nome)
   WHERE id = p_requisicao_id;

  INSERT INTO public.alm_requisicao_eventos (requisicao_id, evento, descricao, usuario, dados_json)
  VALUES (p_requisicao_id, 'status',
    'Separado '||p_quantidade||' × '||coalesce(v_it.item_descricao,'')||' — apartado no almoxarifado (sem saída física)', p_usuario,
    jsonb_build_object('tipo','separacao','item_req_id',p_item_req_id,'item_id',v_it.item_id,'qtd',p_quantidade,
      'separado_antes',v_sep,'separado_depois',v_sep + p_quantidade,'reserva',v_apr - v_atd,
      'chave',btrim(p_chave),'usuario',p_usuario,'usuario_id',p_usuario_id,'data_hora',now(),'estoque_alterado',false));

  RETURN jsonb_build_object('ok',true,'status',v_st_cab,'item_status',v_st_item,
    'quantidade_separada',v_sep + p_quantidade,'reserva_item',v_apr - v_atd,
    'msg','Separado '||p_quantidade||'. Continua reservado e no estoque físico até a entrega.');
END;
$$;

-- ---------------------------------------------------------------------------
-- 6) ENTREGAR ITEM: saída física do que foi separado. Tudo ou nada:
--    estoque.saldo − qtd, movimentacoes_itens 'entrega', quantidade_atendida + qtd (consome a reserva), evento.
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
      'colaborador_id', nullif(v_it.colaborador_id::text,''),
      'equipe_id', nullif(v_it.equipe_id::text,''),
      'data_mov', coalesce(p_data_mov, current_date),
      'obs', concat_ws(' · ', nullif(p_obs,''), 'estoque_id:'||v_row.id, 'requisicao:'||coalesce(v_req.numero,''), v_tag),
      'status', 'Em uso',
      'motivo', 'Entrega requisição CENA',
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
    'Entregue '||p_quantidade||' × '||coalesce(v_it.item_descricao,'')||' — saída física e consumo da reserva', p_usuario,
    jsonb_build_object('tipo','saida_fisica','item_req_id',p_item_req_id,'item_id',v_it.item_id,'qtd',p_quantidade,
      'reserva_antes',v_apr - v_atd,'reserva_depois',v_apr - v_atd - p_quantidade,'saldo_fisico_antes',v_fis,
      'movimentos',v_movs,'dest_deposito_id',v_req.dest_deposito_id,
      'chave',btrim(p_chave),'usuario',p_usuario,'usuario_id',p_usuario_id,'data_hora',now(),'estoque_alterado',true));

  RETURN jsonb_build_object('ok',true,'status',v_st_cab,'item_status',v_st_item,
    'quantidade_atendida',v_atd + p_quantidade,'reserva_restante',v_apr - v_atd - p_quantidade,
    'saldo_fisico_antes',v_fis,'saldo_fisico_depois',v_fis - p_quantidade,'movimentos',v_movs,
    'msg','Entregue '||p_quantidade||'. Saída física registrada.');
END;
$$;

-- ---------------------------------------------------------------------------
-- 7) CONFIRMAR RECEBIMENTO: só registra quem/quando/evento. Sem baixa, sem reserva, sem movimento.
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

  SELECT coalesce(jsonb_agg(jsonb_build_object('item_req_id',i.id,'item_id',i.item_id,'quantidade',coalesce(i.quantidade_atendida,0))), '[]'::jsonb)
    INTO v_itens
    FROM public.alm_requisicao_itens i
   WHERE i.requisicao_id = p_requisicao_id AND coalesce(i.quantidade_atendida,0) > 0
     AND coalesce(i.status,'') NOT IN ('cancelado','recusado');

  PERFORM set_config('cena.alm_req_rpc','1',true);
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
    'msg','Recebimento confirmado. Estoque e reserva não foram alterados.');
END;
$$;

-- ---------------------------------------------------------------------------
-- 8) CANCELAR antes da entrega: libera reserva sem alterar estoque.saldo.
--    Com entrega parcial, libera só o restante. Depois de entregue: fluxo de devolução.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_alm_req_cancelar(
  p_requisicao_id uuid,
  p_usuario text DEFAULT NULL,
  p_usuario_id text DEFAULT NULL,
  p_motivo text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_req public.alm_requisicoes%ROWTYPE;
  v_liberado jsonb;
  v_tem_saida boolean;
  v_pendente numeric;
  v_novo text;
BEGIN
  SELECT * INTO v_req FROM public.alm_requisicoes WHERE id = p_requisicao_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'codigo','NAO_ENCONTRADA','msg','Requisição não encontrada.');
  END IF;
  IF v_req.status = 'cancelada' THEN
    RETURN jsonb_build_object('ok',true,'idempotente',true,'status','cancelada','msg','Requisição já estava cancelada.');
  END IF;
  IF v_req.status IN ('entregue','recebida','atendida') OR public.fn_alm_req_eh_legado_baixado(p_requisicao_id) THEN
    RETURN jsonb_build_object('ok',false,'codigo','JA_ENTREGUE','status',v_req.status,
      'msg','O material já saiu fisicamente do almoxarifado. Use o fluxo de devolução/estorno.');
  END IF;
  IF v_req.status NOT IN ('rascunho','solicitada','aprovada','separacao','separada','parcialmente_atendida') THEN
    RETURN jsonb_build_object('ok',false,'codigo','STATUS_INVALIDO','status',v_req.status,
      'msg','Não é possível cancelar neste status.');
  END IF;
  IF v_req.status IN ('aprovada','separacao','separada','parcialmente_atendida') AND coalesce(btrim(p_motivo),'') = '' THEN
    RETURN jsonb_build_object('ok',false,'codigo','SEM_MOTIVO','msg','Informe o motivo do cancelamento.');
  END IF;
  IF coalesce(v_req.deposito_id,'') <> '' THEN
    PERFORM pg_advisory_xact_lock(hashtext('alm_req_reserva'), hashtext(v_req.deposito_id));
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'item_req_id', i.id, 'material', i.item_descricao,
           'liberado', greatest(0, coalesce(i.quantidade_aprovada, i.quantidade_solicitada, 0) - coalesce(i.quantidade_atendida,0)),
           'separado_devolvido_a_prateleira', greatest(0, coalesce(i.quantidade_separada,0) - coalesce(i.quantidade_atendida,0)),
           'ja_entregue', coalesce(i.quantidade_atendida,0))), '[]'::jsonb),
         bool_or(coalesce(i.quantidade_atendida,0) > 0),
         coalesce(sum(greatest(0, coalesce(i.quantidade_aprovada, i.quantidade_solicitada, 0) - coalesce(i.quantidade_atendida,0))),0)
    INTO v_liberado, v_tem_saida, v_pendente
    FROM public.alm_requisicao_itens i
   WHERE i.requisicao_id = p_requisicao_id AND coalesce(i.status,'') NOT IN ('cancelado','recusado');

  PERFORM set_config('cena.alm_req_rpc','1',true);
  IF coalesce(v_tem_saida,false) THEN
    IF v_pendente <= 0 THEN
      RETURN jsonb_build_object('ok',false,'codigo','JA_ENTREGUE',
        'msg','Todos os itens já saíram fisicamente. Use o fluxo de devolução/estorno.');
    END IF;
    UPDATE public.alm_requisicao_itens SET status = 'cancelado'
     WHERE requisicao_id = p_requisicao_id AND coalesce(quantidade_atendida,0) = 0
       AND coalesce(status,'') NOT IN ('cancelado','recusado');
    UPDATE public.alm_requisicao_itens SET status = 'entregue'
     WHERE requisicao_id = p_requisicao_id AND coalesce(quantidade_atendida,0) > 0
       AND coalesce(status,'') NOT IN ('cancelado','recusado','recebido');
    v_novo := 'entregue';
    UPDATE public.alm_requisicoes SET status = 'entregue' WHERE id = p_requisicao_id;
  ELSE
    UPDATE public.alm_requisicao_itens SET status = 'cancelado' WHERE requisicao_id = p_requisicao_id;
    v_novo := 'cancelada';
    UPDATE public.alm_requisicoes
       SET status = 'cancelada', cancelado_por = p_usuario, cancelado_em = now()
     WHERE id = p_requisicao_id;
  END IF;

  INSERT INTO public.alm_requisicao_eventos (requisicao_id, evento, descricao, usuario, dados_json)
  VALUES (p_requisicao_id, 'cancelada',
    CASE WHEN coalesce(v_tem_saida,false)
         THEN 'Saldo pendente cancelado — reserva restante liberada; o que já foi entregue permanece. Motivo: '||coalesce(p_motivo,'')
         ELSE 'Cancelada — reserva liberada (estoque físico não alterado). Motivo: '||coalesce(p_motivo,'') END,
    p_usuario,
    jsonb_build_object('tipo','liberacao_reserva','parcial',coalesce(v_tem_saida,false),'status_anterior',v_req.status,
      'status_novo',v_novo,'itens',v_liberado,'motivo',p_motivo,'usuario',p_usuario,'usuario_id',p_usuario_id,
      'data_hora',now(),'estoque_alterado',false));

  RETURN jsonb_build_object('ok',true,'status',v_novo,'parcial',coalesce(v_tem_saida,false),'itens',v_liberado,
    'msg', CASE WHEN coalesce(v_tem_saida,false)
                THEN 'Reserva restante liberada. O que já foi entregue continua registrado.'
                ELSE 'Cancelada. Reserva liberada; o saldo físico não foi alterado.' END);
END;
$$;

-- ---------------------------------------------------------------------------
-- 9) Guarda: reserva, entrega e recebimento só pelas funções oficiais
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_alm_req_guarda_reserva()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF coalesce(current_setting('cena.alm_req_rpc', true),'') = '1' THEN
    RETURN NEW;
  END IF;
  IF NEW.status IN ('aprovada','separacao','separada','parcialmente_atendida')
     AND coalesce(OLD.status,'') NOT IN ('aprovada','separacao','separada','parcialmente_atendida','entregue','atendida','recebida') THEN
    RAISE EXCEPTION 'ALM_REQ_RESERVA: aprovação só pelo controle de reservas (fn_alm_req_aprovar).'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IN ('entregue','recebida') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'ALM_REQ_RESERVA: entrega/recebimento só pelas funções oficiais (fn_alm_req_entregar_item / fn_alm_req_confirmar_recebimento).'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_alm_req_guarda_reserva ON public.alm_requisicoes;
CREATE TRIGGER trg_alm_req_guarda_reserva
  BEFORE UPDATE OF status ON public.alm_requisicoes
  FOR EACH ROW EXECUTE FUNCTION public.fn_alm_req_guarda_reserva();

GRANT EXECUTE ON FUNCTION public.fn_alm_estoque_casa_ref(text,text,text,text,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_alm_req_item_ref(text,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_alm_req_saldo_fisico(text,text,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_alm_req_reservado(text,text,text,text,uuid,uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_alm_req_status_por_itens(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_alm_req_eh_legado_baixado(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_alm_req_aprovar(uuid,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_alm_req_separar_item(uuid,uuid,numeric,text,text,text,text,text,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_alm_req_entregar_item(uuid,uuid,numeric,text,text,text,date,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_alm_req_confirmar_recebimento(uuid,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_alm_req_cancelar(uuid,text,text,text) TO anon, authenticated;

COMMENT ON FUNCTION public.fn_alm_req_aprovar(uuid,text,text) IS
  'ALM-CENA: aprova reservando tudo ou nada (disponível = estoque.saldo − reservas ativas). Não altera estoque.saldo.';
COMMENT ON FUNCTION public.fn_alm_req_separar_item(uuid,uuid,numeric,text,text,text,text,text,text,text) IS
  'ALM-CENA: registra quantidade separada (apartada). Não altera estoque.saldo, não consome reserva, não cria movimentação. Idempotente por p_chave.';
COMMENT ON FUNCTION public.fn_alm_req_entregar_item(uuid,uuid,numeric,text,text,text,date,text) IS
  'ALM-CENA: saída física do separado — estoque.saldo, movimentacoes_itens entrega, quantidade_atendida e evento na mesma transação. Idempotente por p_chave.';
COMMENT ON FUNCTION public.fn_alm_req_confirmar_recebimento(uuid,text,text) IS
  'ALM-CENA: confirma recebimento (quem/quando/evento). Não baixa, não consome reserva, não cria movimentação.';
COMMENT ON FUNCTION public.fn_alm_req_cancelar(uuid,text,text,text) IS
  'ALM-CENA: cancela antes da entrega liberando reserva; com entrega parcial libera só o restante. Não altera estoque.saldo.';

NOTIFY pgrst, 'reload schema';
