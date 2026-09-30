'use strict';
// PROGRAMAÇÃO 8.1.168 — saída da portaria gravada em outra equipe depois que a programação trocou equipe/veículo
// (caso EJN102/EBN145): sinalização, transferência fail-closed e avisos ao desprogramar/trocar veículo.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
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
const vr = nome => bloco(new RegExp('\\nvar ' + nome + '\\s*='));

const FUNCS = ['progTmaDiaISO', 'progTmaAmanha', 'progTmaFmtHora', 'progTmaPortariaRetornou', 'progTmaMatchPortariaEq', 'progTmaPlacaProg',
  'progTmaNomeEquipeSaida', 'progTmaMesmoInstante', 'progTmaSaidaOutraEquipe', 'progTmaAvisoEmCampo', 'progTmaStatusPortaria',
  'progTmaTransferirSaida', 'portDiaLocal', 'portEstaEmCampo'];
const codigo = vr('_progTmaTransferindo') + '\n' + FUNCS.map(fn).join('\n');

const DIA = '2026-09-29';
const EQ = { EBN145: 'e-145', EJN102: 'e-102', EJN174: 'e-174', EBN196: 'e-196' };
const NOMES = { 'e-145': 'EBN145', 'e-102': 'EJN102', 'e-174': 'EJN174', 'e-196': 'EBN196' };

function saida(id, eqId, placa, extra) {
  return Object.assign({ id, equipe_id: eqId, equipe: NOMES[eqId], placa, motorista: 'LUIZ CARLOS', status: 'Em campo',
    data_saida: '2026-09-29T07:37:00-03:00', data_retorno: null, deleted_at: null, obs: '' }, extra || {});
}

function contexto(opts) {
  opts = opts || {};
  const banco = (opts.banco || []).map(r => Object.assign({}, r));
  const ctx = {
    console, Math, Number, String, Object, Array, Date, isFinite, isNaN, parseInt, JSON, encodeURIComponent,
    DEMO: false, window: {},
    frt_portaria: (opts.memoria || banco).map(r => Object.assign({}, r)),
    _progVeiculos: {},
    comps: opts.comps || {},
    progFindCompDia(eqId, dia) { return ctx.comps[eqId + '_' + dia] || null; },
    portNomeEquipeSaida(p) { return NOMES[p.equipe_id] || p.equipe || '—'; },
    portBuscarEquipe(id) { return NOMES[id] ? { id, codigo: NOMES[id] } : null; },
    portNomeEquipe(eq, fb) { return (eq && eq.codigo) || fb || '—'; },
    portFiltrosDataSaida(ini, fim) { return ['deleted_at=is.null', 'data_saida=gte.' + ini, 'data_saida=lte.' + fim + 'T23:59:59']; },
    portMesclarSaidas(rows) {
      rows.forEach(r => {
        const i = ctx.frt_portaria.findIndex(p => String(p.id) === String(r.id));
        if (i >= 0) ctx.frt_portaria[i] = Object.assign({}, r); else ctx.frt_portaria.push(Object.assign({}, r));
      });
    },
    invalidados: [], portInvalidarCacheSaidas(d) { ctx.invalidados.push(d); },
    renders: 0, progRenderQuadroDebounced() { ctx.renders++; },
    escHtml: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    usuarioLogado: { nome: 'Rodrigo Diego da Silva' },
    confirmResp: opts.confirm !== undefined ? opts.confirm : true, confirms: [],
    confirm(m) { ctx.confirms.push(m); return ctx.confirmResp; },
    toasts: [], progShowToast(m, t) { ctx.toasts.push([m, t || '']); },
    banco, fetches: [], updates: [],
    async sbFetch(tabela, o) {
      ctx.fetches.push([tabela, o]);
      if (opts.fetchNulo) return null;
      if (opts.confNulo && ctx.fetches.length > 1) return null;
      const f = o.filters || [];
      const idIn = f.find(x => x.startsWith('id=in.('));
      if (idIn) {
        const ids = idIn.slice(7, -1).split(',');
        return ctx.banco.filter(r => ids.includes(String(r.id))).map(r => Object.assign({}, r));
      }
      const placa = decodeURIComponent((f.find(x => x.startsWith('placa=eq.')) || '').slice(9));
      const eq = (f.find(x => x.startsWith('equipe_id=eq.')) || '').slice(13);
      return ctx.banco.filter(r => !r.deleted_at && r.placa === placa && r.equipe_id === eq).map(r => Object.assign({}, r));
    },
    async sbUpdate(tabela, dados, filtro) {
      ctx.updates.push([tabela, dados, filtro]);
      if (opts.updateIgnorado) return true;
      const id = filtro.replace('id=eq.', '');
      const r = ctx.banco.find(x => String(x.id) === id);
      if (r) Object.assign(r, dados);
      return true;
    }
  };
  vm.createContext(ctx);
  vm.runInContext(codigo, ctx);
  return ctx;
}

