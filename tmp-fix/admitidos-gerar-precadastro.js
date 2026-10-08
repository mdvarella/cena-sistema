// Gera o SQL de PRÉ-CADASTRO dos admitidos da planilha do RH (nenhum existe no CENA — conferência de 07/10/2026).
// Uso: node tmp-fix/admitidos-gerar-precadastro.js "<caminho.xlsx>" <saida.sql>  (saída não versionada, contém CPF)
// Campos gravados = rhSynCriarColaboradorDaLinha (index.html): ativo=false, situacao_vinculo='pre_admissao',
// sem contrato/base/equipe (RH_SYN_CAMPOS_BLOQUEADOS). RE = matrícula (aprovado pelo usuário em 07/10/2026).
// Trava: aborta tudo se faltar coluna ou se CPF, RE ou matrícula Synergy já existirem no CENA.
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
    mat: String(r[cMat]).replace(/\D/g, '').replace(/^0+/, ''),
    nome: String(r[cNome]).trim().replace(/\s+/g, ' '),
    cpf: String(r[cCpf]).replace(/\D/g, '').padStart(11, '0'),
    cargo: String(r[cCargo]).trim().replace(/\s+/g, ' '),
    adm: data(r[cAdm]),
  }));
if (itens.some(i => !i.mat || !i.nome || !i.adm || i.cpf.length !== 11)) throw new Error('linha sem matrícula, nome, data ou CPF válido');
for (const k of ['mat', 'cpf']) {
  const vistos = new Set();
  for (const i of itens) { if (vistos.has(i[k])) throw new Error(`${k} repetido na planilha: ${i[k]}`); vistos.add(i[k]); }
}
const N = itens.length;
const origem = path.basename(arq).replace(/'/g, "''");
const valores = itens.map(i =>
  `      (${q(i.mat)}, ${q(i.nome)}, ${q(i.cpf)}, ${q(i.cargo)}, ${q(i.cc)}, DATE ${q(i.adm)})`).join(',\n');
const cte = `WITH t(matricula, nome, cpf, cargo, centro_custo, data_admissao) AS (VALUES\n${valores}\n    )`;

const sql = `-- PRÉ-CADASTRO DE ADMITIDOS — ${origem} — ${N} colaboradores (nenhum existia no CENA na conferência de 07/10/2026)
-- Igual ao pré-cadastro do sistema (importação RH): ativo = false, situação "pré-admissão", sem contrato/base/equipe.
-- RE = matrícula. CPF gravado só com dígitos. O RH completa contrato/equipe e ativa pelo sistema.
-- Rodar o arquivo INTEIRO (sem texto selecionado). O bloco DO é atômico: grava tudo ou nada.

DO $$
DECLARE
  v_faltando text;
  v_erros text;
  v_n integer;
BEGIN
  SELECT string_agg(x.coluna, ', ')
    INTO v_faltando
  FROM unnest(ARRAY['nome', 're', 'bro', 'cargo', 'ativo', 'dispensado', 'synergy_matricula', 'admissao',
                    'fonte_dp', 'synergy_synced_at', 'situacao_vinculo', 'situacao_inicio', 'vinculo_ref']) AS x(coluna)
  WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns ic
                    WHERE ic.table_schema = 'public' AND ic.table_name = 'colaboradores' AND ic.column_name = x.coluna);
  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION 'PRÉ-CADASTRO CANCELADO — nada foi gravado: faltam colunas em colaboradores: %', v_faltando;
  END IF;

  ${cte}
  SELECT string_agg(format('Matrícula %s - %s: já existe no CENA por %s', t.matricula, t.nome, x.motivo), E'\\n')
    INTO v_erros
  FROM t
  CROSS JOIN LATERAL (
    SELECT concat_ws(' + ',
             CASE WHEN EXISTS (SELECT 1 FROM public.colaboradores c
                               WHERE coalesce(c.bro, '') !~ '[A-Za-z]'
                                 AND lpad(regexp_replace(coalesce(c.bro, ''), '\\D', '', 'g'), 11, '0') = t.cpf) THEN 'CPF' END,
             CASE WHEN EXISTS (SELECT 1 FROM public.colaboradores c
                               WHERE ltrim(regexp_replace(coalesce(c.re, ''), '\\D', '', 'g'), '0') = t.matricula) THEN 'RE' END,
             CASE WHEN EXISTS (SELECT 1 FROM public.colaboradores c
                               WHERE upper(regexp_replace(coalesce(c.synergy_matricula::text, ''), '\\s', '', 'g')) = t.matricula) THEN 'MATRÍCULA SYNERGY' END
           ) AS motivo
  ) x
  WHERE x.motivo <> '';
  IF v_erros IS NOT NULL THEN
    RAISE EXCEPTION E'PRÉ-CADASTRO CANCELADO — nada foi gravado:\\n%', v_erros;
  END IF;

  ${cte}
  INSERT INTO public.colaboradores
    (nome, bro, re, cargo, ativo, dispensado, synergy_matricula, admissao, fonte_dp, synergy_synced_at,
     situacao_vinculo, situacao_inicio, vinculo_ref)
  SELECT t.nome, t.cpf, t.matricula, t.cargo, false, false, t.matricula, t.data_admissao, 'import_planilha', now(),
         'pre_admissao', t.data_admissao, gen_random_uuid()
  FROM t;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> ${N} THEN
    RAISE EXCEPTION 'PRÉ-CADASTRO CANCELADO: % cadastros criados, esperado ${N}', v_n;
  END IF;

  IF to_regclass('public.rh_colaborador_eventos') IS NOT NULL THEN
    ${cte}
    INSERT INTO public.rh_colaborador_eventos
      (colaborador_id, vinculo_ref, tipo, situacao, inicio, cargo, motivo, fonte,
       origem_modulo, origem_ref, payload, criado_por)
    SELECT c.id, c.vinculo_ref, 'pre_admissao', 'pre_admissao', t.data_admissao, t.cargo,
           'Pré-cadastro conforme relatório RH de admitidos', 'import', 'rh_sql',
           'admissao_sql:' || t.matricula || ':' || t.data_admissao::text,
           jsonb_build_object('matricula', t.matricula, 'admissao', t.data_admissao, 'centro_custo', t.centro_custo,
                              'origem', 'Relatório RH ${origem}'),
           'Carga SQL RH'
    FROM t
    JOIN public.colaboradores c
      ON ltrim(regexp_replace(coalesce(c.re, ''), '\\D', '', 'g'), '0') = t.matricula
     AND c.bro = t.cpf
     AND c.situacao_vinculo = 'pre_admissao'
    WHERE NOT EXISTS (SELECT 1 FROM public.rh_colaborador_eventos e
                      WHERE e.colaborador_id::text = c.id::text AND e.tipo = 'pre_admissao'
                        AND e.origem_ref = 'admissao_sql:' || t.matricula || ':' || t.data_admissao::text
                        AND e.anulado_em IS NULL);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> ${N} THEN
      RAISE EXCEPTION 'PRÉ-CADASTRO CANCELADO: % eventos criados, esperado ${N}', v_n;
    END IF;
  END IF;
END $$;

-- Conferência (somente leitura, pode rodar sozinha): deve listar ${N} linhas, todas com ativo = false e situacao_vinculo = pre_admissao
WITH t(matricula, centro_custo) AS (VALUES
${itens.map(i => `  (${q(i.mat)}, ${q(i.cc)})`).join(',\n')}
)
SELECT t.matricula, t.centro_custo, c.id, c.nome, c.re, c.cargo, c.ativo, c.dispensado, c.admissao,
       c.situacao_vinculo, c.contrato_id
FROM t
LEFT JOIN public.colaboradores c
  ON ltrim(regexp_replace(coalesce(c.re, ''), '\\D', '', 'g'), '0') = t.matricula
ORDER BY t.matricula::int;
`;
fs.writeFileSync(saida, sql);
console.log(`${saida}: ${N} pré-cadastros`);
