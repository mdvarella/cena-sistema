'use strict';
// CROQUI-IA-2A (8.1.185) — preenchimento seguro do croqui com IA no Novo/Editar Projeto.
// Executa as funções reais do index.html em sandbox (DOM falso + fetch simulado).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const sw = fs.readFileSync(path.join(raiz, 'sw.js'), 'utf8');
const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

function blocoEm(fonte, inicioRe) {
  const m = inicioRe.exec(fonte);
  if (!m) return null;
  const ini = m.index + 1;
  const re = /\n(?:async function |function |var |\/\*\*|\/\/)/g;
  re.lastIndex = ini + 5;
  const fim = re.exec(fonte);
  return fonte.slice(ini, fim ? fim.index : undefined);
}
function bloco(re) { const b = blocoEm(html, re); if (!b) throw new Error('não encontrado: ' + re); return b; }
const fn = nome => bloco(new RegExp('\\n(?:async )?function ' + nome + '\\('));
const vr = nome => bloco(new RegExp('\\nvar ' + nome + '\\s*='));

const FUNCS = ['sotCroquiIaPrompt', 'sotCroquiNorm', 'sotCroquiEsc', 'sotCroquiJsonCompleto', 'sotCroquiValidarResposta',
  'sotCroquiInterpretarResposta', 'sotCroquiPlanejar', 'sotCroquiAplicarPlano', 'sotCroquiMostrarAvisos',
  '_sotArquivoEhPdf', '_sotParseJsonRespostaIA', '_sotExtrairTextoRespostaIA',
  'projCargoEhSupervisor', 'projCargoEhEncarregado', 'projColabsContratoPorCargo',
  'sotCroquiUrlParaBase64', 'sotAnalisarCroquiIA', 'sotCroquiHandleFile'];
FUNCS.forEach(n => ok('definição única: ' + n, html.split(new RegExp('\\n(?:async )?function ' + n + '\\(')).length === 2));
const codigo = [vr('SOT_CROQUI_IA_PROMPT_VERSAO'), vr('SOT_CROQUI_IA_CAMPOS'), vr('SOT_CROQUI_IA_ROTULOS')].concat(FUNCS.map(fn)).join('\n');

// ─────────── DOM falso ───────────
class El {
  constructor(id, value) { this.id = id; this._v = value == null ? '' : String(value); this.textContent = ''; this.innerHTML = ''; this.style = {}; this.disabled = false; this.isConnected = true; this.tagName = 'INPUT'; }
  get value() { return this._v; }
  set value(v) { this._v = String(v); }
}
class Sel extends El {
  constructor(id, opts, value) { super(id); this.tagName = 'SELECT'; this.opts = opts.slice(); this._v = ''; this.value = value || ''; }
  get value() { return this._v; }
  set value(v) { v = String(v); this._v = this.opts.includes(v) ? v : ''; }
}

const CID = 'cid-1';
const COLABS = [
  { id: 'c1', nome: 'JOÃO DA SILVA', cargo: 'SUPERVISOR DE OBRAS JR', contrato_id: CID, ativo: true },
  { id: 'c2', nome: 'MARIA SOUZA', cargo: 'ENCARREGADO DE OBRAS I', contrato_id: CID, ativo: true },
  { id: 'c3', nome: 'ANA LIMA', cargo: 'SUPERVISOR DE ELETRICA', contrato_id: CID, ativo: true },
  { id: 'c4', nome: 'PEDRO OUTRO', cargo: 'SUPERVISOR', contrato_id: 'cid-2', ativo: true },
  { id: 'c5', nome: 'CARLOS INATIVO', cargo: 'SUPERVISOR', contrato_id: CID, ativo: false }
];
const CLIENTES = [
  { id: 'cli-enel', razao_social: 'ENEL', nome_fantasia: 'ENEL' },
  { id: 'cli-eq', razao_social: 'EQUATORIAL', nome_fantasia: '' },
  { id: 'cli-comgas', razao_social: 'COMGAS', nome_fantasia: 'COMGAS' },
  { id: 'cli-isa', razao_social: 'ISA CTEEP', nome_fantasia: 'CTEEP' }
];
const SUP_OPTS = ['', 'JOÃO DA SILVA', 'ANA LIMA'];
const ENC_OPTS = ['', 'MARIA SOUZA'];

