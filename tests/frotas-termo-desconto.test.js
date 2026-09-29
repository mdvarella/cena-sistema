'use strict';
// FROTAS 8.1.167 — Termo de desconto em folha (TD-FOL-001) aberto a partir da multa ou da avaria:
// pré-preenchimento, linhas editáveis, outras ocorrências do mesmo colaborador, validação antes de imprimir e HTML impresso.
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

const FUNCS = ['frtTermoEsc', 'frtTermoParseValor', 'frtTermoFmtValor', 'frtTermoFmtCpf', 'frtTermoCpfValido', 'frtTermoDataBr',
  'frtTermoDataExtenso', 'frtTermoNormNome', 'frtTermoAcharColab', 'frtTermoDescMulta', 'frtTermoDescAvaria', 'frtTermoRefAvaria',
  'frtTermoValorAvaria', 'frtTermoItemMulta', 'frtTermoItemAvaria', 'frtTermoLinhaVazia', 'frtTermoItensPreenchidos', 'frtTermoTotal',
  'frtTermoPlacas', 'frtTermoJuntarPlaca', 'frtTermoNumero', 'frtTermoLerModalOrigem', 'frtTermoCandidatos', 'frtTermoValidar',
  'frtTermoMontarHtml', 'frtTermoAbrir', 'frtTermoLerForm', 'frtTermoRender', 'frtTermoAtualizarTotal', 'frtTermoTrocarTipo',
  'frtTermoAddLinha', 'frtTermoRemoverLinha', 'frtTermoAddDoSistema', 'frtTermoLogoUrl', 'frtTermoImprimir', 'frtTermoFechar'];
const codigo = ['FRT_TERMO_CFG', 'FRT_TERMO_MESES', '_frtTermo'].map(vr).join('\n') + '\n' + FUNCS.map(fn).join('\n');

const CPF_OK = '52998224725';

function fakeDom() {
  const els = {};
  const sel = {};
  const doc = {
    els, sel, body: { filhos: [], appendChild(n) { this.filhos.push(n); if (n.id) els[n.id] = n; } },
    getElementById(id) { return els[id] || null; },
    createElement() { return { style: {}, innerHTML: '', parentNode: null, querySelector(s) { return sel[s] || null; } }; },
    querySelector(s) { return sel[s] || null; }
  };
  return doc;
}

function contexto(extra) {
  const ctx = Object.assign({
    console, Math, Number, String, Object, Array, Date, isFinite, parseFloat, JSON, URL,
    DEMO: true, colaboradores: [], frt_documentos: [], frt_avarias: [], frt_veiculos: [],
    dataHojeLocal: () => '2026-09-15', toasts: [], progShowToast(m, t) { ctx.toasts.push([m, t]); },
    location: { href: 'https://cena.exemplo/app/index.html' },
    document: fakeDom(), window: {}
  }, extra || {});
  vm.createContext(ctx);
  vm.runInContext(codigo, ctx);
  return ctx;
}

