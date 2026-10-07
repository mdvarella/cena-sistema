'use strict';
// Etapa 1.0 — análise somente leitura: onde cada tabela aberta para anon é usada no código.
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..');
const arquivos = ['index.html', 'portaria-offline.js', 'sw.js', 'acordos.html'];
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
walk(path.join(raiz, 'modules')).filter(f => f.endsWith('.js')).forEach(f => arquivos.push(path.relative(raiz, f)));

const tabelas = ['sot_projetos', 'sot_atividades', 'sot_materiais', 'sot_documentos', 'sot_lancamentos_campo', 'sot_adicionais',
  'sot_atividades_historico', 'sot_medicoes', 'sot_med_itens', 'sot_projetos_historico', 'sot_materiais_historico', 'sot_ativ_rapidas',
  'composicao_dia', 'contratos', 'depositos', 'estoque', 'itens_catalogo', 'materiais_sap', 'movimentacoes_itens',
  'alm_movimentos', 'alm_requisicoes', 'alm_requisicao_itens', 'alm_requisicao_eventos', 'perfis_sistema', 'user_permissoes'];

const out = {};
for (const arq of arquivos) {
  const p = path.join(raiz, arq);
  if (!fs.existsSync(p)) continue;
  const linhas = fs.readFileSync(p, 'utf8').split(/\r?\n/);
  let fnAtual = '(topo)';
  const fnPorLinha = linhas.map(l => {
    const m = /^\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/.exec(l) || /^\s*(?:var|let|const)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?function/.exec(l);
    if (m) fnAtual = m[1];
    return fnAtual;
  });
  linhas.forEach((l, i) => {
    for (const t of tabelas) {
      const re = new RegExp("['\"/]" + t + "(['\"?&]|$)");
      if (!re.test(l)) continue;
      let op = 'ref';
      if (/sbInsert\(|method:\s*'POST'/.test(l)) op = 'insert';
      else if (/sbUpdate\(|method:\s*'PATCH'/.test(l)) op = 'update';
      else if (/sbDelete\(|method:\s*'DELETE'/.test(l)) op = 'delete';
      else if (/sbUpsert\(/.test(l)) op = 'upsert';
      else if (/sbFetch\w*\(|select=|method:\s*'GET'/.test(l)) op = 'select';
      else if (/\.channel\(|postgres_changes|table:\s*'/.test(l)) op = 'realtime';
      (out[t] = out[t] || []).push({ arq, linha: i + 1, fn: fnPorLinha[i], op });
    }
  });
}
const resumo = {};
for (const t of tabelas) {
  const refs = out[t] || [];
  const porArq = {};
  refs.forEach(r => { porArq[r.arq] = (porArq[r.arq] || 0) + 1; });
  const ops = {};
  refs.forEach(r => { ops[r.op] = (ops[r.op] || 0) + 1; });
  const fns = {};
  refs.forEach(r => { const k = r.arq === 'index.html' ? r.fn : r.arq + ':' + r.fn; fns[k] = (fns[k] || 0) + 1; });
  resumo[t] = { total: refs.length, porArq, ops, funcoes: Object.keys(fns).sort() };
}
fs.writeFileSync(path.join(__dirname, 'mapa-anon-etapa10.json'), JSON.stringify(resumo, null, 1));
for (const t of tabelas) {
  const r = resumo[t];
  console.log('\n## ' + t + ' — ' + r.total + ' refs ' + JSON.stringify(r.porArq) + ' ' + JSON.stringify(r.ops));
  console.log(r.funcoes.join(', '));
}