function modal(pre) {
  pre = pre || {};
  const els = {};
  const add = e => { els[e.id] = e; };
  add(new El('sot-p-cont', pre.cont == null ? CID : pre.cont));
  add(new Sel('sot-p-cliente-id', [''].concat(CLIENTES.map(c => c.id)), pre.cliente));
  ['sot-p-codigo', 'sot-p-nome', 'sot-p-cidade', 'sot-p-local', 'sot-p-resp', 'sot-p-obs'].forEach(id => add(new El(id, pre[id])));
  add(new Sel('sot-p-sup', SUP_OPTS, pre.sup));
  add(new Sel('sot-p-enc', ENC_OPTS, pre.enc));
  ['sot-croqui-ia-btn', 'sot-croqui-status', 'sot-croqui-avisos', 'sot-croqui-b64', 'sot-croqui-mime', 'sot-croqui-url', 'sot-croqui-preview', 'sot-croqui-drop'].forEach(id => add(new El(id)));
  return els;
}
const CAMPOS = ['sot-p-cliente-id', 'sot-p-codigo', 'sot-p-nome', 'sot-p-cidade', 'sot-p-local', 'sot-p-resp', 'sot-p-sup', 'sot-p-enc', 'sot-p-obs'];
const foto = els => CAMPOS.map(id => id + '=' + els[id].value).join('|');

function ctxNovo(els, fetchImpl) {
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, Math, Number, String, Object, Array, Date, JSON, Promise, isNaN,
    document: { getElementById: id => els[id] || null, querySelector: () => null, createElement: () => ({ getContext: () => ({ drawImage() {} }) }) },
    window: { location: { href: 'http://x/' } },
    colaboradores: COLABS.map(c => Object.assign({}, c)),
    clientes: CLIENTES.map(c => Object.assign({}, c)),
    _sotCroquiBase64: 'QUJD', _sotCroquiMime: 'application/pdf',
    escHtml: s => String(s || '').replace(/'/g, "\\'").replace(/"/g, '&quot;'),
    progShowToast() {}, chamadas: [],
    fetch: async (url, o) => { ctx.chamadas.push([url, o]); return fetchImpl(url, o); }
  };
  vm.createContext(ctx);
  vm.runInContext(codigo, ctx);
  return ctx;
}
const VAZIO = { cliente: '', codigo_projeto: '', nome_projeto: '', cidade: '', bairro: '', endereco: '', tipo_servico_texto: '', prazo_previsto: '', observacoes: '', campos_com_rotulo_explicito: { supervisor: '', encarregado: '', responsavel_interno: '' } };
function resposta(campos, extra) {
  const obj = JSON.parse(JSON.stringify(VAZIO));
  Object.assign(obj, campos || {});
  if (campos && campos.rot) { delete obj.rot; Object.assign(obj.campos_com_rotulo_explicito, campos.rot); }
  return Object.assign({ content: [{ type: 'text', text: JSON.stringify(obj) }], stop_reason: 'end_turn' }, extra || {});
}
const okResp = body => async () => ({ ok: true, status: 200, json: async () => body });
async function rodar(pre, body, fetchImpl) {
  const els = modal(pre);
  const ctx = ctxNovo(els, fetchImpl || okResp(body));
  await ctx.sotAnalisarCroquiIA();
  return { els, ctx, avisos: els['sot-croqui-avisos'].innerHTML, st: els['sot-croqui-status'].textContent };
}

