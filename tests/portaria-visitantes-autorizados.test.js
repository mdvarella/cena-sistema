'use strict';
// Portaria 8.1.197 — Autorizados no tablet, visitante Aguardando → Entrou → Saiu, foto por arquivo,
// "Com quem vai falar" com todos os colaboradores e busca, sem crachá. Funções reais em sandbox.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const off = fs.readFileSync(path.join(raiz, 'portaria-offline.js'), 'utf8').replace(/\r\n/g, '\n');
let falhas = 0, total = 0;
function ok(nome, cond, extra) {
  total++;
  if (!cond) { falhas++; console.error('FALHOU: ' + nome + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}
function fnDe(src, nome) {
  const re = new RegExp('\\n(?:async )?function ' + nome + '\\(');
  const n = src.split(re).length - 1;
  if (n !== 1) throw new Error('definição de ' + nome + ': ' + n);
  const ini = src.search(re) + 1;
  return src.slice(ini, src.indexOf('\n}\n', ini) + 2);
}
const fn = n => fnDe(html, n);
const espera = () => new Promise(r => setTimeout(r, 5));

function dom() {
  const els = {};
  return {
    els,
    getElementById(id) { return els[id] || null; },
    el(id, props) { els[id] = Object.assign({ id, value: '', innerHTML: '', style: {} }, props || {}); return els[id]; },
  };
}

async function testesAutorizados() {
  const d = dom();
  d.el('auth-tbody'); d.el('auth-resumo'); d.el('auth-aviso-portaria');
  d.el('auth-ativo-fil', { value: '1' });
  const c = {
    console, Promise, Object, Array, String, JSON,
    DEMO: false, document: d, fetches: 0, resposta: null,
    sbFetch: async () => { c.fetches++; return c.resposta; },
    portPodeCadastrarAutorizado: () => false,
    portAuthCpfDigits: v => String(v || '').replace(/\D/g, ''),
    portAuthEhCpfPendente: () => false,
    portAuthCpfMask: v => v,
    escHtml: v => String(v || ''),
  };
  vm.createContext(c);
  vm.runInContext('var portaria_autorizados = []; var portaria_autorizados_loaded = false;\n'
    + html.slice(html.indexOf('\nvar portaria_autorizados_erro = false;'), html.indexOf('\nfunction portRenderAutorizados('))
    + '\n' + fn('portRenderAutorizados'), c);

  c.resposta = null;
  c.portRenderAutorizados(true); await espera();
  ok('Autorizados: leitura falhou → aviso com Tentar de novo (não "nenhum")', /Não foi possível carregar os autorizados/.test(d.els['auth-tbody'].innerHTML)
    && /portRenderAutorizados\(true\)/.test(d.els['auth-tbody'].innerHTML) && !/Nenhum autorizado/.test(d.els['auth-tbody'].innerHTML), d.els['auth-tbody'].innerHTML);
  ok('Autorizados: falha não marca como carregado', vm.runInContext('portaria_autorizados_loaded', c) === false);

  c.resposta = [{ id: 'a1', nome: 'ANDRE LUIZ', ativo: true, status_acesso: 'Fora', cpf: '1', setor: 'TI' }, { id: 'a2', nome: 'BRUNO', ativo: true, status_acesso: 'No local' }];
  c.portRenderAutorizados(); await espera();
  ok('Autorizados: render sem force tenta de novo após falha', c.fetches === 2 && /ANDRE LUIZ/.test(d.els['auth-tbody'].innerHTML) && /BRUNO/.test(d.els['auth-tbody'].innerHTML));
  c.portRenderAutorizados(); await espera();
  ok('Autorizados: carregado + sem force → usa memória (busca digitada não relê)', c.fetches === 2);
  c.resposta = null;
  c.portRenderAutorizados(true); await espera();
  ok('Autorizados: falha depois de carregar mantém a lista anterior', c.fetches === 3 && /ANDRE LUIZ/.test(d.els['auth-tbody'].innerHTML));
  c.resposta = [];
  c.portRenderAutorizados(true); await espera();
  ok('Autorizados: banco sem registros → "Nenhum autorizado"', /Nenhum autorizado encontrado/.test(d.els['auth-tbody'].innerHTML));
  ok('Autorizados: abrir a aba relê do banco', /if\(aba==='autorizados'\) portRenderAutorizados\(true\);/.test(html));
}

function sandboxVisitas(opts) {
  opts = opts || {};
  const d = dom();
  ['lib-data', 'lib-busca', 'lib-status-fil', 'lib-tbody', 'lib-resumo'].forEach(id => d.el(id));
  const c = {
    console, Promise, Object, Array, String, JSON, Date, window: {},
    DEMO: false, document: d, toasts: [], eventos: [], updates: [], modal: '', fechou: 0,
    _cad_cargos: [{ nome: 'x' }], _portAtiva: { id: 'port1' },
    colaboradores: opts.colabMem || [],
    dataHojeLocal: () => '2026-10-02',
    fmtD: v => v,
    cargoDatalistHtml: () => '<datalist id="lib-cargo-dl"></datalist>',
    setModal(h) { c.modal = h; },
    closeModal() { c.fechou++; },
    setTimeout: f => f(),
    progShowToast(msg, tipo) { c.toasts.push({ msg, tipo: tipo || 'ok' }); },
    portOffNovoId: () => 'loc-1',
    portOffRegistrarVisita(tipo, dados, id) { c.eventos.push({ tipo, dados: JSON.parse(JSON.stringify(dados)), id }); },
    portOffTravar: () => true,
    sbUpdate: async (t, p, f) => { c.updates.push({ t, p, f }); return true; },
    portCarregarVisitas() {},
    sbFetch: async (t, o) => { c.fetchColab = o; return opts.colabs === undefined ? [{ id: 'c1', nome: 'JOSÉ ANTÔNIO SILVA', cargo: 'Eletricista' }, { id: 'c2', nome: 'MARIA <b>LIMA</b>', cargo: 'Supervisora' }] : opts.colabs; },
    _semId: o => o,
  };
  vm.createContext(c);
  const funcs = ['portEsc', 'portVisitaStatus', 'portVisitaCor', 'portVisitaBotoes', 'portHoraAgora', 'portRenderLiberacao', 'portColabsDestino', 'portNormBusca',
    'portDestinoFiltrar', 'portDestinoEscolher', 'portDestinoFechar', 'portVisitaFotoBloco', 'portNovaVisita', 'portVerVisita', 'portLiberarEntradaVisita', 'portRegistrarSaida',
    'portFotoGuardar', 'portFotoLer'];
  vm.runInContext('var portaria_visitas = []; var _portColabsDestino = null; var _portColabsDestinoCarregando = null; var _portKmOcr = null;\n' + funcs.map(fn).join('\n'), c);
  return { c, d };
}

async function testesVisitantes() {
  const { c, d } = sandboxVisitas();
  c.portNovaVisita();
  const m = c.modal;
  ok('modal: sem campos de hora nem crachá', !/lib-hora-ent|lib-hora-sai|lib-cracha|Crachá \/ Catraca/.test(m));
  ok('modal: foto por câmera e por arquivo (input sem capture)', /id="lib-foto-vis-inp" accept="image\/\*" capture="user"/.test(m) && /id="lib-foto-vis-arq" accept="image\/\*" style="display:none"/.test(m)
    && /id="lib-foto-doc-arq" accept="image\/\*" style="display:none"/.test(m) && (m.match(/📁 Arquivo/g) || []).length === 2);
  ok('modal: destino com busca (sem datalist vazio)', /id="lib-destino" autocomplete="off"[^>]*oninput="portDestinoFiltrar\(\)"/.test(m) && /id="lib-destino-sug"/.test(m) && !/lib-destino-list/.test(m));

  d.el('lib-destino', { value: '' }); d.el('lib-destino-sug'); d.el('lib-cargo-dest', { value: '' });
  c.portDestinoFiltrar(); await espera();
  const sug = d.els['lib-destino-sug'];
  ok('destino: busca todos os colaboradores ativos no banco', c.fetchColab && c.fetchColab.filters.indexOf('ativo=eq.true') >= 0 && c.fetchColab.filters.indexOf('deleted_at=is.null') >= 0
    && /JOSÉ ANTÔNIO SILVA/.test(sug.innerHTML) && sug.style.display === 'block');
  ok('destino: nome escapado', /MARIA &lt;b&gt;LIMA&lt;\/b&gt;/.test(sug.innerHTML) && !/<b>LIMA/.test(sug.innerHTML));
  d.els['lib-destino'].value = 'jose silva';
  c.portDestinoFiltrar(); await espera();
  ok('destino: busca por digitação ignora acento e ordem', /JOSÉ ANTÔNIO/.test(sug.innerHTML) && !/MARIA/.test(sug.innerHTML));
  c.portDestinoEscolher(0);
  ok('destino: escolher preenche nome e cargo e fecha a lista', d.els['lib-destino'].value === 'JOSÉ ANTÔNIO SILVA' && d.els['lib-cargo-dest'].value === 'Eletricista' && sug.style.display === 'none');

  d.el('lib-nome', { value: 'Visitante <x>' }); d.el('lib-doc-tipo', { value: 'RG' }); d.el('lib-doc-num', { value: '123' }); d.el('lib-motivo', { value: 'Reunião' });
  d.el('lib-foto-vis-data'); d.el('lib-foto-doc-data');
  const btn = d.el('lib-salvar-btn');
  c.portNovaVisita();
  const foto = 'data:image/jpeg;base64,' + 'A'.repeat(70000);
  c.portFotoGuardar('lib-foto-vis-data', foto);
  btn.onclick();
  const ev = c.eventos[0];
  ok('registrar: entra como Aguardando, sem hora de saída e sem crachá', ev && ev.tipo === 'VISITA_ENTRADA' && ev.dados.status === 'Aguardando' && ev.dados.hora_saida === null
    && !('cracha' in ev.dados) && ev.dados.destino === 'JOSÉ ANTÔNIO SILVA' && ev.dados.portaria_id === 'port1', ev && ev.dados);
  ok('registrar: foto grande vai inteira (não "[mem]")', ev.dados.foto_visitante === foto && d.els['lib-foto-vis-data'].value === '[mem]');
  ok('registrar: aviso escapa o nome', /Visitante &lt;x&gt;/.test(c.toasts[c.toasts.length - 1].msg));
  const v = vm.runInContext('portaria_visitas[0]', c);

  c.portRenderLiberacao();
  const tb = d.els['lib-tbody'].innerHTML;
  ok('lista: Aguardando com botão Liberar entrada (sem Liberar saída)', /Aguardando/.test(tb) && /portLiberarEntradaVisita\('loc-1'\)/.test(tb) && !/portRegistrarSaida/.test(tb));

  c.portRegistrarSaida('loc-1');
  ok('saída antes da entrada: bloqueada', v.status === 'Aguardando' && c.eventos.length === 1 && /Libere a entrada/.test(c.toasts[c.toasts.length - 1].msg));

  c.portLiberarEntradaVisita('loc-1');
  ok('Liberar entrada: status Entrou + hora + evento VISITA_ENTROU', v.status === 'Entrou' && /^\d{2}:\d{2}$/.test(v.hora_entrada)
    && c.eventos[1].tipo === 'VISITA_ENTROU' && c.eventos[1].dados.status === 'Entrou' && c.eventos[1].id === 'loc-1');
  c.portLiberarEntradaVisita('loc-1');
  ok('Liberar entrada 2x: não duplica', c.eventos.length === 2);
  c.portRenderLiberacao();
  ok('lista: Entrou com botão Liberar saída', /Entrou/.test(d.els['lib-tbody'].innerHTML) && /portRegistrarSaida\('loc-1'\)/.test(d.els['lib-tbody'].innerHTML)
    && !/portLiberarEntradaVisita/.test(d.els['lib-tbody'].innerHTML));

  c.portRegistrarSaida('loc-1');
  ok('Liberar saída: status Saiu + hora + evento VISITA_SAIDA', v.status === 'Saiu' && /^\d{2}:\d{2}$/.test(v.hora_saida) && c.eventos[2].tipo === 'VISITA_SAIDA');
  c.portRenderLiberacao();
  ok('lista: Saiu sem botões de liberar', /Saiu/.test(d.els['lib-tbody'].innerHTML) && !/portRegistrarSaida|portLiberarEntradaVisita/.test(d.els['lib-tbody'].innerHTML));
  ok('resumo: contadores Aguardando/Entrou/Saiu', /Entrou/.test(d.els['lib-resumo'].innerHTML) && !/Em visita/.test(d.els['lib-resumo'].innerHTML));

  vm.runInContext("portaria_visitas.push({id:'old',data:'2026-10-02',nome:'Antigo',status:'Em visita',hora_entrada:'08:00'})", c);
  d.els['lib-status-fil'].value = 'Entrou';
  c.portRenderLiberacao();
  ok('status antigo "Em visita" aparece como Entrou (filtro e botão de saída)', /Antigo/.test(d.els['lib-tbody'].innerHTML) && /portRegistrarSaida\('old'\)/.test(d.els['lib-tbody'].innerHTML));

  c.portNovaVisita('loc-1');
  btn.onclick();
  const ed = c.eventos[c.eventos.length - 1];
  ok('editar: não mexe em status nem horários', ed.tipo === 'VISITA_UPDATE' && !('status' in ed.dados) && !('hora_saida' in ed.dados) && !('hora_entrada' in ed.dados) && v.status === 'Saiu');

  c.portVerVisita('old');
  ok('ver visita: botão Liberar saída e sem linha de crachá vazia', /Liberar saída/.test(c.modal) && !/Crachá/.test(c.modal));

  ok('filtro de status da aba: Entrou no lugar de Em visita', /<option value="Entrou">Entrou<\/option>/.test(html) && !/<option value="Em visita">/.test(html));

  const s2 = sandboxVisitas({ colabs: null });
  s2.d.el('lib-destino', { value: '' }); s2.d.el('lib-destino-sug');
  s2.c.portDestinoFiltrar(); await espera();
  ok('destino: falha ao carregar avisa para digitar', /Não foi possível carregar a lista de colaboradores/.test(s2.d.els['lib-destino-sug'].innerHTML));
}

async function testesOffline() {
  const c = {
    console, Promise, Object, Array, String, JSON, Date,
    updates: [], inserts: [], eventos: [],
    portOffRestaurarFotos: async () => ({}),
    portOffFetchPorEventId: async () => null,
    sbInsert: async (t, b) => { c.inserts.push(b); return [{ id: '11111111-1111-1111-1111-111111111111' }]; },
    sbUpdate: async (t, p, f) => { c.updates.push({ p, f }); return true; },
    portOffListEvents: async () => c.eventos,
    portOffPutEvent: async () => {},
    portOffApagarFotos: async () => {},
    isUUID: s => /^[0-9a-f-]{36}$/.test(s),
    portaria_visitas: [],
  };
  vm.createContext(c);
  vm.runInContext(off.slice(off.indexOf('\nvar PORT_OFF_VISITA_CAMPOS_EDICAO'), off.indexOf('\nasync function portOffSyncVisita(')) + '\n'
    + ['portOffSyncVisita', 'portOffOrdenarFila', 'portOffTipoLabel'].map(n => fnDe(off, n)).join('\n'), c);
  const ID = '22222222-2222-2222-2222-222222222222';
  const evt = (tipo, visita, t) => ({ tipo_evento: tipo, event_id: 'e-' + tipo, data_hora_evento: t || '2026-10-02T10:00:00Z', payload: { visita, id_local: ID } });

  await c.portOffSyncVisita(evt('VISITA_ENTROU', { id: ID, hora_entrada: '10:05', status: 'Entrou' }));
  ok('offline: entrada liberada envia hora_entrada + Entrou', JSON.stringify(c.updates[0].p) === JSON.stringify({ hora_entrada: '10:05', status: 'Entrou' }) && c.updates[0].f === 'id=eq.' + ID);
  await c.portOffSyncVisita(evt('VISITA_SAIDA', { id: ID, hora_saida: '11:00', status: 'Saiu' }));
  ok('offline: saída envia hora_saida + Saiu', JSON.stringify(c.updates[1].p) === JSON.stringify({ hora_saida: '11:00', status: 'Saiu' }));
  await c.portOffSyncVisita(evt('VISITA_UPDATE', { id: ID, nome: 'Novo', destino: 'JOSÉ', motivo: 'm', doc_num: '9' }));
  ok('offline: edição sobe os campos editados, sem status', c.updates[2].p.nome === 'Novo' && c.updates[2].p.destino === 'JOSÉ' && c.updates[2].p.doc_num === '9'
    && !('status' in c.updates[2].p) && !('id' in c.updates[2].p), c.updates[2].p);
  await c.portOffSyncVisita(evt('VISITA_UPDATE', { id: ID, nome: 'Velho', status: 'Saiu', hora_saida: '12:00' }));
  ok('offline: edição da versão anterior mantém status/hora de saída', c.updates[3].p.status === 'Saiu' && c.updates[3].p.hora_saida === '12:00' && c.updates[3].p.nome === 'Velho');
  let erro = '';
  c.sbUpdate = async () => false;
  try { await c.portOffSyncVisita(evt('VISITA_ENTROU', { id: ID, hora_entrada: '10:05', status: 'Entrou' })); } catch (e) { erro = e.message; }
  ok('offline: servidor recusou → erro (evento fica na fila)', /não confirmou a entrada/.test(erro));

  const pend = { tipo_evento: 'VISITA_ENTROU', event_id: 'e2', payload: { id_local: 'loc-9', visita: {} } };
  c.eventos = [pend];
  const ins = { tipo_evento: 'VISITA_ENTRADA', event_id: 'e1', data_hora_evento: 'x', payload: { visita: { nome: 'a' }, id_local: 'loc-9' } };
  c.sbInsert = async () => [{ id: '33333333-3333-3333-3333-333333333333' }];
  await c.portOffSyncVisita(ins);
  ok('offline: entrada liberada antes do cadastro subir recebe o id do servidor', pend.payload.id_local === '33333333-3333-3333-3333-333333333333' && pend.depends_on === 'e1');

  const fila = c.portOffOrdenarFila([
    { tipo_evento: 'VISITA_SAIDA', data_hora_evento: '2026-10-02T10:02:00Z' },
    { tipo_evento: 'VISITA_ENTROU', data_hora_evento: '2026-10-02T10:01:00Z' },
    { tipo_evento: 'VISITA_UPDATE', data_hora_evento: '2026-10-02T09:00:00Z' },
    { tipo_evento: 'VISITA_ENTRADA', data_hora_evento: '2026-10-02T10:00:00Z' },
  ]).map(e => e.tipo_evento).join(',');
  ok('offline: ordem cadastro → entrada → saída → edição', fila === 'VISITA_ENTRADA,VISITA_ENTROU,VISITA_SAIDA,VISITA_UPDATE', fila);
  ok('offline: rótulo do evento no painel', c.portOffTipoLabel('VISITA_ENTROU') === 'Visitante — entrada' && c.portOffTipoLabel('VISITA_ENTRADA') === 'Visitante — cadastro');
  ok('offline: VISITA_ENTROU é despachado pela fila', /ev\.tipo_evento==='VISITA_ENTROU' \|\| ev\.tipo_evento==='VISITA_SAIDA'/.test(off));
  ok('versão: tag portaria-offline.js 8.1.197', html.includes('portaria-offline.js?v=8.1.197'));
}

(async () => {
  await testesAutorizados();
  await testesVisitantes();
  await testesOffline();
  if (falhas) { console.error('portaria-visitantes-autorizados: ' + falhas + ' de ' + total + ' falharam'); process.exit(1); }
  console.log('portaria-visitantes-autorizados: ' + total + ' verificações OK');
})().catch(e => { console.error(e); process.exit(1); });
