-- Portaria: corrige a placa da saída da equipe EJN303 em 30/09/2026 07:26 (registro + clone duplicado).
-- A programação trocou o veículo DTF3B91 → GGB8G11 às 07:26:05 e a portaria liberou às 07:26:15 com a placa
-- antiga da tela (corrigido no app em 8.1.171). O KM de saída 42513 é o KM de retorno do GGB8G11 em 29/09.
-- Altera SOMENTE frotas_portaria_saidas.placa (e acrescenta nota em obs) dos 2 registros abaixo.
-- Não altera KM, status, retorno, frotas_veiculos, programação nem outras saídas.
-- Fail-closed: se algum dos 2 registros não existir, estiver apagado, não for da EJN303 em 30/09 com KM 42513
-- ou já não estiver com DTF3B91, ou se o GGB8G11 não existir no cadastro de veículos, nada é alterado.
-- Grava audit_log PORTARIA_CORRECAO_PLACA com placa/obs anteriores (permite desfazer).

BEGIN;

DO $$
DECLARE
  v_ids text[] := ARRAY[
    '545e35fc-90e0-45ff-a4fe-e06bbd0719d3', -- saída EJN303 30/09 07:26 (tipo_liberacao equipe)
    '357c4c09-e79e-4efa-bac5-57dbfe6090aa'  -- clone inserido junto (modelo/tipo_liberacao nulos)
  ];
  v_equipe      text := 'e1d505db-f808-493d-bd82-271b3291ecd0'; -- EJN303
  v_placa_errada text := 'DTF3B91';
  v_placa_certa  text := 'GGB8G11';
  v_km          int  := 42513;
  v_nota        text := '[Correção 30/09/2026: placa registrada DTF3B91 → GGB8G11 (programação trocou o veículo 10 s antes da liberação)]';
  v_ok int;
  v_antes jsonb;
  v_upd int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.frotas_veiculos
                  WHERE upper(regexp_replace(placa, '[^A-Za-z0-9]', '', 'g')) = v_placa_certa AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'PARAR: veículo % não encontrado em frotas_veiculos. Nenhuma alteração.', v_placa_certa;
  END IF;

  PERFORM 1 FROM public.frotas_portaria_saidas WHERE id::text = ANY(v_ids) FOR UPDATE;

  SELECT count(*) INTO v_ok
  FROM public.frotas_portaria_saidas
  WHERE id::text = ANY(v_ids)
    AND deleted_at IS NULL
    AND equipe_id::text = v_equipe
    AND upper(regexp_replace(coalesce(placa, ''), '[^A-Za-z0-9]', '', 'g')) = v_placa_errada
    AND km_saida = v_km
    AND (data_saida AT TIME ZONE 'America/Sao_Paulo')::date = DATE '2026-09-30';
  IF v_ok <> array_length(v_ids, 1) THEN
    RAISE EXCEPTION 'PARAR: só % dos % registros ainda estão como esperado (EJN303, %, KM %, 30/09). Nenhuma alteração.',
      v_ok, array_length(v_ids, 1), v_placa_errada, v_km;
  END IF;

  SELECT jsonb_agg(jsonb_build_object('id', id::text, 'placa', placa, 'obs', obs) ORDER BY id::text) INTO v_antes
  FROM public.frotas_portaria_saidas
  WHERE id::text = ANY(v_ids);

  UPDATE public.frotas_portaria_saidas
  SET placa = v_placa_certa,
      obs = CASE WHEN coalesce(obs, '') = '' THEN v_nota ELSE obs || ' ' || v_nota END
  WHERE id::text = ANY(v_ids)
    AND upper(regexp_replace(coalesce(placa, ''), '[^A-Za-z0-9]', '', 'g')) = v_placa_errada;

  GET DIAGNOSTICS v_upd = ROW_COUNT;
  IF v_upd <> array_length(v_ids, 1) THEN
    RAISE EXCEPTION 'PARAR: UPDATE afetou % linhas; esperado %. Rollback.', v_upd, array_length(v_ids, 1);
  END IF;

  INSERT INTO public.audit_log (
    acao, modulo, descricao,
    usuario_id, usuario_nome, usuario_perfil,
    dados_extra, data_hora, sessao_id
  ) VALUES (
    'PORTARIA_CORRECAO_PLACA',
    'frotas',
    'Correção da placa da saída da EJN303 em 30/09/2026 07:26: DTF3B91 → GGB8G11 (' || v_upd || ' registros: saída + clone).',
    '',
    coalesce(current_user, 'sql-editor'),
    '',
    jsonb_build_object(
      'equipe_id', v_equipe,
      'equipe', 'EJN303',
      'placa_anterior', v_placa_errada,
      'placa_nova', v_placa_certa,
      'km_saida', v_km,
      'registros', v_antes,
      'registros_afetados', v_upd
    ),
    now(),
    'sql:20260930090000_portaria_placa_ejn303_30set'
  );
END $$;

COMMIT;

-- Validação (após aplicar):
--   SELECT id, placa, km_saida, status, obs FROM public.frotas_portaria_saidas
--    WHERE id::text IN ('545e35fc-90e0-45ff-a4fe-e06bbd0719d3','357c4c09-e79e-4efa-bac5-57dbfe6090aa');  -- placa GGB8G11
--   SELECT acao, descricao, data_hora FROM public.audit_log
--    WHERE sessao_id = 'sql:20260930090000_portaria_placa_ejn303_30set' ORDER BY data_hora DESC LIMIT 1;
--
-- Para desfazer (só se necessário; restaura placa e obs gravadas no audit_log):
--   UPDATE public.frotas_portaria_saidas s
--      SET placa = e.r->>'placa', obs = e.r->>'obs'
--     FROM (SELECT dados_extra FROM public.audit_log
--            WHERE sessao_id = 'sql:20260930090000_portaria_placa_ejn303_30set'
--            ORDER BY data_hora DESC LIMIT 1) a,
--          jsonb_array_elements(a.dados_extra->'registros') AS e(r)
--    WHERE s.id::text = e.r->>'id' AND s.placa = 'GGB8G11';
