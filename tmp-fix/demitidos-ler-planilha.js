// Lê a planilha de demitidos do RH e gera a consulta SOMENTE LEITURA de conferência contra colaboradores.
// Uso: node tmp-fix/demitidos-ler-planilha.js "<caminho.xlsx>"
// Saída: tmp-fix/demitidos-conferencia.sql (não versionado; contém CPF).
const fs = require('fs');
const path = require('path');
const XLSX = require(path.join(process.env.TEMP, 'cena-lms-parse', 'node_modules', 'xlsx'));

const arq = process.argv[2];
const wb = XLSX.readFile(arq, { cellDates: true });
const ws = wb.Sheets[wb.SheetNames[0]];
const linhas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
const iCab = linhas.findIndex(r => r.some(c => norm(c) === 'MATRICULA'));
if (iCab < 0) throw new Error('cabeçalho com "Matrícula" não encontrado');
const cab = linhas[iCab].map(norm);
const col = nome => { const i = cab.findIndex(c => c.startsWith(nome)); if (i < 0) throw new Error('coluna ausente: ' + nome); return i; };
const cMat = col('MATRICULA'), cNome = col('FUNCIONARIO'), cCpf = col('CPF'), cDem = col('DATA DESLIG'), cStatus = col('STATUS');

const data = v => {
  if (v instanceof Date) return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const m = String(v || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const q = s => "'" + String(s).replace(/'/g, "''") + "'";

const itens = [], problemas = [];
linhas.slice(iCab + 1).forEach((r, k) => {
  if (!r || r.every(c => c == null || String(c).trim() === '')) return;
  const mat = String(r[cMat] ?? '').replace(/\D/g, '');
  const nome = String(r[cNome] ?? '').trim();
  let cpf = String(r[cCpf] ?? '').replace(/\D/g, '');
  if (cpf.length >= 9 && cpf.length < 11) cpf = cpf.padStart(11, '0');
  const dem = data(r[cDem]);
  const linha = iCab + 2 + k;
  if (!mat || !nome || cpf.length !== 11 || !dem) problemas.push({ linha, mat, nome, cpf_digitos: cpf.length, dem });
  itens.push({ linha, mat, nome, cpf, dem, status: String(r[cStatus] ?? '').trim() });
});

const repetidas = Object.entries(itens.reduce((m, i) => (m[i.mat] = (m[i.mat] || 0) + 1, m), {})).filter(([, n]) => n > 1);
const sql = `-- Conferência SOMENTE LEITURA: ${path.basename(arq)} (${itens.length} linhas) × public.colaboradores
WITH lista (linha, matricula, nome_lista, cpf, data_lista) AS (
  VALUES
${itens.map(i => `  (${i.linha}, ${q(i.mat)}, ${q(i.nome)}, ${q(i.cpf)}, ${i.dem ? `DATE ${q(i.dem)}` : 'NULL::date'})`).join(',\n')}
),
cand AS (
  SELECT l.*, c.id, c.nome, c.re, c.ativo, c.dispensado, c.data_dispensa, c.motivo_dispensa,
         CASE WHEN coalesce(c.bro, '') ~ '[A-Za-z]' THEN NULL
              ELSE nullif(lpad(regexp_replace(coalesce(c.bro, ''), '\\D', '', 'g'), 11, '0'), '00000000000')
         END AS cpf_cena
  FROM lista l
  LEFT JOIN public.colaboradores c
    ON regexp_replace(coalesce(c.bro, ''), '\\D', '', 'g') = l.cpf
    OR ltrim(regexp_replace(coalesce(c.re, ''), '\\D', '', 'g'), '0') = ltrim(l.matricula, '0')
    OR btrim(coalesce(c.synergy_matricula, '')) = l.matricula
)
SELECT linha, matricula, nome_lista, id, nome AS nome_cena, re,
       cpf_cena = cpf                                   AS bate_cpf,
       cpf_cena IS NOT NULL AND cpf_cena <> cpf         AS cpf_de_outra_pessoa,
       ltrim(regexp_replace(coalesce(re, ''), '\\D', '', 'g'), '0') = ltrim(matricula, '0') AS bate_re,
       ativo, dispensado, data_dispensa, data_lista,
       data_dispensa IS NOT DISTINCT FROM data_lista    AS mesma_data,
       motivo_dispensa
FROM cand
ORDER BY linha, id;
`;
fs.writeFileSync(path.join(__dirname, 'demitidos-conferencia.sql'), sql);
console.log(JSON.stringify({
  aba: wb.SheetNames[0], cabecalho_linha: iCab + 1, linhas: itens.length,
  status: itens.reduce((m, i) => (m[i.status] = (m[i.status] || 0) + 1, m), {}),
  datas: { min: itens.map(i => i.dem).filter(Boolean).sort()[0], max: itens.map(i => i.dem).filter(Boolean).sort().pop() },
  matriculas_repetidas: repetidas, problemas
}, null, 1));
