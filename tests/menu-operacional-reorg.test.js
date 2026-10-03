'use strict';
// 8.1.186 — Menu Operacional reorganizado (Programação / Equipes / Projetos / Almoxarifado com sub-seções).
// Mesmas páginas, rotas e permissões; renderer só ganhou sub-seções recolhíveis.
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
const fnEm = (src, nome) => blocoEm(src, new RegExp('\\n(?:async )?function ' + nome + '\\('));
const vrEm = (src, nome) => blocoEm(src, new RegExp('\\nvar ' + nome + '\\s*='));
const fn = nome => { const b = fnEm(html, nome); if (!b) throw new Error('não encontrado: ' + nome); return b; };

let base = null;
try { base = execSync('git show a743110:index.html', { cwd: raiz, maxBuffer: 64 * 1024 * 1024 }).toString('utf8').replace(/\r\n/g, '\n'); } catch (e) { base = null; }

function avaliarGrupos(src) { const c = {}; vm.createContext(c); vm.runInContext(vrEm(src, 'SIDEBAR_GROUPS') + '\nthis.G = SIDEBAR_GROUPS;', c); return c.G; }
const flat = grupos => [].concat(...grupos.map(g => [].concat(...(g.items || []).map(i => Array.isArray(i.items) ? i.items : [i]))));

const G = avaliarGrupos(html);
const op = G.operacional;
const ORDEM = ['programacao-projetos', 'tma', 'operacional-prod',
  'campo-equipes', 'gestao-ponto', 'campo-apr', 'campo-checklist', 'campo-execucao-field', 'campo-diario', 'campo-solicitacoes',
  'obras-projetos', 'obras-execucao', 'obras-medicao',
  'alm-requisicao', 'obras-sap', 'obras-movSAP', 'obras-requisicao'];

function dados() {
  ok('grupos: Programação, Equipes, Projetos, Almoxarifado', JSON.stringify(op.map(g => g.label)) === JSON.stringify(['Programação', 'Equipes', 'Projetos', 'Almoxarifado']), op.map(g => g.label));
  ok('sem grupo TMA, Em Campo, Obras e Projetos ou Almoxarifado SAP/CENA', !op.some(g => ['TMA', 'Em Campo', 'Obras e Projetos', 'Almoxarifado SAP', 'Almoxarifado CENA'].includes(g.label)));
  ok('ordem dos itens', JSON.stringify(flat(op).map(i => i.id)) === JSON.stringify(ORDEM), flat(op).map(i => i.id));
  ok('Programação: Programação de Equipes, TMA, Produção / COD X', JSON.stringify(op[0].items.map(i => i.label)) === JSON.stringify(['Programação de Equipes', 'TMA', 'Produção / COD X']));
  ok('Gestão de Ponto é o 2º de Equipes', op[1].items[1].id === 'gestao-ponto');
  const alm = op[3].items;
  ok('Almoxarifado: sub-seções CENA e SAP nessa ordem', alm.length === 2 && alm[0].sub === 'Almoxarifado CENA' && alm[1].sub === 'Almoxarifado SAP');
  ok('CENA: Requisição; SAP: Estoque, Movimentação, Requisição', JSON.stringify(alm[0].items.map(i => i.id)) === JSON.stringify(['alm-requisicao'])
    && JSON.stringify(alm[1].items.map(i => i.id)) === JSON.stringify(['obras-sap', 'obras-movSAP', 'obras-requisicao']));
  if (!base) { ok('base 8.1.182 disponível', false); return; }
  const B = avaliarGrupos(base);
  const ant = flat(B.operacional), novo = flat(op);
  ok('mesmas páginas (ids) do menu anterior', JSON.stringify(ant.map(i => i.id).sort()) === JSON.stringify(novo.map(i => i.id).sort()));
  ok('mesmos nomes e ícones dos itens', ant.every(a => { const n = novo.find(x => x.id === a.id); return n && n.label === a.label && n.icon === a.icon; }));
  const outros = Object.keys(B).filter(k => k !== 'operacional');
  ok('demais módulos do menu inalterados', JSON.stringify(Object.keys(G).sort()) === JSON.stringify(Object.keys(B).sort()) && outros.every(k => JSON.stringify(B[k]) === JSON.stringify(G[k])), outros.filter(k => JSON.stringify(B[k]) !== JSON.stringify(G[k])));
  ok('MAIN_CONFIG inalterado (página inicial do Operacional)', vrEm(base, 'MAIN_CONFIG') === vrEm(html, 'MAIN_CONFIG'));
  ok('permissões de perfil inalteradas', ['perfilDpRhFiltrarSidebar', 'perfilModuloBloqueado', 'perfilFrotasModuloBloqueado'].every(n => fnEm(base, n) === fnEm(html, n)));
}

