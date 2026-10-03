-- Portaria: remove (soft delete) a cópia das 6 saídas de 02/10/2026 (07:38–08:20) gravadas em dobro.
-- Em 5 pares o porteiro deu o retorno na cópia incompleta (sem tipo_liberacao/quem_saiu/modelo) e a saída completa
-- ficou "Em campo": EON121 TTJ1J13, EIN330 STC8B57, EIN333 TLS3I84, EIN332 GKF9F12, EON320 SSU2B66.
-- No 6º (EON321 FTM9D41) as duas linhas estão abertas.
-- Em cada par fica UMA linha: a que já tiver retorno (recebe modelo/tipo_liberacao/quem_saiu/foto da completa), ou a
-- completa. A FTM9D41 de 02/10 continua aberta: o retorno não foi registrado (a placa saiu de novo em 03/10 08:17 e
-- voltou 15:58) e precisa ser fechada em "Retornos em aberto".
-- Mesma lógica e travas da 20260930190000_portaria_saidas_duplicadas_abertas_2909 (fail-closed, auditoria, desfazer).

BEGIN;

DO $$
DECLARE
  v_esperado_grupos int := 6;
  v_esperado_linhas int := 12;
  v_nota text := '[Correção 03/10/2026: cópia duplicada da saída de 02/10 (gravação dupla da portaria); saída mantida ';
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
  DROP TABLE IF EXISTS _port_dup_0210;
  CREATE TEMP TABLE _port_dup_0210 (grupo int NOT NULL, id text PRIMARY KEY, completa boolean NOT NULL) ON COMMIT DROP;
  INSERT INTO _port_dup_0210 (grupo, id, completa) VALUES
      (1, '3aba7825-87ef-4284-8eea-ea80e7f5b269', true ), -- 02/10 07:38 EON321 FTM9D41 (completa; as duas abertas)
      (1, '27a3ffcb-e7db-4583-a8ef-930b0fbcc5a6', false), -- 02/10 07:38 EON321 FTM9D41
      (2, '4d058d24-b282-4f49-837b-71a6bb170226', true ), -- 02/10 07:46 EON121 TTJ1J13 (completa, aberta)
      (2, '023162a6-fc11-4591-8d79-3b87477a7706', false), -- 02/10 07:46 EON121 TTJ1J13 (retorno 17:10)
      (3, 'e70eeddc-611d-4102-a181-7e0ef76ca148', true ), -- 02/10 07:52 EIN330 STC8B57 (completa, aberta)
      (3, '811a5747-e0fd-4e9f-a802-c127a501796f', false), -- 02/10 07:52 EIN330 STC8B57 (retorno 16:47)
      (4, '31b2c0df-3276-4f9b-8d49-d6d7d9bb3713', true ), -- 02/10 08:04 EIN333 TLS3I84 (completa, aberta)
      (4, '2f7da883-1b0b-4e8b-94eb-b58f80bb0644', false), -- 02/10 08:04 EIN333 TLS3I84 (retorno 16:34)
      (5, '4f17edc4-14af-4597-939d-d2b5bdf56c08', true ), -- 02/10 08:15 EIN332 GKF9F12 (completa, aberta)
      (5, '82b24b20-8cd1-4357-acfd-7992116858d9', false), -- 02/10 08:15 EIN332 GKF9F12 (retorno 16:45)
      (6, 'b4461dd6-caad-414d-8140-d9f23e317095', true ), -- 02/10 08:20 EON320 SSU2B66 (completa, aberta)
      (6, '43c0c30a-0d2a-4b07-bf8f-8e142d07519b', false)  -- 02/10 08:20 EON320 SSU2B66 (retorno 16:59)
  ;

  IF (SELECT count(DISTINCT grupo) FROM _port_dup_0210) <> v_esperado_grupos
     OR (SELECT count(*) FROM _port_dup_0210) <> v_esperado_linhas THEN
    RAISE EXCEPTION 'PARAR: lista com % grupos / % linhas; esperado % / %.',
      (SELECT count(DISTINCT grupo) FROM _port_dup_0210), (SELECT count(*) FROM _port_dup_0210), v_esperado_grupos, v_esperado_linhas;
  END IF;
  IF EXISTS (SELECT 1 FROM _port_dup_0210 GROUP BY grupo HAVING count(*) < 2 OR count(*) FILTER (WHERE completa) <> 1) THEN
    RAISE EXCEPTION 'PARAR: todo grupo precisa de 2+ linhas e exatamente 1 completa.';
  END IF;

  PERFORM 1 FROM public.frotas_portaria_saidas s JOIN _port_dup_0210 d ON s.id::text = d.id FOR UPDATE OF s;
  IF (SELECT count(*) FROM public.frotas_portaria_saidas s JOIN _port_dup_0210 d ON s.id::text = d.id) <> v_esperado_linhas THEN
    RAISE EXCEPTION 'PARAR: % de % linhas encontradas. Nenhuma alteração.',
      (SELECT count(*) FROM public.frotas_portaria_saidas s JOIN _port_dup_0210 d ON s.id::text = d.id), v_esperado_linhas;
  END IF;

  FOR g IN SELECT DISTINCT grupo FROM _port_dup_0210 ORDER BY 1 LOOP
    IF (SELECT count(DISTINCT (coalesce(s.equipe_id::text, ''), upper(coalesce(s.placa, '')), s.data_saida, coalesce(s.km_saida::text, '')))
          FROM public.frotas_portaria_saidas s JOIN _port_dup_0210 d ON s.id::text = d.id WHERE d.grupo = g) <> 1 THEN
      RAISE EXCEPTION 'PARAR: grupo % não é da mesma equipe/placa/data de saída/KM. Nenhuma alteração.', g;
    END IF;

    SELECT s.* INTO v_completa FROM public.frotas_portaria_saidas s JOIN _port_dup_0210 d ON s.id::text = d.id
     WHERE d.grupo = g AND d.completa;

    SELECT count(*) INTO v_ret FROM public.frotas_portaria_saidas s JOIN _port_dup_0210 d ON s.id::text = d.id
     WHERE d.grupo = g AND s.deleted_at IS NULL AND s.data_retorno IS NOT NULL;
    IF v_ret > 1 THEN
      v_pulados := v_pulados || jsonb_build_object('grupo', g, 'placa', v_completa.placa, 'equipe', v_completa.equipe, 'motivo', 'mais de uma linha com retorno');
      CONTINUE;
    ELSIF v_ret = 1 THEN
      SELECT s.id::text INTO v_mantida FROM public.frotas_portaria_saidas s JOIN _port_dup_0210 d ON s.id::text = d.id
       WHERE d.grupo = g AND s.deleted_at IS NULL AND s.data_retorno IS NOT NULL;
    ELSIF v_completa.deleted_at IS NULL THEN
      v_mantida := v_completa.id::text;
    ELSE
      v_pulados := v_pulados || jsonb_build_object('grupo', g, 'placa', v_completa.placa, 'equipe', v_completa.equipe, 'motivo', 'linha completa já excluída');
      CONTINUE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.frotas_portaria_saidas s JOIN _port_dup_0210 d ON s.id::text = d.id
                    WHERE d.grupo = g AND s.id::text <> v_mantida AND s.deleted_at IS NULL AND s.data_retorno IS NULL) THEN
      v_pulados := v_pulados || jsonb_build_object('grupo', g, 'placa', v_completa.placa, 'equipe', v_completa.equipe, 'motivo', 'já resolvido');
      CONTINUE;
    END IF;

    SELECT * INTO v_mant FROM public.frotas_portaria_saidas WHERE id::text = v_mantida;
    v_copias := '[]'::jsonb;
    FOR v_c IN
      SELECT s.id::text AS id, s.obs FROM public.frotas_portaria_saidas s JOIN _port_dup_0210 d ON s.id::text = d.id
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
    'PORTARIA_SAIDAS_DUPLICADAS_0210',
    'frotas',
    'Exclusão lógica de ' || v_excluidas || ' cópias duplicadas de saída abertas (02/10/2026).'
      || CASE WHEN jsonb_array_length(v_pulados) > 0 THEN ' ' || jsonb_array_length(v_pulados) || ' grupo(s) pulado(s).' ELSE '' END,
    '',
    coalesce(current_user, 'sql-editor'),
    '',
    jsonb_build_object('grupos', v_grupos, 'pulados', v_pulados, 'registros_afetados', v_excluidas),
    now(),
    'sql:20261003204500_portaria_saidas_duplicadas_0210'
  );
