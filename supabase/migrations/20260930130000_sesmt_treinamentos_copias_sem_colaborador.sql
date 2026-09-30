-- SESMT: exclusão lógica (deleted_at) de treinamentos copiados e de treinamentos sem colaborador.
-- Cópias: linhas idênticas criadas depois da original, a maioria em 26/06 e 05/07/2026 (importação de planilha, que
-- lia só 1000 dos ~6500 treinamentos e gravava de novo o que não via — corrigido no app em 8.1.175).
-- Conferido em 30/09/2026 (somente leitura):
--   * 24 grupos colaborador + curso + data + validade com linhas idênticas (mesmo título, instituição,
--     resultado, médico, clínica e EPIs liberados): fica a linha mais antiga; as outras 25 recebem deleted_at.
--   * Grupos com mesmo colaborador/curso/data mas título diferente NÃO entram (ficam para revisão).
--   * 11 treinamentos sem funcionario_id (criados em 24/06 e 30/06/2026): não pertencem a ninguém e só
--     aparecem no filtro "Só sem cadastro"; recebem deleted_at.
-- Fail-closed: se a linha mantida não existir ou estiver excluída, se a cópia não for mais idêntica à mantida, ou se
-- um treinamento sem colaborador tiver ganhado colaborador, nada é alterado.
-- Linha já excluída ou vinculada a documento (rh_sesmt_documento_vinculos ativo, ou rh_colaborador_documentos com
-- referencia_modulo 'sesmt_treinamentos') é pulada e registrada. Em 30/09 uma cópia está nesse caso (VACINACAO
-- 624ac667…, referenciada por documento): esperado 35 excluídas e 1 pulada.
-- Não apaga nada de verdade. Grava audit_log SESMT_TREINAMENTOS_LIMPEZA com o estado anterior (permite desfazer).

BEGIN;

