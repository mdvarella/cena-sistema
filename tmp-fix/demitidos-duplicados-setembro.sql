-- DUPLICADOS — CONSULTA SOMENTE LEITURA. Não grava nada.
-- Lista todo cadastro que bate com a linha da planilha por RE, por nome ou por CPF (bro),
-- para escolher qual cadastro deve receber o desligamento.
WITH t(matricula, nome, cpf, data_planilha) AS (VALUES
  ('610', 'ELVIS GUILHERME PEREIRA', '49971502828', '14/09/2026'),
  ('1690', 'PAULO HENRIQUE FERREIRA UZEDA', '42756578886', '08/09/2026')
)
SELECT t.matricula AS mat_planilha, t.nome AS nome_planilha, t.data_planilha,
       concat_ws(' + ',
         CASE WHEN ltrim(regexp_replace(coalesce(c.re, ''), '\D', '', 'g'), '0') = ltrim(t.matricula, '0') THEN 'RE' END,
         CASE WHEN upper(btrim(c.nome)) = upper(btrim(t.nome)) THEN 'NOME' END,
         CASE WHEN coalesce(c.bro, '') !~ '[A-Za-z]'
                   AND lpad(regexp_replace(coalesce(c.bro, ''), '\D', '', 'g'), 11, '0') = t.cpf THEN 'CPF' END
       ) AS bate_por,
       c.id, c.nome, c.re, c.bro, c.ativo, c.dispensado, c.data_dispensa, c.motivo_dispensa,
       c.contrato_id, c.equipe_id, c.cargo, c.fonte_dp, c.situacao_vinculo, c.synergy_synced_at,
       (SELECT count(*) FROM public.historico_dispensas h WHERE h.colaborador_id::text = c.id::text) AS historico_total,
       (SELECT count(*) FROM public.rh_colaborador_eventos e WHERE e.colaborador_id::text = c.id::text) AS eventos_total
FROM t
JOIN public.colaboradores c
  ON ltrim(regexp_replace(coalesce(c.re, ''), '\D', '', 'g'), '0') = ltrim(t.matricula, '0')
  OR upper(btrim(c.nome)) = upper(btrim(t.nome))
  OR (coalesce(c.bro, '') !~ '[A-Za-z]'
      AND lpad(regexp_replace(coalesce(c.bro, ''), '\D', '', 'g'), 11, '0') = t.cpf)
ORDER BY t.matricula::int, c.ativo DESC, c.nome;
