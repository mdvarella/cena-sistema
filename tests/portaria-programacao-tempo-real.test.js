'use strict';
// PORTARIA 8.1.179 — troca de veículo na Programação não chegava na Portaria (caso EIN182 30/09:
// programação RTQ7D55, portaria TTK1E99). A Portaria carregava prog_veiculos_dia/composicao_dia uma vez
// por data e nunca relia. Agora relê do servidor por Realtime + polling, fail-closed.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const sw = fs.readFileSync(path.join(raiz, 'sw.js'), 'utf8');
const mig = fs.readFileSync(path.join(raiz, 'supabase', 'migrations', '20260930170000_realtime_portaria_programacao.sql'), 'utf8');
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
const varLinha = nome => { const m = new RegExp('\\nvar ' + nome + ' = [^\\n]+').exec(html); if (!m) throw new Error('var ' + nome); return m[0]; };

const FUNCS = ['isUUID', 'progVeiculoKey', 'progVeiculoKeyB', 'progVeiculoKeyEhDoDia', 'progGetVeiculo', 'portDiaISO', 'portPlacaProgramada',
  'portMesclarComposicao', 'portPaginaVisivel', 'portDataExibida', 'portSincronizarProgramacaoDia', 'portRerenderPlacas', 'portSyncProgRodar',
  'portSyncProgAgendar', 'portSyncProgEvento', 'portSyncProgAssinar', 'portSyncProgFecharCanal', 'portSyncProgGarantir', 'portSyncProgIniciar', 'portSyncProgParar'];
const CODIGO = [varLinha('PORT_SYNC_PROG_POLL_MS'), varLinha('_portSyncProg')].concat(FUNCS.map(fn)).join('\n');

const DIA = '2026-09-30';
const OUTRO = '2026-09-29';
const EIN = '89439605-5f84-4640-826a-d011e5525120';
const OUT = '0958ce02-490a-44b7-986a-e640b5ed0547';
const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';

function el(id, props) { return Object.assign({ id, style: { display: '' }, value: '', classList: { _h: false, contains(c) { return c === 'hidden' && this._h; } } }, props || {}); }

function ctx(opts) {
  opts = opts || {};
  const els = {
    'pg-frotas-portaria': el('pg-frotas-portaria'),
    'port-eq-data': el('port-eq-data', { value: opts.data || DIA }),
    'port-aba-equipes': el('port-aba-equipes'),
    'port-aba-saida': el('port-aba-saida', { style: { display: 'none' } }),
  };
  if (opts.paginaOculta) els['pg-frotas-portaria'].classList._h = true;
  const timers = [];
  const intervals = [];
  const c = {
    console: { log() {}, warn() {} }, Object, String, Number, Promise, Array, JSON, Date, Math, isNaN,
    DEMO: false,
    _progVeiculos: opts.mem || {},
    composicao_dia: opts.comps || [],
    banco: opts.banco || { prog_veiculos_dia: [], composicao_dia: [] },
    falha: opts.falha || {},
    fetches: [],
    renders: [],
    listeners: {},
    timers, intervals,
    document: {
      hidden: !!opts.docOculto,
      getElementById: id => els[id] || null,
      addEventListener(ev, f) { c.listeners['doc:' + ev] = f; },
    },
    window: { _portEqDiaBuscado: {}, addEventListener(ev, f) { c.listeners['win:' + ev] = f; } },
    setTimeout(f, ms) { timers.push({ f, ms }); return timers.length; },
    clearTimeout(id) { if (id && timers[id - 1]) timers[id - 1].f = null; },
    setInterval(f, ms) { intervals.push({ f, ms, on: true }); return intervals.length; },
    clearInterval(id) { if (id && intervals[id - 1]) intervals[id - 1].on = false; },
    dataHojeLocal: () => DIA,
    progFindCompDia: (eq, d) => c.composicao_dia.find(x => String(x.equipe_id) === String(eq) && String(x.data).slice(0, 10) === d) || null,
    portFindCompProgramada: (eq, d) => c.progFindCompDia(eq, d),
    portRenderEquipesDia() { c.renders.push('equipes'); },
    portRenderAguardando() { c.renders.push('saida'); },
    sbFetch(tabela, o) {
      c.fetches.push([tabela, o]);
      if (c.falha[tabela] === 'null') return Promise.resolve(null);
      if (c.falha[tabela] === 'rejeita') return Promise.reject(new Error('rede'));
      return Promise.resolve((c.banco[tabela] || []).map(r => JSON.parse(JSON.stringify(r))));
    },
  };
  if (opts.offline) c.portOffIsOnline = () => false;
  if (opts.realtime) {
    c.canais = [];
    c.removidos = [];
    c.supabaseClient = {
      channel(nome) {
        const ch = { nome, ons: [], on(ev, filtro, cb) { this.ons.push({ ev, filtro, cb }); return this; }, subscribe(cb) { this.cbStatus = cb; return this; } };
        c.canais.push(ch);
        return ch;
      },
      removeChannel(ch) { c.removidos.push(ch); },
    };
  } else c.supabaseClient = null;
  c.portRenderEquipesDia._veicBuscado = {};
  vm.createContext(c);
  vm.runInContext(CODIGO, c);
  c.els = els;
  return c;
}
const rodarTimers = async c => { const t = c.timers.splice(0); for (const x of t) if (x.f) await x.f(); await new Promise(r => setImmediate(r)); };

