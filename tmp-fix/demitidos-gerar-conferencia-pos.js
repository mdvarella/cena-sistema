// Gera conferência SOMENTE LEITURA do estado dos colaboradores dos scripts de desligamento de setembro.
// Uso: node tmp-fix/demitidos-gerar-conferencia-pos.js  (saída não versionada)
const fs = require('fs');
const lista = (f, lote) => {
  const s = fs.readFileSync(f, 'utf8');
  const linhas = s.slice(s.indexOf('WITH t(matricula, nome) AS (VALUES')).split('\n').slice(1);
  const out = [];
  for (const l of linhas) {
    if (l.startsWith(')')) break;
    out.push(l.replace(/,\s*$/, '').replace(/\)$/, `, '${lote}')`));
  }
  return out;
};
const vals = [
  ...lista('tmp-fix/demitidos-desligar-setembro-40.sql', '40'),
  ...lista('tmp-fix/demitidos-desligar-setembro-10-re-nome.sql', '10'),
];
const sql = `-- CONFERÊNCIA SOMENTE LEITURA — desligamentos setembro (40 + 10). Não grava nada.
-- historico_carga / eventos_carga > 0 indicam que o script de desligamento SQL já foi aplicado.
WITH t(matricula, nome, lote) AS (VALUES
${vals.join(',\n')}
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
  ON ltrim(regexp_replace(coalesce(c.re, ''), '\\D', '', 'g'), '0') = ltrim(t.matricula, '0')
 AND upper(btrim(c.nome)) = upper(btrim(t.nome))
ORDER BY t.lote DESC, t.matricula::int;
`;
fs.writeFileSync('tmp-fix/demitidos-conferencia-pos-setembro.sql', sql);
console.log(`tmp-fix/demitidos-conferencia-pos-setembro.sql: ${vals.length} linhas`);
