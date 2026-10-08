-- DESLIGAMENTOS RH — dEMITIDOS 1.xlsx — cadastros duplicados das matrículas 610 e 1690 (4 cadastros)
-- Aprovado pelo usuário em 07/10/2026: "SE ELES ESTÃO NA LISTA DE DEMITIDOS PODE DEMITIR AS DUPLICADAS TAMBEM".
-- Vínculo pelo id exato de cada cadastro + RE + nome. Não exclui cadastro. Não altera CPF, auth.users nem usuarios_sistema.
-- Rodar o arquivo INTEIRO (sem texto selecionado). O bloco DO é atômico: grava tudo ou nada.

DO $$
DECLARE
  v_erros text;
  v_n integer;
BEGIN
  WITH t(id, matricula, nome, data_desligamento) AS (VALUES
    ('de6d58db-870d-41de-a3ab-4c503f88e592', '610', 'ELVIS GUILHERME PEREIRA', DATE '2026-09-14'),
    ('c540edf1-a530-4fc4-bb3e-313252e65e04', '610', 'ELVIS GUILHERME PEREIRA', DATE '2026-09-14'),
    ('4e6d16e5-215c-45b4-840f-fb3230caf397', '1690', 'PAULO HENRIQUE FERREIRA UZEDA', DATE '2026-09-08'),
    ('5de944ec-fd13-4762-a241-d9811bb04772', '1690', 'PAULO HENRIQUE FERREIRA UZEDA', DATE '2026-09-08')
  )
  SELECT string_agg(format('Matrícula %s - %s (cadastro %s): %s', t.matricula, t.nome, t.id,
           CASE WHEN c.id IS NULL THEN 'cadastro não encontrado'
                WHEN coalesce(c.dispensado, false) THEN 'já está dispensado'
                ELSE 'RE ou nome não conferem' END), E'\n')
    INTO v_erros
  FROM t
  LEFT JOIN public.colaboradores c ON c.id::text = t.id
  WHERE c.id IS NULL
     OR ltrim(regexp_replace(coalesce(c.re, ''), '\D', '', 'g'), '0') <> t.matricula
     OR upper(btrim(c.nome)) <> t.nome
     OR coalesce(c.dispensado, false);
  IF v_erros IS NOT NULL THEN
    RAISE EXCEPTION E'DESLIGAMENTO CANCELADO — nada foi gravado:\n%', v_erros;
  END IF;

  WITH t(id, data_desligamento) AS (VALUES
    ('de6d58db-870d-41de-a3ab-4c503f88e592', DATE '2026-09-14'),
    ('c540edf1-a530-4fc4-bb3e-313252e65e04', DATE '2026-09-14'),
    ('4e6d16e5-215c-45b4-840f-fb3230caf397', DATE '2026-09-08'),
    ('5de944ec-fd13-4762-a241-d9811bb04772', DATE '2026-09-08')
  )
  UPDATE public.colaboradores c
     SET ativo = false, dispensado = true,
         data_dispensa = t.data_desligamento, motivo_dispensa = 'Demitido',
         fonte_dp = 'import_planilha', synergy_synced_at = now(),
         situacao_vinculo = 'desligado', situacao_inicio = t.data_desligamento, situacao_fim = NULL
    FROM t
   WHERE c.id::text = t.id
     AND coalesce(c.dispensado, false) = false;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'DESLIGAMENTO CANCELADO: % cadastros atualizados, esperado 4', v_n;
  END IF;

  WITH t(id, matricula, data_desligamento) AS (VALUES
    ('de6d58db-870d-41de-a3ab-4c503f88e592', '610', DATE '2026-09-14'),
    ('c540edf1-a530-4fc4-bb3e-313252e65e04', '610', DATE '2026-09-14'),
    ('4e6d16e5-215c-45b4-840f-fb3230caf397', '1690', DATE '2026-09-08'),
    ('5de944ec-fd13-4762-a241-d9811bb04772', '1690', DATE '2026-09-08')
  )
  INSERT INTO public.historico_dispensas
    (colaborador_id, colaborador_nome, data_dispensa, motivo, obs, registrado_por, contrato_id)
  SELECT c.id, c.nome, t.data_desligamento, 'Demitido',
         'Desligamento conforme relatório RH dEMITIDOS 1.xlsx (matrícula ' || t.matricula || ', cadastro duplicado)',
         'Carga SQL RH', coalesce(c.contrato_id::text, '')
  FROM t
  JOIN public.colaboradores c ON c.id::text = t.id
  WHERE NOT EXISTS (SELECT 1 FROM public.historico_dispensas h
                    WHERE h.colaborador_id::text = c.id::text AND h.data_dispensa = t.data_desligamento);

  IF to_regclass('public.rh_colaborador_eventos') IS NOT NULL THEN
    WITH t(id, matricula, data_desligamento) AS (VALUES
      ('de6d58db-870d-41de-a3ab-4c503f88e592', '610', DATE '2026-09-14'),
      ('c540edf1-a530-4fc4-bb3e-313252e65e04', '610', DATE '2026-09-14'),
      ('4e6d16e5-215c-45b4-840f-fb3230caf397', '1690', DATE '2026-09-08'),
      ('5de944ec-fd13-4762-a241-d9811bb04772', '1690', DATE '2026-09-08')
    )
    INSERT INTO public.rh_colaborador_eventos
      (colaborador_id, tipo, situacao, inicio, cargo, contrato_id, equipe_id, motivo, fonte,
       origem_modulo, origem_ref, payload, criado_por)
    SELECT c.id, 'desligamento', 'desligado', t.data_desligamento, c.cargo,
           CASE WHEN c.contrato_id::text <> '' THEN c.contrato_id END,
           CASE WHEN c.equipe_id::text <> '' THEN c.equipe_id END, 'Demitido', 'import', 'rh_sql',
           'desligamento_sql:' || t.matricula || ':' || t.data_desligamento::text || ':' || c.id::text,
           jsonb_build_object('matricula', t.matricula, 'data_dispensa', t.data_desligamento,
                              'origem', 'Relatório RH dEMITIDOS 1.xlsx', 'cadastro_duplicado', true),
           'Carga SQL RH'
    FROM t
    JOIN public.colaboradores c ON c.id::text = t.id
    WHERE NOT EXISTS (SELECT 1 FROM public.rh_colaborador_eventos e
                      WHERE e.colaborador_id::text = c.id::text AND e.tipo = 'desligamento'
                        AND e.origem_ref = 'desligamento_sql:' || t.matricula || ':' || t.data_desligamento::text || ':' || c.id::text
                        AND e.anulado_em IS NULL);
  END IF;
END $$;

-- Conferência (somente leitura, pode rodar sozinha): deve listar 4 linhas, todas com ativo = false e dispensado = true
SELECT c.id, c.nome, c.re, c.ativo, c.dispensado, c.data_dispensa, c.motivo_dispensa, c.situacao_vinculo,
       (SELECT count(*) FROM public.historico_dispensas h
         WHERE h.colaborador_id::text = c.id::text AND h.registrado_por = 'Carga SQL RH') AS historico_carga
FROM public.colaboradores c
WHERE c.id::text IN ('de6d58db-870d-41de-a3ab-4c503f88e592', 'c540edf1-a530-4fc4-bb3e-313252e65e04',
                     '4e6d16e5-215c-45b4-840f-fb3230caf397', '5de944ec-fd13-4762-a241-d9811bb04772')
ORDER BY c.re, c.id;
