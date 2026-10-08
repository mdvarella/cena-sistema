// Gera conferência SOMENTE LEITURA da planilha de admitidos do RH contra public.colaboradores.
// Uso: node tmp-fix/admitidos-ler-planilha.js "<caminho.xlsx>" <saida.sql>  (saída não versionada, contém CPF)
const fs = require('fs');
const path = require('path');
const XLSX = require(path.join(process.env.TEMP, 'cena-lms-parse', 'node_modules', 'xlsx'));

const [arq, saida] = process.argv.slice(2);
const wb = XLSX.readFile(arq, { cellDates: true });
const linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
const iCab = linhas.findIndex(r => r.some(c => norm(c) === 'MATRICULA'));
const cab = linhas[iCab].map(norm);
const col = n => cab.findIndex(c => c.startsWith(n));
const [cCc, cMat, cNome, cCpf, cCargo, cAdm] = ['CENTRO DE CUSTO', 'MATRICULA', 'FUNCIONARIO', 'CPF', 'CARGO', 'DATA ADMISSAO'].map(col);
if ([cCc, cMat, cNome, cCpf, cCargo, cAdm].some(i => i < 0)) throw new Error('cabeçalho inesperado: ' + cab.join(' | '));
const data = s => (String(s).match(/^(\d{2})\/(\d{2})\/(\d{4})$/) || []).slice(1).reverse().join('-');
const q = s => "'" + String(s).replace(/'/g, "''") + "'";

const itens = linhas.slice(iCab + 1)
  .filter(r => r && String(r[cMat]).trim())
  .map(r => ({
    cc: String(r[cCc]).trim(),
    mat: String(r[cMat]).replace(/\D/g, ''),
    nome: String(r[cNome]).trim().replace(/\s+/g, ' '),
    cpf: String(r[cCpf]).replace(/\D/g, '').padStart(11, '0'),
    cargo: String(r[cCargo]).trim(),
    adm: data(r[cAdm]),
  }));
if (itens.some(i => !i.adm || i.cpf.length !== 11)) throw new Error('linha sem data ou CPF válido');

const sql = `-- ADMITIDOS — CONFERÊNCIA SOMENTE LEITURA — ${path.basename(arq)} — ${itens.length} linhas. Não grava nada.
-- Para cada linha da planilha: quantos cadastros batem por RE, por CPF (bro) e por nome, e quais são.
WITH t(matricula, nome, cpf, cargo, centro_custo, data_admissao) AS (VALUES
${itens.map(i => `  (${q(i.mat)}, ${q(i.nome)}, ${q(i.cpf)}, ${q(i.cargo)}, ${q(i.cc)}, DATE ${q(i.adm)})`).join(',\n')}
),
cand AS (
  SELECT t.matricula, c.id, c.nome, c.re, c.bro, c.ativo, c.dispensado, c.contrato_id, c.cargo,
         ltrim(regexp_replace(coalesce(c.re, ''), '\\D', '', 'g'), '0') = ltrim(t.matricula, '0') AS por_re,
         (coalesce(c.bro, '') !~ '[A-Za-z]'
          AND lpad(regexp_replace(coalesce(c.bro, ''), '\\D', '', 'g'), 11, '0') = t.cpf) AS por_cpf,
         upper(btrim(c.nome)) = upper(btrim(t.nome)) AS por_nome
  FROM t
  JOIN public.colaboradores c
    ON ltrim(regexp_replace(coalesce(c.re, ''), '\\D', '', 'g'), '0') = ltrim(t.matricula, '0')
    OR (coalesce(c.bro, '') !~ '[A-Za-z]'
        AND lpad(regexp_replace(coalesce(c.bro, ''), '\\D', '', 'g'), 11, '0') = t.cpf)
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
                         CASE WHEN k.por_nome THEN ' NOME' ELSE '' END), E'\\n') AS cadastros_cena
FROM t
LEFT JOIN cand k ON k.matricula = t.matricula
GROUP BY t.matricula, t.nome, t.centro_custo, t.cargo, t.data_admissao
ORDER BY t.matricula::int;
`;
fs.writeFileSync(saida, sql);
console.log(`${saida}: ${itens.length} linhas`);
