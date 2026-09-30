-- Portaria: remove (soft delete) as cópias duplicadas das saídas de 30/09/2026.
-- Causa: gravação dupla da portaria (tentativa "mini" sem id, corrigida no app em 8.1.173). As 22 cópias vieram do
-- tablet "Portaria Coaquira 1" entre 07:11 e 12:26, 1 a 50 s depois da original e sem tipo_liberacao/quem_saiu/modelo.
-- Conferido em 30/09/2026 (só leitura): 21 saídas com cópia (EBN141 com duas cópias) = 43 linhas, 22 cópias.
-- Em cada grupo fica UMA linha:
--   - a que já tiver retorno (o porteiro pode ter fechado qualquer uma das cópias), ou
--   - a linha completa (com tipo_liberacao), se nenhuma tiver retorno.
-- A linha que fica recebe da completa modelo/tipo_liberacao/quem_saiu/foto se estiverem vazios.
-- As demais cópias ABERTAS recebem deleted_at + nota em obs. Não altera KM, datas nem status.
-- Fail-closed: grupo com linha faltando ou com equipe/placa/data_saida/km diferentes PARA sem alterar nada.
-- Grupo já resolvido à mão, ou com mais de uma linha com retorno, é pulado e registrado na auditoria.
-- Grava audit_log PORTARIA_SAIDAS_DUPLICADAS_3009 com o estado anterior (permite desfazer).

BEGIN;

DO $$
DECLARE
  v_esperado_grupos int := 21;
  v_esperado_linhas int := 43;
  v_nota text := '[Correção 30/09/2026: cópia duplicada da saída (gravação dupla da portaria, corrigida em 8.1.173); saída mantida ';
  g int;
  v_ret int;
  v_mantida text;
  v_completa record;
  v_mant record;
  v_c record;
  v_excluidas int := 0;
  v_pulados jsonb := '[]'::jsonb;
  v_grupos jsonb := '[]'::jsonb;
  v_copias jsonb;
  v_upd int;
