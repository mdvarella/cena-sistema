-- ADMITIDOS — CONFERÊNCIA SOMENTE LEITURA — aDMINTIDOS sETEMBRO.xlsx — 33 linhas. Não grava nada.
-- Para cada linha da planilha: quantos cadastros batem por RE, por CPF (bro) e por nome, e quais são.
WITH t(matricula, nome, cpf, cargo, centro_custo, data_admissao) AS (VALUES
  ('1989', 'ROMARIO DE CASTRO MARQUES DOS SANTOS', '37905833836', 'ELETRICISTA I', 'TMA OESTE', DATE '2026-09-14'),
  ('1990', 'LUCIO SIMPLICIO DE ARAUJO', '27046767807', 'ELETRICISTA I', 'TMA OESTE', DATE '2026-09-14'),
  ('1991', 'MICHAEL DURIA BONFATI', '37812462803', 'ELETRICISTA I', 'TMA OESTE', DATE '2026-09-15'),
  ('1992', 'GUSTAVO HENRIQUE EVARISTO RIBEIRO', '54502414883', 'AUXILIAR ADMINISTRATIVO', 'RDSC', DATE '2026-09-16'),
  ('1993', 'MAURICIO FRANCISCO DORNELLES', '10172557844', 'ELETRICISTA I', 'TMA OESTE', DATE '2026-09-21'),
  ('1994', 'ALDO JUSTINO DOS SANTOS', '32967539821', 'ENCARREGADO DE LINHA VIVA', 'SOT OBRAS', DATE '2026-09-23'),
  ('1995', 'RODRIGO SANTANA DOS SANTOS JUNIOR', '48135271832', 'ELETRICISTA I', 'SOT OBRAS', DATE '2026-09-23'),
  ('1996', 'GABRIEL DOS SANTOS', '47036933801', 'ELETRICISTA I', 'TMA OESTE', DATE '2026-09-23'),
  ('1997', 'ALBERTO VIEIRA DA PAZ', '18240345808', 'AJUDANTE GERAL', 'ADM', DATE '2026-09-28'),
  ('1998', 'DANUBIA TEIXEIRA BORGES SILVA', '33059317879', 'ASSISTENTE ADMINISTRATIVO JUNIOR', 'ADM', DATE '2026-10-01'),
  ('1999', 'ALINE LIMEIRA LIMA', '34385508810', 'ASSISTENTE ADMINISTRATIVO JUNIOR', 'ADM', DATE '2026-10-01'),
  ('2008', 'FRANCISCO SILVESTRE DA SILVA NETO', '13975357410', 'AJUDANTE GERAL', 'COMGAS CAMPINAS', DATE '2026-10-05'),
  ('2009', 'RAFAEL MANOEL DO NASCIMENTO', '13568261480', 'AJUDANTE GERAL', 'COMGAS CAMPINAS', DATE '2026-10-05'),
  ('2010', 'JOSENILTON SANTOS DE JESUS', '03454248590', 'AJUDANTE GERAL', 'COMGAS CAMPINAS', DATE '2026-10-05'),
  ('2011', 'JEOVA DE JESUS SANTANA LOPES', '63460817305', 'AJUDANTE GERAL', 'COMGAS CAMPINAS', DATE '2026-10-05'),
  ('2012', 'TIAGO BATISTA DOS SANTOS', '35764853842', 'INSTALADOR', 'COMGAS CAMPINAS', DATE '2026-10-05'),
  ('2013', 'FRANCISCO DE ASSIS DA SILVA', '23189190895', 'INSTALADOR', 'COMGAS CAMPINAS', DATE '2026-10-05'),
  ('2014', 'EDILSON ALVES BEZERRA', '04037718111', 'PEDREIRO', 'COMGAS CAMPINAS', DATE '2026-10-05'),
  ('2015', 'GENESIO RAEL DE RAMOS', '50150685149', 'OPERADOR DE GUINDAUTO JUNIOR', 'COMGAS CAMPINAS', DATE '2026-10-05'),
  ('2016', 'ANTONIO LIMA DA COSTA', '84369450349', 'ENCARREGADO GERAL JUNIOR', 'COMGAS CAMPINAS', DATE '2026-10-05'),
  ('2017', 'ALEXANDRE AGUIAR BRUNO', '30217619843', 'ELETRICISTA I', 'TMA OESTE', DATE '2026-10-05'),
  ('2018', 'LUIZ ROBERTO GUANABARA DOS SANTOS', '31996166824', 'ELETRICISTA', 'BT0', DATE '2026-10-05'),
  ('2019', 'MATEUS MARTINS BEZERRA', '51322837805', 'ELETRICISTA', 'BT0', DATE '2026-10-05'),
  ('2020', 'DAVID MOREIRA', '40250390876', 'ELETRICISTA II', 'TMA OESTE', DATE '2026-10-05'),
  ('2021', 'LUIZ ROBERTO IGNACIO JUNIOR', '26330278814', 'ELETRICISTA II', 'TMA OESTE', DATE '2026-10-05'),
  ('2022', 'WILLIAN DOS SANTOS', '42732091871', 'ELETRICISTA II', 'TMA OESTE', DATE '2026-10-05'),
  ('2023', 'WILLIAM BARBOSA LIMA', '34376102873', 'MEIO OFICIAL DE ALMOXARIFE', 'SOT OBRAS', DATE '2026-10-05'),
  ('2024', 'THAIRONE DE JESUS SOUZA', '11559600500', 'ELETRICISTA', 'BT0', DATE '2026-10-06'),
  ('2025', 'PAULO EDUARDO ROSA', '11115868888', 'MEIO OFICIAL DE ALMOXARIFE', 'SOT OBRAS', DATE '2026-10-06'),
  ('2026', 'KLEBER CERQUEIRA', '28225094840', 'ENCARREGADO DE ALMOXARIFADO JR', 'RDSE', DATE '2026-10-07'),
  ('2027', 'DIEGO ALEXANDRE DA SILVA', '34040910869', 'MEIO OFICIAL DE ALMOXARIFE', 'RDSE', DATE '2026-10-07'),
  ('2028', 'WELLINGTON PEREIRA DO NASCIMENTO', '60919668801', 'AJUDANTE GERAL', 'ADM', DATE '2026-10-07'),
  ('2029', 'WALEFER MOURA CELESTINO', '41635580803', 'SUPERVISOR DE OBRAS JUNIOR', 'RDSC', DATE '2026-10-07')
),
cand AS (
  SELECT t.matricula, c.id, c.nome, c.re, c.bro, c.ativo, c.dispensado, c.contrato_id, c.cargo,
         ltrim(regexp_replace(coalesce(c.re, ''), '\D', '', 'g'), '0') = ltrim(t.matricula, '0') AS por_re,
         (coalesce(c.bro, '') !~ '[A-Za-z]'
          AND lpad(regexp_replace(coalesce(c.bro, ''), '\D', '', 'g'), 11, '0') = t.cpf) AS por_cpf,
         upper(btrim(c.nome)) = upper(btrim(t.nome)) AS por_nome
  FROM t
  JOIN public.colaboradores c
    ON ltrim(regexp_replace(coalesce(c.re, ''), '\D', '', 'g'), '0') = ltrim(t.matricula, '0')
    OR (coalesce(c.bro, '') !~ '[A-Za-z]'
        AND lpad(regexp_replace(coalesce(c.bro, ''), '\D', '', 'g'), 11, '0') = t.cpf)
    OR upper(btrim(c.nome)) = upper(btrim(t.nome))
)
SELECT t.matricula, t.nome, t.centro_custo, t.cargo, t.data_admissao,
       count(k.id) FILTER (WHERE k.por_re)   AS n_re,
       count(k.id) FILTER (WHERE k.por_cpf)  AS n_cpf,
       count(k.id) FILTER (WHERE k.por_nome) AS n_nome,
       CASE
         WHEN count(k.id) = 0 THEN 'NÃO CADASTRADO'
         WHEN count(k.id) = 1 AND bool_and(k.por_re AND k.por_cpf AND k.por_nome) THEN 'JÁ CADASTRADO (RE + CPF + NOME)'
         ELSE 'CONFERIR'
       END AS situacao,
       string_agg(format('%s | %s | RE %s | ativo=%s dispensado=%s | contrato %s | %s | bate:%s%s%s',
                         k.id, k.nome, coalesce(k.re, '-'), k.ativo, k.dispensado, coalesce(k.contrato_id::text, '-'),
                         coalesce(k.cargo, '-'),
                         CASE WHEN k.por_re THEN ' RE' ELSE '' END,
                         CASE WHEN k.por_cpf THEN ' CPF' ELSE '' END,
                         CASE WHEN k.por_nome THEN ' NOME' ELSE '' END), E'\n') AS cadastros_cena
FROM t
LEFT JOIN cand k ON k.matricula = t.matricula
GROUP BY t.matricula, t.nome, t.centro_custo, t.cargo, t.data_admissao
ORDER BY t.matricula::int;
