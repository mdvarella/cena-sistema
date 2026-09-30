-- Portaria: remove (soft delete) a cópia das 3 saídas de 29/09/2026 que ficaram gravadas em dobro com as
-- DUAS linhas abertas (EJN300 07:24, EIN330 07:59, EJN173 11:39). A migration 20260930110000 só tratou pares em que
-- uma das linhas já tinha retorno, por isso estes três ficaram de fora.
-- Causa: gravação dupla da portaria (tentativa "mini" sem id, corrigida no app em 8.1.173); a cópia não tem
-- tipo_liberacao/quem_saiu/modelo.
-- Em cada par fica UMA linha: a que já tiver retorno, ou a completa. A ORIGINAL continua aberta: o retorno
-- de 29/09 não foi registrado e o porteiro precisa fechá-la em "Retornos em aberto" (EJN300 e EIN330 já saíram
-- de novo em 30/09; a placa TTM8E99 da EJN173 saiu em 30/09 com a EBN196).
-- Mesma lógica e travas da 20260930180000_portaria_saidas_duplicadas_3009 (fail-closed, auditoria, desfazer).

BEGIN;

DO $$
DECLARE
  v_esperado_grupos int := 3;
  v_esperado_linhas int := 6;
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
  DROP TABLE IF EXISTS _port_dup_2909;
  CREATE TEMP TABLE _port_dup_2909 (grupo int NOT NULL, id text PRIMARY KEY, completa boolean NOT NULL) ON COMMIT DROP;
  INSERT INTO _port_dup_2909 (grupo, id, completa) VALUES
      (1, '9659cb18-de11-4d2d-aa60-77693909d558', true ), -- 29/09 07:24 EJN300 DZH7G12 (completa)
      (1, '4c2a9b72-e9f3-483b-b31e-242e64db8682', false), -- 29/09 07:24 EJN300 DZH7G12
      (2, '73dd88f3-ddf6-4a2b-887b-5264e3163f7d', true ), -- 29/09 07:59 EIN330 STC8B57 (completa)
      (2, '39aa348e-6f10-4afd-b74e-1676852791ad', false), -- 29/09 07:59 EIN330 STC8B57
      (3, '5fce3b43-7942-41a1-aa0b-b1f435012a9d', true ), -- 29/09 11:39 EJN173 TTM8E99 (completa)
      (3, '3d82895a-e63b-4ca4-b66c-7082cf4bd42a', false)  -- 29/09 11:39 EJN173 TTM8E99
  ;

  IF (SELECT count(DISTINCT grupo) FROM _port_dup_2909) <> v_esperado_grupos
     OR (SELECT count(*) FROM _port_dup_2909) <> v_esperado_linhas THEN
    RAISE EXCEPTION 'PARAR: lista com % grupos / % linhas; esperado % / %.',
      (SELECT count(DISTINCT grupo) FROM _port_dup_2909), (SELECT count(*) FROM _port_dup_2909), v_esperado_grupos, v_esperado_linhas;
  END IF;
  IF EXISTS (SELECT 1 FROM _port_dup_2909 GROUP BY grupo HAVING count(*) < 2 OR count(*) FILTER (WHERE completa) <> 1) THEN
    RAISE EXCEPTION 'PARAR: todo grupo precisa de 2+ linhas e exatamente 1 completa.';
  END IF;

  PERFORM 1 FROM public.frotas_portaria_saidas s JOIN _port_dup_2909 d ON s.id::text = d.id FOR UPDATE OF s;
  IF (SELECT count(*) FROM public.frotas_portaria_saidas s JOIN _port_dup_2909 d ON s.id::text = d.id) <> v_esperado_linhas THEN
    RAISE EXCEPTION 'PARAR: % de % linhas encontradas. Nenhuma alteração.',
      (SELECT count(*) FROM public.frotas_portaria_saidas s JOIN _port_dup_2909 d ON s.id::text = d.id), v_esperado_linhas;
  END IF;

  FOR g IN SELECT DISTINCT grupo FROM _port_dup_2909 ORDER BY 1 LOOP
    IF (SELECT count(DISTINCT (coalesce(s.equipe_id::text, ''), upper(coalesce(s.placa, '')), s.data_saida, coalesce(s.km_saida::text, '')))
          FROM public.frotas_portaria_saidas s JOIN _port_dup_2909 d ON s.id::text = d.id WHERE d.grupo = g) <> 1 THEN
      RAISE EXCEPTION 'PARAR: grupo % não é da mesma equipe/placa/data de saída/KM. Nenhuma alteração.', g;
    END IF;

    SELECT s.* INTO v_completa FROM public.frotas_portaria_saidas s JOIN _port_dup_2909 d ON s.id::text = d.id
     WHERE d.grupo = g AND d.completa;

    SELECT count(*) INTO v_ret FROM public.frotas_portaria_saidas s JOIN _port_dup_2909 d ON s.id::text = d.id
     WHERE d.grupo = g AND s.deleted_at IS NULL AND s.data_retorno IS NOT NULL;
    IF v_ret > 1 THEN
      v_pulados := v_pulados || jsonb_build_object('grupo', g, 'placa', v_completa.placa, 'equipe', v_completa.equipe, 'motivo', 'mais de uma linha com retorno');
      CONTINUE;
    ELSIF v_ret = 1 THEN
      SELECT s.id::text INTO v_mantida FROM public.frotas_portaria_saidas s JOIN _port_dup_2909 d ON s.id::text = d.id
       WHERE d.grupo = g AND s.deleted_at IS NULL AND s.data_retorno IS NOT NULL;
    ELSIF v_completa.deleted_at IS NULL THEN
      v_mantida := v_completa.id::text;
    ELSE
      v_pulados := v_pulados || jsonb_build_object('grupo', g, 'placa', v_completa.placa, 'equipe', v_completa.equipe, 'motivo', 'linha completa já excluída');
      CONTINUE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.frotas_portaria_saidas s JOIN _port_dup_2909 d ON s.id::text = d.id
                    WHERE d.grupo = g AND s.id::text <> v_mantida AND s.deleted_at IS NULL AND s.data_retorno IS NULL) THEN
      v_pulados := v_pulados || jsonb_build_object('grupo', g, 'placa', v_completa.placa, 'equipe', v_completa.equipe, 'motivo', 'já resolvido');
      CONTINUE;
    END IF;

    SELECT * INTO v_mant FROM public.frotas_portaria_saidas WHERE id::text = v_mantida;
    v_copias := '[]'::jsonb;
    FOR v_c IN
      SELECT s.id::text AS id, s.obs FROM public.frotas_portaria_saidas s JOIN _port_dup_2909 d ON s.id::text = d.id
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
    'PORTARIA_SAIDAS_DUPLICADAS_2909_ABERTAS',
    'frotas',
    'Exclusão lógica de ' || v_excluidas || ' cópias duplicadas de saída abertas (29/09/2026).'
      || CASE WHEN jsonb_array_length(v_pulados) > 0 THEN ' ' || jsonb_array_length(v_pulados) || ' grupo(s) pulado(s).' ELSE '' END,
    '',
    coalesce(current_user, 'sql-editor'),
    '',
    jsonb_build_object('grupos', v_grupos, 'pulados', v_pulados, 'registros_afetados', v_excluidas),
    now(),
    'sql:20260930190000_portaria_saidas_duplicadas_abertas_2909'
  );
