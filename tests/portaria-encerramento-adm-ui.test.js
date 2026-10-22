'use strict';
// Portaria 8.1.225 — encerramento administrativo sem horário fictício (tela + fila offline + Frotas).
// O banco é testado em portaria-encerramento-adm-sql.test.mjs; aqui: a tela só encerra pela função do banco (nunca
// 23:59:59, nunca prompt), reconhece encerramento novo e histórico, não sobrescreve nem exclui encerramento, a fila
// offline concilia o retorno real sem descartar nada, custo/KM e ociosidade não contam encerramento como retorno, e
// TMA / Programação de Projetos / Diário / SOT ficam idênticos à 8.1.224.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const off = fs.readFileSync(path.join(raiz, 'portaria-offline.js'), 'utf8').replace(/\r\n/g, '\n');
const ped = fs.readFileSync(path.join(raiz, 'modules', 'frotas', 'pedagios', 'pedagios-service.js'), 'utf8').replace(/\r\n/g, '\n');
const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 500) : '')); }
function fnDe(src, nome) {
  const m = new RegExp('\\n(?:async )?function ' + nome + '\\(').exec(src);
  if (!m) throw new Error('função não encontrada: ' + nome);
  const re = /\n(?:async function |function |var |\/\/ ═|\/\/ ──|\/\*\*|\/\* )/g;
  re.lastIndex = m.index + 12;
  const f = re.exec(src);
  return src.slice(m.index + 1, f ? f.index : undefined);
}
const fn = n => fnDe(html, n);
const semComent = s => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const varLinha = (src, nome) => { const m = new RegExp('\\nvar ' + nome + '\\s*=[\\s\\S]*?;\\n').exec(src); if (!m) throw new Error('var ' + nome); return m[0]; };
const tick = () => new Promise(r => setImmediate(r));

const NOVAS = ['portEncAdm', 'portEncHorarioDesconhecido', 'portEncRpc', 'portEncerrarSaidaAdmin', 'portEncAbrirJanela', 'portEncerrarUmAdmin', 'portEncerrarSelecionadas'];
const codigoNovo = varLinha(html, 'PORT_ENC_PREFIXO') + varLinha(html, 'PORT_ENC_ERROS') + NOVAS.map(fn).join('\n');
ok('ES5 nas funções novas da tela', !/\blet\s|\bconst\s|=>|`/.test(semComent(codigoNovo)));
ok('encerramento nunca grava horário fictício nem usa prompt/confirm', !/23:59/.test(semComent(codigoNovo)) && !/\bprompt\(|\bconfirm\(/.test(semComent(codigoNovo)));
ok('encerramento só pela função do banco (sem sbUpdate direto)', /fn_portaria_encerrar_saida_admin/.test(fn('portEncerrarSaidaAdmin')) && !/sbUpdate\(/.test(fn('portEncerrarSaidaAdmin')));
const offNovas = varLinha(off, 'PORT_OFF_CONC_CONFLITO') + ['portOffEncAdm', 'portOffConciliarRetornoEncerrado', 'portOffReenviarConflitosAdm'].map(n => fnDe(off, n)).join('\n');
ok('ES5 nas funções novas da fila offline (fora async/await já usado)', !/\blet\s|\bconst\s|=>|`/.test(semComent(offNovas)));

