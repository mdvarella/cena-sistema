// Modelo LMS para download (aba 📥 LMS): gerado no navegador com o SheetJS; tem de passar no parser real da Edge
// (mesma aba, D1 e cabeçalho) e na pré-checagem do front, sem linha de dado na Planilha1.
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath, pathToFileURL } from 'url';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const XLSX = await import(pathToFileURL(process.env.XLSX_PATH || path.join(raiz, 'supabase', 'functions', '_shared', 'vendor', 'xlsx-0.20.3.mjs')).href);
const P = await import(pathToFileURL(process.env.LMS_PARSER_PATH || path.join(raiz, 'supabase', 'functions', '_shared', 'lms-parser.ts')).href);

const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 400) : '')); }
function fnTexto(nome) {
  const m = new RegExp('\\n(?:async )?function ' + nome + '\\(').exec(html);
  if (!m) throw new Error('função não encontrada: ' + nome);
  const re = /\n(?:async function |function |var |\/\/ ═)/g;
  re.lastIndex = m.index + 12;
  const f = re.exec(html);
  return html.slice(m.index + 1, f ? f.index : undefined);
}
const iConf = html.indexOf('// ETAPA 1.3 — LMS: Confirmação humana do RASCUNHO (Projetos)');
const fim = html.indexOf('\nfunction renderProjetosPorContrato(', iConf);
const blocos = html.slice(iConf, fim);
const semComent = s => s.replace(/\/\/[^\n]*/g, '');

