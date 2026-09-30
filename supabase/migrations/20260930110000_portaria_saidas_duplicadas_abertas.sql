-- Portaria: remove (soft delete) as cópias duplicadas de saída que ficaram abertas em "Retornos em aberto".
-- Causa (corrigida no app em 8.1.173): cada liberação gravava a saída duas vezes (mesma equipe, placa e data_saida,
-- criadas com ~1 s de diferença). O retorno fechava uma das linhas e a outra ficava "Em campo" para sempre.
-- Pares conferidos em 30/09/2026: 29 saídas de 29/09 em que uma linha tem retorno e a gêmea não.
-- Para cada par: a linha RETORNADA fica (recebe modelo/tipo_liberacao da gêmea se estiverem vazios) e a linha
-- ABERTA recebe deleted_at + nota em obs. Não altera KM, datas, status de retorno nem outras saídas.
-- Fail-closed: se algum par não existir ou não for da mesma equipe/placa/data_saida, nada é alterado.
-- Par que já foi resolvido à mão (aberta já encerrada ou excluída) é pulado e contado na auditoria.
-- Grava audit_log PORTARIA_SAIDAS_DUPLICADAS com o estado anterior (permite desfazer).

BEGIN;

DO $$
DECLARE
  v_pares text[][] := ARRAY[
    ['7445ad4a-b8bf-4c78-aa7b-6d3cd9b9884a','2d623b0d-c1ce-4234-ad06-2813b3982332'], -- 29/09 07:04 EIN331 TMB1J95
    ['6cbef782-015c-4eac-888f-291990df5f19','36f2d011-2005-47ba-8565-a4e131041610'], -- 29/09 07:23 EON324 DTF3B91
    ['accb5939-0418-4e6d-a271-c8a15935bdc0','211c5cee-99f5-43e9-a6c0-e24d2656aafa'], -- 29/09 07:25 EJN303 GGB8G11
    ['24d5b147-8659-4f4c-a027-e53f000775b7','9592e259-8d0b-46a6-b8bc-114652ae10c9'], -- 29/09 07:25 EON325 SVZ6D46
    ['ddd228f7-9790-4a2b-8b25-fc6833d2b00b','8ad4f9bf-bf06-4179-ba79-580f1e021471'], -- 29/09 07:29 EBN342 TJC9A62
    ['a62164f6-2ca8-4a95-a20c-ab2573924df4','7b999a68-1a5a-43d2-a47f-8b83af4c23ea'], -- 29/09 07:32 EIN135 TTO2J56
    ['bfbe62f5-a7f1-400b-9985-1ba8f816bad3','9406e6b0-a9bd-4475-95b0-d6edf1536f6e'], -- 29/09 07:35 EJN302 TKK3C13
    ['c296cb28-8914-496e-8747-335acf19800c','5a0a1a85-ba37-46e4-90a0-11b5b5b6183b'], -- 29/09 07:36 EBN340 TJY7A03
    ['267bfc6a-60fd-4631-8a3a-f44eeb11f3f0','e1b00dfe-ed7f-41d4-bc17-a149f3cbc3ec'], -- 29/09 07:39 EBN740 UEU6F95
    ['7c09714a-1f2a-47c8-bd30-c4a2f44cb6ea','05ce1171-feda-408f-80b2-6f4e1d929762'], -- 29/09 07:48 EJN700 TIY2A96
    ['86cb4a13-236c-4291-8ca6-467376b7495f','ece34521-dcb3-4db6-8537-2571f9322431'], -- 29/09 07:53 EJN105 TTN6F14
    ['80b3fbe2-303f-4372-8ab6-6e86a444a268','a6901fbf-dd57-436a-96ed-7aa6d3a07f41'], -- 29/09 07:55 EBN141 RTP6F36
    ['5c4fa50f-721d-40f2-809f-4fb1dabd08b2','afe0ad52-2657-444f-9e22-6d10b0ed4d40'], -- 29/09 08:03 EIN730 QSU4G58
    ['02945f70-cbf9-40f9-8b45-3a1a806b79c8','7f3668e6-8e67-4e07-9e5f-ef373598e5b6'], -- 29/09 08:06 EON321 FTM9D41
    ['ed689d5d-c6bc-4c55-a3d0-9aa6f57bab41','1b8c9f6e-5107-48ce-9463-f8213abbd9f7'], -- 29/09 08:09 EON121 TTJ1J13
    ['d0987d6b-e8cf-4fc9-acd3-56b5bd920a39','955cee34-3420-4d73-846b-2ca65899ad73'], -- 29/09 08:10 EIN332 GKF9F12
    ['d09793f1-dff3-4be8-b82b-fff94d1a4fb1','28de2297-2f29-4090-a4c8-2a0c2778c754'], -- 29/09 08:12 EON322 TLS3I84
    ['cc5f7d7e-bf82-4ab5-b647-f4a877d7b0c0','100520f2-9f5a-49fa-b5c3-0ea2900f7de0'], -- 29/09 09:39 EBN142 TTJ9A72
    ['ad24106e-c415-44c2-8f53-ecfe6cd91bbf','06b380e0-d08f-4737-8a08-3b27bbeb9e45'], -- 29/09 11:24 EIN182 RTQ7D55
    ['3e35503d-7f41-40ab-b69b-6e50f281a6dd','3912fa37-9657-418d-9234-04597f2da318'], -- 29/09 11:27 EON176 RTQ7D54
    ['4574dcfb-9cac-4785-a6a9-0f30898a3247','fbef51f1-4b51-45fc-b5cd-aa0c78050a61'], -- 29/09 11:53 EBN186 RTQ7D65
    ['18ae1282-e2a3-457f-8396-c52844044de5','05b4119c-875d-497b-9920-bdca8148be59'], -- 29/09 12:03 EJN174 TUH1I44
    ['40f10199-c726-4b57-a7b7-c6efec52f6ca','2a2f77a5-04f8-4467-8d5e-8903e6f8030a'], -- 29/09 12:51 EBN188 TTD8A68
    ['df669ed1-9c27-4afb-b5a6-75e9e5fd0bd3','a412fc11-9c14-4cf2-9a16-364732c04453'], -- 29/09 15:59 EON326 SVZ7E06
    ['23c8d3e0-4371-4cf5-8c15-8b51b33aba16','cbfc429f-a5b6-4594-978d-98921e286e9b'], -- 29/09 19:47 EBN197 TTM8E98
    ['71221234-d59c-4b01-942e-835168dd03ea','fe7b7b7b-1ea8-4d20-9fe3-d48a45a2326e'], -- 29/09 20:33 EJN190 TTP2G93
    ['cf01516d-3563-4c38-95ba-f60abf495980','90c8c2e9-c908-4a07-92b2-174c361d37bb'], -- 29/09 20:48 EON192 TTN6F14
    ['60f38050-3c71-4a9a-a2ba-fb7ba973eb07','7516a396-a016-46fd-b9d9-96a321bf8ef8'], -- 29/09 21:34 EON193 TTN6F14
    ['4ad0ff18-d2a9-4e50-989f-15b2e0d5976c','5db67597-376f-4959-8d19-e448b5a7c7e0']  -- 29/09 21:38 EON193 TTK8I06
  ];
  v_esperado int := 29;
  v_nota text := '[Correção 30/09/2026: cópia duplicada da saída (bug de gravação dupla da portaria, corrigido em 8.1.173); retorno registrado na saída ';
  i int;
  v_ab record;
  v_ret record;
  v_todos text[] := ARRAY[]::text[];
  v_aplicar int[] := ARRAY[]::int[];
  v_pulados jsonb := '[]'::jsonb;
  v_antes jsonb := '[]'::jsonb;
  v_upd int;
