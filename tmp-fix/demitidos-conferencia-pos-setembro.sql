-- CONFERÊNCIA SOMENTE LEITURA — desligamentos setembro (40 + 10). Não grava nada.
-- historico_carga / eventos_carga > 0 indicam que o script de desligamento SQL já foi aplicado.
WITH t(matricula, nome, lote) AS (VALUES
  ('61', 'JOSE CARLOS DE MEDEIROS', '40'),
  ('91', 'ELIAQUIM CARVALHO SANTOS', '40'),
  ('156', 'JEFERSON OLIVEIRA DE ARAUJO', '40'),
  ('163', 'DANVERS SERRA KRONCKA', '40'),
  ('273', 'UANDSON DA SILVA SANTOS', '40'),
  ('365', 'LUCIANO FERREIRA BRITO', '40'),
  ('408', 'VALMIRIA RIBEIRO DE SOUZA', '40'),
  ('416', 'UELSON ALVES BATISTA', '40'),
  ('435', 'TIAGO COSTA DOS SANTOS', '40'),
  ('438', 'THAIS CRISTINA OLIVEIRA DA SILVA', '40'),
  ('481', 'DANIELA TAMIRES LEMOS DE SOUZA', '40'),
  ('513', 'ADRIANO SANTANA', '40'),
  ('552', 'GABRIEL SANTANA DE JESUS SANTOS', '40'),
  ('706', 'GLEISON DE OLIVEIRA CONCEICAO', '40'),
  ('712', 'RAFAEL DOS SANTOS NASCIMENTO', '40'),
  ('770', 'HELIO FERREIRA DOS SANTOS', '40'),
  ('826', 'ELDER NASCIMENTO DE SANTANA', '40'),
  ('837', 'MARCELO ANTONIO FREIRE DA COSTA JUNIOR', '40'),
  ('863', 'WELLINGTON VIEIRA DA SILVA', '40'),
  ('1072', 'DOMINGOS ZEFERINO DOS SANTOS', '40'),
  ('1094', 'ITALO AGAPITO DE CAVALHO SANTOS', '40'),
  ('1102', 'GUILHERME DE ANDRADE PALOPOLI', '40'),
  ('1444', 'JENILSON LAURINDO FERREIRA', '40'),
  ('1466', 'ANDERSON DOS SANTOS SANTANA', '40'),
  ('1498', 'VINICIUS GOMES DOS SANTOS', '40'),
  ('1521', 'NICOLAS VIEIRA DA SILVA', '40'),
  ('1604', 'LUCIANO MANOEL FERNANDO SANTOS', '40'),
  ('1651', 'RAFAEL DA CRUZ DE BRITO', '40'),
  ('1659', 'RAIMUNDO NONATO GOMES DA SILVA', '40'),
  ('1678', 'NANCI LUZIA CARNEIRO', '40'),
  ('1763', 'MARCOS VINICIUS BRIGADEIRO DA SILVA', '40'),
  ('1770', 'CAROLINE PERETI TAVEIRA', '40'),
  ('1788', 'MICHAEL OLIVEIRA LEITE JUNIOR', '40'),
  ('1799', 'AGNALDO CAETANO SANTANA', '40'),
  ('1800', 'FELIPE OLIVEIRA SOUSA', '40'),
  ('1802', 'JORGE HENRIQUE DE SOUSA LIMA', '40'),
  ('1844', 'RAQUEL ORNELAS DA CRUZ', '40'),
  ('1883', 'NARA THAISE COSTA TEODOSO', '40'),
  ('1920', 'LUIZ CARLOS MARQUEZINI', '40'),
  ('1980', 'MARCIO SANTOS DE ALMEIDA', '40'),
  ('444', 'ALAN SOUSA RODRIGUES DE OLIVEIRA', '10'),
  ('742', 'FELIPE DE ABREU LADEIA', '10'),
  ('795', 'THIAGO DE MORAES SOUZA', '10'),
  ('859', 'VITOR FERREIRA DE ANDRADE', '10'),
  ('871', 'LUCAS CORREA DOS SANTOS', '10'),
  ('1200', 'DIOGO SANTOS DE OLIVEIRA', '10'),
  ('1248', 'ADALBERTO BEZERRA LINO', '10'),
  ('1323', 'GUILHERME GONCALVES DOS SANTOS', '10'),
  ('1388', 'WISNEY DOUGLAS ROCHA LOPES', '10'),
  ('1398', 'ALEXANDRE FRANÇA COSTA', '10')
)
SELECT t.lote, t.matricula, c.nome, c.ativo, c.dispensado, c.data_dispensa, c.motivo_dispensa, c.fonte_dp,
       c.situacao_vinculo, c.synergy_synced_at,
       (SELECT count(*) FROM public.historico_dispensas h
         WHERE h.colaborador_id::text = c.id::text AND h.registrado_por = 'Carga SQL RH') AS historico_carga,
       (SELECT count(*) FROM public.historico_dispensas h
         WHERE h.colaborador_id::text = c.id::text) AS historico_total,
       (SELECT count(*) FROM public.rh_colaborador_eventos e
         WHERE e.colaborador_id::text = c.id::text AND e.origem_ref LIKE 'desligamento_sql:%') AS eventos_carga
FROM t
LEFT JOIN public.colaboradores c
  ON ltrim(regexp_replace(coalesce(c.re, ''), '\D', '', 'g'), '0') = ltrim(t.matricula, '0')
 AND upper(btrim(c.nome)) = upper(btrim(t.nome))
ORDER BY t.lote DESC, t.matricula::int;