// ── Estáticos ───────────────────────────────────────────────────
const novas = ['projLmsUpModeloWorkbook', 'projLmsUpModeloNome', 'projLmsUpModeloBaixar'].map(fnTexto).join('\n');
ok('ES5 nas funções do modelo', !/\blet\s|\bconst\s|=>|`/.test(semComent(novas)));
ok('modelo usa as mesmas constantes da pré-checagem (aba e cabeçalho)', /PROJ_LMS_UP_CABECALHO\.slice\(\)/.test(novas) && /book_append_sheet\(wb, ws, PROJ_LMS_UP_ABA\)/.test(novas));
ok('modelo não acessa banco, Storage nem Edge', !/sbFetch|sbInsert|sbUpdate|sbRpc|projLmsRpc|fetch\(|sbUpload|storage/i.test(semComent(novas)));
ok('botão no card de envio', /id="proj-lms-up-modelo" onclick="projLmsUpModeloBaixar\(\)">⬇ Baixar modelo LMS \(\.xlsx\)/.test(fnTexto('projLmsUpRender')));
ok('botão só no card de envio (não aparece com envio bloqueado)', (html.match(/projLmsUpModeloBaixar\(/g) || []).length === 2
  && fnTexto('projLmsUpRender').indexOf('proj-lms-up-modelo') > fnTexto('projLmsUpRender').indexOf('} else {'));

// ── vm ──────────────────────────────────────────────────────────
function montar(cfg) {
  cfg = cfg || {};
  const log = { escrito: [], toast: [], erro: [] };
  const X = cfg.semXlsx ? undefined : Object.assign({}, XLSX, {
    writeFile: (wb, nome) => { if (cfg.falhaWrite) throw new Error('disco'); log.escrito.push({ wb, nome }); }
  });
  const sb = {
    console: { error: (...a) => log.erro.push(a.join(' ')), warn() {}, log() {} },
    window: {}, DEMO: false, SB: { url: 'https://x', key: 'k' }, XLSX: X,
    sot_projetos: cfg.projetos || [{ id: 'p1', nome: 'Obra Norte', codigo_cliente: 'DMP/A.OES.00.00001' }],
    progShowToast: (m, t) => log.toast.push((t || 'ok') + ':' + m),
    document: { getElementById: () => null }, isUUID: () => true,
    _escapeHtml: v => String(v == null ? '' : v), escHtml: v => String(v == null ? '' : v)
  };
  vm.createContext(sb);
  vm.runInContext(blocos, sb);
  sb._projLmsUpSt.projetoId = cfg.projetoId || 'p1';
  return { sb, log };
}
const bytesDe = wb => new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));

let t = montar();
t.sb.projLmsUpModeloBaixar();
ok('baixar: gera um arquivo com nome pelo código do projeto', t.log.escrito.length === 1 && t.log.escrito[0].nome === 'modelo-lms-DMP_A.OES.00.00001.xlsx', t.log.escrito.map(e => e.nome));
const wb = t.log.escrito[0].wb;
const ws = wb.Sheets.Planilha1;
ok('abas: Planilha1 primeiro, depois Instruções', JSON.stringify(wb.SheetNames) === JSON.stringify(['Planilha1', 'Instruções']));
ok('A1 e D1 (código do projeto)', ws.A1.v === 'Definição de projeto:' && ws.D1.v === 'DMP/A.OES.00.00001');
ok('linha 3 = cabeçalho exato A:N', P.COLUNAS.every(k => ws[k.col + '3'] && ws[k.col + '3'].v === k.cabecalho));
ok('Planilha1 sem nenhuma célula a partir da linha 4', !Object.keys(ws).some(k => /^[A-Z]+([4-9]|\d\d+)$/.test(k)));

const bytes = bytesDe(wb);
const val = await P.validarArquivo(bytes, t.log.escrito[0].nome, P.XLSX_MIME);
ok('Edge: arquivo aceito (xlsx, sem macro, tamanho ok)', val.ok === true, val);
const vazio = P.parseLms(bytes, XLSX);
ok('Edge: modelo em branco passa aba e cabeçalho e só recusa por falta de linhas', vazio.ok === false
  && JSON.stringify(vazio.erros.map(e => e.codigo)) === JSON.stringify(['SEM_LINHAS_OPERACIONAIS']), vazio);

// usuário preenche a Planilha1 do modelo
XLSX.utils.sheet_add_aoa(ws, [
  ['1', 'WP', 'I', '324894', 'NK-AMAR-RC', 'M', 'FIO AL COBERTO', 6, 6],
  ['1', 'WP', 'I', 'I-654321', 'S-654321', 'UN', 'SERVIÇO', 1, 1],
  ['2', 'WP', 'R', '324894', 'NK-AMAR-RC', 'M', 'FIO AL COBERTO RETIRADO', 2, 2]
], { origin: 'A4' });
const cheio = bytesDe(wb);
const parse = P.parseLms(cheio, XLSX);
ok('Edge: modelo preenchido é lido (3 linhas, D1, sem alertas)', parse.ok === true && parse.linhas.length === 3
  && parse.projeto_identificacao_raw === 'DMP/A.OES.00.00001' && parse.linhas.every(l => !l.alertas.length)
  && parse.linhas[1].codigo_norm === 'I-654321', parse.ok ? parse.linhas.map(l => l.alertas) : parse);
ok('Edge: aba Instruções (com exemplos) é ignorada', parse.ok && parse.linhas.every(l => l.descricao_raw.indexOf('DESCRIÇÃO DO') < 0));
const pre = t.sb.projLmsUpPrechecar({ name: 'modelo-lms-DMP_A.OES.00.00001.xlsx', type: P.XLSX_MIME, size: cheio.length }, cheio, t.sb.sot_projetos[0]);
ok('front: pré-checagem aceita o modelo preenchido e confere o projeto pela D1', pre.ok === true && !(pre.avisos || []).some(a => /DIFERENTE|SEM_IDENT/.test(String(a))), pre);

const instr = wb.Sheets['Instruções'];
const textoInstr = Object.keys(instr).filter(k => k[0] !== '!').map(k => String(instr[k].v)).join('\n');
ok('Instruções: avisos de aba, cabeçalho, linha 4, .xlsx sem macro, RASCUNHO', /Planilha1/.test(textoInstr) && /linha 3/.test(textoInstr)
  && /linha 4/.test(textoInstr) && /sem macros/.test(textoInstr) && /RASCUNHO/.test(textoInstr));

t = montar({ projetos: [{ id: 'p2', nome: 'Sem código' }], projetoId: 'p2' });
t.sb.projLmsUpModeloBaixar();
ok('projeto sem código: D1 vazia e nome genérico', t.log.escrito[0].nome === 'modelo-lms-projeto.xlsx' && t.log.escrito[0].wb.Sheets.Planilha1.D1.v === '');
t = montar({ projetos: [{ id: 'p3', codigo: '../a b\\c' }], projetoId: 'p3' });
t.sb.projLmsUpModeloBaixar();
ok('nome do arquivo sem barra nem caminho', t.log.escrito[0].nome === 'modelo-lms-a_b_c.xlsx', t.log.escrito[0].nome);
t = montar({ semXlsx: true });
t.sb.projLmsUpModeloBaixar();
ok('sem SheetJS carregado: aviso, sem erro', t.log.toast.length === 1 && /Biblioteca de planilha não carregada/.test(t.log.toast[0]));
t = montar({ falhaWrite: true });
t.sb.projLmsUpModeloBaixar();
ok('falha ao gravar: aviso, sem quebrar', t.log.toast.length === 1 && /Não foi possível gerar o modelo LMS/.test(t.log.toast[0]));

if (failed.length) {
  console.log(`proj-lms-modelo-ui: FALHOU ${failed.length}/${total}`);
  for (const f of failed) console.log('  - ' + f);
  process.exit(1);
}
console.log(`proj-lms-modelo-ui: OK (${total} verificações)`);