BEGIN
  IF array_length(v_pares, 1) <> v_esperado THEN
    RAISE EXCEPTION 'PARAR: lista com % pares; esperado %.', array_length(v_pares, 1), v_esperado;
  END IF;
  FOR i IN 1..array_length(v_pares, 1) LOOP
    v_todos := v_todos || v_pares[i][1] || v_pares[i][2];
  END LOOP;
  IF (SELECT count(DISTINCT x) FROM unnest(v_todos) x) <> v_esperado * 2 THEN
    RAISE EXCEPTION 'PARAR: ids repetidos na lista.';
  END IF;

  PERFORM 1 FROM public.frotas_portaria_saidas WHERE id::text = ANY(v_todos) FOR UPDATE;

  FOR i IN 1..array_length(v_pares, 1) LOOP
    SELECT * INTO v_ab FROM public.frotas_portaria_saidas WHERE id::text = v_pares[i][1];
    SELECT * INTO v_ret FROM public.frotas_portaria_saidas WHERE id::text = v_pares[i][2];
    IF v_ab.id IS NULL OR v_ret.id IS NULL THEN
      RAISE EXCEPTION 'PARAR: par % (% / %) não encontrado. Nenhuma alteração.', i, v_pares[i][1], v_pares[i][2];
    END IF;
    IF coalesce(v_ab.equipe_id::text, '') <> coalesce(v_ret.equipe_id::text, '')
       OR upper(coalesce(v_ab.placa, '')) <> upper(coalesce(v_ret.placa, ''))
       OR v_ab.data_saida IS DISTINCT FROM v_ret.data_saida THEN
      RAISE EXCEPTION 'PARAR: par % (%) não é da mesma equipe/placa/data de saída. Nenhuma alteração.', i, v_ab.placa;
    END IF;
    IF v_ret.deleted_at IS NOT NULL OR v_ret.data_retorno IS NULL THEN
      RAISE EXCEPTION 'PARAR: par % (%): a linha retornada não está mais retornada/ativa. Nenhuma alteração.', i, v_ab.placa;
    END IF;
    IF v_ab.deleted_at IS NOT NULL OR v_ab.data_retorno IS NOT NULL THEN
      v_pulados := v_pulados || jsonb_build_object('aberta', v_ab.id::text, 'motivo', CASE WHEN v_ab.deleted_at IS NOT NULL THEN 'já excluída' ELSE 'já encerrada' END);
      CONTINUE;
    END IF;
    v_aplicar := v_aplicar || i;
    v_antes := v_antes || jsonb_build_object(
      'aberta_id', v_ab.id::text, 'aberta_obs', v_ab.obs,
      'retornada_id', v_ret.id::text, 'retornada_modelo', v_ret.modelo, 'retornada_tipo_liberacao', v_ret.tipo_liberacao,
      'placa', v_ab.placa, 'equipe', v_ab.equipe, 'data_saida', v_ab.data_saida);
  END LOOP;

  IF coalesce(array_length(v_aplicar, 1), 0) = 0 THEN
    RAISE EXCEPTION 'PARAR: nenhum par pendente (todos já resolvidos). Nenhuma alteração.';
  END IF;

  FOREACH i IN ARRAY v_aplicar LOOP
    UPDATE public.frotas_portaria_saidas r
       SET modelo = coalesce(nullif(r.modelo, ''), a.modelo),
           tipo_liberacao = coalesce(nullif(r.tipo_liberacao, ''), a.tipo_liberacao)
      FROM public.frotas_portaria_saidas a
     WHERE r.id::text = v_pares[i][2] AND a.id::text = v_pares[i][1];

    UPDATE public.frotas_portaria_saidas
       SET deleted_at = now(),
           obs = CASE WHEN coalesce(obs, '') = '' THEN '' ELSE obs || ' ' END || v_nota || v_pares[i][2] || ']'
     WHERE id::text = v_pares[i][1] AND deleted_at IS NULL AND data_retorno IS NULL;
    GET DIAGNOSTICS v_upd = ROW_COUNT;
    IF v_upd <> 1 THEN
      RAISE EXCEPTION 'PARAR: exclusão da cópia % afetou % linhas. Rollback.', v_pares[i][1], v_upd;
    END IF;
  END LOOP;

  INSERT INTO public.audit_log (
    acao, modulo, descricao,
    usuario_id, usuario_nome, usuario_perfil,
    dados_extra, data_hora, sessao_id
  ) VALUES (
    'PORTARIA_SAIDAS_DUPLICADAS',
    'frotas',
    'Exclusão lógica de ' || array_length(v_aplicar, 1) || ' cópias duplicadas de saída que ficaram abertas (29/09/2026).'
      || CASE WHEN jsonb_array_length(v_pulados) > 0 THEN ' ' || jsonb_array_length(v_pulados) || ' par(es) já resolvido(s) à mão foram pulados.' ELSE '' END,
    '',
    coalesce(current_user, 'sql-editor'),
    '',
    jsonb_build_object('pares', v_antes, 'pulados', v_pulados, 'registros_afetados', array_length(v_aplicar, 1)),
    now(),
    'sql:20260930110000_portaria_saidas_duplicadas_abertas'
  );
