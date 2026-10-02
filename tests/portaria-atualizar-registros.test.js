'use strict';
// Portaria 8.1.194 — botão "Atualizar registros": relê saídas/retornos do banco sem recarregar a página.
// Executa as funções reais do index.html em sandbox (DOM, sbFetch e renders falsos).
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
const HOJE = '2026-10-02';

function sandbox(opts) {
  opts = opts || {};
  const abas = {};
  ['equipes', 'saida', 'retorno', 'abertos', 'liberacao', 'autorizados', 'registros', 'reservas', 'config', 'acesso']
    .forEach(a => { abas['port-aba-' + a] = { style: { display: a === (opts.aba || 'equipes') ? '' : 'none' } }; });
  const btn = { disabled: false, textContent: '🔄 Atualizar registros' };
  const els = Object.assign({}, abas, { 'port-btn-atualizar': btn, 'ret-data': { value: opts.retData || '' } });
  const c = {
    console, Promise, Object, Array, String, Date,
    DEMO: !!opts.demo, window: {}, btn,
    document: { getElementById: id => els[id] || null },
    toasts: [], fetches: [], mesclou: [], render: [], conferiu: 0, _portAbertosLoaded: true,
    dataHojeLocal: () => HOJE,
    portDiaISO: v => (String(v || '').match(/^\d{4}-\d{2}-\d{2}/) || [''])[0],
    portFiltrosDataSaida: (a, b) => ['deleted_at=is.null', 'data_saida=gte.' + a, 'fim=' + b],
    portOffIsOnline: () => opts.online !== false,
    sbFetch: async (t, o) => { c.fetches.push({ t, o, btnDuranteFetch: btn.disabled }); return opts.falha ? null : (opts.rows || [{ id: 's1', status: 'Retornado' }]); },
    portMesclarSaidas(rows) { c.mesclou.push(rows); },
    portInvalidarCacheSaidas(d) {
      if (c.window._portEqDiaBuscado) { delete c.window._portEqDiaBuscado['p:' + d]; delete c.window._portEqDiaBuscado['p:em_campo']; }
      c.render.push('invalidou:' + d);
    },
    portConferirSaidasMemoria: async o => { c.conferiu++; c.conferirForcar = o && o.forcar; return opts.excluidas ? { excluidas: 1 } : { excluidas: 0 }; },
    portEnsureDadosPortariaDia: async d => { c.render.push('ensure:' + d); },
    portRenderEquipesDia() { c.render.push('equipes'); },
    portRenderAguardando() { c.render.push('saida'); },
    portRenderRetorno() { c.render.push('retorno'); },
    portRenderRetornosAbertos() { c.render.push('abertos:' + c._portAbertosLoaded); },
    frtPortariaRender: Object.assign(function () { c.render.push('registros:' + c.frtPortariaRender._lastKey); }, { _lastKey: 'x|y' }),
    portMostrarAba(a) { c.render.push('mostrar:' + a); },
    progShowToast(msg, tipo) { c.toasts.push({ msg, tipo: tipo || 'ok' }); },
  };
  vm.createContext(c);
  vm.runInContext(['portAbaAtiva', 'portAtualizarRegistros'].map(fn).join('\n')
    + '\nvar _portAtualizandoRegistros=false;', c);
  return c;
}
const espera = () => new Promise(r => setTimeout(r, 5));

