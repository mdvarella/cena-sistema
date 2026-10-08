// Gera o SQL de desligamento a partir da planilha do RH, só para as matrículas aprovadas na conferência.
// Uso: node tmp-fix/demitidos-gerar-desligamento.js "<caminho.xlsx>" <saida.sql> <mat1,mat2,...> [--re-nome]
// Trava na execução: cada linha precisa achar EXATAMENTE 1 colaborador com RE = matrícula, CPF (bro) = CPF da
// lista, mesmo nome, ativo e não dispensado. Qualquer divergência aborta tudo antes de gravar.
// --re-nome (aprovado pelo usuário para CPF divergente no cadastro): RE + nome exato, ativo, não dispensado, e o
// CPF da lista não pode estar no cadastro de outra pessoa. O CPF do cadastro não é alterado.
// Campos gravados = rhSynRegistrarDesligamentoCadastro (index.html). Saída não versionada (contém CPF).
const fs = require('fs');
const path = require('path');
const XLSX = require(path.join(process.env.TEMP, 'cena-lms-parse', 'node_modules', 'xlsx'));

const [arq, saida, matsArg, modo] = process.argv.slice(2);
const reNome = modo === '--re-nome';
const cpfDe = a => `lpad(regexp_replace(coalesce(${a}.bro, ''), '\\D', '', 'g'), 11, '0')`;
const chave = (c, t) => [
  `ltrim(regexp_replace(coalesce(${c}.re, ''), '\\D', '', 'g'), '0') = ltrim(${t}.matricula, '0')`,
  `upper(btrim(${c}.nome)) = upper(btrim(${t}.nome))`,
  reNome
    ? `NOT EXISTS (SELECT 1 FROM public.colaboradores o WHERE o.id <> ${c}.id AND coalesce(o.bro, '') !~ '[A-Za-z]' AND ${cpfDe('o')} = ${t}.cpf)`
    : `coalesce(${c}.bro, '') !~ '[A-Za-z]' AND ${cpfDe(c)} = ${t}.cpf`,
].join('\n      AND ');
const aprovadas = new Set(String(matsArg || '').split(',').map(s => s.trim()).filter(Boolean));
const wb = XLSX.readFile(arq, { cellDates: true });
const linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
const iCab = linhas.findIndex(r => r.some(c => norm(c) === 'MATRICULA'));
const cab = linhas[iCab].map(norm);
const col = n => cab.findIndex(c => c.startsWith(n));
const [cMat, cNome, cCpf, cDem] = ['MATRICULA', 'FUNCIONARIO', 'CPF', 'DATA DESLIG'].map(col);
const data = v => v instanceof Date
  ? new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  : (String(v || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/) || []).slice(1).reverse().join('-') || null;
const q = s => "'" + String(s).replace(/'/g, "''") + "'";

const itens = linhas.slice(iCab + 1)
  .filter(r => r && r[cMat] != null)
  .map(r => ({
    mat: String(r[cMat]).replace(/\D/g, ''),
    nome: String(r[cNome]).trim(),
    cpf: String(r[cCpf]).replace(/\D/g, '').padStart(11, '0'),
    dem: data(r[cDem]),
  }))
  .filter(i => aprovadas.has(i.mat));
const faltando = [...aprovadas].filter(m => !itens.some(i => i.mat === m));
if (faltando.length) throw new Error('matrículas não encontradas na planilha: ' + faltando.join(','));
if (itens.some(i => !i.dem || i.cpf.length !== 11)) throw new Error('linha sem data ou CPF válido');
const N = itens.length;
const origem = path.basename(arq);

const sql = `-- DESLIGAMENTOS RH — ${origem} — ${N} colaboradores aprovados na conferência de 07/10/2026
-- Não exclui cadastro. Não altera auth.users nem usuarios_sistema.${reNome ? `
-- Vínculo por RE + nome (CPF do cadastro diverge da lista; aprovado pelo usuário em 07/10/2026).
-- O CPF da lista não pode estar no cadastro de outra pessoa. O CPF do cadastro NÃO é alterado.` : ''}
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
${itens.map(i => `    (${q(i.mat)}, ${q(i.nome)}, ${q(i.cpf)}, DATE ${q(i.dem)})`).join(',\n')};

  SELECT string_agg(format('Matrícula %s - %s: %s cadastro(s) elegível(is)', t.matricula, t.nome, x.total), E'\\n')
    INTO v_erros
  FROM tmp_desl t
  CROSS JOIN LATERAL (
    SELECT count(*) AS total
    FROM public.colaboradores c
    WHERE ${chave('c', 't')}
      AND c.ativo IS TRUE
      AND coalesce(c.dispensado, false) = false
  ) x
  WHERE x.total <> 1;
  IF v_erros IS NOT NULL THEN
    RAISE EXCEPTION E'DESLIGAMENTO CANCELADO — nada foi gravado:\\n%', v_erros;
  END IF;

  CREATE TEMP TABLE tmp_desl_alvos ON COMMIT DROP AS
  SELECT t.*, c.id AS colaborador_id, c.nome AS nome_cena, c.contrato_id, c.equipe_id, c.cargo
  FROM tmp_desl t
  JOIN public.colaboradores c
    ON ${chave('c', 't')}
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
  IF v_n <> ${N} THEN
    RAISE EXCEPTION 'DESLIGAMENTO CANCELADO: % cadastros atualizados, esperado ${N}', v_n;
  END IF;

  INSERT INTO public.historico_dispensas
    (colaborador_id, colaborador_nome, data_dispensa, motivo, obs, registrado_por, contrato_id)
  SELECT a.colaborador_id, a.nome_cena, a.data_desligamento, 'Demitido',
         'Desligamento conforme relatório RH ${origem.replace(/'/g, "''")} (matrícula ' || a.matricula || ')',
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
                              'origem', 'Relatório RH ${origem.replace(/'/g, "''")}'),
           'Carga SQL RH'
    FROM tmp_desl_alvos a
    WHERE NOT EXISTS (SELECT 1 FROM public.rh_colaborador_eventos e
                      WHERE e.colaborador_id::text = a.colaborador_id::text AND e.tipo = 'desligamento'
                        AND e.origem_ref = 'desligamento_sql:' || a.matricula || ':' || a.data_desligamento::text
                        AND e.anulado_em IS NULL);
  END IF;
END $$;

-- Conferência (somente leitura, pode rodar sozinha): deve listar ${N} linhas, todas com ativo = false e dispensado = true
WITH t(matricula, nome) AS (VALUES
${itens.map(i => `  (${q(i.mat)}, ${q(i.nome)})`).join(',\n')}
)
SELECT t.matricula, c.nome, c.re, c.ativo, c.dispensado, c.data_dispensa, c.motivo_dispensa, c.situacao_vinculo
FROM t
JOIN public.colaboradores c
  ON ltrim(regexp_replace(coalesce(c.re, ''), '\\D', '', 'g'), '0') = ltrim(t.matricula, '0')
 AND upper(btrim(c.nome)) = upper(btrim(t.nome))
ORDER BY t.matricula::int;
`;
fs.writeFileSync(saida, sql);
console.log(`${saida}: ${N} colaboradores`);