// EJN102 hoje: EBN145 liberada 07:37 com TTP2G93 (2 clones); depois a programação passou equipe e veículo para EJN102.
function cenarioEjn102(opts) {
  opts = opts || {};
  const banco = opts.banco || [saida('s1', EQ.EBN145, 'TTP2G93'), saida('s2', EQ.EBN145, 'TTP2G93', { data_saida: '2026-09-29T07:37:20-03:00' })];
  const ctx = contexto(Object.assign({}, opts, { banco }));
  ctx._progVeiculos[EQ.EJN102 + '_' + DIA] = { placa: 'TTP2G93' };
  ctx._progVeiculos[EQ.EBN145 + '_' + DIA] = opts.origemPlaca ? { placa: opts.origemPlaca } : null;
  return ctx;
}

(async () => {
  // ── Sinalização ──
  {
    const ctx = cenarioEjn102();
    const st = ctx.progTmaStatusPortaria(EQ.EJN102, DIA);
    ok('EJN102: saída da placa em outra equipe → outra_equipe', st.status === 'outra_equipe', st);
    ok('EJN102: label cita a equipe de origem', st.label === 'Em campo como EBN145', st.label);
    ok('EJN102: equipe_origem_id é a EBN145', st.equipe_origem_id === EQ.EBN145);
    ok('EJN102: não conta como em_campo', st.status !== 'em_campo');
    const origem = ctx.progTmaStatusPortaria(EQ.EBN145, DIA);
    ok('EBN145 continua em campo (saída é dela)', origem.status === 'em_campo', origem.status);
  }
  {
    // EBN196 / EJN174: placa duplicada na programação — a outra equipe ainda tem a placa, não é troca.
    const ctx = contexto({ banco: [saida('s9', EQ.EJN174, 'TUH1I44')] });
    ctx._progVeiculos[EQ.EBN196 + '_' + DIA] = { placa: 'TUH1I44' };
    ctx._progVeiculos[EQ.EJN174 + '_' + DIA] = { placa: 'TUH1I44' };
    const st = ctx.progTmaStatusPortaria(EQ.EBN196, DIA);
    ok('placa duplicada (origem ainda programada) → aguardando', st.status === 'aguardando', st.status);
  }
  {
    const ctx = cenarioEjn102({ banco: [saida('s1', EQ.EBN145, 'TTP2G93', { status: 'Retornado', data_retorno: '2026-09-29T17:00:00-03:00' })] });
    ok('saída já retornada não é sinalizada', ctx.progTmaStatusPortaria(EQ.EJN102, DIA).status === 'aguardando');
  }
  {
    const ctx = cenarioEjn102({ banco: [saida('s1', EQ.EBN145, 'TTP2G93', { data_saida: '2026-09-28T07:37:00-03:00' })] });
    ok('saída de outro dia não é sinalizada', ctx.progTmaStatusPortaria(EQ.EJN102, DIA).status === 'aguardando');
  }
  {
    const ctx = contexto({ banco: [saida('s3', EQ.EJN102, 'TTP2G93')] });
    ctx._progVeiculos[EQ.EJN102 + '_' + DIA] = { placa: 'TTP2G93' };
    ok('saída própria continua em_campo', ctx.progTmaStatusPortaria(EQ.EJN102, DIA).status === 'em_campo');
    const av = ctx.progTmaAvisoEmCampo(EQ.EJN102, DIA);
    ok('aviso ao desprogramar equipe em campo', av && /já saiu pela portaria/.test(av.txt) && /não altera a saída/.test(av.txt), av && av.txt);
    ok('aviso em HTML', av && /Transferir saída/.test(av.html));
    const ctx2 = cenarioEjn102();
    ok('sem aviso para equipe que não saiu', ctx2.progTmaAvisoEmCampo(EQ.EJN102, DIA) === null);
  }

  // ── Transferência ──
  {
    const ctx = cenarioEjn102();
    const r = await ctx.progTmaTransferirSaida(EQ.EJN102, DIA);
    ok('transferência: sucesso', r === true, ctx.toasts);
    ok('transferência: pediu confirmação', ctx.confirms.length === 1 && /EBN145/.test(ctx.confirms[0]) && /EJN102/.test(ctx.confirms[0]));
    ok('transferência: atualizou os 2 clones', ctx.updates.length === 2, ctx.updates.map(u => u[2]));
    const u = ctx.updates[0] && ctx.updates[0][1];
    ok('transferência: grava equipe_id e equipe', u && u.equipe_id === EQ.EJN102 && u.equipe === 'EJN102', u);
    ok('transferência: nota na obs', u && /Equipe transferida de EBN145 para EJN102 pela Programação/.test(u.obs) && /Rodrigo Diego da Silva/.test(u.obs), u && u.obs);
    ok('transferência: filtro por id', ctx.updates.every(x => /^id=eq\.s[12]$/.test(x[2])));
    ok('transferência: busca no servidor com placa e equipe de origem', ctx.fetches[0][1].filters.includes('placa=eq.TTP2G93') && ctx.fetches[0][1].filters.includes('equipe_id=eq.' + EQ.EBN145));
    ok('transferência: relê por id para conferir', ctx.fetches.length === 2 && /^id=in\./.test(ctx.fetches[1][1].filters[0]));
    ok('transferência: memória atualizada', ctx.frt_portaria.every(p => p.equipe_id === EQ.EJN102));
    ok('transferência: EJN102 agora em_campo', ctx.progTmaStatusPortaria(EQ.EJN102, DIA).status === 'em_campo');
    ok('transferência: EBN145 sem saída', ctx.progTmaStatusPortaria(EQ.EBN145, DIA).status === 'aguardando');
    ok('transferência: invalida cache e re-renderiza', ctx.invalidados.includes(DIA) && ctx.renders > 0);
    ok('transferência: toast de sucesso', ctx.toasts.some(t => /Saída transferida de EBN145 para EJN102/.test(t[0])));
  }
  {
    const ctx = cenarioEjn102({ confirm: false });
    const r = await ctx.progTmaTransferirSaida(EQ.EJN102, DIA);
    ok('cancelar confirmação: nada gravado', r === false && ctx.updates.length === 0 && ctx.fetches.length === 0);
  }
  {
    const ctx = cenarioEjn102({ updateIgnorado: true });
    const r = await ctx.progTmaTransferirSaida(EQ.EJN102, DIA);
    ok('servidor não aplicou (RLS): falha', r === false);
    ok('servidor não aplicou: toast de erro', ctx.toasts.some(t => t[1] === 'erro' && /não aceitou a transferência \(0 de 2/.test(t[0])), ctx.toasts);
    ok('servidor não aplicou: memória não mente', ctx.frt_portaria.every(p => p.equipe_id === EQ.EBN145));
  }
  {
    // Memória desatualizada: no servidor a saída já retornou.
    const mem = [saida('s1', EQ.EBN145, 'TTP2G93')];
    const ctx = cenarioEjn102({ banco: [saida('s1', EQ.EBN145, 'TTP2G93', { status: 'Retornado', data_retorno: '2026-09-29T09:00:00-03:00' })] });
    ctx.frt_portaria = mem.map(r => Object.assign({}, r));
    const r = await ctx.progTmaTransferirSaida(EQ.EJN102, DIA);
    ok('saída já retornada no servidor: aborta sem update', r === false && ctx.updates.length === 0 && ctx.toasts.some(t => /não está mais em campo/.test(t[0])), ctx.toasts);
    ok('saída já retornada no servidor: memória atualizada', ctx.frt_portaria[0].status === 'Retornado');
  }
  {
    const ctx = cenarioEjn102();
    ctx.progTmaSaidaOutraEquipe(EQ.EJN102, DIA);
    const orig = ctx.progTmaSaidaOutraEquipe;
    // A origem volta a ter a placa entre a sinalização e a gravação.
    ctx.sbFetch = (f => async function (t, o) { ctx._progVeiculos[EQ.EBN145 + '_' + DIA] = { placa: 'TTP2G93' }; return f(t, o); })(ctx.sbFetch);
    const r = await ctx.progTmaTransferirSaida(EQ.EJN102, DIA);
    ok('origem voltou a ter a placa: aborta sem update', r === false && ctx.updates.length === 0 && ctx.toasts.some(t => /voltou a ter TTP2G93/.test(t[0])), ctx.toasts);
    ok('função de detecção intacta', typeof orig === 'function');
  }
  {
    const ctx = cenarioEjn102({ fetchNulo: true });
    const r = await ctx.progTmaTransferirSaida(EQ.EJN102, DIA);
    ok('sbFetch falhou: aborta sem update', r === false && ctx.updates.length === 0);
    ok('sbFetch falhou: toast de erro', ctx.toasts.some(t => t[1] === 'erro' && /Nada foi transferido/.test(t[0])));
  }
  {
    const ctx = cenarioEjn102({ confNulo: true });
    const r = await ctx.progTmaTransferirSaida(EQ.EJN102, DIA);
    ok('conferência falhou: não confirma sucesso', r === false && !ctx.toasts.some(t => /✅/.test(t[0])), ctx.toasts);
  }
  {
    const ctx = cenarioEjn102({ origemPlaca: 'TTP2G93' });
    const r = await ctx.progTmaTransferirSaida(EQ.EJN102, DIA);
    ok('sem saída de outra equipe: nada a transferir', r === false && ctx.fetches.length === 0 && ctx.confirms.length === 0);
  }
  {
    const ctx = cenarioEjn102();
    ctx._progTmaTransferindo[EQ.EJN102 + '_' + DIA] = true;
    const r = await ctx.progTmaTransferirSaida(EQ.EJN102, DIA);
    ok('trava contra duplo clique', r === false && ctx.fetches.length === 0);
  }

  // ── Integração no quadro e nos fluxos ──
  const op = fn('progTmaHtmlOperacao');
  ok('quadro: cor e ícone de outra_equipe', /p\.status==='outra_equipe'\?'#854F0B'/.test(op) && /p\.status==='outra_equipe'\?'⚠'/.test(op));
  ok('quadro: botão Transferir saída', /onclick="progTmaTransferirSaida\(/.test(op) && /⇄ Transferir saída p\/ esta equipe/.test(op));
  ok('quadro: operação repassa equipe de origem', /equipe_origem:port\.equipe_origem\|\|''/.test(fn('progTmaGetOperacaoEquipe')));
  ok('linha: destaque laranja', /stPort==='outra_equipe' \? 'background:#FEF8EC/.test(fn('progRenderEquipeRow')));
  ok('desprogramar: aviso de equipe em campo', /progTmaAvisoEmCampo\(eqId, progGetData\(\)\)/.test(fn('progDesprogramarEquipe')) && /_avEmCampo\?_avEmCampo\.html:''/.test(fn('progDesprogramarEquipe')));
  ok('remover veículo: aviso de equipe em campo', /progTmaAvisoEmCampo\(eqId, d\)/.test(fn('progRemoverVeiculo')) && /mesmo assim\?/.test(fn('progRemoverVeiculo')));
  const sv = fn('progSetVeiculo');
  ok('programar veículo: avisa placa em campo em outra equipe', /progTmaSaidaOutraEquipe\(eqId, data\)/.test(sv) && /use ⇄ Transferir saída no quadro/.test(sv));
  ok('programar veículo: avisa troca de placa de equipe em campo', /Trocar a placa na programação não altera a saída/.test(sv));
  ok('versão 8.1.168 no changelog', /\{v:'8\.1\.168'/.test(html));
  ok('sw.js versionado', /'cena-8\.1\.\d+'/.test(sw));

  if (failed.length) { console.error('FALHOU ' + failed.length + '/' + total + ':\n - ' + failed.join('\n - ')); process.exit(1); }
  console.log('prog-portaria-outra-equipe: ' + total + ' verificações OK');
})().catch(e => { console.error(e); process.exit(1); });