// ── 1) botões nos modais e escopo ──
const srcMulta = fn('fdocAbrirModal');
const srcAvaria = fn('frtAbrirAvaria');
ok('modal da multa tem botão 🖨 Termo de desconto só para multa', /\+\(isMulta\?'<button[^\n]*frtTermoAbrir\(\\'multa\\',\\''\+escHtml\(String\(d\.id\|\|''\)\)[^\n]*🖨 Termo de desconto/.test(srcMulta));
ok('modal da avaria tem botão 🖨 Termo de desconto', /frtTermoAbrir\(\\'avaria\\',\\''\+escHtml\(String\(\(orig&&orig\.id\)\|\|''\)\)[^\n]*🖨 Termo de desconto/.test(srcAvaria));
ok('termo não grava no banco (só imprime)', !/\bsb(Insert|Update|Delete|Upsert|Rpc)\s*\(/.test(codigo) && !/fetch\(/.test(codigo.replace(/sbFetch\(/g, '')));
ok('termo só lê colaboradores (sbFetch colaboradores por id)', (codigo.match(/sbFetch\(/g) || []).length === 1 && /sbFetch\('colaboradores',\{filters:\['id=eq\.'\+o\.colaborador_id\]/.test(codigo));
ok('busca remota do colaborador só com id UUID', /isUUID\(o\.colaborador_id\)/.test(codigo));
ok('editor abre em overlay próprio (não substitui o modal da multa/avaria)', /ov\.id='frt-termo-overlay'/.test(codigo) && !/setModal\(|closeModal\(/.test(codigo));

// ── 2) funções puras ──
{
  const c = contexto();
  ok('valor 130,16', c.frtTermoParseValor('130,16') === 130.16);
  ok('valor 1.234,56', c.frtTermoParseValor('1.234,56') === 1234.56);
  ok('valor 130.16 (banco)', c.frtTermoParseValor('130.16') === 130.16);
  ok('valor 1.234 (milhar)', c.frtTermoParseValor('1.234') === 1234);
  ok('valor R$ 480,00', c.frtTermoParseValor('R$ 480,00') === 480);
  ok('valor numérico', c.frtTermoParseValor(260.324) === 260.32);
  ok('valor inválido → null', c.frtTermoParseValor('abc') === null && c.frtTermoParseValor('') === null && c.frtTermoParseValor(null) === null);
  ok('formata valor pt-BR', c.frtTermoFmtValor(1234.5) === '1.234,50', c.frtTermoFmtValor(1234.5));
  ok('CPF válido aceito', c.frtTermoCpfValido('529.982.247-25') && c.frtTermoCpfValido(CPF_OK));
  ok('CPF inválido recusado', !c.frtTermoCpfValido('529.982.247-26') && !c.frtTermoCpfValido('111.111.111-11') && !c.frtTermoCpfValido('0') && !c.frtTermoCpfValido(''));
  ok('CPF formatado', c.frtTermoFmtCpf(CPF_OK) === '529.982.247-25');
  ok('data por extenso', c.frtTermoDataExtenso('2026-09-15') === '15 de setembro de 2026' && c.frtTermoDataExtenso('2026-03-01') === '1 de março de 2026');
  ok('data inválida vazia', c.frtTermoDataExtenso('') === '' && c.frtTermoDataExtenso('2026-13-01') === '');
  ok('total soma só valores positivos', c.frtTermoTotal([{ valor: 130.16 }, { valor: 130.16 }, { valor: null }, { valor: -5 }]) === 260.32);
  ok('placas: junta sem duplicar', c.frtTermoJuntarPlaca('TLY9G76', 'abc1d23') === 'TLY9G76, ABC1D23' && c.frtTermoJuntarPlaca('TLY9G76, ABC1D23', 'tly-9g76') === 'TLY9G76, ABC1D23');
  ok('escape HTML', c.frtTermoEsc('<b>"x"&\'y\'</b>') === '&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/b&gt;');
  const n1 = c.frtTermoNumero({ tipo: 'multa', matricula: '2247', origem_id: '5b1e-44aa-9c3f-00e4f1a2b3c4' }, new Date(2026, 8, 15, 9, 10, 0));
  ok('nº do termo estável pelo registro', n1 === 'TD-2026-002247-MA2B3C4', n1);
  const n2 = c.frtTermoNumero({ tipo: 'avaria', matricula: '', origem_id: '' }, new Date(2026, 8, 15, 9, 10, 5));
  ok('nº do termo sem registro salvo usa hora', n2 === 'TD-2026-000000-A091005', n2);
}

// ── 3) leitura do modal aberto ──
{
  const c = contexto({ frt_veiculos: [{ id: 'v1', placa: 'TLY9G76', modelo: 'Strada' }] });
  const els = c.document.els;
  const inp = v => ({ value: v });
  Object.assign(els, {
    'fdoc-num-auto': inp('E004413335'), 'fdoc-cod-inf': inp('745-50'), 'fdoc-data-inf': inp('2026-09-02'), 'fdoc-hora-inf': inp('14:37'),
    'fdoc-local-inf': inp('Av. dos Autonomistas, 1400'), 'fdoc-municipio': inp('Osasco/SP'), 'fdoc-valor': inp('130.16'),
    'fdoc-placa': inp('TLY9G76'), 'fdoc-colab-id': inp('col-1'), 'fdoc-condutor': inp('Felipe Ferreira dos Santos'),
    'fdoc-tipo-inf': { value: 'Velocidade até 20%', selectedIndex: 1, options: [{ text: 'Selecione' }, { text: 'Transitar em velocidade superior à máxima permitida em até 20%' }] }
  });
  const m = c.frtTermoLerModalOrigem('multa', 'mul-1');
  ok('multa: AIT do modal', m.item.ref === 'E004413335');
  ok('multa: descrição com infração, código, data/hora e local', m.item.desc === 'Transitar em velocidade superior à máxima permitida em até 20% (cód. 745-50) · 02/09/2026 14:37 · Av. dos Autonomistas, 1400 — Osasco/SP', m.item.desc);
  ok('multa: valor do modal', m.item.valor === 130.16);
  ok('multa: placa, colaborador e origem', m.placa === 'TLY9G76' && m.colaborador_id === 'col-1' && m.item.origem === 'multa:mul-1');

  Object.assign(els, {
    'favar-veic': { value: 'v1' }, 'favar-tipo': inp('Avaria leve'), 'favar-desc': inp('Retrovisor lateral esquerdo quebrado'),
    'favar-data': inp('2026-09-10'), 'favar-custo': inp('520'), 'favar-custo-final': inp(''), 'favar-mot': inp('Felipe Ferreira dos Santos'), 'favar-colab-id': inp('col-1')
  });
  const a = c.frtTermoLerModalOrigem('avaria', 'c0ffee12-0000-4000-8000-000000a381f1');
  ok('avaria: placa pelo veículo selecionado', a.placa === 'TLY9G76');
  ok('avaria: nº da ocorrência gerado do registro', a.item.ref === 'OC-2026-A381F1', a.item.ref);
  ok('avaria: descrição tipo — descrição · data', a.item.desc === 'Avaria leve — Retrovisor lateral esquerdo quebrado · 10/09/2026', a.item.desc);
  ok('avaria: sem custo final usa o estimado', a.item.valor === 520);
  els['favar-custo-final'] = inp('480,00');
  ok('avaria: custo final tem prioridade', c.frtTermoLerModalOrigem('avaria', 'x').item.valor === 480);
}

// ── 4) abrir: pré-preenche colaborador e renderiza o editor ──
function montarTermo(extra) {
  const c = contexto(Object.assign({
    colaboradores: [{ id: 'col-1', nome: 'FELIPE FERREIRA DOS SANTOS', cpf: CPF_OK, re: '002247' }, { id: 'col-2', nome: 'OUTRO MOTORISTA', cpf: '', re: '9' }],
    frt_documentos: [
      { id: 'mul-1', tipo: 'Multa', numero_auto: 'E004413335', colaborador_id: 'col-1', placa: 'TLY9G76', valor: 130.16, data_infracao: '2026-09-02', tipo_infracao: 'Velocidade' },
      { id: 'mul-2', tipo: 'Multa', numero_auto: 'E004413336', colaborador_id: null, condutor_responsavel: 'Felipe Ferreira dos Santos', placa: 'ABC1D23', valor: '130.16', data_infracao: '2026-09-03', tipo_infracao: 'Velocidade' },
      { id: 'mul-3', tipo: 'Multa', numero_auto: 'X1', colaborador_id: 'col-2', placa: 'TLY9G76', valor: 88 },
      { id: 'doc-1', tipo: 'Licenciamento', colaborador_id: 'col-1', placa: 'TLY9G76', valor: 200 }
    ]
  }, extra || {}));
  const els = c.document.els;
  Object.assign(els, {
    'fdoc-num-auto': { value: 'E004413335' }, 'fdoc-valor': { value: '130.16' }, 'fdoc-placa': { value: 'tly9g76' },
    'fdoc-colab-id': { value: 'col-1' }, 'fdoc-condutor': { value: 'Felipe Ferreira dos Santos' }, 'fdoc-data-inf': { value: '2026-09-02' },
    'fdoc-tipo-inf': { value: 'Velocidade', selectedIndex: 0, options: [{ text: 'Velocidade' }] }
  });
  c.frtTermoAbrir('multa', 'mul-1');
  return c;
}
{
  const c = montarTermo();
  const st = c._frtTermo;
  ok('abrir: nome, CPF e matrícula do cadastro do colaborador', st.nome === 'FELIPE FERREIRA DOS SANTOS' && st.cpf === '529.982.247-25' && st.matricula === '002247', st);
  ok('abrir: placa, tipo, nacionalidade, cidade e data padrão', st.placa === 'TLY9G76' && st.tipo === 'multa' && st.nacionalidade === 'brasileiro(a)' && st.cidade === 'São Paulo' && st.data === '2026-09-15');
  ok('abrir: primeira linha vem da multa aberta', st.itens.length === 1 && st.itens[0].ref === 'E004413335' && st.itens[0].valor === 130.16);
  const ov = c.document.els['frt-termo-overlay'];
  ok('editor renderizado no overlay', ov && /data-termo-ref="0" value="E004413335"/.test(ov.innerHTML) && /data-termo-valor="0" value="130,16"/.test(ov.innerHTML));
  ok('editor: botões inserir linha, remover e imprimir', /frtTermoAddLinha\(\)/.test(ov.innerHTML) && /frtTermoRemoverLinha\(0\)/.test(ov.innerHTML) && /frtTermoImprimir\(\)/.test(ov.innerHTML));
  ok('editor: coluna AIT e total', /<th[^>]*>AIT<\/th>/.test(ov.innerHTML) && /id="frt-termo-total"[^>]*>R\$ 130,16</.test(ov.innerHTML));
  const cands = c.frtTermoCandidatos(st);
  ok('outras multas do mesmo colaborador (por id ou por nome), sem a aberta, sem de outro colaborador, sem outro tipo de documento',
    cands.length === 1 && cands[0].chave === 'multa:mul-2', cands.map(x => x.chave));
  ok('editor lista as outras multas para adicionar', /<option value="multa:mul-2">E004413336 · ABC1D23 · 03\/09\/2026 · R\$ 130,16<\/option>/.test(ov.innerHTML));

  // simula o formulário: edição de linha + adicionar do sistema + inserir e remover linha
  const sel = c.document.sel;
  const campos = { 'frt-termo-nome': st.nome, 'frt-termo-cpf': st.cpf, 'frt-termo-nac': 'brasileiro', 'frt-termo-mat': st.matricula,
    'frt-termo-placa': st.placa, 'frt-termo-cidade': 'Osasco', 'frt-termo-data': '2026-09-16' };
  Object.keys(campos).forEach(k => { c.document.els[k] = { value: campos[k] }; });
  sel['input[name="frt-termo-tipo"]:checked'] = { value: 'multa' };
  sel['[data-termo-ref="0"]'] = { value: 'E004413335' };
  sel['[data-termo-desc="0"]'] = { value: 'Velocidade superior à máxima em até 20%' };
  sel['[data-termo-valor="0"]'] = { value: '130,16' };
  c.document.els['frt-termo-cand'] = { value: 'multa:mul-2' };
  c.frtTermoAddDoSistema();
  ok('adicionar do sistema: preserva a edição da linha 1 e inclui a outra multa', st.itens.length === 2 && st.itens[0].desc === 'Velocidade superior à máxima em até 20%' && st.itens[1].ref === 'E004413336' && st.itens[1].valor === 130.16);
  ok('adicionar do sistema: placa da outra multa entra junto', st.placa === 'TLY9G76, ABC1D23', st.placa);
  ok('adicionar do sistema: campos do formulário lidos', st.nacionalidade === 'brasileiro' && st.cidade === 'Osasco' && st.data === '2026-09-16');
  ok('adicionada some da lista de candidatas', c.frtTermoCandidatos(st).length === 0);
  delete sel['[data-termo-ref="0"]'];
  c.frtTermoAddLinha();
  ok('inserir linha em branco', st.itens.length === 3 && st.itens[2].ref === '' && st.itens[2].valor === null);
  c.frtTermoRemoverLinha(2);
  ok('remover linha', st.itens.length === 2);
  c.frtTermoFechar();
}

// ── 5) validação bloqueia a impressão ──
{
  const c = montarTermo();
  const aberturas = [];
  c.window.open = function () { const w = { escrito: '', document: { open() {}, write(h) { w.escrito += h; }, close() {} } }; aberturas.push(w); return w; };
  c.document.els['frt-termo-erro'] = { style: {}, innerHTML: '' };
  const st = c._frtTermo;
  st.cpf = '';
  st.itens.push({ ref: '', desc: 'Sem AIT', valor: null, origem: '' });
  st.itens.push({ ref: '', desc: '', valor: null, origem: '' });
  const erros = c.frtTermoValidar(st);
  ok('valida: CPF obrigatório e válido', erros.includes('Informe um CPF válido do colaborador.'), erros);
  ok('valida: linha incompleta aponta AIT e valor', erros.includes('Linha 2: informe o AIT.') && erros.includes('Linha 2: informe um valor maior que zero.'), erros);
  ok('valida: linha totalmente vazia é ignorada', !erros.some(e => /^Linha 3/.test(e)), erros);
  c.frtTermoImprimir();
  ok('imprimir com erro não abre janela e mostra os erros', aberturas.length === 0 && c.document.els['frt-termo-erro'].style.display === 'block' && /CPF válido/.test(c.document.els['frt-termo-erro'].innerHTML));
  ok('imprimir com erro avisa por toast', c.toasts.some(t => t[1] === 'erro'));
  st.cpf = CPF_OK; st.itens.splice(1, 1);
  ok('valida: ok com dados completos', c.frtTermoValidar(st).length === 0, c.frtTermoValidar(st));
  const semLinhas = Object.assign({}, st, { itens: [{ ref: '', desc: '', valor: null }] });
  ok('valida: exige ao menos uma linha', c.frtTermoValidar(semLinhas).some(e => /ao menos uma linha/.test(e)));
  ok('valida: avaria pede nº da ocorrência', c.frtTermoValidar(Object.assign({}, st, { tipo: 'avaria', itens: [{ ref: '', desc: 'x', valor: 10 }] })).includes('Linha 1: informe o nº da ocorrência.'));
  c.frtTermoImprimir();
  ok('imprimir válido abre a janela com o termo', aberturas.length === 1 && /Autorização de Desconto em Folha de Pagamento/.test(aberturas[0].escrito));
  ok('logo resolvido pela URL do sistema', aberturas[0].escrito.includes('src="https://cena.exemplo/app/assets/cena-logo-branco.png"'));
}

// ── 6) HTML impresso ──
{
  const c = contexto();
  const st = { tipo: 'multa', origem_id: 'mul-1', placa: 'TLY9G76', nome: 'FELIPE <FERREIRA>', cpf: CPF_OK, matricula: '002247',
    nacionalidade: 'brasileiro', cidade: 'São Paulo', data: '2026-09-15',
    itens: [{ ref: 'E004413335', desc: 'Velocidade até 20%', valor: 130.16 }, { ref: '', desc: '', valor: null }, { ref: 'E004413336', desc: 'Velocidade até 20%', valor: 130.16 }] };
  const h = c.frtTermoMontarHtml(st, { agora: new Date(2026, 8, 15, 9, 10), logo: 'assets/cena-logo-branco.png' });
  ok('impresso: cabeçalho e título do TD-FOL-001', h.includes('TERMO DE DESCONTO — AUTORIZAÇÃO DE DESCONTO EM FOLHA DE PAGAMENTO') && h.includes('<h1>Autorização de Desconto em Folha de Pagamento</h1>'));
  ok('impresso: faixa de controle', h.includes('Sistema CENA') && h.includes('Marcos Varella') && h.includes('29/09/2026 · Rev. 1'));
  ok('impresso: natureza multa marcada, avaria não', /<div class="nat on"><span class="mk">✕<\/span><span class="nt">Multa de trânsito/.test(h) && /<div class="nat"><span class="mk"><\/span><span class="nt">Avarias/.test(h));
  ok('impresso: texto da autorização com os dados', h.includes('Pelo presente instrumento, eu <b class="v">FELIPE &lt;FERREIRA&gt;</b>, <b class="v">brasileiro</b>, inscrito(a) no CPF <b class="v">529.982.247-25</b>, autorizo a <b>LAND SOLUÇÕES LTDA.</b> a efetuar o desconto em folha de pagamento da importância total de R$&nbsp;<b class="v">260,32</b>, referente à <b class="v">MULTA DE TRÂNSITO</b> no veículo placa <b class="v">TLY9G76</b> por mim causada, descrita abaixo:'));
  ok('impresso: nome escapado (sem HTML injetado)', !h.includes('<FERREIRA>'));
  ok('impresso: duas linhas (vazia ignorada) e total', (h.match(/<td class="mono">E00441333[56]<\/td>/g) || []).length === 2 && h.includes('Importância total autorizada</td><td class="mono r">260,32</td>'));
  ok('impresso: coluna AIT', h.includes('<th style="width:24%">AIT</th>'));
  ok('impresso: local e data por extenso', h.includes('<p class="ld">São Paulo, 15 de setembro de 2026.</p>'));
  ok('impresso: assinatura do empregado e duas testemunhas', h.includes('<div class="nome">FELIPE &lt;FERREIRA&gt;</div><div class="cpf">CPF 529.982.247-25</div>') && h.includes('Testemunha 1') && h.includes('Testemunha 2'));
  ok('impresso: autenticidade e rodapé', h.includes('Termo nº TD-2026-002247-MMUL1') && h.includes('Matrícula 002247') && h.includes('Gerado pelo Sistema CENA em 15/09/2026 09:10') && h.includes('CNPJ 28.390.966/0001-00 · Rua Coaquira, 154 — Vila Anastácio — São Paulo/SP — CEP 06554-010'));
  ok('impresso: numeração de página e A4', h.includes('@page{size:A4') && h.includes('counter(pages)'));
  ok('impresso: barra de impressão não sai no papel', h.includes('<div class="bar noprint">') && h.includes('.noprint{display:none !important}'));
  const ha = c.frtTermoMontarHtml(Object.assign({}, st, { tipo: 'avaria', placa: 'TLY9G76, ABC1D23', itens: [{ ref: 'OC-2026-0381', desc: 'Retrovisor', valor: 480 }] }), { agora: new Date(2026, 8, 15) });
  ok('impresso avaria: coluna Nº da ocorrência, AVARIA marcada', ha.includes('>Nº da ocorrência</th>') && ha.includes('<b class="v">AVARIA</b>') && /<div class="nat on"><span class="mk">✕<\/span><span class="nt">Avarias/.test(ha));
  ok('impresso avaria: mais de uma placa', ha.includes('nos veículos placas <b class="v">TLY9G76</b>, <b class="v">ABC1D23</b>'));
}

// ── 7) versão e asset ──
ok('versão 8.1.167', /numero: '8\.1\.167'/.test(html) && /\{v:'8\.1\.167'/.test(html) && /'cena-8\.1\.167'/.test(sw));
ok('logo branco do termo no repositório', fs.existsSync(path.join(raiz, 'assets', 'cena-logo-branco.png')));

if (failed.length) {
  console.error('FALHOU ' + failed.length + '/' + total);
  failed.forEach(f => console.error(' ✗ ' + f));
  process.exit(1);
}
console.log('frotas-termo-desconto: ' + total + ' verificações OK');
