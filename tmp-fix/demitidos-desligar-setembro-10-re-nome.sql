-- DESLIGAMENTOS RH — dEMITIDOS 1.xlsx — 10 colaboradores aprovados na conferência de 07/10/2026
-- Não exclui cadastro. Não altera auth.users nem usuarios_sistema.
-- Vínculo por RE + nome (CPF do cadastro diverge da lista; aprovado pelo usuário em 07/10/2026).
-- O CPF da lista não pode estar no cadastro de outra pessoa. O CPF do cadastro NÃO é alterado.
-- Rodar o arquivo INTEIRO (sem texto selecionado). O bloco DO é atômico: grava tudo ou nada.

DO $$
DECLARE
  v_erros text;
  v_n integer;
BEGIN
  DROP TABLE IF EXISTS pg_temp.tmp_desl_alvos;
  DROP TABLE IF EXISTS pg_temp.tmp_desl;
  CREATE TEMP TABLE tmp_desl (matricula text, nome text, cpf text, data_desligamento date) ON COMMIT DROP;
  INSERT INTO tmp_desl VALUES
    ('444', 'ALAN SOUSA RODRIGUES DE OLIVEIRA', '32332059881', DATE '2026-09-20'),
    ('742', 'FELIPE DE ABREU LADEIA', '49129667895', DATE '2026-09-14'),
    ('795', 'THIAGO DE MORAES SOUZA', '32227113804', DATE '2026-09-30'),
    ('859', 'VITOR FERREIRA DE ANDRADE', '49043319821', DATE '2026-09-29'),
    ('871', 'LUCAS CORREA DOS SANTOS', '44110792835', DATE '2026-09-29'),
    ('1200', 'DIOGO SANTOS DE OLIVEIRA', '41971130800', DATE '2026-09-21'),
    ('1248', 'ADALBERTO BEZERRA LINO', '32886742899', DATE '2026-09-24'),
    ('1323', 'GUILHERME GONCALVES DOS SANTOS', '41612642837', DATE '2026-09-11'),
    ('1388', 'WISNEY DOUGLAS ROCHA LOPES', '44948068896', DATE '2026-09-25'),
    ('1398', 'ALEXANDRE FRANÇA COSTA', '17712107882', DATE '2026-09-18');

  SELECT string_agg(format('Matrícula %s - %s: %s cadastro(s) elegível(is)', t.matricula, t.nome, x.total), E'\n')
    INTO v_erros
  FROM tmp_desl t
  CROSS JOIN LATERAL (
    SELECT count(*) AS total
    FROM public.colaboradores c
    WHERE ltrim(regexp_replace(coalesce(c.re, ''), '\D', '', 'g'), '0') = ltrim(t.matricula, '0')
      AND upper(btrim(c.nome)) = upper(btrim(t.nome))
      AND NOT EXISTS (SELECT 1 FROM public.colaboradores o WHERE o.id <> c.id AND coalesce(o.bro, '') !~ '[A-Za-z]' AND lpad(regexp_replace(coalesce(o.bro, ''), '\D', '', 'g'), 11, '0') = t.cpf)
      AND c.ativo IS TRUE
      AND coalesce(c.dispensado, false) = false
  ) x
  WHERE x.total <> 1;
  IF v_erros IS NOT NULL THEN
    RAISE EXCEPTION E'DESLIGAMENTO CANCELADO — nada foi gravado:\n%', v_erros;
  END IF;

  CREATE TEMP TABLE tmp_desl_alvos ON COMMIT DROP AS
  SELECT t.*, c.id AS colaborador_id, c.nome AS nome_cena, c.contrato_id, c.equipe_id, c.cargo
  FROM tmp_desl t
  JOIN public.colaboradores c
    ON ltrim(regexp_replace(coalesce(c.re, ''), '\D', '', 'g'), '0') = ltrim(t.matricula, '0')
      AND upper(btrim(c.nome)) = upper(btrim(t.nome))
      AND NOT EXISTS (SELECT 1 FROM public.colaboradores o WHERE o.id <> c.id AND coalesce(o.bro, '') !~ '[A-Za-z]' AND lpad(regexp_replace(coalesce(o.bro, ''), '\D', '', 'g'), 11, '0') = t.cpf)
   AND c.ativo IS TRUE
   AND coalesce(c.dispensado, false) = false;

  UPDATE public.colaboradores c
     SET ativo = false, dispensado = true,
         data_dispensa = a.data_desligamento, motivo_dispensa = 'Demitido',
         fonte_dp = 'import_planilha', synergy_synced_at = now(),
         situacao_vinculo = 'desligado', situacao_inicio = a.data_desligamento, situacao_fim = NULL
    FROM tmp_desl_alvos a
   WHERE c.id = a.colaborador_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 10 THEN
    RAISE EXCEPTION 'DESLIGAMENTO CANCELADO: % cadastros atualizados, esperado 10', v_n;
  END IF;

  INSERT INTO public.historico_dispensas
    (colaborador_id, colaborador_nome, data_dispensa, motivo, obs, registrado_por, contrato_id)
  SELECT a.colaborador_id, a.nome_cena, a.data_desligamento, 'Demitido',
         'Desligamento conforme relatório RH dEMITIDOS 1.xlsx (matrícula ' || a.matricula || ')',
         'Carga SQL RH', coalesce(a.contrato_id::text, '')
  FROM tmp_desl_alvos a
  WHERE NOT EXISTS (SELECT 1 FROM public.historico_dispensas h
                    WHERE h.colaborador_id::text = a.colaborador_id::text AND h.data_dispensa = a.data_desligamento);

  IF to_regclass('public.rh_colaborador_eventos') IS NOT NULL THEN
    INSERT INTO public.rh_colaborador_eventos
      (colaborador_id, tipo, situacao, inicio, cargo, contrato_id, equipe_id, motivo, fonte,
       origem_modulo, origem_ref, payload, criado_por)
    SELECT a.colaborador_id, 'desligamento', 'desligado', a.data_desligamento, a.cargo,
           nullif(a.contrato_id::text, ''), nullif(a.equipe_id::text, ''), 'Demitido', 'import', 'rh_sql',
           'desligamento_sql:' || a.matricula || ':' || a.data_desligamento::text,
           jsonb_build_object('matricula', a.matricula, 'data_dispensa', a.data_desligamento,
                              'origem', 'Relatório RH dEMITIDOS 1.xlsx'),
           'Carga SQL RH'
    FROM tmp_desl_alvos a
    WHERE NOT EXISTS (SELECT 1 FROM public.rh_colaborador_eventos e
                      WHERE e.colaborador_id::text = a.colaborador_id::text AND e.tipo = 'desligamento'
                        AND e.origem_ref = 'desligamento_sql:' || a.matricula || ':' || a.data_desligamento::text
                        AND e.anulado_em IS NULL);
  END IF;
