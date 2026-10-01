-- Portaria: recupera os retornos de 30/09/2026 que foram gravados em cópias de saída já excluídas.
-- Causa: a migration 20260930180000 excluiu as cópias abertas às 15:25; o tablet "Portaria Coaquira 1" continuou com a
-- cópia no cache e, das 16:18 às 21:49, registrou o retorno nela (o PATCH por id não conferia deleted_at — corrigido em
-- 8.1.187). A saída viva ficou "Em campo" sem retorno.
-- Conferido em 01/10/2026 (só leitura): 17 pares cópia excluída COM retorno → saída viva da mesma equipe/placa/data_saida/KM.
--   16 vivas seguem abertas e recebem o retorno.
--   EON121 TTJ1J13: a viva já recebeu outro retorno em 01/10 05:17 → pulada (conferência manual).
-- E uma restauração: EON177 RTQ7D65 (e05fe08c) era a única linha viva da saída de 30/09 12:04, já com retorno (21:49), e foi
-- excluída em 01/10 07:35 pela deduplicação do app (cópia antiga no cache venceu). Volta a ficar viva.
-- A viva recebe da cópia: status, km_retorno, data_retorno, base_retorno, obs_retorno, retorno_registrado_por,
-- status_devolucao, foto_carga_retorno_b64, foto_carga_retorno_ts, mais nota em obs. A cópia continua excluída e intocada.
-- KM copiado como o porteiro digitou. Divergências que ficam para o ajuste de KM (não corrigidas aqui):
--   KM de saída truncado pelo bug do ponto de milhar (8.1.182): EBN344 32, EBN342 25, EJN300 64, EON325 96, EBN185 46,
--   EBN188 33, EON177 13; EJN303 GGB8G11 retorno 26883 < saída 42513; EBN143 TTD8A69 retorno 37462 < saída 127438.
-- Fail-closed: par com equipe/placa/data_saida/KM diferentes, cópia sem retorno ou linha faltando PARA sem alterar nada.
-- Par já resolvido (viva excluída, viva com retorno, cópia restaurada) é pulado e registrado na auditoria.
-- Grava audit_log PORTARIA_RETORNOS_COPIAS_EXCLUIDAS_3009 com o estado anterior (permite desfazer).

BEGIN;

DO $$
DECLARE
  v_esperado_pares int := 17;
  v_restaurar text := 'e05fe08c-b693-4146-b308-f85d7d75cd1d';
  v_nota text := '[Correção 01/10/2026: retorno registrado pela portaria na cópia já excluída ';
  v_par record;
  v_c record;
  v_v record;
  v_r record;
  v_upd int;
  v_aplicados int := 0;
  v_itens jsonb := '[]'::jsonb;
  v_pulados jsonb := '[]'::jsonb;
  v_restaurada jsonb := NULL;
