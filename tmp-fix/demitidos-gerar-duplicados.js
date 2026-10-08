// Gera consulta SOMENTE LEITURA dos cadastros candidatos para matrículas com duplicidade no CENA.
// Uso: node tmp-fix/demitidos-gerar-duplicados.js "<caminho.xlsx>" <saida.sql> <mat1,mat2,...>  (saída não versionada, contém CPF)
const fs = require('fs');
const path = require('path');
const XLSX = require(path.join(process.env.TEMP, 'cena-lms-parse', 'node_modules', 'xlsx'));

const [arq, saida, matsArg] = process.argv.slice(2);
const mats = new Set(String(matsArg || '').split(',').map(s => s.trim()).filter(Boolean));
const wb = XLSX.readFile(arq, { cellDates: true });
const linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
const iCab = linhas.findIndex(r => r.some(c => norm(c) === 'MATRICULA'));
const cab = linhas[iCab].map(norm);
const col = n => cab.findIndex(c => c.startsWith(n));
const [cMat, cNome, cCpf, cDem] = ['MATRICULA', 'FUNCIONARIO', 'CPF', 'DATA DESLIG'].map(col);
const data = v => v instanceof Date
  ? new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  : String(v || '');
const q = s => "'" + String(s).replace(/'/g, "''") + "'";
const itens = linhas.slice(iCab + 1)
  .filter(r => r && r[cMat] != null && mats.has(String(r[cMat]).replace(/\D/g, '')))
  .map(r => ({
    mat: String(r[cMat]).replace(/\D/g, ''),
    nome: String(r[cNome]).trim(),
    cpf: String(r[cCpf]).replace(/\D/g, '').padStart(11, '0'),
    dem: data(r[cDem]),
  }));
if (itens.length !== mats.size) throw new Error('matrículas não encontradas na planilha');

const sql = `-- DUPLICADOS — CONSULTA SOMENTE LEITURA. Não grava nada.
-- Lista todo cadastro que bate com a linha da planilha por RE, por nome ou por CPF (bro),
-- para escolher qual cadastro deve receber o desligamento.
WITH t(matricula, nome, cpf, data_planilha) AS (VALUES
${itens.map(i => `  (${q(i.mat)}, ${q(i.nome)}, ${q(i.cpf)}, ${q(i.dem)})`).join(',\n')}
)
SELECT t.matricula AS mat_planilha, t.nome AS nome_planilha, t.data_planilha,
       concat_ws(' + ',
         CASE WHEN ltrim(regexp_replace(coalesce(c.re, ''), '\\D', '', 'g'), '0') = ltrim(t.matricula, '0') THEN 'RE' END,
         CASE WHEN upper(btrim(c.nome)) = upper(btrim(t.nome)) THEN 'NOME' END,
         CASE WHEN coalesce(c.bro, '') !~ '[A-Za-z]'
                   AND lpad(regexp_replace(coalesce(c.bro, ''), '\\D', '', 'g'), 11, '0') = t.cpf THEN 'CPF' END
       ) AS bate_por,
       c.id, c.nome, c.re, c.bro, c.ativo, c.dispensado, c.data_dispensa, c.motivo_dispensa,
       c.contrato_id, c.equipe_id, c.cargo, c.fonte_dp, c.situacao_vinculo, c.synergy_synced_at,
       (SELECT count(*) FROM public.historico_dispensas h WHERE h.colaborador_id::text = c.id::text) AS historico_total,
       (SELECT count(*) FROM public.rh_colaborador_eventos e WHERE e.colaborador_id::text = c.id::text) AS eventos_total
FROM t
JOIN public.colaboradores c
  ON ltrim(regexp_replace(coalesce(c.re, ''), '\\D', '', 'g'), '0') = ltrim(t.matricula, '0')
  OR upper(btrim(c.nome)) = upper(btrim(t.nome))
  OR (coalesce(c.bro, '') !~ '[A-Za-z]'
      AND lpad(regexp_replace(coalesce(c.bro, ''), '\\D', '', 'g'), 11, '0') = t.cpf)
ORDER BY t.matricula::int, c.ativo DESC, c.nome;
`;
fs.writeFileSync(saida, sql);
console.log(`${saida}: ${itens.length} matrículas`);