END $$;

-- Conferência (somente leitura, pode rodar sozinha): deve listar 10 linhas, todas com ativo = false e dispensado = true
WITH t(matricula, nome) AS (VALUES
  ('444', 'ALAN SOUSA RODRIGUES DE OLIVEIRA'),
  ('742', 'FELIPE DE ABREU LADEIA'),
  ('795', 'THIAGO DE MORAES SOUZA'),
  ('859', 'VITOR FERREIRA DE ANDRADE'),
  ('871', 'LUCAS CORREA DOS SANTOS'),
  ('1200', 'DIOGO SANTOS DE OLIVEIRA'),
  ('1248', 'ADALBERTO BEZERRA LINO'),
  ('1323', 'GUILHERME GONCALVES DOS SANTOS'),
  ('1388', 'WISNEY DOUGLAS ROCHA LOPES'),
  ('1398', 'ALEXANDRE FRANÇA COSTA')
)
SELECT t.matricula, c.nome, c.re, c.ativo, c.dispensado, c.data_dispensa, c.motivo_dispensa, c.situacao_vinculo
FROM t
JOIN public.colaboradores c
  ON ltrim(regexp_replace(coalesce(c.re, ''), '\D', '', 'g'), '0') = ltrim(t.matricula, '0')
 AND upper(btrim(c.nome)) = upper(btrim(t.nome))
ORDER BY t.matricula::int;