END $$;

COMMIT;

-- Validação (após aplicar):
--   SELECT count(*) FROM public.frotas_portaria_saidas
--    WHERE deleted_at IS NULL AND data_retorno IS NULL AND data_saida < '2026-09-30';   -- antes 35; esperado 6
--   SELECT acao, descricao, data_hora FROM public.audit_log
--    WHERE sessao_id = 'sql:20260930110000_portaria_saidas_duplicadas_abertas' ORDER BY data_hora DESC LIMIT 1;
--
-- Para desfazer (só se necessário; restaura as cópias e os campos preenchidos na linha retornada):
--   UPDATE public.frotas_portaria_saidas s
--      SET deleted_at = NULL, obs = e.p->>'aberta_obs'
--     FROM (SELECT dados_extra FROM public.audit_log
--            WHERE sessao_id = 'sql:20260930110000_portaria_saidas_duplicadas_abertas'
--            ORDER BY data_hora DESC LIMIT 1) a,
--          jsonb_array_elements(a.dados_extra->'pares') AS e(p)
--    WHERE s.id::text = e.p->>'aberta_id';
--   UPDATE public.frotas_portaria_saidas s
--      SET modelo = e.p->>'retornada_modelo', tipo_liberacao = e.p->>'retornada_tipo_liberacao'
--     FROM (SELECT dados_extra FROM public.audit_log
--            WHERE sessao_id = 'sql:20260930110000_portaria_saidas_duplicadas_abertas'
--            ORDER BY data_hora DESC LIMIT 1) a,
--          jsonb_array_elements(a.dados_extra->'pares') AS e(p)
--    WHERE s.id::text = e.p->>'retornada_id';