BEGIN
  -- Lista criada dentro do bloco: funciona mesmo se o editor rodar só o DO ou usar outra conexão.
  DROP TABLE IF EXISTS _port_ret_3009;
  CREATE TEMP TABLE _port_ret_3009 (copia text PRIMARY KEY, viva text NOT NULL UNIQUE) ON COMMIT DROP;
  INSERT INTO _port_ret_3009 (copia, viva) VALUES
      ('2d2f2f1e-a645-4093-93b0-1f714e8c3d91', '7128d117-d221-4c24-bc04-11864b280165'), -- 07:11 EBN344 STM6J35 ret 16:18
      ('364a38b5-fcfd-444d-acc2-2b485287d642', '6008b0ce-2474-4a3e-8221-7a869057ef4a'), -- 07:18 EBN342 TJC9A62 ret 16:54
      ('48f68783-91f8-4940-8a92-701e69aa9d41', '83ade37a-e6bd-4c35-96dd-6877d6fde30f'), -- 07:23 EJN300 DZH7G12 ret 18:45
      ('545e35fc-90e0-45ff-a4fe-e06bbd0719d3', '357c4c09-e79e-4efa-bac5-57dbfe6090aa'), -- 07:26 EJN303 GGB8G11 ret 17:46
      ('aa928f91-570d-4645-baf7-661051c873e7', '80e13f8c-5619-4796-869c-873c3980bf33'), -- 07:27 EJN301 EGB6D72 ret 16:22
      ('5da4ff78-ce28-40a8-ad87-b62221a8f2d9', 'fbbbddfa-9a71-4fc2-bba2-60bc7f2eea66'), -- 07:27 EBN143 TTD8A69 ret 17:41
      ('887077b4-36c1-4114-a736-b050c1835de1', '6ab9b524-4ec8-4680-9399-c922fc8c7c7b'), -- 07:28 EON325 SVZ6D46 ret 17:52
      ('ecbdb230-db83-4051-9ed4-41ce38ef8064', 'af2602ea-f857-467a-8ed8-31e1f259143f'), -- 07:32 EBN145 TTP2G93 ret 16:52
      ('1f241111-11c7-4095-aa7a-b6c1b87ec20d', '8308d1fe-9acb-4f8e-9efa-69e90dc4fdb2'), -- 07:34 EBN345 TLY9G76 ret 16:24
      ('86645980-068a-46ae-84e0-1144a82f9ac6', 'a0162d0c-e9b8-4455-afe6-203f0ae273eb'), -- 07:57 EIN330 STC8B57 ret 16:48
      ('7fdee033-395b-4b68-8d33-16e4f154ce4a', '11c72d79-3de3-4ff7-b53e-fd1976a68539'), -- 08:01 EJN103 TTM8E98 ret 21:47
      ('52eaebb2-943d-421a-a4fb-aabf3197d317', '4d886cc2-32b0-4762-ad2f-34efc97dffd0'), -- 08:14 EON121 TTJ1J13 ret 17:32 (viva já retornada)
      ('4dd9a06c-292b-4ed6-b87f-d7ba9f65deaa', '6014d4fc-3421-4d43-9c7c-1edc21b53130'), -- 08:16 EBN141 RTP6F36 ret 16:22
      ('079e1882-6abe-4e16-b0a6-8109a598649e', 'dc7ebffe-0ba5-4828-858f-2d4bbdb30ebf'), -- 08:23 EIN331 TMB1J95 ret 17:41
      ('9e420ffc-9109-4ec7-9e1c-e309b5d13fc2', 'b5cf0e38-f030-4a14-a276-38de5447f013'), -- 08:31 EIN334 TLS8E04 ret 17:04
      ('43910a19-b145-4134-80c4-3706bd84be5b', '2c564ea8-f6c3-44ab-82b6-3a20e7323b80'), -- 11:57 EBN185 TTH9G86 ret 20:48
      ('f2857e8a-865a-4ac5-b24e-7dca3b2e6799', '36b1bea1-3c4e-41a1-8838-30972a8fcb82')  -- 12:00 EBN188 TTD8A68 ret 21:07
  ;

  IF (SELECT count(*) FROM _port_ret_3009) <> v_esperado_pares THEN
    RAISE EXCEPTION 'PARAR: lista com % pares; esperado %.', (SELECT count(*) FROM _port_ret_3009), v_esperado_pares;
  END IF;
  IF EXISTS (SELECT 1 FROM _port_ret_3009 a JOIN _port_ret_3009 b ON a.copia = b.viva) OR v_restaurar IN (SELECT copia FROM _port_ret_3009 UNION SELECT viva FROM _port_ret_3009) THEN
    RAISE EXCEPTION 'PARAR: id repetido entre cópias, vivas e restauração.';
  END IF;

  PERFORM 1 FROM public.frotas_portaria_saidas s
   WHERE s.id::text IN (SELECT copia FROM _port_ret_3009 UNION ALL SELECT viva FROM _port_ret_3009 UNION ALL SELECT v_restaurar)
   FOR UPDATE;
  IF (SELECT count(*) FROM public.frotas_portaria_saidas s
       WHERE s.id::text IN (SELECT copia FROM _port_ret_3009 UNION ALL SELECT viva FROM _port_ret_3009)) <> v_esperado_pares * 2 THEN
    RAISE EXCEPTION 'PARAR: % de % linhas encontradas. Nenhuma alteração.',
      (SELECT count(*) FROM public.frotas_portaria_saidas s
        WHERE s.id::text IN (SELECT copia FROM _port_ret_3009 UNION ALL SELECT viva FROM _port_ret_3009)), v_esperado_pares * 2;
  END IF;

  FOR v_par IN SELECT copia, viva FROM _port_ret_3009 ORDER BY copia LOOP
    SELECT * INTO v_c FROM public.frotas_portaria_saidas WHERE id::text = v_par.copia;
    SELECT * INTO v_v FROM public.frotas_portaria_saidas WHERE id::text = v_par.viva;

    IF coalesce(v_c.equipe_id::text, '') <> coalesce(v_v.equipe_id::text, '')
       OR upper(coalesce(v_c.placa, '')) <> upper(coalesce(v_v.placa, ''))
       OR v_c.data_saida IS DISTINCT FROM v_v.data_saida
       OR v_c.km_saida IS DISTINCT FROM v_v.km_saida THEN
      RAISE EXCEPTION 'PARAR: cópia % e viva % não são da mesma equipe/placa/data de saída/KM. Nenhuma alteração.', v_par.copia, v_par.viva;
    END IF;
    IF v_c.data_retorno IS NULL THEN
      RAISE EXCEPTION 'PARAR: cópia % sem retorno. Nenhuma alteração.', v_par.copia;
    END IF;

    IF v_c.deleted_at IS NULL THEN
      v_pulados := v_pulados || jsonb_build_object('copia', v_par.copia, 'viva', v_par.viva, 'placa', v_v.placa, 'equipe', v_v.equipe, 'motivo', 'cópia não está mais excluída');
      CONTINUE;
    ELSIF v_v.deleted_at IS NOT NULL THEN
      v_pulados := v_pulados || jsonb_build_object('copia', v_par.copia, 'viva', v_par.viva, 'placa', v_v.placa, 'equipe', v_v.equipe, 'motivo', 'saída viva foi excluída');
      CONTINUE;
    ELSIF v_v.data_retorno IS NOT NULL OR coalesce(v_v.status, '') <> 'Em campo' THEN
      v_pulados := v_pulados || jsonb_build_object('copia', v_par.copia, 'viva', v_par.viva, 'placa', v_v.placa, 'equipe', v_v.equipe,
        'motivo', 'saída viva já tem retorno', 'viva_status', v_v.status, 'viva_data_retorno', v_v.data_retorno, 'viva_km_retorno', v_v.km_retorno,
        'copia_data_retorno', v_c.data_retorno, 'copia_km_retorno', v_c.km_retorno);
      CONTINUE;
    END IF;

    UPDATE public.frotas_portaria_saidas
       SET status = 'Retornado',
           km_retorno = v_c.km_retorno,
           data_retorno = v_c.data_retorno,
           base_retorno = v_c.base_retorno,
           obs_retorno = v_c.obs_retorno,
           retorno_registrado_por = v_c.retorno_registrado_por,
           status_devolucao = v_c.status_devolucao,
           foto_carga_retorno_b64 = v_c.foto_carga_retorno_b64,
           foto_carga_retorno_ts = v_c.foto_carga_retorno_ts,
           obs = CASE WHEN coalesce(obs, '') = '' THEN '' ELSE obs || ' ' END || v_nota || v_par.copia || '; copiado para esta saída]'
     WHERE id::text = v_par.viva AND deleted_at IS NULL AND data_retorno IS NULL;
    GET DIAGNOSTICS v_upd = ROW_COUNT;
    IF v_upd <> 1 THEN
      RAISE EXCEPTION 'PARAR: retorno na viva % afetou % linhas. Rollback.', v_par.viva, v_upd;
    END IF;
    v_aplicados := v_aplicados + 1;
    v_itens := v_itens || jsonb_build_object(
      'viva', v_par.viva, 'copia', v_par.copia, 'placa', v_v.placa, 'equipe', v_v.equipe,
      'data_retorno', v_c.data_retorno, 'km_retorno', v_c.km_retorno,
      'antes', jsonb_build_object(
        'status', v_v.status, 'km_retorno', v_v.km_retorno, 'data_retorno', v_v.data_retorno, 'base_retorno', v_v.base_retorno,
        'obs_retorno', v_v.obs_retorno, 'retorno_registrado_por', v_v.retorno_registrado_por, 'status_devolucao', v_v.status_devolucao,
        'foto_carga_retorno_b64', v_v.foto_carga_retorno_b64, 'foto_carga_retorno_ts', v_v.foto_carga_retorno_ts, 'obs', v_v.obs));
  END LOOP;

  SELECT * INTO v_r FROM public.frotas_portaria_saidas WHERE id::text = v_restaurar;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PARAR: saída % (RTQ7D65) não encontrada. Nenhuma alteração.', v_restaurar;
  END IF;
  IF v_r.deleted_at IS NULL THEN
    v_pulados := v_pulados || jsonb_build_object('restaurar', v_restaurar, 'placa', v_r.placa, 'equipe', v_r.equipe, 'motivo', 'já restaurada');
  ELSIF v_r.data_retorno IS NULL THEN
    RAISE EXCEPTION 'PARAR: saída % (RTQ7D65) sem retorno. Nenhuma alteração.', v_restaurar;
  ELSIF EXISTS (SELECT 1 FROM public.frotas_portaria_saidas s
                 WHERE s.deleted_at IS NULL AND s.id::text <> v_restaurar
                   AND upper(coalesce(s.placa, '')) = upper(coalesce(v_r.placa, ''))
                   AND s.data_saida BETWEEN v_r.data_saida - interval '2 minutes' AND v_r.data_saida + interval '2 minutes') THEN
    v_pulados := v_pulados || jsonb_build_object('restaurar', v_restaurar, 'placa', v_r.placa, 'equipe', v_r.equipe, 'motivo', 'já existe saída viva equivalente');
  ELSE
    UPDATE public.frotas_portaria_saidas
       SET deleted_at = NULL,
           obs = CASE WHEN coalesce(obs, '') = '' THEN '' ELSE obs || ' ' END
                 || '[Correção 01/10/2026: saída restaurada; era a única linha desta saída, com retorno, e foi excluída pela deduplicação do app]'
     WHERE id::text = v_restaurar AND deleted_at IS NOT NULL;
    GET DIAGNOSTICS v_upd = ROW_COUNT;
    IF v_upd <> 1 THEN
      RAISE EXCEPTION 'PARAR: restauração de % afetou % linhas. Rollback.', v_restaurar, v_upd;
    END IF;
    v_restaurada := jsonb_build_object('id', v_restaurar, 'placa', v_r.placa, 'equipe', v_r.equipe,
      'deleted_at_anterior', v_r.deleted_at, 'obs_anterior', v_r.obs);
  END IF;

  IF v_aplicados = 0 AND v_restaurada IS NULL THEN
    RAISE EXCEPTION 'PARAR: nada pendente (todos os pares já resolvidos). Nenhuma alteração.';
  END IF;

  INSERT INTO public.audit_log (
    acao, modulo, descricao,
    usuario_id, usuario_nome, usuario_perfil,
    dados_extra, data_hora, sessao_id
  ) VALUES (
    'PORTARIA_RETORNOS_COPIAS_EXCLUIDAS_3009',
    'frotas',
    'Retorno de 30/09/2026 copiado da cópia excluída para a saída viva em ' || v_aplicados || ' saída(s)'
      || CASE WHEN v_restaurada IS NOT NULL THEN '; 1 saída restaurada (RTQ7D65)' ELSE '' END
      || CASE WHEN jsonb_array_length(v_pulados) > 0 THEN '; ' || jsonb_array_length(v_pulados) || ' pulado(s).' ELSE '.' END,
    '',
    coalesce(current_user, 'sql-editor'),
    '',
    jsonb_build_object('itens', v_itens, 'restaurada', v_restaurada, 'pulados', v_pulados,
      'registros_afetados', v_aplicados + CASE WHEN v_restaurada IS NOT NULL THEN 1 ELSE 0 END),
    now(),
    'sql:20261001100000_portaria_retornos_copias_excluidas_3009'
  );