async function cenarios() {
  // A — campo vazio recebe valor válido
  let r = await rodar({}, resposta({ codigo_projeto: 'DAC/S.SUL.22.00031', nome_projeto: 'ENTERRAMENTO RUA X', endereco: 'Rua X, 100' }));
  ok('A: código vazio é preenchido', r.els['sot-p-codigo'].value === 'DAC/S.SUL.22.00031', r.els['sot-p-codigo'].value);
  ok('A: nome e endereço vazios preenchidos', r.els['sot-p-nome'].value === 'ENTERRAMENTO RUA X' && r.els['sot-p-local'].value === 'Rua X, 100');
  ok('A: status informa quantidade', r.st.includes('IA preencheu 3 campo(s) vazio(s)'), r.st);
  ok('A: botão restaurado', r.els['sot-croqui-ia-btn'].disabled === false && r.els['sot-croqui-ia-btn'].textContent === '🤖 Preencher com IA');

  // B — campo preenchido não é sobrescrito
  r = await rodar({ 'sot-p-codigo': 'MEU-123', 'sot-p-nome': 'Nome manual' }, resposta({ codigo_projeto: 'DAC/S.SUL.22.00031', nome_projeto: 'Outro nome' }));
  ok('B: código manual permanece', r.els['sot-p-codigo'].value === 'MEU-123', r.els['sot-p-codigo'].value);
  ok('B: nome manual permanece', r.els['sot-p-nome'].value === 'Nome manual');
  ok('B: aviso "Valor já preenchido. Sugestão da IA"', r.avisos.includes('Código do projeto: valor já preenchido. Sugestão da IA: DAC/S.SUL.22.00031'), r.avisos);
  ok('B: avisos visíveis', r.els['sot-croqui-avisos'].style.display === 'block');
  r = await rodar({ 'sot-p-codigo': 'dac/s.sul.22.00031' }, resposta({ codigo_projeto: 'DAC/S.SUL.22.00031' }));
  ok('B: mesmo valor (normalizado) não gera aviso', r.els['sot-p-codigo'].value === 'dac/s.sul.22.00031' && !r.avisos.includes('Código'));

  // C — supervisor com match normalizado
  r = await rodar({}, resposta({ rot: { supervisor: '  joao   da  silva ' } }));
  ok('C: supervisor normalizado selecionado', r.els['sot-p-sup'].value === 'JOÃO DA SILVA', r.els['sot-p-sup'].value);
  r = await rodar({}, resposta({ rot: { encarregado: 'Maria Souza' } }));
  ok('C: encarregado normalizado selecionado', r.els['sot-p-enc'].value === 'MARIA SOUZA');

  // D — supervisor inexistente não cria opção
  r = await rodar({}, resposta({ rot: { supervisor: 'Carlos Inventado' } }));
  ok('D: supervisor inexistente não selecionado', r.els['sot-p-sup'].value === '');
  ok('D: nenhuma opção criada', JSON.stringify(r.els['sot-p-sup'].opts) === JSON.stringify(SUP_OPTS), r.els['sot-p-sup'].opts);
  ok('D: aviso "IA encontrou no croqui"', r.avisos.includes('Supervisor: IA encontrou no croqui: Carlos Inventado, mas não foi localizado colaborador correspondente.'), r.avisos);
  r = await rodar({}, resposta({ rot: { supervisor: 'Pedro Outro' } }));
  ok('D: colaborador de outro contrato não conta', r.els['sot-p-sup'].value === '' && r.avisos.includes('não foi localizado'));
  r = await rodar({}, resposta({ rot: { supervisor: 'Carlos Inativo' } }));
  ok('D: colaborador inativo não conta', r.els['sot-p-sup'].value === '');
  r = await rodar({}, resposta({ rot: { supervisor: 'João' } }));
  ok('D: nome parcial não casa', r.els['sot-p-sup'].value === '');
  r = await rodar({ cont: '' }, resposta({ rot: { supervisor: 'João da Silva' } }));
  ok('D: sem contrato selecionado não seleciona', r.els['sot-p-sup'].value === '');

  // E — IA vazia não apaga escolha
  r = await rodar({ sup: 'ANA LIMA', enc: 'MARIA SOUZA', 'sot-p-resp': 'Fulano' }, resposta({ codigo_projeto: 'X1' }));
  ok('E: supervisor permanece', r.els['sot-p-sup'].value === 'ANA LIMA');
  ok('E: encarregado permanece', r.els['sot-p-enc'].value === 'MARIA SOUZA');
  ok('E: responsável permanece', r.els['sot-p-resp'].value === 'Fulano');
  r = await rodar({ sup: 'ANA LIMA' }, resposta({ rot: { supervisor: 'João da Silva' } }));
  ok('E: supervisor diferente não troca a escolha', r.els['sot-p-sup'].value === 'ANA LIMA' && r.avisos.includes('Supervisor: valor já preenchido. Sugestão da IA: JOÃO DA SILVA'), r.avisos);

  // F — encarregado inexistente não grava
  r = await rodar({}, resposta({ rot: { encarregado: 'Encarregado Fantasma' } }));
  ok('F: encarregado inexistente não selecionado', r.els['sot-p-enc'].value === '' && JSON.stringify(r.els['sot-p-enc'].opts) === JSON.stringify(ENC_OPTS));
  ok('F: aviso do encarregado', r.avisos.includes('Encarregado: IA encontrou no croqui: Encarregado Fantasma'));

  // G — cliente já selecionado
  r = await rodar({ cliente: 'cli-isa' }, resposta({ cliente: 'ENEL' }));
  ok('G: cliente permanece', r.els['sot-p-cliente-id'].value === 'cli-isa');
  ok('G: aviso Cliente atual / IA identificou', r.avisos.includes('Cliente atual: ISA CTEEP — IA identificou: ENEL. Cliente não alterado.'), r.avisos);
  r = await rodar({ cliente: 'cli-isa' }, resposta({ cliente: 'Empresa Desconhecida' }));
  ok('G: cliente permanece com IA sem match', r.els['sot-p-cliente-id'].value === 'cli-isa' && r.avisos.includes('Cliente atual: ISA CTEEP'));

  // H — cliente sem match exato
  for (const nome of ['Enel Distribuição São Paulo', 'SA', 'EN', 'ISA', 'CTEEP SA']) {
    r = await rodar({}, resposta({ cliente: nome }));
    ok('H: "' + nome + '" não seleciona cliente', r.els['sot-p-cliente-id'].value === '', r.els['sot-p-cliente-id'].value);
  }
  ok('H: aviso sem correspondência', r.avisos.includes('sem correspondência exata no cadastro'));
  r = await rodar({}, resposta({ cliente: 'enel' }));
  ok('H: match exato normalizado seleciona', r.els['sot-p-cliente-id'].value === 'cli-enel');
  r = await rodar({}, resposta({ cliente: 'Cteep' }));
  ok('H: nome fantasia exato normalizado seleciona', r.els['sot-p-cliente-id'].value === 'cli-isa');
  r = await rodar({}, resposta({ cliente: 'isa cteep' }));
  ok('H: razão social exata normalizada seleciona', r.els['sot-p-cliente-id'].value === 'cli-isa');

  // I — observação repetida
  r = await rodar({ 'sot-p-obs': 'Rede subterrânea — atenção à travessia' }, resposta({ observacoes: 'Rede subterrânea — atenção à travessia' }));
  ok('I: observação igual não duplica', r.els['sot-p-obs'].value === 'Rede subterrânea — atenção à travessia', r.els['sot-p-obs'].value);
  ok('I: sem aviso para observação igual', !r.avisos.includes('Observações'));
  {
    const els = modal({});
    const ctx = ctxNovo(els, okResp(resposta({ observacoes: 'Nota do desenho' })));
    await ctx.sotAnalisarCroquiIA();
    await ctx.sotAnalisarCroquiIA();
    ok('I: reanálise não repete observação', els['sot-p-obs'].value === 'Nota do desenho', els['sot-p-obs'].value);
  }
  r = await rodar({ 'sot-p-obs': 'Texto manual' }, resposta({ observacoes: 'Nota nova do croqui' }));
  ok('I: observação manual não sobrescrita nem acrescida', r.els['sot-p-obs'].value === 'Texto manual' && r.avisos.includes('Observações: campo já preenchido. Sugestão da IA: Nota nova do croqui'));

  // J / K — cidade x bairro
  r = await rodar({}, resposta({ cidade: 'São Paulo', bairro: 'Pirituba' }));
  ok('J: cidade = São Paulo', r.els['sot-p-cidade'].value === 'São Paulo', r.els['sot-p-cidade'].value);
  ok('J: bairro informado sem ir para cidade', r.avisos.includes('Bairro no croqui: Pirituba'));
  r = await rodar({}, resposta({ cidade: '', bairro: 'Pirituba' }));
  ok('K: só bairro → cidade vazia', r.els['sot-p-cidade'].value === '');
  r = await rodar({}, resposta({ cidade: 'Pirituba', bairro: 'Pirituba' }));
  ok('K: bairro repetido em cidade não é aplicado', r.els['sot-p-cidade'].value === '');
  r = await rodar({}, resposta({ cidade: 'PIRITUBA / LAPA', bairro: 'Pirituba' }));
  ok('K: "PIRITUBA / LAPA" com bairro não vira cidade', r.els['sot-p-cidade'].value === '');
  r = await rodar({}, resposta({ cidade: 'PIRITUBA / LAPA', bairro: '' }));
  ok('K: "PIRITUBA / LAPA" sem bairro não vira cidade', r.els['sot-p-cidade'].value === '' && r.avisos.includes('valor ambíguo'));
  r = await rodar({}, resposta({ tipo_servico_texto: 'Enterramento de rede', prazo_previsto: '2026-12-01' }));
  ok('tipo de serviço e prazo só como aviso', r.avisos.includes('Tipo de serviço no croqui: Enterramento de rede') && r.avisos.includes('Prazo no croqui: 2026-12-01') && r.st.includes('não preencheu'));

  // L — fail-closed
  const PRE = { 'sot-p-codigo': 'MEU-1', sup: 'ANA LIMA', cliente: 'cli-enel', 'sot-p-obs': 'obs' };
  const base = foto(modal(PRE));
  const casos = [
    ['JSON inválido', { content: [{ type: 'text', text: 'Não consegui ler o croqui.' }], stop_reason: 'end_turn' }],
    ['JSON truncado', { content: [{ type: 'text', text: '{"cliente":"ENEL","codigo_projeto":"DAC' }], stop_reason: 'end_turn' }],
    ['stop_reason max_tokens', resposta({ cidade: 'São Paulo' }, { stop_reason: 'max_tokens' })],
    ['campo desconhecido', (() => { const b = resposta({ cidade: 'São Paulo' }); const o = JSON.parse(b.content[0].text); o.supervisor = 'X'; b.content[0].text = JSON.stringify(o); return b; })()],
    ['campo ausente', (() => { const b = resposta({ cidade: 'São Paulo' }); const o = JSON.parse(b.content[0].text); delete o.observacoes; b.content[0].text = JSON.stringify(o); return b; })()],
    ['tipo errado', (() => { const b = resposta({ cidade: 'São Paulo' }); const o = JSON.parse(b.content[0].text); o.codigo_projeto = 123; b.content[0].text = JSON.stringify(o); return b; })()],
    ['rótulo desconhecido', (() => { const b = resposta({ cidade: 'São Paulo' }); const o = JSON.parse(b.content[0].text); o.campos_com_rotulo_explicito.projetista = 'Y'; b.content[0].text = JSON.stringify(o); return b; })()],
    ['resposta vazia', { content: [], stop_reason: 'end_turn' }],
    ['erro do modelo', { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }],
    ['content não é lista', { content: { text: '{}' } }]
  ];
  for (const [nome, body] of casos) {
    r = await rodar(PRE, body);
    ok('L: ' + nome + ' → nenhum campo alterado', foto(r.els) === base, foto(r.els));
    ok('L: ' + nome + ' → mensagem amigável', r.st === '⚠ Não foi possível interpretar a análise da IA. Nenhum campo foi alterado.', r.st);
  }
  r = await rodar(PRE, null, async () => ({ ok: true, status: 200, json: async () => { throw new Error('json'); } }));
  ok('L: corpo não-JSON → nada alterado', foto(r.els) === base && r.st.includes('Nenhum campo foi alterado'));

  // M — erro do proxy
  r = await rodar(PRE, null, async () => { throw new Error('Failed to fetch'); });
  ok('M: proxy fora → nenhum campo alterado', foto(r.els) === base && r.st === '⚠ Falha ao consultar a IA. Nenhum campo foi alterado.', r.st);
  r = await rodar(PRE, null, async () => ({ ok: false, status: 502, json: async () => ({}) }));
  ok('M: HTTP 502 → nenhum campo alterado', foto(r.els) === base && r.st === '⚠ Falha ao consultar a IA (HTTP 502). Nenhum campo foi alterado.', r.st);
  ok('M: botão restaurado após erro', r.els['sot-croqui-ia-btn'].disabled === false);

  // Modal fechada durante a análise
  {
    const els = modal({});
    const ctx = ctxNovo(els, async () => { els['sot-croqui-ia-btn'].isConnected = false; return { ok: true, status: 200, json: async () => resposta({ codigo_projeto: 'Z9' }) }; });
    await ctx.sotAnalisarCroquiIA();
    ok('modal fechada durante a análise → nada aplicado', els['sot-p-codigo'].value === '');
  }
  // Escapa texto da IA nos avisos
  r = await rodar({ 'sot-p-codigo': 'X' }, resposta({ codigo_projeto: '<img src=x onerror=alert(1)>' }));
  ok('avisos escapam HTML da IA', r.avisos.includes('&lt;img src=x onerror=alert(1)&gt;') && !r.avisos.includes('<img'), r.avisos);
  // JSON com cercas markdown ainda é aceito (parser robusto)
  r = await rodar({}, { content: [{ type: 'text', text: '```json\n' + resposta({ codigo_projeto: 'P-77' }).content[0].text + '\n```' }], stop_reason: 'end_turn' });
  ok('parser robusto aceita cerca ```json', r.els['sot-p-codigo'].value === 'P-77');
  // null como vazio
  r = await rodar({ sup: 'ANA LIMA' }, (() => { const b = resposta({ codigo_projeto: 'N1' }); const o = JSON.parse(b.content[0].text); o.cidade = null; o.campos_com_rotulo_explicito.supervisor = null; b.content[0].text = JSON.stringify(o); return b; })());
  ok('null tratado como vazio, sem apagar seleção', r.els['sot-p-codigo'].value === 'N1' && r.els['sot-p-sup'].value === 'ANA LIMA' && r.els['sot-p-cidade'].value === '');

  // Requisição ao proxy: mesmo endpoint, modelo e limite; prompt V2
  r = await rodar({}, resposta({}));
  const [url, o] = r.ctx.chamadas[0];
  const body = JSON.parse(o.body);
  ok('proxy inalterado', url === 'https://cena-proxy.marcos-afe.workers.dev');
  ok('modelo e max_tokens inalterados', body.model === 'claude-sonnet-4-5' && body.max_tokens === 1000, body.model);
  ok('PDF enviado como document', body.messages[0].content[0].type === 'document' && body.messages[0].content[0].source.media_type === 'application/pdf');
  const prompt = body.messages[0].content[1].text;
  ok('prompt: não inventar', prompt.includes('Extraia apenas informações efetivamente visíveis no documento.') && prompt.includes('Não complete, não deduza e não invente. Quando não encontrar uma informação, retorne string vazia.'));
  ok('prompt: cidade e bairro separados', prompt.includes('Nunca coloque bairro em cidade'));
  ok('prompt: pessoas só em campos_com_rotulo_explicito', prompt.includes('"campos_com_rotulo_explicito":{"supervisor":"","encarregado":"","responsavel_interno":""}') && !/"supervisor":"nome/.test(prompt));
  ok('prompt: projetista não é colaborador', prompt.includes('Projetista, Desenhista, Responsável técnico e Engenheiro responsável NÃO são'));
  ok('prompt: cliente não por logotipo', prompt.includes('Não deduza pelo logotipo'));
  ok('versão do prompt CROQUI_V2', r.ctx.SOT_CROQUI_IA_PROMPT_VERSAO === 'CROQUI_V2');
  {
    const els = modal({});
    const ctx = ctxNovo(els, okResp(resposta({})));
    ctx._sotCroquiMime = 'image/png';
    await ctx.sotAnalisarCroquiIA();
    const b2 = JSON.parse(ctx.chamadas[0][1].body);
    ok('PNG enviado como image/png', b2.messages[0].content[0].type === 'image' && b2.messages[0].content[0].source.media_type === 'image/png');
  }
}

// ─────────── Upload (regressão PDF/PNG/JPG) ───────────
async function uploads() {
  for (const [nome, tipo, mimeEsperado] of [['croqui.pdf', 'application/pdf', 'application/pdf'], ['croqui.png', 'image/png', 'image/png'], ['croqui.jpg', 'image/jpeg', 'image/jpeg']]) {
    const els = modal({});
    els['sot-croqui-avisos'].innerHTML = 'aviso antigo'; els['sot-croqui-avisos'].style.display = 'block';
    const ctx = ctxNovo(els, okResp(null));
    ctx.FileReader = class { readAsDataURL(f) { this.onload({ target: { result: 'data:' + f.type + ';base64,QUJD' } }); } };
    ctx.sbUpload = async (f, p) => 'https://sb/storage/v1/object/public/cena-docs/' + p;
    ctx.Date = Date;
    ctx.sotCroquiHandleFile({ name: nome, type: tipo });
    await new Promise(r => setTimeout(r, 0));
    ok('upload ' + nome + ': base64 e mime', ctx._sotCroquiBase64 === 'QUJD' && ctx._sotCroquiMime === mimeEsperado, ctx._sotCroquiMime);
    ok('upload ' + nome + ': URL em croquis/', /\/cena-docs\/croquis\/\d+_croqui\.(pdf|png|jpg)$/.test(els['sot-croqui-url'].value), els['sot-croqui-url'].value);
    ok('upload ' + nome + ': botão IA visível', els['sot-croqui-ia-btn'].style.display === '');
    ok('upload ' + nome + ': avisos anteriores limpos', els['sot-croqui-avisos'].innerHTML === '' && els['sot-croqui-avisos'].style.display === 'none');
  }
}

// ─────────── Estáticos / escopo ───────────
function estaticos() {
  const an = fn('sotAnalisarCroquiIA');
  ok('sem JSON.parse(text) direto', !/JSON\.parse\(text\)/.test(an));
  ok('sem includes() no cliente', !/\.includes\(parsed\.cliente/.test(an) && !/includes\(/.test(fn('sotCroquiPlanejar')));
  ok('sem sotProjAtualizarSupEnc com nome da IA', !/sotProjAtualizarSupEnc\(/.test(an));
  ok('closeTruncated nunca decide: exige JSON fechado antes do parser', fn('sotCroquiInterpretarResposta').indexOf('sotCroquiJsonCompleto(text)') < fn('sotCroquiInterpretarResposta').indexOf('_sotParseJsonRespostaIA('));
  ok('modal tem caixa de avisos', fn('sotModalProjeto').includes('id="sot-croqui-avisos"'));
  ok('versão 8.1.185 no log', /\{v:'8\.1\.185'/.test(html));
  const num = /numero: '(8\.1\.\d+)'/.exec(html)[1];
  ok('sw.js na versão atual', sw.includes("'cena-" + num + "'"), num);

  let base = null;
  try { base = execSync('git show a743110:index.html', { cwd: raiz, maxBuffer: 64 * 1024 * 1024 }).toString('utf8').replace(/\r\n/g, '\n'); } catch (e) { base = null; }
  if (!base) { ok('base 8.1.182 disponível', false); return; }
  const nomes = src => [...src.matchAll(/\n(?:async )?function ([\w$]+)\(/g)].map(m => m[1]);
  const blocos = src => { const out = {}; const re = /\n(?:async )?function ([\w$]+)\(/g; let m; while ((m = re.exec(src))) { (out[m[1]] = out[m[1]] || []).push(blocoEm(src.slice(m.index), /\n/)); } return out; };
  // Escopo medido no commit do croqui (8.1.185): versões mescladas depois mexem em outras funções.
  let croqui = null;
  try { croqui = execSync('git show 157dcf9:index.html', { cwd: raiz, maxBuffer: 64 * 1024 * 1024 }).toString('utf8').replace(/\r\n/g, '\n'); } catch (e) { croqui = null; }
  if (!croqui) { ok('commit 8.1.185 disponível', false); return; }
  const bA = blocos(base), bN = blocos(croqui), bAtual = blocos(html);
  const PERMITIDAS = ['sotAnalisarCroquiIA', 'sotCroquiHandleFile', 'sotModalProjeto'];
  const NOVAS = ['sotCroquiIaPrompt', 'sotCroquiNorm', 'sotCroquiEsc', 'sotCroquiJsonCompleto', 'sotCroquiValidarResposta', 'sotCroquiInterpretarResposta', 'sotCroquiPlanejar', 'sotCroquiAplicarPlano', 'sotCroquiMostrarAvisos'];
  const alteradas = Object.keys(bA).filter(n => JSON.stringify(bA[n]) !== JSON.stringify(bN[n] || null));
  ok('somente sotAnalisarCroquiIA, sotCroquiHandleFile e sotModalProjeto alteradas', alteradas.length === PERMITIDAS.length && alteradas.every(n => PERMITIDAS.includes(n)), alteradas);
  // sotModalProjeto também monta o upload da lista de materiais (alterado em 8.1.189): ali só o trecho do croqui é conferido.
  const doCroqui = PERMITIDAS.concat(NOVAS).filter(n => n !== 'sotModalProjeto');
  ok('funções do croqui intactas na versão atual', doCroqui.every(n => JSON.stringify(bN[n]) === JSON.stringify(bAtual[n])),
    doCroqui.filter(n => JSON.stringify(bN[n]) !== JSON.stringify(bAtual[n])));
  const trechoCroqui = b => (b || []).join('\n').split('\n').filter(l => /croqui/i.test(l)).join('\n');
  ok('trecho do croqui em sotModalProjeto intacto', trechoCroqui(bN.sotModalProjeto).length > 500 && trechoCroqui(bN.sotModalProjeto) === trechoCroqui(bAtual.sotModalProjeto));
  const criadas = Object.keys(bN).filter(n => !bA[n]);
  ok('funções novas só do croqui', JSON.stringify(criadas.sort()) === JSON.stringify(NOVAS.slice().sort()), criadas);
  ['_sotParseJsonRespostaIA', 'sotAnalisarListaIA', '_sotAnalisarTextoColado', '_sotAplicarResultadoLista', 'sotProjAtualizarSupEnc', 'projBuildColabOpts',
    'sotSalvarProjeto', 'sotCroquiInitExistente', 'sotCroquiUrlParaBase64', 'sotRemoverCroqui', 'sotSalvarPlanoExecucao', 'wlSalvarDistribuicao']
    .forEach(n => ok('inalterada: ' + n, bA[n] && JSON.stringify(bA[n]) === JSON.stringify(bN[n])));
  ok('nenhuma função removida', nomes(base).every(n => bN[n]));
}

(async () => {
  try {
    await cenarios();
    await uploads();
    estaticos();
  } catch (e) { failed.push('exceção: ' + (e && e.stack || e)); }
  if (failed.length) {
    console.error('FALHOU ' + failed.length + '/' + total + ':\n - ' + failed.join('\n - '));
    process.exit(1);
  }
  console.log('OK sot-croqui-ia-hotfix: ' + total + ' verificações');
})();