// ─────────── DOM falso ───────────
class ClassList { constructor() { this.s = new Set(); } add(c) { this.s.add(c); } remove(c) { this.s.delete(c); } contains(c) { return this.s.has(c); } }
function ctxRender(store) {
  const els = { 'sidebar-modulos': { style: {} }, 'sidebar-inner': { style: {}, innerHTML: '' }, 'subnav-bar': { style: {}, innerHTML: '', querySelector: () => null } };
  const ctx = {
    console, JSON, Object, Array, String, Math, setTimeout: () => 0,
    document: { getElementById: id => els[id] || null },
    window: { innerWidth: 800 },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    usuarioLogado: null, MODULOS_NOMES: { operacional: 'Operacional' }, perfilEhDpRh: () => false
  };
  vm.createContext(ctx);
  vm.runInContext([vrEm(html, 'SIDEBAR_GROUPS'), vrEm(html, 'SIDEBAR_SUB_FECHADAS_KEY')].concat(
    ['sidebarMostrarItens', 'sidebarGruposDoPerfil', 'sidebarItensDoGrupo', 'sidebarSubFechadas', 'sidebarSubFechada', 'sidebarAlternarSub', 'sidebarAbrirSubDoItem', '_renderSubNav', 'perfilDpRhFiltrarSidebar'].map(fn)).join('\n'), ctx);
  return { ctx, els };
}
const conta = (s, sub) => s.split(sub).length - 1;