END $$;

COMMIT;

-- Validação (após aplicar):
--   SELECT equipe, placa, data_saida, count(*) FROM public.frotas_portaria_saidas
--    WHERE deleted_at IS NULL AND data_saida >= '2026-09-29T00:00:00-03:00' AND data_saida < '2026-09-30T00:00:00-03:00'
--    GROUP BY equipe_id, equipe, placa, data_saida HAVING count(*) > 1;   -- esperado: nenhuma linha
--   SELECT acao, descricao, data_hora FROM public.audit_log
--    WHERE sessao_id = 'sql:20260930190000_portaria_saidas_duplicadas_abertas_2909' ORDER BY data_hora DESC LIMIT 1;
--
-- Para desfazer
-- UPDATE public.frotas_portaria_saidas s
--    SET deleted_at = NULL, obs = c.c->>'obs'
--   FROM (SELECT dados_extra FROM public.audit_log
--          WHERE sessao_id = 'sql:20260930190000_portaria_saidas_duplicadas_abertas_2909'
--          ORDER BY data_hora DESC LIMIT 1) a,
--        jsonb_array_elements(a.dados_extra->'grupos') AS g(g),
--        jsonb_array_elements(g.g->'copias') AS c(c)
--  WHERE s.id::text = c.c->>'id';
-- UPDATE public.frotas_portaria_saidas s
--    SET modelo = g.g->>'mantida_modelo', tipo_liberacao = g.g->>'mantida_tipo_liberacao', quem_saiu = g.g->>'mantida_quem_saiu',
--        foto_carga_saida_b64 = CASE WHEN (g.g->>'mantida_foto_vazia')::boolean THEN NULL ELSE s.foto_carga_saida_b64 END
--   FROM (SELECT dados_extra FROM public.audit_log
--          WHERE sessao_id = 'sql:20260930190000_portaria_saidas_duplicadas_abertas_2909'
--          ORDER BY data_hora DESC LIMIT 1) a,
--        jsonb_array_elements(a.dados_extra->'grupos') AS g(g)
--  WHERE s.id::text = g.g->>'mantida_id';