DO $$
DECLARE
  -- [linha mantida, cópia a excluir]
  v_copias text[][] := ARRAY[
    ['da0c87ce-0e0a-4a53-975c-794c83fa70da','147ad50f-8fc7-4526-bb73-2d36c9b9ccab'], -- NR11 · data 2025-06-30 · val — · cópia de 05/07 08:34
    ['5b292f8e-7b19-4ae1-94cb-4d1c9bd22ba7','147b6ab8-e448-4deb-b4ae-79209109774a'], -- NR18 · data — · val — · cópia de 26/06 16:56
    ['3d0a66fe-cae3-4a94-b21e-90f8c3a18e5c','16447fb9-3fb1-4532-9219-269884b0b969'], -- NR18 · data — · val — · cópia de 26/06 16:56
    ['b6845145-c8d0-4e3b-ac3c-5ddd2d0825c1','1c39a2e4-ded6-4c47-8fdd-f8e587831c75'], -- NR11 · data 2023-04-03 · val — · cópia de 05/07 08:34
    ['b8ac1103-7fc3-4d32-8063-0e4d53792390','20729a94-1777-4c1d-b106-bbdf51850782'], -- NR18 · data — · val — · cópia de 26/06 16:56
    ['4eae57b6-0baa-4d5b-bf01-17ad5b9ca0fb','2354c6b7-4ea8-4dde-976f-8134e1098c9a'], -- NR18 · data — · val — · cópia de 26/06 16:56
    ['32170491-b01b-47c5-991b-de8b106870dc','3513fc79-5231-4b48-bcd3-7ecb35813da2'], -- NR-35 · data — · val — · cópia de 17/06 22:27
    ['46e0128b-97fc-41f0-9e17-c92861cab747','f7e4917e-c163-474d-9f91-21560e134f15'], -- VACINACAO · data — · val — · cópia de 28/09 19:39
    ['46e0128b-97fc-41f0-9e17-c92861cab747','624ac667-2cb1-4264-9e81-d58368d939cf'], -- VACINACAO · data — · val — · cópia de 28/09 19:40
    ['49548ccb-893a-4691-ba94-d82e0936e366','8b85fdf2-5d2d-40ac-b524-1a19ec9aa51f'], -- NR 6 · data — · val — · cópia de 26/06 16:55
    ['4b4ffa0a-c6d0-4881-ac29-813c36e36800','89477dee-d02d-4b1b-a198-e8c92877df55'], -- NR11 · data 2026-02-12 · val — · cópia de 05/07 08:34
    ['c4f9ef94-e007-4056-9ce1-a906a7f86e57','4c5bc777-16d4-4289-af4b-d5060599f3ce'], -- NR-10-REC · data 2026-06-16 · val 2028-06-23 · cópia de 24/06 11:45
    ['4cbcc816-0aec-401f-b1b5-2c50f5665b5b','a5576247-f919-4d4d-9993-44bbb17b4167'], -- NR11 · data 2025-06-10 · val — · cópia de 05/07 08:34
    ['4ded9cd8-c621-49ce-9c62-883e4e61f464','9701a6c6-88fa-4b0b-a928-4682b4b1ba57'], -- NR11 · data 2025-04-29 · val — · cópia de 05/07 08:34
    ['579e7ee0-3a5e-4b75-833d-5564423c290f','e29f5ed7-e00d-4ce4-893b-d86b0bf5bbce'], -- NR11 · data 2026-02-19 · val — · cópia de 05/07 08:34
    ['617582df-9c75-4522-8134-76cc38e16934','b2426261-8453-47b5-a170-519bb38db103'], -- NR 6 · data — · val — · cópia de 26/06 16:55
    ['86f78329-f91e-4a73-9423-5e95b3d77247','7715c891-7f14-4de5-b778-d14b7506cb63'], -- NR11 · data 2025-01-28 · val — · cópia de 05/07 08:34
    ['797dbd3d-d478-4519-b73f-ab38a899a7cd','7793fab2-28c7-4f24-a0e9-80129572eedb'], -- NR 6 · data — · val — · cópia de 26/06 16:55
    ['7e54c900-b77b-4518-b02f-66ac15c242a4','af6edf0f-5601-434b-a154-69ede362bc5d'], -- CRMDA · data 2026-06-18 · val — · cópia de 24/06 10:46
    ['85bca64f-6dbf-4a48-8f0a-0b701417d826','e1349fad-ad71-4d29-aaa0-1d329b7b0333'], -- NR 6 · data 2025-02-03 · val 2027-02-03 · cópia de 20/08 01:16
    ['a8b904c8-7e5e-4768-8aa1-2b9de12c6850','9e67ccd4-4d0d-4edc-b46e-0493f18ccf64'], -- NR 6 · data — · val — · cópia de 26/06 16:55
    ['a51be5b1-5c28-4baf-ba03-c19a5d5cf7b6','d3676733-0889-49cc-a359-8d1b16d2849a'], -- NR11 · data 2026-02-19 · val — · cópia de 05/07 08:34
    ['a8fed138-eb42-4929-91df-0cf908c0d54d','efdd17ec-ebdd-447a-b5ec-c19921271907'], -- CRMDA · data 2026-06-18 · val — · cópia de 24/06 10:46
    ['db1d6654-5fe4-4f0f-b326-93545eb77ca8','a9643ae7-9a8b-4e4e-acf2-d9f60fc6b2c2'], -- NR11 · data 2025-06-10 · val — · cópia de 05/07 08:34
    ['b67249bc-2698-4832-b646-2a8c0f2445cc','b3ed2867-0026-4d04-b35a-a650c5452831']  -- NR 6 · data 2025-02-03 · val 2027-02-03 · cópia de 20/08 01:16
  ];
  v_sem_colab text[] := ARRAY[
    '0c755f4a-afef-423b-a9fa-5882579bbbd5', -- NR-12 · val 2028-06-16 · criado 30/06 16:27
    '1dd7c139-bcf4-438a-ab74-4ebcdcf3949c', -- HAR · val 2028-06-12 · criado 24/06 16:17
    '5031abe9-a2e9-4c26-960f-cb3392e23d83', -- NR-35-REC · val 2027-06-15 · criado 24/06 16:08
    '514a0655-4d2b-4932-8701-1bccf6d07c2c', -- NR 6 · val 2028-05-26 · criado 24/06 13:47
    '55de5d65-21aa-43b3-ac55-9759e9c80eb3', -- NR-35-REC · val 2027-06-03 · criado 24/06 15:55
    '769b3b41-c191-470e-9c06-734dac1950a5', -- NR-10-REC · val 2028-06-02 · criado 24/06 14:33
    '7b11f4df-ecd2-40d1-a100-dd03a80059d2', -- NR-33-REC · val 2027-06-22 · criado 24/06 14:16
    '9c29c5fe-34b0-46ab-ba24-e9a8bd596285', -- NR-12 · val 2028-05-28 · criado 24/06 13:42
    'c4a6f90b-eec2-4bff-94ab-5764094ba6a6', -- NR-10-REC · val 2028-06-16 · criado 24/06 16:04
    'ce8a7258-324b-4622-990a-a335639d0580', -- NR-35-REC · val 2027-06-15 · criado 24/06 16:22
    'cefcb9b4-e2ee-4fe3-a54d-3bc78feb7008'  -- NR 6 · val 2028-06-15 · criado 30/06 16:10
  ];
  v_esp_copias int := 25;
  v_esp_sem_colab int := 11;
  i int;
  v_m record;
  v_e record;
  v_todos text[] := ARRAY[]::text[];
  v_excluir text[] := ARRAY[]::text[];
  v_antes jsonb := '[]'::jsonb;
  v_pulados jsonb := '[]'::jsonb;
  v_upd int;