BEGIN
  -- Lista criada dentro do bloco: funciona mesmo se o editor rodar só o DO ou usar outra conexão.
  DROP TABLE IF EXISTS _port_dup_3009;
  CREATE TEMP TABLE _port_dup_3009 (grupo int NOT NULL, id text PRIMARY KEY, completa boolean NOT NULL) ON COMMIT DROP;
  INSERT INTO _port_dup_3009 (grupo, id, completa) VALUES
      (1, '7128d117-d221-4c24-bc04-11864b280165', true ), -- 07:11 EBN344 STM6J35 (completa)
      (1, '2d2f2f1e-a645-4093-93b0-1f714e8c3d91', false), -- 07:11 EBN344 STM6J35
      (2, '6008b0ce-2474-4a3e-8221-7a869057ef4a', true ), -- 07:18 EBN342 TJC9A62 (completa)
      (2, '364a38b5-fcfd-444d-acc2-2b485287d642', false), -- 07:18 EBN342 TJC9A62
      (3, '83ade37a-e6bd-4c35-96dd-6877d6fde30f', true ), -- 07:23 EJN300 DZH7G12 (completa)
      (3, '48f68783-91f8-4940-8a92-701e69aa9d41', false), -- 07:23 EJN300 DZH7G12
      (4, '80e13f8c-5619-4796-869c-873c3980bf33', true ), -- 07:27 EJN301 EGB6D72 (completa)
      (4, 'aa928f91-570d-4645-baf7-661051c873e7', false), -- 07:27 EJN301 EGB6D72
      (5, 'fbbbddfa-9a71-4fc2-bba2-60bc7f2eea66', true ), -- 07:27 EBN143 TTD8A69 (completa)
      (5, '5da4ff78-ce28-40a8-ad87-b62221a8f2d9', false), -- 07:27 EBN143 TTD8A69
      (6, '6ab9b524-4ec8-4680-9399-c922fc8c7c7b', true ), -- 07:28 EON325 SVZ6D46 (completa)
      (6, '887077b4-36c1-4114-a736-b050c1835de1', false), -- 07:28 EON325 SVZ6D46
      (7, '63a36fc2-42a4-43f0-b2ed-b48d901a969d', true ), -- 07:31 EBN343 TJE5A45 (completa)
      (7, 'b78a6dfd-3fb9-403b-b9e4-993192ba6bb9', false), -- 07:31 EBN343 TJE5A45
      (8, 'af2602ea-f857-467a-8ed8-31e1f259143f', true ), -- 07:32 EBN145 TTP2G93 (completa)
      (8, 'ecbdb230-db83-4051-9ed4-41ce38ef8064', false), -- 07:32 EBN145 TTP2G93
      (9, '8308d1fe-9acb-4f8e-9efa-69e90dc4fdb2', true ), -- 07:34 EBN345 TLY9G76 (completa)
      (9, '1f241111-11c7-4095-aa7a-b6c1b87ec20d', false), -- 07:34 EBN345 TLY9G76
      (10, 'a0162d0c-e9b8-4455-afe6-203f0ae273eb', true ), -- 07:57 EIN330 STC8B57 (completa)
      (10, '86645980-068a-46ae-84e0-1144a82f9ac6', false), -- 07:57 EIN330 STC8B57
      (11, '11c72d79-3de3-4ff7-b53e-fd1976a68539', true ), -- 08:01 EJN103 TTM8E98 (completa)
      (11, '7fdee033-395b-4b68-8d33-16e4f154ce4a', false), -- 08:01 EJN103 TTM8E98
      (12, '4b8f45a7-9a08-4b1f-9948-8737407ec4a3', true ), -- 08:02 EJN101 TTB5A73 (completa)
      (12, 'e00d28cc-0745-4092-a967-d7fbdeea0bdf', false), -- 08:02 EJN101 TTB5A73
      (13, '39a42919-e1ec-41da-a329-8fba144bff58', true ), -- 08:02 EJN302 TKK3C13 (completa)
      (13, '713263a8-ba14-4bdb-9550-ef9f89446111', false), -- 08:02 EJN302 TKK3C13
      (14, '4d886cc2-32b0-4762-ad2f-34efc97dffd0', true ), -- 08:14 EON121 TTJ1J13 (completa)
      (14, '52eaebb2-943d-421a-a4fb-aabf3197d317', false), -- 08:14 EON121 TTJ1J13
      (15, '6014d4fc-3421-4d43-9c7c-1edc21b53130', true ), -- 08:16 EBN141 RTP6F36 (completa)
      (15, '4dd9a06c-292b-4ed6-b87f-d7ba9f65deaa', false), -- 08:16 EBN141 RTP6F36
      (15, 'f52283d9-04e3-4801-b71f-6ba49c8b5782', false), -- 08:16 EBN141 RTP6F36
      (16, 'dc7ebffe-0ba5-4828-858f-2d4bbdb30ebf', true ), -- 08:23 EIN331 TMB1J95 (completa)
      (16, '079e1882-6abe-4e16-b0a6-8109a598649e', false), -- 08:23 EIN331 TMB1J95
      (17, 'b5cf0e38-f030-4a14-a276-38de5447f013', true ), -- 08:31 EIN334 TLS8E04 (completa)
      (17, '9e420ffc-9109-4ec7-9e1c-e309b5d13fc2', false), -- 08:31 EIN334 TLS8E04
      (18, '2c564ea8-f6c3-44ab-82b6-3a20e7323b80', true ), -- 11:57 EBN185 TTH9G86 (completa)
      (18, '43910a19-b145-4134-80c4-3706bd84be5b', false), -- 11:57 EBN185 TTH9G86
      (19, '36b1bea1-3c4e-41a1-8838-30972a8fcb82', true ), -- 12:00 EBN188 TTD8A68 (completa)
      (19, 'f2857e8a-865a-4ac5-b24e-7dca3b2e6799', false), -- 12:00 EBN188 TTD8A68
      (20, 'e05fe08c-b693-4146-b308-f85d7d75cd1d', true ), -- 12:04 EJN174 RTQ7D65 (completa)
      (20, 'eea376fa-074f-4938-a83f-9015bbbbca4a', false), -- 12:04 EJN174 RTQ7D65
      (21, '5b1049bb-0d46-40af-b085-13063f20de37', true ), -- 12:26 EBN187 TUH1I44 (completa)
      (21, 'ea5a57b9-8984-4af6-958d-17a193915e99', false)  -- 12:26 EBN187 TUH1I44
  ;

  IF (SELECT count(DISTINCT grupo) FROM _port_dup_3009) <> v_esperado_grupos
     OR (SELECT count(*) FROM _port_dup_3009) <> v_esperado_linhas THEN
    RAISE EXCEPTION 'PARAR: lista com % grupos / % linhas; esperado % / %.',
      (SELECT count(DISTINCT grupo) FROM _port_dup_3009), (SELECT count(*) FROM _port_dup_3009), v_esperado_grupos, v_esperado_linhas;
  END IF;
  IF EXISTS (SELECT 1 FROM _port_dup_3009 GROUP BY grupo HAVING count(*) < 2 OR count(*) FILTER (WHERE completa) <> 1) THEN
    RAISE EXCEPTION 'PARAR: todo grupo precisa de 2+ linhas e exatamente 1 completa.';
  END IF;

  PERFORM 1 FROM public.frotas_portaria_saidas s JOIN _port_dup_3009 d ON s.id::text = d.id FOR UPDATE OF s;
  IF (SELECT count(*) FROM public.frotas_portaria_saidas s JOIN _port_dup_3009 d ON s.id::text = d.id) <> v_esperado_linhas THEN
    RAISE EXCEPTION 'PARAR: % de % linhas encontradas. Nenhuma alteração.',
      (SELECT count(*) FROM public.frotas_portaria_saidas s JOIN _port_dup_3009 d ON s.id::text = d.id), v_esperado_linhas;
  END IF;

  FOR g IN SELECT DISTINCT grupo FROM _port_dup_3009 ORDER BY 1 LOOP
    IF (SELECT count(DISTINCT (coalesce(s.equipe_id::text, ''), upper(coalesce(s.placa, '')), s.data_saida, coalesce(s.km_saida::text, '')))
          FROM public.frotas_portaria_saidas s JOIN _port_dup_3009 d ON s.id::text = d.id WHERE d.grupo = g) <> 1 THEN
      RAISE EXCEPTION 'PARAR: grupo % não é da mesma equipe/placa/data de saída/KM. Nenhuma alteração.', g;
    END IF;

    SELECT s.* INTO v_completa FROM public.frotas_portaria_saidas s JOIN _port_dup_3009 d ON s.id::text = d.id
     WHERE d.grupo = g AND d.completa;

    SELECT count(*) INTO v_ret FROM public.frotas_portaria_saidas s JOIN _port_dup_3009 d ON s.id::text = d.id
     WHERE d.grupo = g AND s.deleted_at IS NULL AND s.data_retorno IS NOT NULL;
    IF v_ret > 1 THEN
      v_pulados := v_pulados || jsonb_build_object('grupo', g, 'placa', v_completa.placa, 'equipe', v_completa.equipe, 'motivo', 'mais de uma linha com retorno');
      CONTINUE;
    ELSIF v_ret = 1 THEN
      SELECT s.id::text INTO v_mantida FROM public.frotas_portaria_saidas s JOIN _port_dup_3009 d ON s.id::text = d.id
       WHERE d.grupo = g AND s.deleted_at IS NULL AND s.data_retorno IS NOT NULL;
    ELSIF v_completa.deleted_at IS NULL THEN
      v_mantida := v_completa.id::text;
    ELSE
      v_pulados := v_pulados || jsonb_build_object('grupo', g, 'placa', v_completa.placa, 'equipe', v_completa.equipe, 'motivo', 'linha completa já excluída');
      CONTINUE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.frotas_portaria_saidas s JOIN _port_dup_3009 d ON s.id::text = d.id
                    WHERE d.grupo = g AND s.id::text <> v_mantida AND s.deleted_at IS NULL AND s.data_retorno IS NULL) THEN
      v_pulados := v_pulados || jsonb_build_object('grupo', g, 'placa', v_completa.placa, 'equipe', v_completa.equipe, 'motivo', 'já resolvido');
      CONTINUE;
    END IF;

    SELECT * INTO v_mant FROM public.frotas_portaria_saidas WHERE id::text = v_mantida;
    v_copias := '[]'::jsonb;
    FOR v_c IN
      SELECT s.id::text AS id, s.obs FROM public.frotas_portaria_saidas s JOIN _port_dup_3009 d ON s.id::text = d.id
       WHERE d.grupo = g AND s.id::text <> v_mantida AND s.deleted_at IS NULL AND s.data_retorno IS NULL
       ORDER BY s.id
    LOOP
      v_copias := v_copias || jsonb_build_object('id', v_c.id, 'obs', v_c.obs);
      UPDATE public.frotas_portaria_saidas
         SET deleted_at = now(),
             obs = CASE WHEN coalesce(obs, '') = '' THEN '' ELSE obs || ' ' END || v_nota || v_mantida || ']'
       WHERE id::text = v_c.id AND deleted_at IS NULL AND data_retorno IS NULL;
      GET DIAGNOSTICS v_upd = ROW_COUNT;
      IF v_upd <> 1 THEN
        RAISE EXCEPTION 'PARAR: exclusão da cópia % afetou % linhas. Rollback.', v_c.id, v_upd;
      END IF;
      v_excluidas := v_excluidas + 1;
    END LOOP;

    IF v_mantida <> v_completa.id::text THEN
      UPDATE public.frotas_portaria_saidas
         SET modelo = coalesce(nullif(modelo, ''), v_completa.modelo),
             tipo_liberacao = coalesce(nullif(tipo_liberacao, ''), v_completa.tipo_liberacao),
             quem_saiu = coalesce(nullif(quem_saiu, ''), v_completa.quem_saiu),
             foto_carga_saida_b64 = coalesce(nullif(foto_carga_saida_b64, ''), v_completa.foto_carga_saida_b64)
       WHERE id::text = v_mantida;
    END IF;

    v_grupos := v_grupos || jsonb_build_object(
      'grupo', g, 'placa', v_mant.placa, 'equipe', v_mant.equipe, 'data_saida', v_mant.data_saida,
      'mantida_id', v_mantida, 'mantida_modelo', v_mant.modelo, 'mantida_tipo_liberacao', v_mant.tipo_liberacao,
      'mantida_quem_saiu', v_mant.quem_saiu, 'mantida_foto_vazia', coalesce(v_mant.foto_carga_saida_b64, '') = '',
      'copias', v_copias);
  END LOOP;

  IF v_excluidas = 0 THEN
    RAISE EXCEPTION 'PARAR: nenhuma cópia pendente (todos os grupos já resolvidos). Nenhuma alteração.';
  END IF;

  INSERT INTO public.audit_log (
    acao, modulo, descricao,
    usuario_id, usuario_nome, usuario_perfil,
    dados_extra, data_hora, sessao_id
  ) VALUES (
    'PORTARIA_SAIDAS_DUPLICADAS_3009',
    'frotas',
    'Exclusão lógica de ' || v_excluidas || ' cópias duplicadas de saída (30/09/2026).'
      || CASE WHEN jsonb_array_length(v_pulados) > 0 THEN ' ' || jsonb_array_length(v_pulados) || ' grupo(s) pulado(s).' ELSE '' END,
    '',
    coalesce(current_user, 'sql-editor'),
    '',
    jsonb_build_object('grupos', v_grupos, 'pulados', v_pulados, 'registros_afetados', v_excluidas),
    now(),
    'sql:20260930180000_portaria_saidas_duplicadas_3009'
  );
