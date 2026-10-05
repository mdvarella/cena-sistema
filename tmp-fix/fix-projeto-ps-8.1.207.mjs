// 8.1.207 — Código do projeto em destaque no card; croqui com IA usa o campo "Projeto PS" como código do projeto.
import fs from 'node:fs';

const ARQ = 'index.html';
const ARQ_SW = 'sw.js';

function carregar(arq) {
  const bruto = fs.readFileSync(arq, 'utf8');
  const crlf = bruto.includes('\r\n');
  return { crlf, txt: crlf ? bruto.replace(/\r\n/g, '\n') : bruto };
}
function salvar(arq, { crlf, txt }) {
  fs.writeFileSync(arq, crlf ? txt.replace(/\n/g, '\r\n') : txt, 'utf8');
}
function trocar(doc, nome, de, para, esperado = 1) {
  const n = doc.txt.split(de).length - 1;
  if (n !== esperado) throw new Error(`${nome}: esperado ${esperado} ocorrência(s), achou ${n}`);
  doc.txt = doc.txt.split(de).join(para);
  console.log('ok  ' + nome + (esperado > 1 ? ` (${n}x)` : ''));
}

const html = carregar(ARQ);
const sw = carregar(ARQ_SW);

// 1. Card do projeto: código em destaque
trocar(html, 'card codigo_cliente',
`    +'<div style="font-size:11px;color:'+sc.cor+';font-weight:600">'+(p.codigo_cliente||'S/N')+'</div>'`,
`    +'<div style="font-size:15px;color:#1a1a18;font-weight:700;letter-spacing:.2px;overflow-wrap:anywhere">'+escHtml(p.codigo_cliente||'S/N')+'</div>'`);

// 2. Croqui IA: chave projeto_ps (CROQUI_V3)
trocar(html, 'prompt versao',
`var SOT_CROQUI_IA_PROMPT_VERSAO = 'CROQUI_V2';
var SOT_CROQUI_IA_CAMPOS = ['cliente','codigo_projeto',`,
`var SOT_CROQUI_IA_PROMPT_VERSAO = 'CROQUI_V3';
var SOT_CROQUI_IA_CAMPOS = ['cliente','projeto_ps','codigo_projeto',`);

trocar(html, 'prompt projeto_ps',
`    + '- codigo_projeto: código do projeto indicado por rótulo como "Projeto", "Nº Projeto", "Projeto nº", "SOT" ou "OS". Não use número da folha, número do desenho, revisão, número de poste ou de instalação.\\n'`,
`    + '- projeto_ps: texto completo do campo com o rótulo "Projeto PS" (ex.: "Projeto PS:"), copiado exatamente como está escrito. Se o documento não tiver esse campo, "".\\n'
    + '- codigo_projeto: código do projeto indicado por rótulo como "Projeto", "Nº Projeto", "Projeto nº", "SOT" ou "OS". Não use número da folha, número do desenho, revisão, número de poste ou de instalação.\\n'`);

trocar(html, 'prompt json',
`    + '{"cliente":"","codigo_projeto":"",`,
`    + '{"cliente":"","projeto_ps":"","codigo_projeto":"",`);

trocar(html, 'schema comentario',
`/** Schema CROQUI_V2: todas as chaves obrigatórias`,
`/** Schema CROQUI_V3: todas as chaves obrigatórias`);

trocar(html, 'planejar codigo',
`  texto('sot-p-codigo', 'Código do projeto', r.codigo_projeto, atual.codigo);`,
`  var ps = String(r.projeto_ps||'').trim();
  if(ps && r.codigo_projeto && sotCroquiNorm(ps)!==sotCroquiNorm(r.codigo_projeto)){
    plano.avisos.push('Código do projeto: usado o campo Projeto PS ("'+ps+'"). A IA também leu "'+String(r.codigo_projeto).trim()+'" em outro rótulo.');
  }
  texto('sot-p-codigo', 'Código do projeto', ps || r.codigo_projeto, atual.codigo);`);

// 3. Versão
trocar(html, 'APP_VERSAO',
`  numero: '8.1.206',
  data:   '05/10/2026',
  build:  '20261005-1145',
  log: [
`,
`  numero: '8.1.207',
  data:   '05/10/2026',
  build:  '20261005-1205',
  log: [
    {v:'8.1.207', d:'05/10/2026', itens:[
      'Projetos e Obras: o código do projeto (ex.: DAC/...) aparece em destaque no card, em 15px, negrito e cor escura; antes ficava pequeno e na cor do status, quase apagado. Vale para Obras > Projetos, painel do contrato e PLPT.',
      'Projetos — croqui com IA (prompt CROQUI_V3): a IA lê o campo "Projeto PS" do croqui e esse texto vira o Código do projeto. Sem esse campo, segue a regra anterior (rótulos Projeto, Nº Projeto, SOT, OS). Se a IA ler outro código diferente, aparece aviso. Campo já preenchido continua sem ser trocado. Sem SQL. Sem alteração na Programação TMA.',
    ]},
`);

trocar(html, 'script ?v=', '?v=8.1.206"', '?v=8.1.207"', 7);
trocar(sw, 'SW_VERSION', "const SW_VERSION   = 'cena-8.1.206';", "const SW_VERSION   = 'cena-8.1.207';");

salvar(ARQ, html);
salvar(ARQ_SW, sw);
console.log('gravado: ' + ARQ + ' (' + (html.crlf ? 'CRLF' : 'LF') + '), ' + ARQ_SW + ' (' + (sw.crlf ? 'CRLF' : 'LF') + ')');