async function main() {
  // ─── 1. Caso EIN182: memória com TTK1E99 (antiga), servidor com RTQ7D55 ───
  let c = ctx({
    mem: { [EIN + '_' + DIA]: { placa: 'TTK1E99', modelo: 'VW/DELIVERY 11.180' }, [EIN + '_' + OUTRO]: { placa: 'AAA1A11' } },
    comps: [{ id: C1, equipe_id: EIN, data: DIA, placa: 'TTK1E99', _portaria_liberado: true }],
    banco: {
      prog_veiculos_dia: [
        { id: 'pv1', equipe_id: EIN, data: DIA, slot: 1, placa: 'RTQ7D55', modelo: 'ACCELO 1016 CE', veiculo_id: 'v-rtq' },
        { id: 'pv2', equipe_id: OUT, data: DIA, slot: 1, placa: 'TTK1E99', modelo: 'VW/DELIVERY 11.180', veiculo_id: 'v-ttk' },
      ],
      composicao_dia: [{ id: C1, equipe_id: EIN, data: DIA, placa: 'RTQ7D55', veiculo_id: 'v-rtq' }],
    },
  });
  ok('EIN182: antes mostra a placa antiga', c.portPlacaProgramada(EIN, DIA) === 'TTK1E99');
  let mudou = await c.portSincronizarProgramacaoDia(DIA);
  ok('EIN182: sync informa mudança', mudou === true);
  ok('EIN182: depois mostra a placa da programação', c.portPlacaProgramada(EIN, DIA) === 'RTQ7D55', c._progVeiculos);
  ok('EIN182: modelo da programação', c._progVeiculos[EIN + '_' + DIA].modelo === 'ACCELO 1016 CE');
  ok('EIN182: TTK1E99 foi para a outra equipe', c.portPlacaProgramada(OUT, DIA) === 'TTK1E99');
  ok('EIN182: composicao_dia atualizada', c.composicao_dia[0].placa === 'RTQ7D55');
  ok('EIN182: preserva _portaria_liberado', c.composicao_dia[0]._portaria_liberado === true);
  ok('EIN182: outra data intocada', c._progVeiculos[EIN + '_' + OUTRO].placa === 'AAA1A11');
  const fv = c.fetches.find(f => f[0] === 'prog_veiculos_dia');
  ok('fetch prog_veiculos_dia do dia sem apagados', fv && fv[1].filters.includes('data=eq.' + DIA) && fv[1].filters.includes('deleted_at=is.null'), fv);
  const fc = c.fetches.find(f => f[0] === 'composicao_dia');
  ok('fetch composicao_dia do dia', fc && fc[1].filters.includes('data=eq.' + DIA), fc);
  ok('marca veículos do dia como buscados', c.portRenderEquipesDia._veicBuscado[DIA] === true);
  ok('marca composição do dia como buscada', c.window._portEqDiaBuscado['c:' + DIA] === true);

  mudou = await c.portSincronizarProgramacaoDia(DIA);
  ok('servidor igual: sem mudança', mudou === false);

  c.banco.prog_veiculos_dia[0].placa = 'GGB8G11';
  mudou = await c.portSincronizarProgramacaoDia(DIA);
  ok('nova troca: detecta', mudou === true && c.portPlacaProgramada(EIN, DIA) === 'GGB8G11');

  // ─── 2. Placa em cache vinda da composição antiga é substituída ───
  c = ctx({
    comps: [{ id: C1, equipe_id: EIN, data: DIA, placa: 'TTK1E99' }],
    banco: { prog_veiculos_dia: [], composicao_dia: [{ id: C1, equipe_id: EIN, data: DIA, placa: 'RTQ7D55' }] },
  });
  ok('cache: progGetVeiculo guarda placa da composição', c.portPlacaProgramada(EIN, DIA) === 'TTK1E99' && c._progVeiculos[EIN + '_' + DIA]);
  await c.portSincronizarProgramacaoDia(DIA);
  ok('cache: chave sem linha no servidor é removida e placa vem da composição nova', c.portPlacaProgramada(EIN, DIA) === 'RTQ7D55', c._progVeiculos);

  // ─── 3. Slot 2 não sobrescreve o veículo principal ───
  c = ctx({ banco: { prog_veiculos_dia: [
    { id: 'a', equipe_id: EIN, data: DIA, slot: 1, placa: 'RTQ7D55' },
    { id: 'b', equipe_id: EIN, data: DIA, slot: 2, placa: 'ZZZ9Z99' },
  ], composicao_dia: [] } });
  await c.portSincronizarProgramacaoDia(DIA);
  ok('slot 1 na chave principal', c._progVeiculos[EIN + '_' + DIA].placa === 'RTQ7D55');
  ok('slot 2 na chave _b', c._progVeiculos[EIN + '_' + DIA + '_b'].placa === 'ZZZ9Z99');
  ok('portaria mostra slot 1', c.portPlacaProgramada(EIN, DIA) === 'RTQ7D55');
  c.banco.prog_veiculos_dia.pop();
  await c.portSincronizarProgramacaoDia(DIA);
  ok('slot 2 removido no servidor sai da memória', !c._progVeiculos[EIN + '_' + DIA + '_b']);

  // ─── 4. Fail-closed ───
  const memBase = () => ({ [EIN + '_' + DIA]: { placa: 'TTK1E99' } });
  const compBase = () => [{ id: C1, equipe_id: EIN, data: DIA, placa: 'TTK1E99' }];
  c = ctx({ mem: memBase(), comps: compBase(), falha: { prog_veiculos_dia: 'null', composicao_dia: 'null' } });
  mudou = await c.portSincronizarProgramacaoDia(DIA);
  ok('falha nas duas leituras: nada muda', mudou === false && c._progVeiculos[EIN + '_' + DIA].placa === 'TTK1E99' && c.composicao_dia.length === 1);

  c = ctx({ mem: memBase(), comps: compBase(), falha: { prog_veiculos_dia: 'rejeita', composicao_dia: 'rejeita' } });
  mudou = await c.portSincronizarProgramacaoDia(DIA);
  ok('erro de rede: nada muda', mudou === false && c._progVeiculos[EIN + '_' + DIA].placa === 'TTK1E99' && c.composicao_dia.length === 1);

  c = ctx({ mem: memBase(), comps: compBase(), falha: { prog_veiculos_dia: 'null' },
    banco: { composicao_dia: [{ id: C1, equipe_id: EIN, data: DIA, placa: 'RTQ7D55' }] } });
  await c.portSincronizarProgramacaoDia(DIA);
  ok('falha só em prog_veiculos_dia: memória de veículos preservada', c._progVeiculos[EIN + '_' + DIA].placa === 'TTK1E99');
  ok('falha só em prog_veiculos_dia: composição atualizada', c.composicao_dia[0].placa === 'RTQ7D55');

  c = ctx({ mem: memBase(), comps: compBase(), falha: { composicao_dia: 'null' },
    banco: { prog_veiculos_dia: [] } });
  await c.portSincronizarProgramacaoDia(DIA);
  ok('falha só em composicao_dia: composição preservada', c.composicao_dia.length === 1 && c.composicao_dia[0].placa === 'TTK1E99');

  c = ctx({ mem: memBase(), offline: true });
  mudou = await c.portSincronizarProgramacaoDia(DIA);
  ok('offline: não busca nem altera', mudou === false && c.fetches.length === 0 && c._progVeiculos[EIN + '_' + DIA].placa === 'TTK1E99');

  c = ctx({ mem: memBase() });
  c.DEMO = true;
  mudou = await c.portSincronizarProgramacaoDia(DIA);
  ok('DEMO: não busca', mudou === false && c.fetches.length === 0);

  // lista no limite pode estar cortada → não remove
  const mil = Array.from({ length: 1000 }, (_, i) => ({ id: 'x' + i, equipe_id: 'eq' + i, data: DIA, slot: 1, placa: 'P' + i }));
  c = ctx({ mem: { [EIN + '_' + DIA]: { placa: 'TTK1E99' } }, banco: { prog_veiculos_dia: mil, composicao_dia: [] } });
  await c.portSincronizarProgramacaoDia(DIA);
  ok('1000 linhas (possível corte): não remove o que não veio', c._progVeiculos[EIN + '_' + DIA].placa === 'TTK1E99' && c._progVeiculos['eq5_' + DIA].placa === 'P5');

  // ─── 5. Composição removida no servidor ───
  c = ctx({
    comps: [
      { id: C1, equipe_id: EIN, data: DIA, placa: 'RTQ7D55' },
      { id: C2, equipe_id: OUT, data: DIA, placa: 'TTK1E99' },
      { id: 'tmp_local', equipe_id: 'x', data: DIA, placa: 'LOC1A11' },
      { id: '33333333-3333-4333-8333-333333333333', equipe_id: 'y', data: OUTRO, placa: 'ONT1A11' },
    ],
    banco: { prog_veiculos_dia: [], composicao_dia: [{ id: C1, equipe_id: EIN, data: DIA, placa: 'RTQ7D55' }] },
  });
  await c.portSincronizarProgramacaoDia(DIA);
  const ids = c.composicao_dia.map(x => x.id);
  ok('composição apagada no servidor sai da memória', !ids.includes(C2), ids);
  ok('composição local sem id do banco é mantida', ids.includes('tmp_local'), ids);
  ok('composição de outra data é mantida', ids.includes('33333333-3333-4333-8333-333333333333'), ids);

  // ─── 6. Leitura concorrente: uma requisição por vez, releitura agendada ───
  c = ctx({ banco: { prog_veiculos_dia: [], composicao_dia: [] } });
  const p1 = c.portSincronizarProgramacaoDia(DIA);
  const p2 = c.portSincronizarProgramacaoDia(DIA);
  ok('concorrente: mesma promessa', p1 === p2);
  await p1;
  ok('concorrente: 2 fetches só (1 rodada)', c.fetches.length === 2, c.fetches.length);
  ok('concorrente: releitura agendada', c.timers.some(t => t.f));

  // ─── 7. Rodar re-renderiza só quando muda e só a aba visível ───
  c = ctx({ banco: { prog_veiculos_dia: [{ id: 'a', equipe_id: EIN, data: DIA, slot: 1, placa: 'RTQ7D55' }], composicao_dia: [] } });
  await c.portSyncProgRodar();
  ok('rodar: primeira leitura re-renderiza Equipes', c.renders.join() === 'equipes', c.renders);
  await c.portSyncProgRodar();
  ok('rodar: sem mudança não re-renderiza', c.renders.length === 1, c.renders);
  c.els['port-aba-equipes'].style.display = 'none';
  c.els['port-aba-saida'].style.display = '';
  c.banco.prog_veiculos_dia[0].placa = 'GGB8G11';
  await c.portSyncProgRodar();
  ok('rodar: aba Saída visível re-renderiza Saída', c.renders.join() === 'equipes,saida', c.renders);

  c = ctx({ paginaOculta: true, banco: { prog_veiculos_dia: [], composicao_dia: [] } });
  await c.portSyncProgRodar();
  c.portSyncProgAgendar();
  ok('página da Portaria oculta: não busca nem agenda', c.fetches.length === 0 && c.timers.length === 0);
  c = ctx({ docOculto: true });
  c.portSyncProgAgendar();
  ok('aba do navegador oculta: não agenda', c.timers.length === 0);

  // ─── 8. Realtime ───
  c = ctx({ realtime: true, banco: { prog_veiculos_dia: [{ id: 'a', equipe_id: EIN, data: DIA, slot: 1, placa: 'RTQ7D55' }], composicao_dia: [] } });
  c.portSyncProgGarantir(DIA);
  c.portSyncProgGarantir(DIA);
  ok('realtime: um canal só', c.canais.length === 1, c.canais.length);
  ok('realtime: um polling só', c.intervals.length === 1 && c.intervals[0].ms === 20000, c.intervals);
  const tabs = c.canais[0].ons.map(o => o.ev + ':' + o.filtro.schema + '.' + o.filtro.table + ':' + o.filtro.event).sort();
  ok('realtime: escuta prog_veiculos_dia e composicao_dia', JSON.stringify(tabs) === JSON.stringify(['postgres_changes:public.composicao_dia:*', 'postgres_changes:public.prog_veiculos_dia:*']), tabs);
  ok('realtime: ouvintes visibilitychange/online', typeof c.listeners['doc:visibilitychange'] === 'function' && typeof c.listeners['win:online'] === 'function');
  await rodarTimers(c);
  const f0 = c.fetches.length;
  ok('realtime: primeira data sincroniza', f0 === 2, f0);
  ok('realtime: re-render após primeira leitura', c.renders.length === 1);

  c.banco.prog_veiculos_dia[0].placa = 'GGB8G11';
  const cbVeic = c.canais[0].ons.find(o => o.filtro.table === 'prog_veiculos_dia').cb;
  cbVeic({ eventType: 'UPDATE', new: { equipe_id: EIN, data: OUTRO, placa: 'X' }, old: {} });
  ok('realtime: evento de outra data ignorado', c.timers.filter(t => t.f).length === 0);
  cbVeic({ eventType: 'UPDATE', new: { equipe_id: EIN, data: DIA, placa: 'GGB8G11' }, old: {} });
  cbVeic({ eventType: 'UPDATE', new: { equipe_id: EIN, data: DIA, placa: 'GGB8G11' }, old: {} });
  ok('realtime: eventos seguidos viram uma leitura (debounce)', c.timers.filter(t => t.f).length === 1);
  await rodarTimers(c);
  ok('realtime: evento do dia relê e mostra a troca', c.portPlacaProgramada(EIN, DIA) === 'GGB8G11' && c.renders.length === 2, c.renders);
  cbVeic({ eventType: 'DELETE', new: {}, old: { id: 'a' } });
  ok('realtime: DELETE sem data também agenda', c.timers.filter(t => t.f).length === 1);
  await rodarTimers(c);

  // polling
  c.banco.prog_veiculos_dia[0].placa = 'HHH1H11';
  await c.intervals[0].f();
  await new Promise(r => setImmediate(r));
  ok('polling: relê e mostra a troca', c.portPlacaProgramada(EIN, DIA) === 'HHH1H11');

  // troca de data exibida
  c.els['port-eq-data'].value = OUTRO;
  c.portSyncProgGarantir(OUTRO);
  ok('troca de data: agenda leitura', c.timers.some(t => t.f));
  await rodarTimers(c);
  ok('troca de data: lê a data nova', c.fetches.slice(-2).every(f => f[1].filters.includes('data=eq.' + OUTRO)));

  // erro de canal: fecha e segue no polling, sem reabrir em seguida
  c.canais[0].cbStatus('CHANNEL_ERROR');
  ok('canal com erro: removido', c.removidos.length === 1 && c._portSyncProg.canal === null);
  c.portSyncProgGarantir(OUTRO);
  ok('canal com erro: não reabre na hora', c.canais.length === 1);
  ok('canal com erro: polling continua', c.intervals[0].on === true);

  // parar
  c._portSyncProg.falhouEm = 0;
  c.portSyncProgGarantir(OUTRO);
  ok('reabre depois da espera', c.canais.length === 2);
  c.portSyncProgParar();
  ok('parar: fecha canal e polling', c.removidos.length === 2 && c.intervals[0].on === false && c._portSyncProg.poll === null && c._portSyncProg.canal === null);

  c = ctx({ realtime: true });
  c.canais.length = 0;
  c.portSyncProgGarantir(DIA);
  c.canais[0].cbStatus('SUBSCRIBED');
  ok('SUBSCRIBED agenda leitura (cobre troca feita antes de assinar)', c.timers.filter(t => t.f).length >= 1);

  c = ctx({});
  c.portSyncProgGarantir(DIA);
  ok('sem supabaseClient: só polling', c.intervals.length === 1 && c._portSyncProg.canal === null);

  // ─── 9. Ligações no index.html ───
  const rend = fn('portRenderEquipesDia');
  ok('Equipes: liga sincronização com a data exibida', /portSyncProgGarantir\(data\)/.test(rend));
  ok('Equipes: carga inicial põe slot 2 em progVeiculoKeyB', /Number\(r\.slot\)===2 \? progVeiculoKeyB\(r\.equipe_id,_veicKey\) : progVeiculoKey\(r\.equipe_id,_veicKey\)/.test(rend));
  ok('Equipes: carga inicial não grava mais r.equipe_id+"_"+_veicKey direto', !/_progVeiculos\[r\.equipe_id\+'_'\+_veicKey\]/.test(rend));
  const init = fn('frtInit');
  ok('frtInit: slot 2 em progVeiculoKeyB', /Number\(r\.slot\)===2 \? progVeiculoKeyB\(r\.equipe_id,hoje\)/.test(init));
  ok('frtInit: não grava mais r.equipe_id+"_"+hoje direto', !/_progVeiculos\[r\.equipe_id\+'_'\+hoje\]/.test(init));
  ok('portMostrarAba: Equipes/Saída chamam portSyncProgIniciar', /\(aba==='equipes' \|\| aba==='saida'\) && typeof portSyncProgIniciar==='function'\) portSyncProgIniciar\(\)/.test(fn('portMostrarAba')));
  ok('logout desliga Realtime/polling', /portSyncProgParar\(\)/.test(fn('cenaAuthStopAuthenticatedLoops')));

  // ─── 10. Migration e versão ───
  ok('migration: publicação supabase_realtime', /ALTER PUBLICATION supabase_realtime ADD TABLE public\.%I/.test(mig));
  ok('migration: as duas tabelas', /ARRAY\['prog_veiculos_dia', 'composicao_dia'\]/.test(mig));
  ok('migration: idempotente', /pg_publication_tables/.test(mig));
  ok('migration: PARAR sem publicação', /PARAR: publicação supabase_realtime não existe/.test(mig));
  ok('migration: sem DELETE/UPDATE/DROP fora do desfazer', !/^\s*(DELETE|UPDATE|DROP|TRUNCATE)\b/im.test(mig.split('-- Para desfazer')[0]));
  const ver = /numero:\s*'([\d.]+)'/.exec(html)[1];
  ok('log da versão 8.1.179', html.includes("{v:'8.1.179'"));
  ok('sw.js acompanha a versão', sw.includes("SW_VERSION   = 'cena-" + ver + "'"));

  if (failed.length) { console.log('portaria-programacao-tempo-real: FALHOU ' + failed.length + '/' + total); failed.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
  console.log('portaria-programacao-tempo-real: OK ' + total + ' checagens');
}
main().catch(e => { console.error(e); process.exit(1); });