END $$;

COMMIT;

-- Validação (após aplicar):
--   SELECT equipe, placa, data_saida, count(*) FROM public.frotas_portaria_saidas
--    WHERE deleted_at IS NULL AND data_saida >= '2026-09-30T00:00:00-03:00' AND data_saida < '2026-10-01T00:00:00-03:00'
--    GROUP BY equipe_id, equipe, placa, data_saida HAVING count(*) > 1;   -- esperado: nenhuma linha
--   SELECT acao, descricao, data_hora FROM public.audit_log
--    WHERE sessao_id = 'sql:20260930180000_portaria_saidas_duplicadas_3009' ORDER BY data_hora DESC LIMIT 1;
--
-- Para desfazer
-- UPDATE public.frotas_portaria_saidas s
--    SET deleted_at = NULL, obs = c.c->>'obs'
--   FROM (SELECT dados_extra FROM public.audit_log
--          WHERE sessao_id = 'sql:20260930180000_portaria_saidas_duplicadas_3009'
--          ORDER BY data_hora DESC LIMIT 1) a,
--        jsonb_array_elements(a.dados_extra->'grupos') AS g(g),
--        jsonb_array_elements(g.g->'copias') AS c(c)
--  WHERE s.id::text = c.c->>'id';
-- UPDATE public.frotas_portaria_saidas s
--    SET modelo = g.g->>'mantida_modelo', tipo_liberacao = g.g->>'mantida_tipo_liberacao', quem_saiu = g.g->>'mantida_quem_saiu',
--        foto_carga_saida_b64 = CASE WHEN (g.g->>'mantida_foto_vazia')::boolean THEN NULL ELSE s.foto_carga_saida_b64 END
--   FROM (SELECT dados_extra FROM public.audit_log
--          WHERE sessao_id = 'sql:20260930180000_portaria_saidas_duplicadas_3009'
--          ORDER BY data_hora DESC LIMIT 1) a,
--        jsonb_array_elements(a.dados_extra->'grupos') AS g(g)
--  WHERE s.id::text = g.g->>'mantida_id';