// ── Reconhecimento ──
const base = { console: { log() {}, warn() {}, error() {} }, Promise, Object, Array, String, JSON, Date, Number, parseFloat, parseInt, isNaN, setTimeout, Math };
let c = Object.assign({}, base);
vm.createContext(c);
vm.runInContext(codigoNovo, c);
ok('reconhece encerramento novo pelo tipo', c.portEncAdm({ tipo_encerramento: 'ENCERRAMENTO_ADMINISTRATIVO', obs_retorno: null }));
ok('reconhece histórico (23:59) pelo texto', c.portEncAdm({ status: 'Retornado', data_retorno: '2026-09-10T23:59:59', obs_retorno: '[Encerramento administrativo] x' }));
ok('retorno físico não é encerramento', !c.portEncAdm({ status: 'Retornado', data_retorno: '2026-09-10T17:00', obs_retorno: 'ok' }));
ok('tipo vence o texto (conciliado deixa de ser encerramento)', !c.portEncAdm({ tipo_encerramento: 'RETORNO_FISICO', obs_retorno: '[Encerramento administrativo] x' }));
ok('conciliado (prefixo novo) não é encerramento', !c.portEncAdm({ obs_retorno: '[Retorno físico conciliado após encerramento administrativo] x' }));
ok('horário desconhecido: encerramento ou flag do banco', c.portEncHorarioDesconhecido({ retorno_horario_conhecido: false }) && !c.portEncHorarioDesconhecido({ data_retorno: 'x' }));