BEGIN
  IF array_length(v_copias, 1) <> v_esp_copias OR array_length(v_sem_colab, 1) <> v_esp_sem_colab THEN
    RAISE EXCEPTION 'PARAR: listas com % cópias / % sem colaborador; esperado % / %.',
      array_length(v_copias, 1), array_length(v_sem_colab, 1), v_esp_copias, v_esp_sem_colab;
  END IF;
  FOR i IN 1..array_length(v_copias, 1) LOOP
    v_todos := v_todos || v_copias[i][2];
  END LOOP;
  v_todos := v_todos || v_sem_colab;
  IF (SELECT count(DISTINCT x) FROM unnest(v_todos) x) <> v_esp_copias + v_esp_sem_colab
     OR EXISTS (SELECT 1 FROM generate_subscripts(v_copias, 1) g WHERE v_copias[g][1] = ANY(v_todos)) THEN
    RAISE EXCEPTION 'PARAR: ids repetidos na lista ou linha mantida também marcada para excluir.';
  END IF;

  PERFORM 1 FROM public.treinamentos
   WHERE id::text = ANY(v_todos) OR id::text IN (SELECT v_copias[g][1] FROM generate_subscripts(v_copias, 1) g)
   FOR UPDATE;

  FOR i IN 1..array_length(v_copias, 1) LOOP
    SELECT * INTO v_m FROM public.treinamentos WHERE id::text = v_copias[i][1];
    SELECT * INTO v_e FROM public.treinamentos WHERE id::text = v_copias[i][2];
    IF v_m.id IS NULL OR v_e.id IS NULL THEN
      RAISE EXCEPTION 'PARAR: par % (% / %) não encontrado. Nenhuma alteração.', i, v_copias[i][1], v_copias[i][2];
    END IF;
    IF v_m.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'PARAR: par % (%): a linha que deveria ficar está excluída. Nenhuma alteração.', i, v_m.nr;
    END IF;
    IF v_e.funcionario_id::text IS DISTINCT FROM v_m.funcionario_id::text
       OR v_e.nr IS DISTINCT FROM v_m.nr OR v_e.titulo IS DISTINCT FROM v_m.titulo
       OR v_e.data IS DISTINCT FROM v_m.data OR v_e.validade IS DISTINCT FROM v_m.validade
       OR v_e.instituicao IS DISTINCT FROM v_m.instituicao OR v_e.resultado IS DISTINCT FROM v_m.resultado
       OR v_e.medico IS DISTINCT FROM v_m.medico OR v_e.clinica IS DISTINCT FROM v_m.clinica
       OR v_e.epis_liberados IS DISTINCT FROM v_m.epis_liberados THEN
      RAISE EXCEPTION 'PARAR: par % (%): a cópia não é mais idêntica à linha mantida. Nenhuma alteração.', i, v_m.nr;
    END IF;
    IF v_e.deleted_at IS NOT NULL THEN
      v_pulados := v_pulados || jsonb_build_object('id', v_e.id::text, 'motivo', 'já excluída');
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM public.rh_sesmt_documento_vinculos v
                WHERE v.treinamento_id::text = v_e.id::text AND coalesce(v.ativo, true))
       OR EXISTS (SELECT 1 FROM public.rh_colaborador_documentos d
                   WHERE d.referencia_modulo = 'sesmt_treinamentos' AND d.referencia_id::text = v_e.id::text) THEN
      v_pulados := v_pulados || jsonb_build_object('id', v_e.id::text, 'motivo', 'vinculado a documento');
      CONTINUE;
    END IF;
    v_excluir := v_excluir || v_e.id::text;
    v_antes := v_antes || jsonb_build_object('id', v_e.id::text, 'tipo', 'copia', 'mantida', v_m.id::text,
      'funcionario_id', v_e.funcionario_id::text, 'nr', v_e.nr, 'data', v_e.data, 'validade', v_e.validade);
  END LOOP;

  FOR i IN 1..array_length(v_sem_colab, 1) LOOP
    SELECT * INTO v_e FROM public.treinamentos WHERE id::text = v_sem_colab[i];
    IF v_e.id IS NULL THEN
      RAISE EXCEPTION 'PARAR: treinamento sem colaborador % não encontrado. Nenhuma alteração.', v_sem_colab[i];
    END IF;
    IF v_e.funcionario_id IS NOT NULL THEN
      RAISE EXCEPTION 'PARAR: treinamento % (%) agora tem colaborador. Nenhuma alteração.', v_sem_colab[i], v_e.nr;
    END IF;
    IF v_e.deleted_at IS NOT NULL THEN
      v_pulados := v_pulados || jsonb_build_object('id', v_e.id::text, 'motivo', 'já excluída');
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM public.rh_sesmt_documento_vinculos v
                WHERE v.treinamento_id::text = v_e.id::text AND coalesce(v.ativo, true))
       OR EXISTS (SELECT 1 FROM public.rh_colaborador_documentos d
                   WHERE d.referencia_modulo = 'sesmt_treinamentos' AND d.referencia_id::text = v_e.id::text) THEN
      v_pulados := v_pulados || jsonb_build_object('id', v_e.id::text, 'motivo', 'vinculado a documento');
      CONTINUE;
    END IF;
    v_excluir := v_excluir || v_e.id::text;
    v_antes := v_antes || jsonb_build_object('id', v_e.id::text, 'tipo', 'sem_colaborador', 'nr', v_e.nr, 'titulo', v_e.titulo, 'validade', v_e.validade);
  END LOOP;

  IF coalesce(array_length(v_excluir, 1), 0) = 0 THEN
    RAISE EXCEPTION 'PARAR: nada pendente (tudo já excluído ou vinculado). Nenhuma alteração.';
  END IF;

  UPDATE public.treinamentos SET deleted_at = now()
   WHERE id::text = ANY(v_excluir) AND deleted_at IS NULL;
  GET DIAGNOSTICS v_upd = ROW_COUNT;
  IF v_upd <> array_length(v_excluir, 1) THEN
    RAISE EXCEPTION 'PARAR: exclusão afetou % linhas; esperado %. Rollback.', v_upd, array_length(v_excluir, 1);
  END IF;

  INSERT INTO public.audit_log (
    acao, modulo, descricao,
    usuario_id, usuario_nome, usuario_perfil,
    dados_extra, data_hora, sessao_id
  ) VALUES (
    'SESMT_TREINAMENTOS_LIMPEZA',
    'sesmt',
    'Exclusão lógica de ' || v_upd || ' treinamento(s): cópias idênticas e registros sem colaborador.'
      || CASE WHEN jsonb_array_length(v_pulados) > 0 THEN ' ' || jsonb_array_length(v_pulados) || ' pulado(s) (já excluído ou vinculado a documento).' ELSE '' END,
    '',
    coalesce(current_user, 'sql-editor'),
    '',
    jsonb_build_object('excluidos', v_antes, 'pulados', v_pulados, 'registros_afetados', v_upd),
    now(),
    'sql:20260930130000_sesmt_treinamentos_copias_sem_colaborador'
  );
END $$;

COMMIT;

-- Validação (após aplicar):
--   SELECT count(*) FROM public.treinamentos WHERE deleted_at IS NULL AND funcionario_id IS NULL;   -- esperado 0 (salvo pulados no audit_log)
--   SELECT acao, descricao, data_hora FROM public.audit_log
--    WHERE sessao_id = 'sql:20260930130000_sesmt_treinamentos_copias_sem_colaborador' ORDER BY data_hora DESC LIMIT 1;
--
-- Para desfazer (só se necessário; reativa as linhas excluídas por esta migration):
--   UPDATE public.treinamentos t
--      SET deleted_at = NULL
--     FROM (SELECT dados_extra FROM public.audit_log
--            WHERE sessao_id = 'sql:20260930130000_sesmt_treinamentos_copias_sem_colaborador'
--            ORDER BY data_hora DESC LIMIT 1) a,
--          jsonb_array_elements(a.dados_extra->'excluidos') AS e(r)
--    WHERE t.id::text = e.r->>'id' AND t.deleted_at IS NOT NULL;