END $$;

COMMIT;

-- Validação (após aplicar):
--   SELECT equipe, placa, data_saida, status, data_retorno, km_retorno FROM public.frotas_portaria_saidas
--    WHERE deleted_at IS NULL AND status = 'Em campo'
--      AND data_saida >= '2026-09-30T00:00:00-03:00' AND data_saida < '2026-10-01T00:00:00-03:00'
--    ORDER BY data_saida;   -- esperado: só EON193 TTP2G94 21:48 (sem cópia; não faz parte desta correção)
--   SELECT acao, descricao, data_hora FROM public.audit_log
--    WHERE sessao_id = 'sql:20261001100000_portaria_retornos_copias_excluidas_3009' ORDER BY data_hora DESC LIMIT 1;
--
-- Para desfazer
-- UPDATE public.frotas_portaria_saidas s
--    SET (status, km_retorno, data_retorno, base_retorno, obs_retorno, retorno_registrado_por, status_devolucao,
--         foto_carga_retorno_b64, foto_carga_retorno_ts, obs) =
--        (SELECT a.status, a.km_retorno, a.data_retorno, a.base_retorno, a.obs_retorno, a.retorno_registrado_por, a.status_devolucao,
--                a.foto_carga_retorno_b64, a.foto_carga_retorno_ts, a.obs
--           FROM jsonb_populate_record(NULL::public.frotas_portaria_saidas, i.i->'antes') a)
--   FROM (SELECT dados_extra FROM public.audit_log
--          WHERE sessao_id = 'sql:20261001100000_portaria_retornos_copias_excluidas_3009'
--          ORDER BY data_hora DESC LIMIT 1) x,
--        jsonb_array_elements(x.dados_extra->'itens') AS i(i)
--  WHERE s.id::text = i.i->>'viva';
-- UPDATE public.frotas_portaria_saidas s
--    SET deleted_at = (x.dados_extra->'restaurada'->>'deleted_at_anterior')::timestamptz,
--        obs = x.dados_extra->'restaurada'->>'obs_anterior'
--   FROM (SELECT dados_extra FROM public.audit_log
--          WHERE sessao_id = 'sql:20261001100000_portaria_retornos_copias_excluidas_3009'
--          ORDER BY data_hora DESC LIMIT 1) x
--  WHERE x.dados_extra->'restaurada' IS NOT NULL AND jsonb_typeof(x.dados_extra->'restaurada') = 'object'
--    AND s.id::text = x.dados_extra->'restaurada'->>'id';
