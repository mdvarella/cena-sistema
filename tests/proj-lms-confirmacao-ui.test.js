'use strict';
// ETAPA 1.3 — frontend da Confirmação Humana do LMS (aba "LMS — Confirmação" em Projetos):
// lista RASCUNHOS por sot_lms_rascunhos_listar, estado WL por sot_lms_estado_wl, confirma SÓ por clique + confirm()
// via sot_lms_confirmar(p_importacao_id, p_modo, p_observacao), recarrega após sucesso, erro claro sem permissão.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 400) : '')); }

const INI = '// ETAPA 1.3 — LMS: Confirmação humana do RASCUNHO (Projetos)';
const iBloco = html.indexOf(INI);
const fBloco = html.indexOf('\nfunction renderProjetosPorContrato(', iBloco);
if (iBloco < 0 || fBloco < 0) throw new Error('bloco projLms não encontrado');
const bloco = html.slice(iBloco, fBloco);

function fnTexto(nome) {
  const m = new RegExp('\\n(?:async )?function ' + nome + '\\(').exec(html);
  if (!m) throw new Error('função não encontrada: ' + nome);
  const re = /\n(?:async function |function |var |\/\/ ═)/g;
  re.lastIndex = m.index + 12;
  const fim = re.exec(html);
  return html.slice(m.index + 1, fim ? fim.index : undefined);
}

