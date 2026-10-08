-- DESLIGAMENTOS RH — dEMITIDOS 1.xlsx — 40 colaboradores aprovados na conferência de 07/10/2026
-- Não exclui cadastro. Não altera auth.users nem usuarios_sistema.
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
    ('61', 'JOSE CARLOS DE MEDEIROS', '55084028453', DATE '2026-09-11'),
    ('91', 'ELIAQUIM CARVALHO SANTOS', '39286479549', DATE '2026-09-24'),
    ('156', 'JEFERSON OLIVEIRA DE ARAUJO', '05191088506', DATE '2026-09-11'),
    ('163', 'DANVERS SERRA KRONCKA', '35916752881', DATE '2026-09-25'),
    ('273', 'UANDSON DA SILVA SANTOS', '01591213533', DATE '2026-09-11'),
    ('365', 'LUCIANO FERREIRA BRITO', '08584275673', DATE '2026-09-09'),
    ('408', 'VALMIRIA RIBEIRO DE SOUZA', '37826649811', DATE '2026-09-16'),
    ('416', 'UELSON ALVES BATISTA', '34443475885', DATE '2026-09-18'),
    ('435', 'TIAGO COSTA DOS SANTOS', '41367415888', DATE '2026-09-09'),
    ('438', 'THAIS CRISTINA OLIVEIRA DA SILVA', '16478524639', DATE '2026-09-16'),
    ('481', 'DANIELA TAMIRES LEMOS DE SOUZA', '40071956840', DATE '2026-09-16'),
    ('513', 'ADRIANO SANTANA', '18241415800', DATE '2026-09-18'),
    ('552', 'GABRIEL SANTANA DE JESUS SANTOS', '43785314884', DATE '2026-09-24'),
    ('706', 'GLEISON DE OLIVEIRA CONCEICAO', '61087613345', DATE '2026-09-24'),
    ('712', 'RAFAEL DOS SANTOS NASCIMENTO', '35884676883', DATE '2026-09-01'),
    ('770', 'HELIO FERREIRA DOS SANTOS', '11078301689', DATE '2026-09-05'),
    ('826', 'ELDER NASCIMENTO DE SANTANA', '86368416580', DATE '2026-09-25'),
    ('837', 'MARCELO ANTONIO FREIRE DA COSTA JUNIOR', '42278948830', DATE '2026-09-19'),
    ('863', 'WELLINGTON VIEIRA DA SILVA', '34048978896', DATE '2026-09-05'),
    ('1072', 'DOMINGOS ZEFERINO DOS SANTOS', '26535728854', DATE '2026-09-09'),
    ('1094', 'ITALO AGAPITO DE CAVALHO SANTOS', '49569671874', DATE '2026-09-09'),
    ('1102', 'GUILHERME DE ANDRADE PALOPOLI', '46320487801', DATE '2026-09-10'),
    ('1444', 'JENILSON LAURINDO FERREIRA', '30601839889', DATE '2026-09-14'),
    ('1466', 'ANDERSON DOS SANTOS SANTANA', '29804064812', DATE '2026-09-14'),
    ('1498', 'VINICIUS GOMES DOS SANTOS', '60483818836', DATE '2026-09-18'),
    ('1521', 'NICOLAS VIEIRA DA SILVA', '54279687846', DATE '2026-09-30'),
    ('1604', 'LUCIANO MANOEL FERNANDO SANTOS', '64888746591', DATE '2026-09-05'),
    ('1651', 'RAFAEL DA CRUZ DE BRITO', '31454962801', DATE '2026-09-09'),
    ('1659', 'RAIMUNDO NONATO GOMES DA SILVA', '77384512115', DATE '2026-09-28'),
    ('1678', 'NANCI LUZIA CARNEIRO', '26952198814', DATE '2026-09-11'),
    ('1763', 'MARCOS VINICIUS BRIGADEIRO DA SILVA', '23797161883', DATE '2026-09-28'),
    ('1770', 'CAROLINE PERETI TAVEIRA', '47002120808', DATE '2026-09-25'),
    ('1788', 'MICHAEL OLIVEIRA LEITE JUNIOR', '01924455293', DATE '2026-09-29'),
    ('1799', 'AGNALDO CAETANO SANTANA', '14705882857', DATE '2026-09-15'),
    ('1800', 'FELIPE OLIVEIRA SOUSA', '55414661804', DATE '2026-09-09'),
    ('1802', 'JORGE HENRIQUE DE SOUSA LIMA', '22862588806', DATE '2026-09-04'),
    ('1844', 'RAQUEL ORNELAS DA CRUZ', '44196461875', DATE '2026-09-22'),
    ('1883', 'NARA THAISE COSTA TEODOSO', '44393898800', DATE '2026-09-03'),
    ('1920', 'LUIZ CARLOS MARQUEZINI', '31196093822', DATE '2026-09-09'),
    ('1980', 'MARCIO SANTOS DE ALMEIDA', '82268606520', DATE '2026-09-16');

  SELECT string_agg(format('Matrícula %s - %s: %s cadastro(s) elegível(is)', t.matricula, t.nome, x.total), E'\n')
    INTO v_erros
  FROM tmp_desl t
  CROSS JOIN LATERAL (
    SELECT count(*) AS total
    FROM public.colaboradores c
    WHERE ltrim(regexp_replace(coalesce(c.re, ''), '\D', '', 'g'), '0') = ltrim(t.matricula, '0')
      AND upper(btrim(c.nome)) = upper(btrim(t.nome))
      AND coalesce(c.bro, '') !~ '[A-Za-z]' AND lpad(regexp_replace(coalesce(c.bro, ''), '\D', '', 'g'), 11, '0') = t.cpf
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
      AND coalesce(c.bro, '') !~ '[A-Za-z]' AND lpad(regexp_replace(coalesce(c.bro, ''), '\D', '', 'g'), 11, '0') = t.cpf
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
  IF v_n <> 40 THEN
    RAISE EXCEPTION 'DESLIGAMENTO CANCELADO: % cadastros atualizados, esperado 40', v_n;
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

-- Conferência (somente leitura, pode rodar sozinha): deve listar 40 linhas, todas com ativo = false e dispensado = true
WITH t(matricula, nome) AS (VALUES
  ('61', 'JOSE CARLOS DE MEDEIROS'),
  ('91', 'ELIAQUIM CARVALHO SANTOS'),
  ('156', 'JEFERSON OLIVEIRA DE ARAUJO'),
  ('163', 'DANVERS SERRA KRONCKA'),
  ('273', 'UANDSON DA SILVA SANTOS'),
  ('365', 'LUCIANO FERREIRA BRITO'),
  ('408', 'VALMIRIA RIBEIRO DE SOUZA'),
  ('416', 'UELSON ALVES BATISTA'),
  ('435', 'TIAGO COSTA DOS SANTOS'),
  ('438', 'THAIS CRISTINA OLIVEIRA DA SILVA'),
  ('481', 'DANIELA TAMIRES LEMOS DE SOUZA'),
  ('513', 'ADRIANO SANTANA'),
  ('552', 'GABRIEL SANTANA DE JESUS SANTOS'),
  ('706', 'GLEISON DE OLIVEIRA CONCEICAO'),
  ('712', 'RAFAEL DOS SANTOS NASCIMENTO'),
  ('770', 'HELIO FERREIRA DOS SANTOS'),
  ('826', 'ELDER NASCIMENTO DE SANTANA'),
  ('837', 'MARCELO ANTONIO FREIRE DA COSTA JUNIOR'),
  ('863', 'WELLINGTON VIEIRA DA SILVA'),
  ('1072', 'DOMINGOS ZEFERINO DOS SANTOS'),
  ('1094', 'ITALO AGAPITO DE CAVALHO SANTOS'),
  ('1102', 'GUILHERME DE ANDRADE PALOPOLI'),
  ('1444', 'JENILSON LAURINDO FERREIRA'),
  ('1466', 'ANDERSON DOS SANTOS SANTANA'),
  ('1498', 'VINICIUS GOMES DOS SANTOS'),
  ('1521', 'NICOLAS VIEIRA DA SILVA'),
  ('1604', 'LUCIANO MANOEL FERNANDO SANTOS'),
  ('1651', 'RAFAEL DA CRUZ DE BRITO'),
  ('1659', 'RAIMUNDO NONATO GOMES DA SILVA'),
  ('1678', 'NANCI LUZIA CARNEIRO'),
  ('1763', 'MARCOS VINICIUS BRIGADEIRO DA SILVA'),
  ('1770', 'CAROLINE PERETI TAVEIRA'),
  ('1788', 'MICHAEL OLIVEIRA LEITE JUNIOR'),
  ('1799', 'AGNALDO CAETANO SANTANA'),
  ('1800', 'FELIPE OLIVEIRA SOUSA'),
  ('1802', 'JORGE HENRIQUE DE SOUSA LIMA'),
  ('1844', 'RAQUEL ORNELAS DA CRUZ'),
  ('1883', 'NARA THAISE COSTA TEODOSO'),
  ('1920', 'LUIZ CARLOS MARQUEZINI'),
  ('1980', 'MARCIO SANTOS DE ALMEIDA')
)
SELECT t.matricula, c.nome, c.re, c.ativo, c.dispensado, c.data_dispensa, c.motivo_dispensa, c.situacao_vinculo
FROM t
JOIN public.colaboradores c
  ON ltrim(regexp_replace(coalesce(c.re, ''), '\D', '', 'g'), '0') = ltrim(t.matricula, '0')
 AND upper(btrim(c.nome)) = upper(btrim(t.nome))
ORDER BY t.matricula::int;