END $$;

COMMIT;

-- Validação (após aplicar):
--   SELECT equipe, placa, data_saida, count(*) FROM public.frotas_portaria_saidas
--    WHERE deleted_at IS NULL AND data_saida >= '2026-10-02T00:00:00-03:00' AND data_saida < '2026-10-03T00:00:00-03:00'
--    GROUP BY equipe_id, equipe, placa, data_saida HAVING count(*) > 1;   -- esperado: nenhuma linha
--   SELECT acao, descricao, data_hora FROM public.audit_log
--    WHERE sessao_id = 'sql:20261003204500_portaria_saidas_duplicadas_0210' ORDER BY data_hora DESC LIMIT 1;
--
-- Para desfazer
-- UPDATE public.frotas_portaria_saidas s
--    SET deleted_at = NULL, obs = c.c->>'obs'
--   FROM (SELECT dados_extra FROM public.audit_log
--          WHERE sessao_id = 'sql:20261003204500_portaria_saidas_duplicadas_0210'
--          ORDER BY data_hora DESC LIMIT 1) a,
--        jsonb_array_elements(a.dados_extra->'grupos') AS g(g),
--        jsonb_array_elements(g.g->'copias') AS c(c)
--  WHERE s.id::text = c.c->>'id';
-- UPDATE public.frotas_portaria_saidas s
--    SET modelo = g.g->>'mantida_modelo', tipo_liberacao = g.g->>'mantida_tipo_liberacao', quem_saiu = g.g->>'mantida_quem_saiu',
--        foto_carga_saida_b64 = CASE WHEN (g.g->>'mantida_foto_vazia')::boolean THEN NULL ELSE s.foto_carga_saida_b64 END
--   FROM (SELECT dados_extra FROM public.audit_log
--          WHERE sessao_id = 'sql:20261003204500_portaria_saidas_duplicadas_0210'
--          ORDER BY data_hora DESC LIMIT 1) a,
--        jsonb_array_elements(a.dados_extra->'grupos') AS g(g)
--  WHERE s.id::text = g.g->>'mantida_id';