(async () => {
  ok('botão no topo da Portaria chama portAtualizarRegistros',
    /<button type="button" id="port-btn-atualizar"[^>]*onclick="portAtualizarRegistros\(\)"[^>]*>🔄 Atualizar registros<\/button>/.test(html));
  ok('botão fica dentro da página da Portaria',
    html.indexOf('id="port-btn-atualizar"') > html.indexOf('<div id="pg-frotas-portaria"') && html.indexOf('id="port-btn-atualizar"') < html.indexOf('id="port-tab-equipes"'));

  {
    const c = sandbox({ aba: 'equipes' });
    const r = await c.portAtualizarRegistros(); await espera();
    ok('Saída: busca as saídas do dia no banco', r === true && c.fetches.length === 1 && c.fetches[0].t === 'frotas_portaria_saidas'
      && c.fetches[0].o.filters.indexOf('data_saida=gte.' + HOJE) >= 0, c.fetches);
    ok('Saída: botão desabilitado durante a busca e liberado depois', c.fetches[0].btnDuranteFetch === true && c.btn.disabled === false && c.btn.textContent === '🔄 Atualizar registros');
    ok('Saída: mescla na memória (não substitui) e confere forçado', c.mesclou.length === 1 && c.conferiu === 1 && c.conferirForcar === true);
    ok('Saída: dia marcado como buscado (sem buscar 2x) e virada relida', c.window._portEqDiaBuscado['p:' + HOJE] === true && !('p:em_campo' in c.window._portEqDiaBuscado));
    ok('Saída: redesenha a aba Saída', c.render.indexOf('ensure:' + HOJE) >= 0 && c.render[c.render.length - 1] === 'equipes', c.render);
    ok('Saída: avisa com a hora', /^✅ Saídas e retornos atualizados \(\d{2}:\d{2}\)\.$/.test(c.toasts[0].msg) && c.toasts[0].tipo === 'ok', c.toasts);
  }
  {
    const c = sandbox({ aba: 'retorno', retData: '2026-09-30' });
    await c.portAtualizarRegistros(); await espera();
    ok('Retorno: busca o dia escolhido na aba', c.fetches[0].o.filters.indexOf('data_saida=gte.2026-09-30') >= 0 && c.window._portEqDiaBuscado['p:2026-09-30'] === true);
    ok('Retorno: invalida também hoje e redesenha Retorno', c.render.indexOf('invalidou:' + HOJE) >= 0 && c.render[c.render.length - 1] === 'retorno', c.render);
  }
  {
    const c = sandbox({ aba: 'registros' });
    await c.portAtualizarRegistros(); await espera();
    ok('Registros: força nova busca do período', c.render[c.render.length - 1] === 'registros:', c.render);
  }
  {
    const c = sandbox({ aba: 'abertos' });
    await c.portAtualizarRegistros(); await espera();
    ok('Retornos em aberto: recarrega a lista', c.render[c.render.length - 1] === 'abertos:false', c.render);
  }
  {
    const c = sandbox({ aba: 'saida' });
    await c.portAtualizarRegistros(); await espera();
    ok('aba saida (Aguardando): redesenha', c.render[c.render.length - 1] === 'saida', c.render);
  }
  {
    const c = sandbox({ aba: 'liberacao' });
    await c.portAtualizarRegistros(); await espera();
    ok('outras abas: reabre a aba atual', c.render[c.render.length - 1] === 'mostrar:liberacao', c.render);
  }
  {
    const c = sandbox({ aba: 'equipes', excluidas: true });
    c.window._portEqDiaBuscado = { 'p:2026-10-01': true, 'c:2026-10-02': true };
    await c.portAtualizarRegistros(); await espera();
    ok('cópia excluída no servidor: relê o dia de novo', !Object.keys(c.window._portEqDiaBuscado).some(k => k.indexOf('p:') === 0)
      && c.window._portEqDiaBuscado['c:2026-10-02'] === true, c.window._portEqDiaBuscado);
  }
  {
    const c = sandbox({ aba: 'equipes', falha: true });
    c.window._portEqDiaBuscado = { ['p:' + HOJE]: true, 'p:em_campo': true };
    const r = await c.portAtualizarRegistros(); await espera();
    ok('falha na leitura: avisa e não mexe em memória nem cache', r === false && c.mesclou.length === 0 && c.conferiu === 0
      && c.window._portEqDiaBuscado['p:em_campo'] === true && c.render.length === 0 && c.toasts[0].tipo === 'erro'
      && /Não foi possível buscar/.test(c.toasts[0].msg) && c.btn.disabled === false, { toasts: c.toasts, render: c.render });
  }
  {
    const c = sandbox({ aba: 'equipes', online: false });
    const r = await c.portAtualizarRegistros(); await espera();
    ok('sem conexão: não busca, avisa e preserva a fila offline', r === false && c.fetches.length === 0 && c.mesclou.length === 0
      && /Sem conexão/.test(c.toasts[0].msg) && /pendentes sobem/.test(c.toasts[0].msg));
  }
  {
    const c = sandbox({ aba: 'equipes' });
    const p1 = c.portAtualizarRegistros();
    const r2 = await c.portAtualizarRegistros();
    await p1; await espera();
    ok('clique duplo: uma busca só', r2 === false && c.fetches.length === 1);
  }
  {
    const c = sandbox({ aba: 'retorno', demo: true });
    await c.portAtualizarRegistros();
    ok('DEMO: não busca no banco, só redesenha', c.fetches.length === 0 && c.render[0] === 'mostrar:retorno');
  }

  if (falhas) { console.error('portaria-atualizar-registros: ' + falhas + ' de ' + total + ' falharam'); process.exit(1); }
  console.log('portaria-atualizar-registros: ' + total + ' verificações OK');
})().catch(e => { console.error(e); process.exit(1); });
