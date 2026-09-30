'use strict';
// SESMT 8.1.175 — Importar planilha / Renovar em Treinamentos tinham sido cortados na 8.1.108 (botões com ReferenceError).
// Restaurados da 8.1.107 com leitura completa (o servidor corta em 1000 linhas; havia 6498 treinamentos) e gravação conferida.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const shell = fs.readFileSync(path.join(raiz, 'sesmt-alm-shell.js'), 'utf8');
const sw = fs.readFileSync(path.join(raiz, 'sw.js'), 'utf8');
const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

function bloco(inicioRe) {
  const m = inicioRe.exec(html);
  if (!m) throw new Error('não encontrado: ' + inicioRe);
  const ini = m.index + 1;
  const re = /\n(?:async function |function |var |\/\*\*|\/\/)/g;
  re.lastIndex = ini + 5;
  const fim = re.exec(html);
  return html.slice(ini, fim ? fim.index : undefined);
}
const fn = nome => bloco(new RegExp('\\n(?:async )?function ' + nome + '\\('));

const RESTAURADAS = ['trLimpo', 'trNormRe', 'trNormSigla', 'sesmtTreinamentoColabId', 'trParseData', 'trISO', 'trAddValidade', 'trMapasImportacao',
  'trResolverRE', 'trIdsRelacionados', 'trFindTreinExistente', 'trBuscarTudo', 'trAbrirImportacao', 'trLerArquivo', 'trPrepararPreview',
  'trExecutarImportacao', 'renovarTrein'];
for (const f of RESTAURADAS) {
  const n = (html.match(new RegExp('\\n(?:async )?function ' + f + '\\s*\\(', 'g')) || []).length;
  ok('função ' + f + ' definida uma vez', n === 1, n);
}
for (const f of ['openNovoTrein', '_openNovoTreinModal', 'trSalvarTreinamento'])
  ok('modal legado ' + f + ' não restaurado (gravava treinamento sem colaborador)', !new RegExp('function ' + f + '\\s*\\(').test(html));
ok('botão Importar planilha aponta para função existente', /onclick="trAbrirImportacao\(\)"/.test(html));
ok('shell: cabeçalho com as 8 colunas da lista', /tbl\('tbody-trein',\['Colaborador','NR','Treinamento','Abertura','Validade','Status','EPIs liberados','Ações'\]\)/.test(shell));
ok('shell: tag de versão renovada', /sesmt-alm-shell\.js\?v=8\.1\.175/.test(html));
ok('preview não usa mais sbFetch com ||[] (lista parcial/vazia duplicava)', !/await sbFetch\('treinamentos'[^\n]*\|\|\[\]/.test(fn('trPrepararPreview')));

const codigo = RESTAURADAS.map(fn).join('\n') + '\nvar _trImportRows=null;';

function cenario(opts) {
  opts = opts || {};
  const els = {};
  const el = id => els[id] || (els[id] = { id, innerHTML: '', textContent: '', value: '', style: {}, disabled: false, appendChild() {} });
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, Math, Date, String, Object, Array, Promise, JSON, parseInt, isNaN, RegExp,
    DEMO: false, setTimeout: f => { f(); return 0; },
    document: { getElementById: id => el(id), createElement: () => ({ style: {} }) },
    escHtml: s => String(s == null ? '' : s),
    isUUID: id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
    isoD: n => '2027-09-30',
    colaboradores: opts.colaboradores || [], funcs: opts.funcs || [], treinamentos: opts.treinamentos || [],
    closeModal() {}, _turmaInvalidateCaches() {}, renderTreinamentos() { ctx.renders++; }, renders: 0, alert() {},
    toasts: [], progShowToast(m, t) { ctx.toasts.push([m, t]); },
    fetches: [],
    sbFetch(t, o) {
      ctx.fetches.push([t, o]);
      const off = +((o.filters || []).find(f => /^offset=/.test(f)) || 'offset=0').slice(7);
      if (opts.falhaFetch && opts.falhaFetch(t, off)) return Promise.resolve(null);
      const todos = (opts.tabelas || {})[t] || [];
      return Promise.resolve(todos.slice(off, off + (o.limit || 1000)));
    },
    inserts: [], sbInsert(t, rows) { ctx.inserts.push([t, rows]); return Promise.resolve(opts.insertFalha ? null : rows.map((r, i) => Object.assign({ id: 'novo-' + i }, r))); },
    updates: [], sbUpdate(t, d, f) { ctx.updates.push([t, d, f]); return Promise.resolve(!opts.updateFalha); },
    els,
  };
  vm.createContext(ctx);
  vm.runInContext(codigo, ctx);
  return ctx;
}
const esperar = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r)); };
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