// ── Encerrar pela tela ──
function ctxTela(rpcResp) {
  const t = Object.assign({}, base, {
    DEMO: false, SB: { url: 'https://x', key: 'anon' }, _sbAuthToken: 'jwt-ok', frt_portaria: [], fetches: [], updates: [], toasts: [], modal: null, _portAbertos: [], _portAbertosSel: {},
    usuarioLogado: { perfil: 'gestor' },
    isUUID: s => /^[0-9a-f-]{36}$/.test(String(s)),
    sbAuthJwtIsAuthenticated: tok => tok === 'jwt-ok',
    cenaAuthGetValidToken: () => Promise.resolve(t._sbAuthToken),
    sbUpdate: (...a) => { t.updates.push(a); return Promise.resolve(true); },
    progShowToast: (m, k) => t.toasts.push([m, k]),
    setModal: h => { t.modal = h; }, closeModal: () => { t.modal = null; },
    escHtml: s => String(s), fmtDT: s => String(s), portNomePorteiroAtual: () => 'Gestor Teste',
    portRenderRetornosAbertos: () => { t.render = (t.render || 0) + 1; },
    portPodeEncerrarAbertos: () => true,
    portKmLerValor: v => (/^\d+$/.test(String(v).trim()) ? parseInt(v, 10) : 0),
    portFotoLer: () => t._foto || null,
  });
  t.fetch = (url, opt) => { t.fetches.push({ url, body: JSON.parse(opt.body) }); const r = rpcResp(url, JSON.parse(opt.body)); return Promise.resolve({ ok: r.status < 300, status: r.status, text: () => Promise.resolve(JSON.stringify(r.body)) }); };
  vm.createContext(t);
  vm.runInContext(codigoNovo, t);
  return t;
}
const ID = '11111111-2222-4333-8444-555555555555';
const okResp = () => ({ status: 200, body: { ok: true, id: ID, idempotente: false, encerrado_em: '2026-10-21T10:00:00Z', encerrado_por: 'Usuário gestor', acompanhantes: 0 } });
(async () => {
  let t = ctxTela(okResp);
  let s = { id: ID, placa: 'TLY9G76', status: 'Em campo', data_saida: '2026-10-16T07:42:52-03:00', km_saida: 41255 };
  t.frt_portaria = [s];
  let r = await t.portEncerrarSaidaAdmin(s, 'Retorno de 16/10 não registrado; horário real desconhecido.', { km_observado: 41700 });
  ok('chama fn_portaria_encerrar_saida_admin com saída, justificativa e evidência', t.fetches.length === 1 && /rpc\/fn_portaria_encerrar_saida_admin$/.test(t.fetches[0].url)
    && t.fetches[0].body.p_saida === ID && /16\/10/.test(t.fetches[0].body.p_justificativa) && t.fetches[0].body.p_evidencia.km_observado === 41700, t.fetches);
  ok('nunca envia 23:59:59 nem data_retorno', !/23:59/.test(JSON.stringify(t.fetches)) && !('data_retorno' in t.fetches[0].body) && t.updates.length === 0);
  ok('memória: Retornado, sem horário e sem KM de retorno, marcado como encerramento', r.ok && s.status === 'Retornado' && s.data_retorno === null && s.km_retorno === null
    && s.tipo_encerramento === 'ENCERRAMENTO_ADMINISTRATIVO' && s.retorno_horario_conhecido === false && /^\[Encerramento administrativo\] Retorno de 16\/10/.test(s.obs_retorno)
    && s.encerrado_por === 'Usuário gestor', s);

  t = ctxTela(() => ({ status: 403, body: { message: 'SEM_PERMISSAO: encerrar saída administrativamente exige PORT_ENCERRAR_SAIDA_ADMIN.' } }));
  s = { id: ID, placa: 'X', status: 'Em campo', data_saida: '2026-10-16T07:00:00Z' };
  r = await t.portEncerrarSaidaAdmin(s, 'Justificativa suficiente aqui.', null);
  ok('sem permissão: erro claro e nada muda na memória', !r.ok && r.codigo === 'SEM_PERMISSAO' && /permissão/.test(r.error) && s.status === 'Em campo' && !s.tipo_encerramento, r);
  t = ctxTela(okResp); t._sbAuthToken = null;
  r = await t.portEncerrarSaidaAdmin({ id: ID, status: 'Em campo' }, 'Justificativa suficiente aqui.', null);
  ok('sem sessão Auth: não chama o servidor (SEM_SESSAO)', !r.ok && r.codigo === 'SEM_SESSAO' && t.fetches.length === 0, r);
  t = ctxTela(okResp);
  r = await t.portEncerrarSaidaAdmin({ id: ID, status: 'Em campo' }, 'curta', null);
  ok('justificativa curta: recusa sem chamar o servidor', !r.ok && r.codigo === 'JUSTIFICATIVA' && t.fetches.length === 0);
  r = await t.portEncerrarSaidaAdmin({ id: 'local_123', status: 'Em campo' }, 'Justificativa suficiente aqui.', null);
  ok('saída ainda local (sem UUID): recusa com orientação', !r.ok && /sincronize/.test(r.error) && t.fetches.length === 0);

  // Janela: justificativa obrigatória; KM do pátio vira evidência
  t = ctxTela(okResp);
  const els = { 'enc-just': { value: '' }, 'enc-km': { value: '' }, 'enc-erro': { textContent: '', style: {} }, 'enc-ok': { disabled: false }, 'enc-cancelar': {} };
  t.document = { getElementById: id => els[id] || null };
  t._portAbertos = [{ id: ID, placa: 'TKK3C13', equipe: 'EJN302', status: 'Em campo', data_saida: '2026-10-16T07:24:00-03:00' }];
  t.portEncerrarUmAdmin(ID);
  await new Promise(r2 => setTimeout(r2, 60));
  ok('janela própria (sem prompt) com justificativa, KM do pátio e foto', /id="enc-just"/.test(t.modal) && /id="enc-km"/.test(t.modal) && /enc-foto-b64/.test(t.modal) && /Não registra horário nem KM de retorno/.test(t.modal));
  els['enc-ok'].onclick();
  ok('janela: sem justificativa não envia', t.fetches.length === 0 && /justificativa/i.test(els['enc-erro'].textContent));
  els['enc-just'].value = 'Veículo conferido no pátio em 21/10; retorno de 16/10 não registrado.'; els['enc-km'].value = '33x';
  els['enc-ok'].onclick();
  ok('janela: KM do pátio inválido não envia', t.fetches.length === 0 && /KM visto no pátio inválido/.test(els['enc-erro'].textContent));
  els['enc-km'].value = '34012'; t._foto = 'data:image/jpeg;base64,FOTO';
  els['enc-ok'].onclick();
  for (let i = 0; i < 20; i++) await tick();
  const b0 = t.fetches[0] && t.fetches[0].body;
  ok('janela: envia justificativa e evidência (KM do pátio + foto), fecha e tira da lista', b0 && b0.p_evidencia.km_observado === 34012 && b0.p_evidencia.foto === 'data:image/jpeg;base64,FOTO'
    && b0.p_evidencia.observado_por === 'Gestor Teste' && t.modal === null && t._portAbertos.length === 0 && /sem horário de retorno/.test(t.toasts[t.toasts.length - 1][0]), { b0, toasts: t.toasts });

  // Em massa: mesma justificativa, uma chamada por saída, sem prompt/confirm
  t = ctxTela(okResp);
  const els2 = { 'enc-just': { value: 'Encerramento administrativo de saídas antigas conferidas.' }, 'enc-erro': { textContent: '', style: {} }, 'enc-ok': { disabled: false }, 'enc-cancelar': {} };
  t.document = { getElementById: id => els2[id] || null };
  const I2 = '22222222-2222-4333-8444-555555555555';
  t._portAbertos = [{ id: ID, placa: 'A', status: 'Em campo' }, { id: I2, placa: 'B', status: 'Em campo' }];
  t._portAbertosSel = { [ID]: true, [I2]: true };
  t.portEncerrarSelecionadas();
  await new Promise(r2 => setTimeout(r2, 60));
  ok('em massa: janela sem KM/foto individuais', /id="enc-just"/.test(t.modal) && !/id="enc-km"/.test(t.modal));
  els2['enc-ok'].onclick();
  for (let i = 0; i < 40; i++) await tick();
  ok('em massa: uma chamada por saída, todas encerradas', t.fetches.length === 2 && t._portAbertos.length === 0 && /Encerradas: 2/.test(t.toasts[t.toasts.length - 1][0]), t.toasts);

  // ── Cópias, fusão, KM, Frotas ──
  const p0 = Object.assign({}, base);
  vm.createContext(p0);
  p0.updates = [];
  Object.assign(p0, {
    DEMO: false, isUUID: s2 => /^[0-9a-f-]{36}$/.test(String(s2)), sbFetch: () => Promise.resolve([{ id: I2 }]),
    sbUpdate: (...a) => { p0.updates.push(a); return Promise.resolve(true); },
    portAplicarFotosPacote: x => x, portMelhorFotoSaida: (a, b2) => a || b2, portExtraScoreSaida: () => 0, portKmParseTs: s2 => (s2 ? Date.parse(s2) : 0),
  });
  vm.runInContext(['portEncAdm', 'portEncHorarioDesconhecido', 'portPreferirSaida', 'portFundirSaidas', 'portSuprimirCloneSaida', 'portKmTsRegistro'].map(fn).join('\n') + '\nvar _portClonesSuprimidos={};', p0);
  p0.portSuprimirCloneSaida({ id: ID, status: 'Retornado', data_retorno: null, obs_retorno: '[Encerramento administrativo] x' }, { id: I2 });
  await tick(); await tick();
  ok('cópia encerrada administrativamente nunca é excluída', p0.updates.length === 0, p0.updates);
  p0.portSuprimirCloneSaida({ id: ID, status: 'Em campo', data_retorno: null }, { id: I2 });
  await tick(); await tick();
  ok('cópia aberta continua sendo suprimida como antes', p0.updates.length === 1 && p0.updates[0][2] === 'deleted_at=is.null&data_retorno=is.null&id=eq.' + ID, p0.updates);
  const encW = { id: ID, status: 'Retornado', data_retorno: null, km_retorno: null, obs_retorno: '[Encerramento administrativo] x', tipo_encerramento: 'ENCERRAMENTO_ADMINISTRATIVO' };
  const loserLocal = { id: 'local_1', status: 'Retornado', data_retorno: '2026-10-16T17:00', km_retorno: 999, km_ajustado_em: '2026-10-17T10:00Z', km_saida: 1 };
  const mg = p0.portFundirSaidas(loserLocal, encW);
  ok('fusão: encerramento vencedor não herda hora/KM de outra cópia', mg.id === ID && mg.data_retorno === null && mg.km_retorno === null && /^\[Encerramento/.test(mg.obs_retorno), mg);
  ok('KM: encerramento ordena pela saída (não pelo 23:59:59)', p0.portKmTsRegistro({ data_saida: '2026-09-10T10:00:00Z', data_retorno: '2026-09-11T02:59:59Z', obs_retorno: '[Encerramento administrativo] x' }) === Date.parse('2026-09-10T10:00:00Z')
    && p0.portKmTsRegistro({ data_saida: '2026-09-10T10:00:00Z', data_retorno: '2026-09-10T20:00:00Z' }) === Date.parse('2026-09-10T20:00:00Z'));

  const custo = fn('frtCustosRender');
  ok('custo/KM: exclui encerramento administrativo e retorno menor que a saída (sem KM negativo)', /portEncAdm\(p\)\) return false/.test(custo) && /!isNaN\(kr\) && kr>ks/.test(custo) && !/\(p\.km_retorno\|\|0\)-\(p\.km_saida\|\|0\)\);\},0\)/.test(custo));
  {
    // mesma regra, executada: 3 viagens (1 normal 100 km, 1 encerrada sem KM, 1 com retorno digitado menor)
    const m = /(var kmsaid=frt_portaria\.filter\([\s\S]*?\},0\);)/.exec(custo);
    const sb = Object.assign({}, base, { v: { placa: 'P1' }, _dataOk: () => true, portEncAdm: c.portEncAdm,
      frt_portaria: [{ placa: 'P1', km_saida: 1000, km_retorno: 1100, status: 'Retornado' }, { placa: 'P1', km_saida: 1100, km_retorno: null, status: 'Retornado', obs_retorno: '[Encerramento administrativo] x' },
        { placa: 'P1', km_saida: 127491, km_retorno: 41445, status: 'Retornado' }] });
    vm.createContext(sb);
    const km = m && vm.runInContext(m[1] + '\nkmsaid', sb);
    ok('custo/KM executado: 100 km (antes: 100 − 1100 − 86046 = negativo)', km === 100, km);
  }
  {
    const oc = Object.assign({}, base, { dataHojeLocal: () => '2026-10-21', ocioCarregarResets: () => {}, _ocioResets: {}, portEncAdm: c.portEncAdm, Set });
    vm.createContext(oc);
    vm.runInContext(fn('_ocioCalcMetricas'), oc);
    const res = oc._ocioCalcMetricas([{ placa: 'P1' }], [{ placa: 'P1', data_saida: '2026-10-19T07:00', km_saida: 1000, km_retorno: 1100 },
      { placa: 'P1', data_saida: '2026-10-20T07:00', km_saida: 1100, km_retorno: null, obs_retorno: '[Encerramento administrativo] x' }], 30)[0];
    ok('ociosidade: encerramento conta como uso, mas não dilui o KM médio', res.nSaidas === 2 && res.diasUsados === 2 && res.kmTotal === 100 && res.kmMedio === 100, res);
  }
  const reg = fn('frtPortariaRender');
  ok('Registros: cartão "Encerradas adm." e Retornados sem encerramento', /l:'Encerradas adm\.'/.test(reg) && /p\.status==='Retornado' && !portEncAdm\(p\)/.test(reg) && /Horário desconhecido/.test(reg));
  ok('Registros: grade comporta 5 cartões', /id="frt-port-metricas"/.test(html) && /grid-template-columns:repeat\(auto-fit,minmax\(120px,1fr\)\);gap:8px;margin-bottom:1rem" id="frt-port-metricas"/.test(html));
  ok('Showroom: "Retornados" não conta encerramento administrativo', /portEncAdm\(s\)\) return false; \/\/ encerramento administrativo não é retorno real/.test(html));
  ok('pedágios: encerramento usa a janela padrão (não até 23:59)', /var t1=\(s\.data_retorno && !encAdm\)\?Date\.parse\(s\.data_retorno\):\(t0\+18\*3600000\)/.test(ped));
  const aj = fn('portSalvarAjusteKm');
  ok('ajuste de KM: encerramento não exige nem altera KM de retorno', /if\(_encAdmAj\) kmR=/.test(aj) && /!_encAdmAj && \(p\.status==='Retornado'/.test(aj) && /disabled\/>/.test(fn('portAbrirAjusteKm')));
  const det = fn('frtPortariaMostrarDetalhe');
  ok('detalhe: "Encerrado administrativamente", horário desconhecido, regularização e evidência', /Encerrado administrativamente/.test(det) && /Horário de retorno desconhecido/.test(det)
    && /Regularizado em/.test(det) && /KM visto no pátio/.test(det) && /horário convencional, não o real/.test(det) && /Evidência do encerramento/.test(det));
  ok('aba Retorno: selo e sem hora de retorno para encerramento', /Encerrado administrativamente/.test(fn('portRenderRetorno')) && /Horário de retorno desconhecido/.test(fn('portRenderRetorno')));
  ok('retorno pelo modal antigo: grava só em saída em campo e confere a linha', /'status=eq\.Em%20campo&id=eq\.'\+_idDb,\{linhas:true\}/.test(fn('frtPortariaAbrirRetornoItem')));

  // ── Fila offline: conciliação ──
  function ctxOff(srv, rpc) {
    const o = Object.assign({}, base, {
      frt_portaria: [{ id: ID, status: 'Retornado', _sync_status: 'PENDENTE' }], rpcs: [], apagadas: 0, updates: [],
      isUUID: s2 => /^[0-9a-f-]{36}$/.test(String(s2)),
      sbFetch: () => Promise.resolve([Object.assign({}, srv)]),
      sbUpdate: (...a) => { o.updates.push(a); return Promise.resolve(false); },
      portOffGetEvent: () => Promise.resolve(null), portOffFetchPorEventId: () => Promise.resolve(null),
      portOffRestaurarFotos: f => Promise.resolve(f || {}), portOffApagarFotos: () => { o.apagadas++; return Promise.resolve(); },
      portUploadFotoSaida: v => Promise.resolve(v), portOffColunaAusente: () => false,
      portOffSaidaVivaEquivalente: () => Promise.resolve({ ok: false }), portOffTrocarIdMemoria: () => {},
      portEncRpc: (f, params) => { o.rpcs.push([f, params]); return Promise.resolve(rpc(params)); },
    });
    vm.createContext(o);
    vm.runInContext(['portOffSyncRetorno', 'portOffMarcarMemoriaConflito'].map(n => fnDe(off, n)).join('\n') + '\n' + offNovas + '\n' + fn('portEncAdm'), o);
    return o;
  }
  const evRet = () => ({ event_id: 'ev-77', tipo_evento: 'RETORNO', dispositivo_id: 'tab-1', status_sync: 'SINCRONIZANDO',
    payload: { saida_id: ID, placa: 'TLY9G76', km_retorno: 41300, data_retorno: '2026-10-16T17:05:00-03:00', obs_retorno: 'voltou', retorno_registrado_por: 'Porteiro 1', fotos: { retorno: 'ref-foto' } } });
  const SRV_ENC = { id: ID, placa: 'TLY9G76', status: 'Retornado', data_retorno: null, km_retorno: null, obs_retorno: '[Encerramento administrativo] x', tipo_encerramento: 'ENCERRAMENTO_ADMINISTRATIVO', km_saida: 41255 };
  let o = ctxOff(SRV_ENC, () => ({ ok: true, data: { ok: true } }));
  let ev = evRet();
  await o.portOffSyncRetorno(ev);
  ok('offline sobre encerramento: chama a conciliação com o horário REAL do evento, KM, placa e id do evento', o.rpcs.length === 1 && o.rpcs[0][0] === 'fn_portaria_converter_retorno_fisico'
    && o.rpcs[0][1].p_data_retorno === '2026-10-16T17:05:00-03:00' && o.rpcs[0][1].p_km_retorno === 41300 && o.rpcs[0][1].p_origem === 'OFFLINE_SINCRONIZADO'
    && o.rpcs[0][1].p_evento_offline === 'ev-77' && o.rpcs[0][1].p_extra.placa === 'TLY9G76' && o.updates.length === 0, o.rpcs);
  ok('offline conciliado: SINCRONIZADO, memória como retorno físico, fotos limpas', ev.status_sync === 'SINCRONIZADO' && o.apagadas === 1
    && o.frt_portaria[0].tipo_encerramento === 'RETORNO_FISICO' && o.frt_portaria[0].km_retorno === 41300);
  o = ctxOff(SRV_ENC, () => ({ ok: false, codigo: 'HORARIO', error: 'Horário do retorno inválido.' }));
  ev = evRet();
  await o.portOffSyncRetorno(ev);
  ok('offline com inconsistência: CONFLITO de encerramento, fotos e dados preservados', ev.status_sync === 'CONFLITO' && ev.conflito_tipo === 'ENCERRAMENTO_ADM'
    && o.apagadas === 0 && ev.payload.fotos && ev.payload.fotos.retorno === 'ref-foto' && /continuam guardados neste tablet/.test(ev.ultimo_erro), ev);
  o = ctxOff(SRV_ENC, () => ({ ok: false, codigo: 'SEM_SESSAO', semAuth: true, error: 'login' }));
  ev = evRet();
  let err = null; try { await o.portOffSyncRetorno(ev); } catch (e) { err = e.message; }
  ok('offline sem sessão: erro de autenticação (fila mantém PENDENTE)', /401|Sessão/.test(err || ''), err);
  o = ctxOff(Object.assign({}, SRV_ENC, { tipo_encerramento: undefined, data_retorno: '2026-09-10T23:59:59-03:00' }), () => ({ ok: true, data: { ok: true } }));
  ev = evRet();
  await o.portOffSyncRetorno(ev);
  ok('offline sobre histórico 23:59 (antes era CONFLITO e perdia o KM): agora concilia', o.rpcs.length === 1 && ev.status_sync === 'SINCRONIZADO');
  ok('descarte de conflitos nunca inclui retorno aguardando o gestor', /e\.conflito_tipo!=='ENCERRAMENTO_ADM'/.test(fnDe(off, 'portOffDescartarConflitos'))
    && /Tentar conciliar de novo/.test(fnDe(off, 'portOffAbrirPainel')));

  // ── Isolamento: TMA, Programação de Projetos, Diário, SOT idênticos à 8.1.224 ──
  let htmlBase;
  try { htmlBase = execSync('git show ' + (process.env.PORT225_BASE || 'a557b5d') + ':index.html', { cwd: raiz, maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8').replace(/\r\n/g, '\n'); }
  catch (e) { console.error('FALHOU: commit base a557b5d (8.1.224) indisponível — isolamento não verificado.'); process.exit(1); }
  const prot = /\n(?:async )?function ((?:progTma\w*|prog(?!Proj|Projeto|Agenda)\w*|_?progProj\w*|progProjetoCore\w*|pp[A-Z]\w*|plpt\w*|_plpt\w*|db[A-Z]\w*|sot\w*))\(/g;
  const nomesP = [...new Set([...htmlBase.matchAll(prot)].map(m => m[1]))];
  const difP = nomesP.filter(n => { try { return fnDe(htmlBase, n) !== fn(n); } catch (e) { return true; } });
  ok('TMA, Programação de Projetos, Diário e SOT idênticos à 8.1.224', difP.length === 0 && nomesP.length > 500, { difP: difP.slice(0, 10), n: nomesP.length });

  if (failed.length) { console.error('FALHOU ' + failed.length + '/' + total + ':\n- ' + failed.join('\n- ')); process.exit(1); }
  console.log('portaria-encerramento-adm-ui: OK (' + total + ' verificações)');
})().catch(e => { console.error(e); process.exit(1); });