// ── Estáticos ───────────────────────────────────────────────────
const semComentarios = bloco.replace(/\/\/[^\n]*/g, '');
ok('ES5 no bloco: sem let/const/arrow/template literal',
  !/\blet\s|\bconst\s|=>|`/.test(semComentarios));
// A tela visível de Obras → Projetos é pg-contrato-obras (coAbrirContrato esconde pg-obras-projetos):
// a aba precisa estar nas sub-abas co-tabs, logo depois de "📋 Projetos".
const iCoTabs = html.indexOf('<div id="co-tabs"');
const fCoTabs = html.indexOf('</div>', iCoTabs);
const coTabs = html.slice(iCoTabs, fCoTabs);
const btnsCo = coTabs.match(/<button id="co-tab-[a-z_]+"/g) || [];
ok('aba LMS nas sub-abas do painel de contrato, logo depois de Projetos, oculta por padrão',
  btnsCo[0] === '<button id="co-tab-projetos"' && btnsCo[1] === '<button id="co-tab-lms_confirmar"'
  && /<button id="co-tab-lms_confirmar" onclick="coMostrarTab\('lms_confirmar'\)" style="display:none;/.test(coTabs), btnsCo);
const iPgCo = html.indexOf('<div id="pg-contrato-obras"');
const iCont = html.indexOf('<div id="co-content-lms_confirmar"');
ok('conteúdo LMS dentro de pg-contrato-obras, entre Projetos e Equipe, com lista/mensagem',
  iPgCo > 0 && iCont > html.indexOf('<div id="co-content-projetos"') && iCont < html.indexOf('<div id="co-content-equipe"')
  && html.indexOf('id="proj-lms-lista"') > iCont && html.indexOf('id="proj-lms-msg"') > iCont
  && html.indexOf('id="proj-lms-lista"') < html.indexOf('<div id="co-content-equipe"'));
ok('ids únicos e nada restou em pg-obras-projetos',
  (html.match(/id="proj-lms-lista"/g) || []).length === 1 && (html.match(/id="proj-lms-msg"/g) || []).length === 1
  && (html.match(/id="co-tab-lms_confirmar"/g) || []).length === 1
  && html.indexOf('proj-tab-lms_confirmar') < 0 && html.indexOf('proj-tab-content-lms_confirmar') < 0);
const mostrar = fnTexto('projMostrarTab');
ok('projMostrarTab: lms_confirmar fora das abas de contrato de pg-obras-projetos',
  !/allKeys = \[[^\]]*lms_confirmar/.test(mostrar));
const chamadasConfirmar = html.match(/projLmsConfirmar\(/g) || [];
ok('sem confirmação automática: projLmsConfirmar só na definição e nos 2 onclick (ativar a aba só lista)',
  chamadasConfirmar.length === 3
  && (html.match(/onclick="projLmsConfirmar\(\\''\+id\+'\\',\\'(ESTRUTURA_NOVA|CONCILIACAO)\\'\)"/g) || []).length === 2,
  chamadasConfirmar.length);
ok('sot_lms_confirmar só é chamado dentro de projLmsConfirmar, que exige confirm()',
  (html.match(/'sot_lms_confirmar'/g) || []).length === 1
  && /if\(!ok\) return;[\s\S]*'sot_lms_confirmar'/.test(fnTexto('projLmsConfirmar'))
  && /confirm\(/.test(bloco));
ok('não escreve fora do LMS (sem sbInsert/sbUpdate/sbDelete, WL, materiais, atividades, TMA)',
  !/sbInsert|sbUpdate|sbDelete|sot_wl\b|sot_materiais|sot_atividades|composicao_dia/.test(semComentarios));

// ── Execução (vm) ───────────────────────────────────────────────
const IMP1 = '11111111-1111-4111-8111-111111111111';
const IMP2 = '22222222-2222-4222-8222-222222222222';
const PJ1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PJ2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const HASH = 'ab'.repeat(32);
function itens(opts) {
  opts = opts || {};
  return [
    { id: IMP1, projeto_id: PJ1, projeto_nome: 'Obra Rua das Flores', projeto_codigo: 'OBR-77', tipo_importacao: 'ORIGINAL',
      status: 'RASCUNHO', hash_sha256: HASH, arquivo_nome_original: 'LMS flores.xlsx', qtd_linhas: 42, qtd_wls_distintas: 3,
      criado_em: '2026-10-10T12:30:00Z', pode_confirmar: opts.pode !== false },
    { id: IMP2, projeto_id: PJ2, projeto_nome: 'Obra Av. Central', projeto_codigo: null, tipo_importacao: 'ORIGINAL',
      status: 'RASCUNHO', hash_sha256: HASH, arquivo_nome_original: 'LMS central.xlsx', qtd_linhas: 7, qtd_wls_distintas: 1,
      criado_em: '2026-10-09T08:00:00Z', pode_confirmar: opts.pode !== false }
  ];
}

function montar(cfg) {
  cfg = cfg || {};
  const els = {};
  function el(id) {
    if (!els[id]) els[id] = { id, innerHTML: '', value: '', style: { display: id === 'co-tab-lms_confirmar' ? 'none' : '' } };
    return els[id];
  }
  ['co-tab-lms_confirmar', 'proj-lms-msg', 'proj-lms-lista'].forEach(el);
  const chamadas = { fetch: [], confirm: [] };
  let lista = cfg.lista || itens();
  const resp = cfg.resp || {};
  const sb = {
    console: { error() {}, warn() {}, log() {} },
    DEMO: false,
    SB: { url: 'https://x.supabase.co', key: 'anon' },
    usuarioLogado: cfg.semUsuario ? null : { id: 'u1', nome: 'Gestor' },
    cenaAuthGetValidToken: async () => (cfg.token === undefined ? 'jwt-auth' : cfg.token),
    sbAuthJwtIsAuthenticated: t => t === 'jwt-auth',
    document: { getElementById: id => els[id] || (/^proj-lms-obs-/.test(id) ? el(id) : null) },
    confirm: msg => { chamadas.confirm.push(msg); return cfg.confirmar !== false; },
    fetch: async (url, opt) => {
      const fn = url.split('/rpc/')[1];
      const body = JSON.parse(opt.body || '{}');
      chamadas.fetch.push({ fn, body, auth: opt.headers.Authorization });
      let r;
      if (resp[fn]) r = resp[fn](body);
      else if (fn === 'sot_lms_rascunhos_listar') r = { status: 200, body: lista };
      else if (fn === 'sot_lms_estado_wl') r = { status: 200, body: 'LEGADO_SEM_WL' };
      else if (fn === 'cena_pode') r = { status: 200, body: cfg.pode !== false };
      else if (fn === 'sot_lms_confirmar') {
        lista = lista.filter(x => x.id !== body.p_importacao_id);
        r = { status: 200, body: { operacao: 'CONFIRMADA', importacao_id: body.p_importacao_id, status: 'CONFIRMADA',
          modo: body.p_modo, estado_wl: body.p_modo === 'CONCILIACAO' ? 'EM_CONCILIACAO' : 'ESTRUTURADO' } };
      } else r = { status: 404, body: { code: 'PGRST202', message: 'function not found' } };
      return { ok: r.status < 400, status: r.status, text: async () => JSON.stringify(r.body) };
    }
  };
  vm.createContext(sb);
  vm.runInContext(bloco, sb);
  return { sb, els, el, chamadas, setLista: l => { lista = l; } };
}
const nFetch = (c, fn) => c.chamadas.fetch.filter(x => x.fn === fn);

(async () => {
  // Lista: nome humanizado, dados mínimos, estado WL por projeto
  let t = montar();
  await t.sb.projLmsCarregar();
  let h = t.els['proj-lms-lista'].innerHTML;
  ok('lista mostra nome do projeto (não o id)', h.indexOf('Obra Rua das Flores — OBR-77') >= 0 && h.indexOf('Obra Av. Central') >= 0
    && h.indexOf(PJ1) < 0 && h.indexOf(PJ2) < 0);
  ok('lista mostra tipo, hash, linhas, criado em, estado WL',
    /ORIGINAL/.test(h) && h.indexOf(HASH.slice(0, 12)) >= 0 && h.indexOf('title="' + HASH + '"') >= 0
    && /Linhas:<\/span> 42/.test(h) && /Criado em:<\/span> \d\d\/\d\d\/2026/.test(h) && /Legado \(sem WL\)/.test(h));
  ok('estado WL consultado por projeto distinto via sot_lms_estado_wl',
    nFetch(t, 'sot_lms_estado_wl').length === 2 && nFetch(t, 'sot_lms_estado_wl').every(x => x.body.p_projeto_id));
  ok('botões dos dois modos + campo de observação', h.indexOf('Confirmar como ESTRUTURA_NOVA') >= 0
    && h.indexOf('Confirmar como CONCILIACAO') >= 0 && h.indexOf('id="proj-lms-obs-' + IMP1 + '"') >= 0);
  ok('carregar a lista não confirma nada', nFetch(t, 'sot_lms_confirmar').length === 0 && t.chamadas.confirm.length === 0);
  ok('usa JWT autenticado', t.chamadas.fetch.every(x => x.auth === 'Bearer jwt-auth'));

  // Cancelar no confirm() → nada é enviado
  t = montar({ confirmar: false });
  await t.sb.projLmsCarregar();
  await t.sb.projLmsConfirmar(IMP1, 'ESTRUTURA_NOVA');
  ok('cancelar o confirm() não chama sot_lms_confirmar', t.chamadas.confirm.length === 1 && nFetch(t, 'sot_lms_confirmar').length === 0);

  // ESTRUTURA_NOVA com observação
  t = montar();
  await t.sb.projLmsCarregar();
  t.el('proj-lms-obs-' + IMP1).value = '  conferido com o projetista  ';
  const listAntes = nFetch(t, 'sot_lms_rascunhos_listar').length;
  await t.sb.projLmsConfirmar(IMP1, 'ESTRUTURA_NOVA');
  let c = nFetch(t, 'sot_lms_confirmar');
  ok('ESTRUTURA_NOVA: chama sot_lms_confirmar com (id, modo, observação aparada)', c.length === 1
    && JSON.stringify(c[0].body) === JSON.stringify({ p_importacao_id: IMP1, p_modo: 'ESTRUTURA_NOVA', p_observacao: 'conferido com o projetista' }), c);
  ok('confirm() explica o modo e cita o projeto pelo nome',
    /Obra Rua das Flores/.test(t.chamadas.confirm[0]) && /ESTRUTURA_NOVA/.test(t.chamadas.confirm[0]) && /Nenhuma WL será criada/.test(t.chamadas.confirm[0]));
  h = t.els['proj-lms-lista'].innerHTML;
  ok('após sucesso: lista recarregada e RASCUNHO confirmado removido',
    nFetch(t, 'sot_lms_rascunhos_listar').length === listAntes + 1 && h.indexOf(IMP1) < 0 && h.indexOf(IMP2) >= 0);
  ok('mensagem de sucesso com modo e estado WL',
    /confirmado como ESTRUTURA_NOVA\. Estado WL: Estruturado/.test(t.els['proj-lms-msg'].innerHTML), t.els['proj-lms-msg'].innerHTML);

  // CONCILIACAO sem observação → p_observacao null
  t = montar();
  await t.sb.projLmsCarregar();
  await t.sb.projLmsConfirmar(IMP2, 'CONCILIACAO');
  c = nFetch(t, 'sot_lms_confirmar');
  ok('CONCILIACAO: observação vazia vai como null', c.length === 1 && c[0].body.p_modo === 'CONCILIACAO' && c[0].body.p_observacao === null, c);
  ok('CONCILIACAO: confirm() avisa que não cria estrutura', /Nenhuma estrutura nova será criada/.test(t.chamadas.confirm[0]));
  ok('CONCILIACAO: sucesso mostra Em conciliação', /Estado WL: Em conciliação/.test(t.els['proj-lms-msg'].innerHTML));

  // Erro de permissão vindo do banco
  t = montar({ resp: { sot_lms_confirmar: () => ({ status: 403, body: { code: '42501', message: 'LMS confirmar: SEM_PERMISSAO' } }) } });
  await t.sb.projLmsCarregar();
  const nList = nFetch(t, 'sot_lms_rascunhos_listar').length;
  await t.sb.projLmsConfirmar(IMP1, 'CONCILIACAO');
  let msg = t.els['proj-lms-msg'].innerHTML;
  ok('sem permissão no banco: erro claro citando PROJ_CONFIRMAR_LMS', /Não foi possível confirmar/.test(msg) && /PROJ_CONFIRMAR_LMS/.test(msg), msg);
  ok('erro: lista não recarrega e o item continua com botões habilitados',
    nFetch(t, 'sot_lms_rascunhos_listar').length === nList && t.els['proj-lms-lista'].innerHTML.indexOf('id="proj-lms-btn-cc-' + IMP1 + '" onclick') >= 0);

  // Travas do banco traduzidas
  const casos = [
    ['ORIGINAL_JA_CONFIRMADA', { code: '55000', message: 'LMS confirmar: ORIGINAL_JA_CONFIRMADA' }, /já tem um LMS ORIGINAL confirmado/],
    ['CONCILIACAO_ABERTA', { code: '55000', message: 'LMS confirmar: CONCILIACAO_ABERTA' }, /conciliação em aberto/],
    ['modo diferente', { code: '55000', message: 'LMS confirmar: importação já confirmada com modo CONCILIACAO (pedido: ESTRUTURA_NOVA)' }, /já foi confirmada em outro modo/],
    ['inexistente', { code: 'P0002', message: 'LMS confirmar: importação inexistente' }, /não encontrada/],
    ['função ausente', { code: 'PGRST202', message: 'Could not find the function' }, /aplique as migrations/]
  ];
  for (const [nome, body, re] of casos) {
    t = montar({ resp: { sot_lms_confirmar: () => ({ status: body.code === 'PGRST202' ? 404 : 400, body }) } });
    await t.sb.projLmsCarregar();
    await t.sb.projLmsConfirmar(IMP1, 'ESTRUTURA_NOVA');
    ok('trava do banco traduzida: ' + nome, re.test(t.els['proj-lms-msg'].innerHTML), t.els['proj-lms-msg'].innerHTML);
  }

  // pode_confirmar = false → sem botões, aviso claro, sem chamada
  t = montar({ lista: itens({ pode: false }) });
  await t.sb.projLmsCarregar();
  h = t.els['proj-lms-lista'].innerHTML;
  ok('sem PROJ_CONFIRMAR_LMS no projeto: sem botões e aviso claro',
    h.indexOf('Confirmar como') < 0 && /não tem a permissão PROJ_CONFIRMAR_LMS/.test(h));
  await t.sb.projLmsConfirmar(IMP1, 'ESTRUTURA_NOVA');
  ok('sem permissão: projLmsConfirmar não chama o banco', nFetch(t, 'sot_lms_confirmar').length === 0 && t.chamadas.confirm.length === 0);

  // Duplo clique → uma chamada só
  t = montar();
  await t.sb.projLmsCarregar();
  await Promise.all([t.sb.projLmsConfirmar(IMP1, 'ESTRUTURA_NOVA'), t.sb.projLmsConfirmar(IMP1, 'ESTRUTURA_NOVA')]);
  ok('duplo clique envia uma única confirmação', nFetch(t, 'sot_lms_confirmar').length === 1);

  // Modo/ids inválidos ou item fora da lista
  t = montar();
  await t.sb.projLmsCarregar();
  await t.sb.projLmsConfirmar(IMP1, 'XPTO');
  await t.sb.projLmsConfirmar('nao-uuid', 'CONCILIACAO');
  await t.sb.projLmsConfirmar('33333333-3333-4333-8333-333333333333', 'CONCILIACAO');
  ok('modo inválido / id inválido / id fora da lista: nada enviado', nFetch(t, 'sot_lms_confirmar').length === 0 && t.chamadas.confirm.length === 0);

  // Login MD5 (sem JWT autenticado)
  t = montar({ token: 'anon-key' });
  await t.sb.projLmsCarregar();
  ok('login MD5: lista avisa que precisa de sessão Auth e não chama o banco',
    /Sessão Auth obrigatória/.test(t.els['proj-lms-lista'].innerHTML) && t.chamadas.fetch.length === 0);

  // Lista vazia / erro de lista
  t = montar({ lista: [] });
  await t.sb.projLmsCarregar();
  ok('lista vazia: mensagem amigável', /Nenhum LMS em RASCUNHO/.test(t.els['proj-lms-lista'].innerHTML));
  t = montar({ resp: { sot_lms_rascunhos_listar: () => ({ status: 404, body: { code: 'PGRST202', message: 'Could not find the function' } }) } });
  await t.sb.projLmsCarregar();
  ok('sem a migration de listagem: erro claro', /aplique as migrations/.test(t.els['proj-lms-lista'].innerHTML));

  // Estado WL indisponível não derruba a lista
  t = montar({ resp: { sot_lms_estado_wl: () => ({ status: 403, body: { code: '42501', message: 'LMS estado: acesso negado (SEM_PERMISSAO)' } }) } });
  await t.sb.projLmsCarregar();
  h = t.els['proj-lms-lista'].innerHTML;
  ok('estado WL negado: mostra "indisponível" e mantém a lista', /indisponível/.test(h) && h.indexOf('Obra Rua das Flores') >= 0);

  // Escape de HTML
  t = montar({ lista: [Object.assign(itens()[0], { projeto_nome: '<img src=x onerror=alert(1)>' })] });
  await t.sb.projLmsCarregar();
  ok('nome do projeto é escapado', t.els['proj-lms-lista'].innerHTML.indexOf('<img') < 0);

  // Aba visível só com cena_pode(PROJ_CONFIRMAR_LMS)
  t = montar({ pode: true });
  await t.sb.projLmsVerificarAba();
  let cp = nFetch(t, 'cena_pode');
  ok('com permissão: aba aparece (cena_pode PROJ_CONFIRMAR_LMS)',
    t.els['co-tab-lms_confirmar'].style.display === '' && cp.length === 1 && cp[0].body.p_acao === 'PROJ_CONFIRMAR_LMS');
  await t.sb.projLmsVerificarAba();
  ok('verificação da aba é cacheada por usuário', nFetch(t, 'cena_pode').length === 1);
  t = montar({ pode: false });
  await t.sb.projLmsVerificarAba();
  ok('sem permissão: aba continua oculta', t.els['co-tab-lms_confirmar'].style.display === 'none');
  t = montar({ semUsuario: true });
  await t.sb.projLmsVerificarAba();
  ok('sem usuário logado: aba oculta e sem chamada', t.els['co-tab-lms_confirmar'].style.display === 'none' && t.chamadas.fetch.length === 0);

  // ── Ativação real da aba (coMostrarTab / projMostrarTab executados) ──
  function montarNav(cfg) {
    cfg = cfg || {};
    const els = {};
    const mk = (id, hidden) => {
      const cls = new Set(hidden ? ['hidden'] : []);
      els[id] = { id, innerHTML: '', value: '', style: { display: '' },
        classList: { contains: c => cls.has(c), add: c => cls.add(c), remove: c => cls.delete(c), toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)) } };
      return els[id];
    };
    ['projetos', 'lms_confirmar', 'equipe', 'programacao', 'servicos', 'materiais', 'indicadores'].forEach(a => {
      mk('co-tab-' + a); mk('co-content-' + a).style.display = a === 'projetos' ? '' : 'none';
    });
    els['co-tab-lms_confirmar'].style.display = 'none';
    mk('pg-contrato-obras', !cfg.painelAberto);
    mk('proj-lms-msg'); mk('proj-lms-lista');
    const log = { render: [], abrir: [], fetch: [] };
    const sb = {
      console: { error() {}, warn() {}, log() {} },
      DEMO: false, SB: { url: 'https://x.supabase.co', key: 'anon' },
      usuarioLogado: { id: 'u1' }, window: {},
      _coContratoAtual: 'c1', _coTabAtual: 'projetos',
      cenaAuthGetValidToken: async () => 'jwt-auth', sbAuthJwtIsAuthenticated: t => t === 'jwt-auth',
      document: { getElementById: id => els[id] || null },
      confirm: () => { throw new Error('confirm não pode ser chamado ao ativar a aba'); },
      fetch: async (url, opt) => {
        const fn = url.split('/rpc/')[1];
        log.fetch.push(fn);
        const body = fn === 'cena_pode' ? true : fn === 'sot_lms_rascunhos_listar' ? itens() : fn === 'sot_lms_estado_wl' ? 'LEGADO_SEM_WL' : null;
        return { ok: true, status: 200, text: async () => JSON.stringify(body) };
      },
      coRenderProjetos: () => log.render.push('projetos'), coRenderEquipe: () => log.render.push('equipe'),
      coRenderProgramacao() {}, coRenderServicos() {}, coRenderMateriais() {}, coRenderIndicadores() {}, _coEnsureComposicao() {},
      verificarContratoObras() {}, sotInit() {},
      coAbrirContrato: cid => { log.abrir.push(cid); els['pg-contrato-obras'].classList.remove('hidden'); }
    };
    vm.createContext(sb);
    vm.runInContext(bloco + '\n' + fnTexto('coMostrarTab') + '\n' + fnTexto('projMostrarTab'), sb);
    return { sb, els, log };
  }
  const espera = () => new Promise(r => setTimeout(r, 0));

  let n = montarNav({ painelAberto: true });
  n.sb.coMostrarTab('lms_confirmar');
  await espera(); await espera(); await espera();
  ok('clique (coMostrarTab) ativa botão LMS e desativa Projetos',
    n.els['co-tab-lms_confirmar'].style.borderBottomColor === '#1a1a18' && n.els['co-tab-lms_confirmar'].style.fontWeight === '700'
    && n.els['co-tab-projetos'].style.borderBottomColor === 'transparent', n.els['co-tab-lms_confirmar'].style);
  ok('clique mostra só o conteúdo LMS',
    n.els['co-content-lms_confirmar'].style.display === '' && n.els['co-content-projetos'].style.display === 'none'
    && n.els['co-content-equipe'].style.display === 'none');
  ok('clique carrega a lista (projLmsCarregar) e não renderiza Projetos',
    n.log.fetch.indexOf('sot_lms_rascunhos_listar') >= 0 && n.log.render.length === 0
    && /Obra Rua das Flores/.test(n.els['proj-lms-lista'].innerHTML));
  ok('ativar a aba não confirma nada', n.log.fetch.indexOf('sot_lms_confirmar') < 0);
  ok('ao abrir o painel, a aba aparece para quem tem PROJ_CONFIRMAR_LMS', n.els['co-tab-lms_confirmar'].style.display === '');
  n.sb.coMostrarTab('projetos');
  ok('voltar para Projetos esconde o conteúdo LMS',
    n.els['co-content-lms_confirmar'].style.display === 'none' && n.els['co-content-projetos'].style.display === '' && n.log.render[0] === 'projetos');

  n = montarNav({ painelAberto: true });
  n.sb.projMostrarTab('lms_confirmar');
  await espera(); await espera();
  ok("projMostrarTab('lms_confirmar') com painel aberto ativa botão, conteúdo e carregamento",
    n.els['co-content-lms_confirmar'].style.display === '' && n.els['co-tab-lms_confirmar'].style.fontWeight === '700'
    && n.log.fetch.indexOf('sot_lms_rascunhos_listar') >= 0 && n.log.abrir.length === 0);

  n = montarNav({ painelAberto: false });
  n.sb.projMostrarTab('lms_confirmar');
  ok("projMostrarTab('lms_confirmar') com painel fechado abre o painel pelo caminho normal",
    n.log.abrir.length === 1 && n.log.abrir[0] === '04277076-baa5-4ea4-85dc-bddf55541e68', n.log.abrir);
  n.sb.coMostrarTab('projetos'); // o que coAbrirContrato chama ao terminar de carregar
  await espera(); await espera();
  ok('…e quando o painel termina de abrir, cai na aba LMS (uma vez só)',
    n.els['co-content-lms_confirmar'].style.display === '' && n.log.render.length === 0
    && n.log.fetch.indexOf('sot_lms_rascunhos_listar') >= 0);
  n.sb.coMostrarTab('projetos');
  ok('pedido pendente é consumido: próxima abertura volta ao normal (Projetos)',
    n.els['co-content-projetos'].style.display === '' && n.log.render[0] === 'projetos');

  n = montarNav({ painelAberto: false });
  n.sb.coAbrirContrato = cid => { n.log.abrir.push(cid); }; // contrato não abre (ex.: fora da lista)
  n.sb.projMostrarTab('lms_confirmar');
  n.els['pg-contrato-obras'].classList.remove('hidden');
  n.sb.coMostrarTab('projetos');
  ok('se o painel não abrir, o pedido LMS não vaza para a próxima abertura',
    n.els['co-content-projetos'].style.display === '' && n.log.render[0] === 'projetos');

  if (failed.length) {
    console.log(`proj-lms-confirmacao-ui: FALHOU ${failed.length}/${total}`);
    for (const f of failed) console.log('  - ' + f);
    process.exit(1);
  }
  console.log(`proj-lms-confirmacao-ui: OK (${total} verificações)`);
})().catch(e => { console.error(e); process.exit(1); });