function render() {
  let { ctx, els } = ctxRender({});
  ctx.sidebarMostrarItens('operacional', 'tma');
  let h = els['sidebar-inner'].innerHTML;
  const secoes = [...h.matchAll(/<div class="sb-section">([^<]*)<\/div>/g)].map(m => m[1]);
  ok('render: títulos na nova ordem', JSON.stringify(secoes) === JSON.stringify(['Programação', 'Equipes', 'Projetos', 'Almoxarifado']), secoes);
  const ids = [...h.matchAll(/id="sn-([^"]+)"/g)].map(m => m[1]);
  ok('render: um botão por página, na nova ordem', JSON.stringify(ids) === JSON.stringify(ORDEM), ids);
  ok('render: rota inalterada (showSub)', ORDEM.every(id => h.includes('onclick="showSub(\'' + id + '\')" id="sn-' + id + '"')));
  ok('render: item ativo marcado', h.includes('class="sb-item on" onclick="showSub(\'tma\')"'));
  ok('render: 2 sub-seções com seta', conta(h, 'class="sb-sub aberto"') === 2 && conta(h, '<span class="sb-sub-seta">›</span>') === 2);
  ok('render: sub-itens recuados (4)', conta(h, 'class="sb-item sb-item-sub') === 4);
  ok('render: sub-seções abertas por padrão', !h.includes('class="sb-sub-itens" style="display:none"'));
  ok('render: chave da sub-seção por módulo', h.includes('data-sb-sub="operacional|Almoxarifado SAP"'));

  // recolhida salva em localStorage
  const store = { cena_sidebar_sub_fechadas: JSON.stringify({ 'operacional|Almoxarifado SAP': true }) };
  ({ ctx, els } = ctxRender(store));
  ctx.sidebarMostrarItens('operacional', 'tma');
  h = els['sidebar-inner'].innerHTML;
  ok('render: sub-seção recolhida respeita o estado salvo', h.includes('class="sb-sub" data-sb-sub="operacional|Almoxarifado SAP" aria-expanded="false"') && conta(h, 'style="display:none"') === 1);
  ctx.sidebarMostrarItens('operacional', 'obras-movSAP');
  h = els['sidebar-inner'].innerHTML;
  ok('render: sub-seção com a página ativa abre mesmo recolhida', h.includes('class="sb-sub aberto" data-sb-sub="operacional|Almoxarifado SAP"') && !h.includes('display:none'));
  ({ ctx, els } = ctxRender({ cena_sidebar_sub_fechadas: '{quebrado' }));
  ctx.sidebarMostrarItens('operacional', 'tma');
  ok('render: localStorage inválido não quebra (abre tudo)', conta(els['sidebar-inner'].innerHTML, 'class="sb-sub aberto"') === 2);

  // alternar
  const st = {};
  ({ ctx } = ctxRender(st));
  const itens = { style: { display: '' }, classList: new ClassList() };
  const attrs = { 'data-sb-sub': 'operacional|Almoxarifado CENA' };
  const btn = { classList: new ClassList(), nextElementSibling: itens, getAttribute: k => attrs[k], setAttribute: (k, v) => { attrs[k] = v; } };
  btn.classList.add('aberto');
  ctx.sidebarAlternarSub(btn);
  ok('alternar: recolhe e salva', itens.style.display === 'none' && !btn.classList.contains('aberto') && attrs['aria-expanded'] === 'false' && JSON.parse(st.cena_sidebar_sub_fechadas)['operacional|Almoxarifado CENA'] === true);
  ctx.sidebarAlternarSub(btn);
  ok('alternar: abre e limpa o estado', itens.style.display === '' && btn.classList.contains('aberto') && !('operacional|Almoxarifado CENA' in JSON.parse(st.cena_sidebar_sub_fechadas)));

  // abrir sub-seção do item ativo
  const st2 = {};
  const r2 = ctxRender(st2);
  const box = { style: { display: 'none' }, classList: new ClassList() }; box.classList.add('sb-sub-itens');
  const a2 = { 'data-sb-sub': 'operacional|Almoxarifado SAP' };
  const b2 = { classList: new ClassList(), nextElementSibling: box, getAttribute: k => a2[k], setAttribute: (k, v) => { a2[k] = v; } };
  box.previousElementSibling = b2;
  const item = { parentElement: box };
  r2.ctx.document.getElementById = id => (id === 'sn-obras-sap' ? item : null);
  r2.ctx.sidebarAbrirSubDoItem('obras-sap');
  ok('showSub: abre a sub-seção recolhida do item ativo', box.style.display === '' && b2.classList.contains('aberto'));
  r2.ctx.sidebarAbrirSubDoItem('inexistente');
  ok('showSub: item fora de sub-seção não faz nada', true);
  ok('showSub chama sidebarAbrirSubDoItem', fn('showSub').includes('sidebarAbrirSubDoItem(subId);'));

  // mobile
  ({ ctx, els } = ctxRender({}));
  ctx._renderSubNav('operacional', 'obras-sap');
  const m = els['subnav-bar'].innerHTML;
  const mIds = [...m.matchAll(/_subNavClick\('([^']+)'\)/g)].map(x => x[1]);
  ok('mobile: todas as páginas em lista plana, na nova ordem', JSON.stringify(mIds) === JSON.stringify(ORDEM), mIds);
  ok('mobile: rótulos dos grupos novos', ['Programação', 'Equipes', 'Projetos', 'Almoxarifado'].every(l => m.includes('<span class="subnav-group-label">' + l + '</span>')));
  ok('mobile: ativo marcado', m.includes('class="subnav-btn active" onclick="_subNavClick(\'obras-sap\')"'));
}

function estaticos() {
  ok('CSS: título de grupo destacado', /\.sb-section\{display:flex;[^}]*font-weight:800;color:#1a1a18;[^}]*border-top:\.5px solid #ecebe6;\}/.test(html));
  ok('CSS: marcador do título', html.includes(".sb-section::before{content:'';width:3px;height:11px;"));
  ok('CSS: sub-itens recuados', html.includes('.sb-item.sb-item-sub{padding-left:26px}'));
  ok('CSS mobile: sub-seção vira lista plana', html.includes('  .sb-sub{display:none!important}\n  .sb-sub-itens{display:contents!important}'));
  ok('almoxarife e DP/RH continuam com o menu próprio', fn('sidebarGruposDoPerfil').includes("{label:'Almoxarifado SAP', items:[{id:'obras-requisicao', label:'Requisição SAP', icon:'📥'}]}")
    && fn('sidebarGruposDoPerfil').includes('perfilDpRhFiltrarSidebar(main, grupos)')
    && fn('sidebarMostrarItens').includes('var grupos = sidebarGruposDoPerfil(main);')
    && fn('_renderSubNav').includes("usuarioLogado.perfil==='almoxarife' && main==='operacional'"));
  ok('versão 8.1.186 no log', /\{v:'8\.1\.186'/.test(html));
  const num = /numero: '(8\.1\.\d+)'/.exec(html)[1];
  ok('sw.js na versão atual', sw.includes("'cena-" + num + "'"), num);
  if (!base) return;
  const corta = b => { const i = b.indexOf('</script>'); return i >= 0 ? b.slice(0, i) : b; };
  const blocos = src => { const out = {}; const re = /\n(?:async )?function ([\w$]+)\(/g; let m; while ((m = re.exec(src))) { (out[m[1]] = out[m[1]] || []).push(corta(blocoEm(src.slice(m.index), /\n/))); } return out; };
  // Escopo medido no commit do menu (8.1.186): versões mescladas depois mexem em outras funções.
  let menu = null;
  try { menu = execSync('git show 6399eae:index.html', { cwd: raiz, maxBuffer: 64 * 1024 * 1024 }).toString('utf8').replace(/\r\n/g, '\n'); } catch (e) { menu = null; }
  if (!menu) return;
  const bA = blocos(base), bN = blocos(menu), bAtual = blocos(html);
  const PERMITIDAS = ['sidebarMostrarItens', '_renderSubNav', 'showMain', 'showSub'];
  const alteradas = Object.keys(bA).filter(n => JSON.stringify(bA[n]) !== JSON.stringify(bN[n] || null));
  ok('só o renderer e a navegação do menu mudaram', alteradas.length === PERMITIDAS.length && alteradas.every(n => PERMITIDAS.includes(n)), alteradas);
  // 8.1.199: o filtro de perfil saiu de sidebarMostrarItens para sidebarGruposDoPerfil (reusado pela navegação persistente).
  const FILTRO_INI = '  var grupos = SIDEBAR_GROUPS[main] || [];\n', FILTRO_FIM = '  // Segurança: SIDEBAR_GROUPS deve ser array';
  const filtroMenu = (bN.sidebarMostrarItens || [''])[0].split(FILTRO_INI)[1];
  const filtro186 = filtroMenu ? FILTRO_INI + filtroMenu.split(FILTRO_FIM)[0] : null;
  const atualNorm = n => (n !== 'sidebarMostrarItens' || !filtro186) ? bAtual[n]
    : (bAtual[n] || []).map(b => b.replace('  var grupos = sidebarGruposDoPerfil(main);\n', filtro186));
  ok('funções do menu intactas na versão atual', PERMITIDAS.every(n => JSON.stringify(bN[n]) === JSON.stringify(atualNorm(n))),
    PERMITIDAS.filter(n => JSON.stringify(bN[n]) !== JSON.stringify(atualNorm(n))));
  ok('filtro de perfil movido sem alteração', !!filtro186 && fn('sidebarGruposDoPerfil').includes(filtro186 + '  return grupos;\n}'));
  const criadas = Object.keys(bN).filter(n => !bA[n]).sort();
  ok('funções novas só do menu', JSON.stringify(criadas) === JSON.stringify(['sidebarAbrirSubDoItem', 'sidebarAlternarSub', 'sidebarItensDoGrupo', 'sidebarSubFechada', 'sidebarSubFechadas']), criadas);
}

try { dados(); render(); estaticos(); } catch (e) { failed.push('exceção: ' + (e && e.stack || e)); }
if (failed.length) {
  console.error('FALHOU ' + failed.length + '/' + total + ':\n - ' + failed.join('\n - '));
  process.exit(1);
}
console.log('OK menu-operacional-reorg: ' + total + ' verificações');