(async () => {
  // trBuscarTudo: pagina até acabar; falha em qualquer página → null
  let c = cenario({ tabelas: { treinamentos: Array.from({ length: 2498 }, (_, i) => ({ id: uuid(i) })) } });
  let r = await vm.runInContext("trBuscarTudo('treinamentos',['deleted_at=is.null'])", c);
  ok('busca completa: 2498 linhas em 3 páginas', Array.isArray(r) && r.length === 2498 && c.fetches.length === 3, [r && r.length, c.fetches.length]);
  ok('busca completa: offsets 0/1000/2000, ordem estável e filtro mantido', c.fetches.map(f => f[1].filters.join('&')).join(' | ') === 'deleted_at=is.null&offset=0 | deleted_at=is.null&offset=1000 | deleted_at=is.null&offset=2000'
    && c.fetches.every(f => f[1].order === 'id.asc' && f[1].limit === 1000));
  c = cenario({ tabelas: { treinamentos: Array.from({ length: 2498 }, (_, i) => ({ id: uuid(i) })) }, falhaFetch: (t, off) => off === 1000 });
  r = await vm.runInContext("trBuscarTudo('treinamentos',[])", c);
  ok('busca completa: página com erro → null (nunca lista parcial)', r === null);

  // Prévia: treinamento existente além da linha 1000 não pode virar "novo"
  const colab = { id: 'col-1', nome: 'Fulano', re: '0123', ativo: true, dispensado: false };
  const antigos = Array.from({ length: 1500 }, (_, i) => ({ id: uuid(i), funcionario_id: 'col-x' + i, nr: 'NR10', data: '2025-01-01' }));
  antigos.push({ id: uuid(9999), funcionario_id: 'col-1', nr: 'NR-10', data: '2026-01-10', validade: '2028-01-10' });
  const tabelas = { funcionarios: [], colaboradores: [colab], sesmt_cursos: [{ id: 'k1', sigla: 'NR10', nome: 'NR-10 Básico', periodicidade: 24, tipo_validade: 'meses' }], treinamentos: antigos };
  const linhasPlanilha = [{ RE: '123', DATA: '10/01/2026', 'NR10': '' }, { RE: '999', DATA: '10/01/2026', 'NR10': '' }];
  c = cenario({ tabelas });
  await vm.runInContext('trPrepararPreview(' + JSON.stringify(linhasPlanilha) + ')', c);
  let st = vm.runInContext('_trImportRows', c);
  ok('prévia: registro existente na 2ª página é reconhecido (não duplica)', st && st.novos.length === 0 && st.pular === 1, st && { novos: st.novos.length, atualizar: st.atualizar.length, pular: st.pular });
  ok('prévia: RE sem colaborador aparece como ignorado', /RE\(s\) sem colaborador no cadastro[^<]*999/.test(c.els['tr-imp-preview'].innerHTML));

  const planilhaNova = [{ RE: '123', DATA: '15/03/2026', 'NR10': '' }];
  c = cenario({ tabelas });
  await vm.runInContext('trPrepararPreview(' + JSON.stringify(planilhaNova) + ')', c);
  st = vm.runInContext('_trImportRows', c);
  ok('prévia: data mais recente → atualizar o existente', st && st.atualizar.length === 1 && st.atualizar[0]._id === uuid(9999) && st.novos.length === 0);
  ok('prévia: validade pelo cadastro do curso (24 meses)', st && st.atualizar[0] && st.atualizar[0].validade === '2028-03-15', st && st.atualizar[0] && st.atualizar[0].validade);
  ok('prévia: botão de confirmar visível', c.els['tr-imp-btn'].style.display === '');

  c = cenario({ tabelas, falhaFetch: t => t === 'treinamentos' });
  await vm.runInContext('trPrepararPreview(' + JSON.stringify(planilhaNova) + ')', c);
  ok('prévia: leitura com falha para e não prepara gravação', vm.runInContext('_trImportRows', c) === null && c.els['tr-imp-btn'].style.display === 'none'
    && /Nada foi importado/.test(c.els['tr-imp-preview'].innerHTML));

  // Gravação conferida
  const prep = { novos: [{ fid: 'col-1', nr: 'NR35', titulo: 'NR-35', data: '2026-03-15', validade: '2028-03-15', extras: {} }],
    atualizar: [{ fid: 'col-1', nr: 'NR10', titulo: 'NR-10', data: '2026-03-15', validade: '2028-03-15', extras: {}, _id: uuid(9999) }], pular: 0 };
  c = cenario({ colaboradores: [colab], treinamentos: [{ id: uuid(9999), funcionario_id: 'col-1', nr: 'NR10' }] });
  vm.runInContext('_trImportRows=' + JSON.stringify(prep), c);
  await vm.runInContext('trExecutarImportacao()', c);
  ok('importar: insere com funcionario_id do colaborador', c.inserts.length === 1 && c.inserts[0][1][0].funcionario_id === 'col-1' && c.inserts[0][1][0].nr === 'NR35');
  ok('importar: atualiza pelo id do existente', c.updates.length === 1 && c.updates[0][2] === 'id=eq.' + uuid(9999) && !('criado_em' in c.updates[0][1]));
  ok('importar: sucesso → ✅ 1 novo, 1 atualizado', /^✅ Importação concluída — 1 novo\(s\), 1 atualizado\(s\)/.test(c.toasts[0][0]) && c.toasts[0][1] === undefined, c.toasts);

  c = cenario({ colaboradores: [colab], treinamentos: [{ id: uuid(9999), funcionario_id: 'col-1', nr: 'NR10', validade: '2027-01-10' }], insertFalha: true, updateFalha: true });
  vm.runInContext('_trImportRows=' + JSON.stringify(prep), c);
  await vm.runInContext('trExecutarImportacao()', c);
  ok('importar: banco recusou → aviso de falha com a contagem', c.toasts[0][1] === 'erro' && /^⚠ Importação com falha — 2 registro\(s\) não gravado\(s\) no banco · 0 novo\(s\), 0 atualizado\(s\)/.test(c.toasts[0][0]), c.toasts);
  ok('importar: update recusado não altera a lista local', vm.runInContext('treinamentos[0].validade', c) === '2027-01-10' && vm.runInContext('treinamentos.length', c) === 1);

  // Renovar
  c = cenario({ treinamentos: [{ id: uuid(5), nr: 'NR10', validade: '2026-01-01', val: '2026-01-01' }], updateFalha: true });
  await vm.runInContext("renovarTrein('" + uuid(5) + "')", c);
  ok('renovar: banco recusou → validade intacta e aviso', vm.runInContext('treinamentos[0].validade', c) === '2026-01-01' && c.toasts.some(t => t[1] === 'erro' && /Nada foi alterado/.test(t[0])));
  c = cenario({ treinamentos: [{ id: uuid(5), nr: 'NR10', validade: '2026-01-01', val: '2026-01-01' }] });
  await vm.runInContext("renovarTrein('" + uuid(5) + "')", c);
  ok('renovar: confirmado → nova validade e lista redesenhada', c.updates[0][1].validade === '2027-09-30' && vm.runInContext('treinamentos[0].validade', c) === '2027-09-30' && c.renders === 1);

  // FK treinamentos.funcionario_id → colaboradores.id
  c = cenario({ colaboradores: [colab], funcs: [{ id: 'func-7', matricula: '00123' }] });
  ok('colabId: id de colaborador passa direto', vm.runInContext("sesmtTreinamentoColabId('col-1')", c) === 'col-1');
  ok('colabId: id de funcionário vira colaborador pelo RE', vm.runInContext("sesmtTreinamentoColabId('func-7')", c) === 'col-1');
  ok('colabId: desconhecido → null', vm.runInContext("sesmtTreinamentoColabId('zzz')", c) === null);

  ok('versão: log 8.1.175', /\{v:'8\.1\.175'/.test(html));
  ok('versão: numero 8.1.x', /numero: '8\.1\.\d+'/.test(html));
  ok('versão: sw cena-8.1.x', /'cena-8\.1\.\d+'/.test(sw));

  if (failed.length) {
    console.error('FALHAS (' + failed.length + '/' + total + '):\n - ' + failed.join('\n - '));
    process.exit(1);
  }
  console.log('sesmt-treinamentos-importacao: ' + total + ' verificações OK');
})().catch(e => { console.error(e); process.exit(1); });
