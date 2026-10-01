// Itens "somente descritivo" (sem cadastro no contrato / outra empresa): fora das listas operacionais do projeto.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
let falhas = 0, total = 0;
function ok(nome, cond, extra) {
  total++;
  if (!cond) { falhas++; console.error('FALHOU: ' + nome + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}
function fn(nome) {
  const re = new RegExp('\\n(?:async )?function ' + nome + '\\(');
  const n = html.split(re).length - 1;
  if (n !== 1) throw new Error('definição de ' + nome + ': ' + n);
  const ini = html.search(re) + 1;
  return html.slice(ini, html.indexOf('\n}\n', ini) + 2);
}
const PID = '20002920-9d52-4b6d-878d-9870da3fb62a';

function sandbox(opts) {
  opts = opts || {};
  const c = {
    console, Promise, Math, Number, String, Object, Array, JSON,
    DEMO: false, fetches: 0, abriu: [], apagou: [], confirmar: true,
    confirm() { return c.confirmar; },
    sbFetch: async () => { c.fetches++; if (c.fetches > 5) throw new Error('loop'); return opts.rows || []; },
    sbDelete: async (t, f) => { c.apagou.push(t + '|' + f); },
    sotAbrirProjeto(id) { c.abriu.push(id); },
    fmtMoeda: v => Number(v).toFixed(2), escHtml: s => String(s || ''),
    sot_projetos: [{ id: PID, modalidade: 'UPS' }],
    sot_atividades: [], sot_materiais_proj: [],
    sot_atividades_desc: [{ id: 'a1', projeto_id: PID, codigo: 'R-AHO816', descricao: 'MO <outra> empresa', qtd_prevista: 3, unidade: 'UN', somente_descritivo: true }],
    sot_materiais_desc: [{ id: 'm1', projeto_id: PID, codigo_sap: '337326', descricao: 'PROTET CABO-DUTO', qtd_projetada: 6, unidade: 'PC', somente_descritivo: true }],
  };
  vm.createContext(c);
  vm.runInContext(['_escapeHtml', 'sotRenderBlocoDescritivo', 'sotExcluirDescritivo', 'sotRenderTabAtividades', '_sotRenderTabAtividadesOper',
    'sotRenderTabMateriais', '_sotRenderTabMateriaisOper', 'sotRenderTabReserva'].map(fn).join('\n'), c);
  return c;
}

(async () => {
  {
    const c = sandbox();
    const at = c.sotRenderTabAtividades(PID);
    ok('Atividades: operacional vazio + bloco descritivo', /Nenhuma atividade cadastrada/.test(at) && /Somente descritivo — 1 serviço\(s\) sem cadastro no contrato/.test(at), at.slice(-600));
    ok('Atividades: descritivo sem botão Lançar/Editar e com aviso', !/sotMenuLancamento|sotEditarAtividade/.test(at.slice(at.indexOf('Somente descritivo'))) && /não entra em valor|Não entra em valor/.test(at));
    ok('Atividades: texto escapado', /MO &lt;outra&gt; empresa/.test(at) && !/<outra>/.test(at));
    const mt = c.sotRenderTabMateriais(PID, null);
    ok('Materiais: bloco descritivo com código e quantidade', /Somente descritivo — 1 material\(is\)/.test(mt) && /337326/.test(mt) && />6</.test(mt) && /reserva, requisição, entrega nem aplicação/.test(mt));
    ok('Materiais: descritivo sem Lançar', !/sotMenuLancamentoMat/.test(mt));
    c.sot_atividades_desc = []; c.sot_materiais_desc = [];
    ok('sem descritivos: nenhum bloco', c.sotRenderBlocoDescritivo(PID, 'atividade') === '' && !/Somente descritivo/.test(c.sotRenderTabMateriais(PID, null)));
  }
  {
    const c = sandbox();
    await c.sotExcluirDescritivo('sot_materiais', 'm1', PID);
    ok('excluir descritivo: apaga e recarrega do banco', c.apagou[0] === 'sot_materiais|id=eq.m1' && c.abriu[0] === PID);
    await c.sotExcluirDescritivo('lancamentos', 'x', PID);
    ok('excluir descritivo: só tabelas da lista do projeto', c.apagou.length === 1);
    c.confirmar = false;
    await c.sotExcluirDescritivo('sot_atividades', 'a1', PID);
    ok('excluir descritivo: cancelado não apaga', c.apagou.length === 1);
  }
  {
    const c = sandbox({ rows: [{ id: 'm1', projeto_id: PID, codigo_sap: '337326', somente_descritivo: true }] });
    const cont = { innerHTML: '' };
    c.sotRenderTabReserva(PID, cont);
    await new Promise(r => setTimeout(r, 10));
    ok('Reserva: busca uma vez e não entra em loop', c.fetches === 1 && /Nenhum material programado/.test(cont.innerHTML), { fetches: c.fetches, html: cont.innerHTML });
    ok('Reserva: descritivo do banco não entra na lista', c.sot_materiais_proj.length === 0);
  }
  {
    const c = { String };
    vm.createContext(c);
    vm.runInContext(fn('sotContagemAba'), c);
    ok('contador da aba: só descritivos', c.sotContagemAba([], [1, 2, 3, 4, 5, 6]) === '0 + 6 descritivos');
    ok('contador da aba: misto e singular', c.sotContagemAba([1, 2], [1]) === '2 + 1 descritivo');
    ok('contador da aba: sem descritivos', c.sotContagemAba([1, 2, 3], []) === '3' && c.sotContagemAba(null, null) === '0');
    ok('abas Atividades/Materiais usam o contador', /atividades:'📋 Atividades \('\+sotContagemAba\(sot_atividades,sot_atividades_desc\)/.test(html)
      && /materiais:'📦 Materiais \('\+sotContagemAba\(sot_materiais_proj,sot_materiais_desc\)/.test(html));
  }
  ok('abrir projeto separa descritivos', /sot_atividades {6}= \(res\[0\]\|\|\[\]\)\.filter\(function\(a\)\{ return !a\.somente_descritivo; \}\);/.test(html)
    && /sot_materiais_desc {2}= \(res\[1\]\|\|\[\]\)\.filter\(function\(m\)\{ return !!m\.somente_descritivo; \}\);/.test(html));
  ok('PLPT e Resumo sem descritivos', /pj\._materiais {3}= \(res\[1\]\|\|\[\]\)\.filter\(function\(m\)\{ return !m\.somente_descritivo; \}\);/.test(html)
    && /plptRenderResumoOperacoes\(projetoId, pjStub, p,\n\s+\(res\[0\]\|\|\[\]\)\.filter/.test(html));

  if (falhas) { console.error('sot-itens-descritivo: ' + falhas + ' de ' + total + ' falharam'); process.exit(1); }
  console.log('sot-itens-descritivo: ' + total + ' verificações OK');
})().catch(e => { console.error(e); process.exit(1); });
