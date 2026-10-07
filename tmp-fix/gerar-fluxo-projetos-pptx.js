// Gera docs/fluxo-operacional-programacao-projetos.pptx (formas e setas nativas, editáveis no PowerPoint).
// Uso: node tmp-fix/gerar-fluxo-projetos-pptx.js   (pptxgenjs instalado em %TEMP%\pptx-cena)
const path = require('path');
const pptxgen = require(path.join(process.env.TEMP, 'pptx-cena', 'node_modules', 'pptxgenjs'));

const SAIDA = path.join(__dirname, '..', 'docs', 'fluxo-operacional-programacao-projetos.pptx');
const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5
pres.author = 'CENA';
pres.title = 'Fluxo operacional dos projetos — Programação de Projetos';

const F = 'Calibri';
const FT = 'Cambria';
const C = {
  cad:   { fill: 'F2F2F2', line: '6B6B6B', txt: '1A1A18' },
  jor:   { fill: 'EEEAFB', line: '533AB7', txt: '3C2A8A' },
  prog:  { fill: 'E6F1FB', line: '185FA5', txt: '0F4577' },
  port:  { fill: 'FEF3E2', line: 'B26A00', txt: '6E4300' },
  campo: { fill: 'EAF3DE', line: '3B6D11', txt: '2A4F0C' },
  med:   { fill: 'E1F5EE', line: '0B6B57', txt: '085041' },
  erro:  { fill: 'FCEBEB', line: 'A32D2D', txt: '7A1F1F' },
  dec:   { fill: 'FFFFFF', line: '1A1A18', txt: '1A1A18' },
  db:    { fill: 'F4F4F2', line: '555555', txt: '1A1A18' },
  forte: { fill: '185FA5', line: '185FA5', txt: 'FFFFFF' },
};

function runs(titulo, corpo, cor, fs, align) {
  const r = [];
  const linhas = Array.isArray(corpo) ? corpo : (corpo ? [corpo] : []);
  if (titulo) r.push({ text: titulo, options: { bold: true, fontSize: fs, color: cor.txt, breakLine: linhas.length > 0, align } });
  linhas.forEach((l, i) => r.push({ text: l, options: { fontSize: fs - 1.5, color: cor.txt, breakLine: i < linhas.length - 1, align } }));
  return r;
}

function box(s, x, y, w, h, titulo, corpo, cor, o = {}) {
  const shape = o.shape || pres.shapes.ROUNDED_RECTANGLE;
  const opts = {
    shape, x, y, w, h,
    fill: { color: cor.fill },
    line: { color: cor.line, width: o.lw || 1.25, dashType: o.dash || 'solid' },
    fontFace: F, align: o.align || 'center', valign: 'middle', margin: o.margin != null ? o.margin : 4,
  };
  if (shape === pres.shapes.ROUNDED_RECTANGLE) opts.rectRadius = 0.08;
  s.addText(runs(titulo, corpo, cor, o.fs || 12, o.align || 'center'), opts);
}

function dec(s, x, y, w, h, texto, fs) {
  box(s, x, y, w, h, texto, null, C.dec, { shape: pres.shapes.DIAMOND, fs: fs || 11, lw: 1.5, margin: 2 });
}

function db(s, x, y, w, h, titulo, corpo, o = {}) {
  box(s, x, y, w, h, titulo, corpo, C.db, Object.assign({ shape: pres.shapes.CAN, fs: 11 }, o));
}

function seta(s, pts, o = {}) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const ultima = i === pts.length - 2;
    s.addShape(pres.shapes.LINE, {
      x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1),
      flipH: x2 < x1, flipV: y2 < y1,
      line: { color: o.cor || '4A4A4A', width: o.lw || 1.5, dashType: o.dash || 'solid', endArrowType: (ultima && !o.semPonta) ? 'triangle' : undefined },
    });
  }
}

function rotulo(s, texto, x, y, w, o = {}) {
  s.addText(texto, {
    x, y, w, h: o.h || 0.3, fontFace: F, fontSize: o.fs || 10, bold: o.bold !== false, color: o.cor || '333333',
    align: o.align || 'center', valign: 'middle', margin: 0, isTextBox: true, italic: !!o.italic,
  });
}

function titulo(s, t, sub, n) {
  s.background = { color: 'FFFFFF' };
  s.addText(t, { x: 0.5, y: 0.3, w: 12.3, h: 0.6, fontFace: FT, fontSize: 28, bold: true, color: '1A1A18', margin: 0, isTextBox: true });
  if (sub) s.addText(sub, { x: 0.5, y: 0.9, w: 12.3, h: 0.4, fontFace: F, fontSize: 14, color: '555555', margin: 0, isTextBox: true });
  s.addText('CENA · Programação de Projetos · ' + n, { x: 0.5, y: 7.08, w: 12.33, h: 0.28, fontFace: F, fontSize: 9, color: '999999', align: 'right', margin: 0, isTextBox: true });
}

// ── 1. Capa ─────────────────────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: '1A1A18' };
  s.addText('Fluxo operacional dos projetos', { x: 0.8, y: 1.5, w: 11.7, h: 1.0, fontFace: FT, fontSize: 42, bold: true, color: 'FFFFFF', margin: 0, isTextBox: true });
  s.addText('Programação de Projetos — da Jornada à medição', { x: 0.8, y: 2.5, w: 11.7, h: 0.6, fontFace: F, fontSize: 22, color: 'C8C8C8', margin: 0, isTextBox: true });
  const etapas = [['Jornada', C.jor], ['Programação', C.prog], ['Portaria', C.port], ['Campo', C.campo], ['Medição', C.med]];
  const x0 = 1.2, passo = 2.55, yc = 4.55, d = 0.9;
  s.addShape(pres.shapes.LINE, { x: x0 + d / 2, y: yc, w: passo * 4, h: 0, line: { color: '6B6B6B', width: 2 } });
  etapas.forEach(([nome, cor], i) => {
    const cx = x0 + i * passo;
    s.addText(String(i + 1), { shape: pres.shapes.OVAL, x: cx, y: yc - d / 2, w: d, h: d, fill: { color: cor.line }, line: { color: 'FFFFFF', width: 2 }, fontFace: F, fontSize: 22, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle' });
    s.addText(nome, { x: cx - 0.6, y: yc + 0.6, w: d + 1.2, h: 0.4, fontFace: F, fontSize: 16, color: 'FFFFFF', align: 'center', margin: 0, isTextBox: true });
  });
  s.addText('CENA · sistema na versão 8.1.210 · 05/10/2026 · documento editável (formas e setas do PowerPoint)', { x: 0.8, y: 6.6, w: 11.7, h: 0.4, fontFace: F, fontSize: 12, color: '9A9A9A', margin: 0, isTextBox: true });
}

// ── 2. Visão geral ──────────────────────────────────────────────────────
{
  const s = pres.addSlide();
  titulo(s, 'Visão geral do fluxo', 'Do cadastro do projeto à medição — o ciclo volta à Jornada enquanto faltar executar', 2);
  const xs = [0.55, 3.1, 5.65, 8.2, 10.75], w = 2.05, y1 = 1.7, h = 1.05;
  const linha1 = [
    ['1. Cadastro', ['projeto (sot_projetos)', '+ lista de atividades'], C.cad],
    ['2. Jornada', ['escolhe a data da execução', 'fila: AGUARDANDO EQUIPE'], C.jor],
    ['3. Fila do dia', ['PROJETOS A PROGRAMAR', 'clica no projeto e na equipe'], C.prog],
    ['4. Equipe', ['projeto entra na composição', 'EM COMPOSIÇÃO'], C.prog],
    ['5. 💾 Salvar', ['equipe confirmada', 'PROGRAMADO'], C.forte],
  ];
  linha1.forEach(([t, c, cor], i) => box(s, xs[i], y1, w, h, t, c, cor));
  for (let i = 0; i < 4; i++) seta(s, [[xs[i] + w, y1 + h / 2], [xs[i + 1], y1 + h / 2]]);
  const y2 = 3.6, yc2 = y2 + h / 2;
  seta(s, [[xs[4] + w / 2, y1 + h], [xs[4] + w / 2, y2]]);
  box(s, xs[4], y2, w, h, '6. Portaria', ['saída: placa, foto, KM', 'retorno: vistoria e KM'], C.port);
  box(s, xs[3], y2, w, h, '7. Campo', ['encarregado lança', 'as quantidades'], C.campo);
  box(s, xs[2], y2, w, h, '8. Supervisor', ['valida os lançamentos', '→ quantidade executada'], C.campo);
  dec(s, xs[1], 3.45, w, 1.35, 'Jornada: o que falta?');
  box(s, 0.55, y2, 1.8, h, '9. Medição', ['parcial → aprovação', '→ emissão de NF'], C.med);
  seta(s, [[xs[4], yc2], [xs[3] + w, yc2]]);
  seta(s, [[xs[3], yc2], [xs[2] + w, yc2]]);
  seta(s, [[xs[2], yc2], [xs[1] + w, yc2]]);
  seta(s, [[xs[1], yc2], [2.35, yc2]]);
  rotulo(s, 'a medir', 2.35, yc2 - 0.33, 0.75);
  seta(s, [[xs[1] + w / 2, 3.45], [xs[1] + w / 2, y1 + h]], { cor: '533AB7' });
  rotulo(s, 'falta executar → nova data', xs[1] + w / 2 + 0.12, 2.92, 2.2, { cor: '533AB7', align: 'left' });

  rotulo(s, 'Legenda', 0.55, 5.2, 1.0, { align: 'left', fs: 11 });
  const leg = [['Cadastro', C.cad], ['Jornada', C.jor], ['Programação', C.prog], ['Portaria', C.port], ['Campo', C.campo], ['Medição', C.med], ['Bloqueio', C.erro]];
  leg.forEach(([n, cor], i) => box(s, 0.55 + i * 1.6, 5.55, 1.45, 0.42, n, null, cor, { fs: 11 }));
  box(s, 0.55 + 7 * 1.6, 5.5, 1.45, 0.52, 'Decisão', null, C.dec, { shape: pres.shapes.DIAMOND, fs: 10, margin: 0 });
  box(s, 0.55, 6.2, 12.3, 0.7, 'Atenção:', 'o status administrativo do projeto (Recebido … Faturado) é alterado à mão no cadastro e não acompanha a programação. Na tela, "EM COMPOSIÇÃO" e "PROGRAMADO" vêm da composição da equipe.', C.cad, { align: 'left', fs: 12, margin: 8 });
}

// ── 3. Jornada → data ───────────────────────────────────────────────────
{
  const s = pres.addSlide();
  titulo(s, 'Etapa 2 · Jornada: enviar o projeto para uma data', 'Escolher a data não programa equipe: só coloca o projeto na fila daquele dia', 3);
  dec(s, 0.5, 1.7, 2.2, 1.3, 'Tem lista de atividades?');
  seta(s, [[1.6, 3.0], [1.6, 3.55]]); rotulo(s, 'Não', 1.7, 3.1, 0.5);
  box(s, 0.5, 3.55, 2.2, 0.85, 'Importar lista', ['a Jornada pede antes de programar'], C.jor, { fs: 11 });
  seta(s, [[2.7, 2.35], [3.1, 2.35]]); rotulo(s, 'Sim', 2.65, 2.0, 0.5);
  box(s, 3.1, 1.9, 2.3, 0.9, 'Jornada', ['Programar execução', 'Continuar / Próxima'], C.jor);
  rotulo(s, 'Só perfis de gestão e programação: admin, diretoria, gestor, coordenador, supervisor, administrativo e escritório.', 3.1, 2.95, 2.3, { h: 0.9, fs: 9.5, bold: false, italic: true, align: 'left', cor: '555555' });
  seta(s, [[5.4, 2.35], [5.75, 2.35]]);
  box(s, 5.75, 1.85, 2.45, 1.0, 'Escolher a data', ['Hoje · Amanhã · calendário', 'obrigatória, não aceita passada'], C.jor);
  seta(s, [[8.2, 2.35], [8.55, 2.35]]);
  dec(s, 8.55, 1.7, 2.2, 1.3, 'Já está numa equipe nesse dia?', 10.5);
  seta(s, [[10.75, 2.35], [11.05, 2.35]]); rotulo(s, 'Sim', 10.62, 1.98, 0.5);
  box(s, 11.05, 1.9, 1.8, 0.9, 'Avisa', ['oferece abrir a programação'], C.prog, { fs: 11 });
  seta(s, [[9.65, 3.0], [9.65, 3.3]]); rotulo(s, 'Não', 9.75, 3.0, 0.5);
  dec(s, 8.55, 3.3, 2.2, 1.3, 'Já está na fila nessa data?', 10.5);
  seta(s, [[10.75, 3.95], [11.05, 3.95]]); rotulo(s, 'Sim', 10.62, 3.58, 0.5);
  box(s, 11.05, 3.5, 1.8, 0.9, 'Não duplica', ['avisa que já aguarda programação'], C.prog, { fs: 11 });
  seta(s, [[9.65, 4.6], [9.65, 4.9]]); rotulo(s, 'Não', 9.75, 4.6, 0.5);
  dec(s, 8.55, 4.9, 2.2, 1.3, 'Tem outra data prevista?', 10.5);
  seta(s, [[10.75, 5.55], [11.05, 5.55]]); rotulo(s, 'Sim', 10.62, 5.18, 0.5);
  box(s, 11.05, 5.0, 1.8, 1.1, 'Pergunta', ['manter a data', 'trocar pela nova', 'adicionar esta data'], C.jor, { fs: 11 });
  seta(s, [[8.55, 5.55], [8.2, 5.55]]); rotulo(s, 'Não', 8.12, 5.18, 0.5);
  db(s, 5.75, 5.05, 2.45, 1.0, 'prog_projetos_agenda', ['status AGUARDANDO_EQUIPE']);
  seta(s, [[11.95, 6.1], [11.95, 6.55], [6.975, 6.55], [6.975, 6.05]]);
  rotulo(s, 'trocar / adicionar', 8.9, 6.58, 1.8);
  seta(s, [[5.75, 5.55], [5.4, 5.55]]);
  box(s, 3.1, 5.1, 2.3, 0.9, 'Fila do dia', ['PROJETOS A PROGRAMAR', 'ainda sem equipe'], C.prog, { fs: 11 });
  rotulo(s, 'Na troca de data, o registro antigo da fila é cancelado; ao adicionar, as duas datas ficam na fila.', 0.5, 5.0, 2.4, { h: 1.1, fs: 10, bold: false, italic: true, align: 'left', cor: '555555' });
}

// ── 4. Fila do dia ──────────────────────────────────────────────────────
{
  const s = pres.addSlide();
  titulo(s, 'Etapa 3 · Fila do dia e situação do projeto', 'Caixa "📋 PROJETOS A PROGRAMAR" no topo da Programação de Projetos (contrato + data)', 4);
  box(s, 0.6, 1.55, 3.0, 0.85, 'A PROGRAMAR', ['aguardando equipe'], C.prog, { fs: 13 });
  box(s, 5.15, 1.55, 3.0, 0.85, 'EM COMPOSIÇÃO', ['projeto na equipe, equipe não confirmada'], C.port, { fs: 13 });
  box(s, 9.7, 1.55, 3.0, 0.85, 'PROGRAMADO', ['equipe confirmada'], C.campo, { fs: 13 });
  seta(s, [[3.6, 1.975], [5.15, 1.975]]); rotulo(s, 'projeto → equipe', 3.6, 1.62, 1.55, { fs: 9.5 });
  seta(s, [[8.15, 1.975], [9.7, 1.975]]); rotulo(s, '💾 Salvar', 8.15, 1.62, 1.55, { fs: 9.5 });
  seta(s, [[11.2, 2.4], [11.2, 2.75], [6.65, 2.75], [6.65, 2.4]], { cor: 'A32D2D' });
  rotulo(s, '↩ Desprog.', 8.2, 2.78, 1.5, { cor: 'A32D2D' });
  seta(s, [[5.6, 2.4], [5.6, 2.75], [2.1, 2.75], [2.1, 2.4]], { cor: 'A32D2D' });
  rotulo(s, 'retirar o projeto da equipe', 2.5, 2.78, 2.7, { cor: 'A32D2D' });

  rotulo(s, 'Como o projeto entra na equipe', 0.5, 3.25, 5.0, { align: 'left', fs: 14 });
  box(s, 0.5, 3.85, 1.6, 0.9, 'Clica no projeto', ['na fila do dia'], C.prog, { fs: 11 });
  seta(s, [[2.1, 4.3], [2.4, 4.3]]);
  dec(s, 2.4, 3.7, 1.75, 1.2, 'Data passada?', 10.5);
  seta(s, [[4.15, 4.3], [4.45, 4.3]]); rotulo(s, 'Não', 4.0, 3.88, 0.5);
  box(s, 4.45, 3.85, 1.6, 0.9, 'Escolhe a equipe', ['do contrato'], C.prog, { fs: 11 });
  seta(s, [[6.05, 4.3], [6.35, 4.3]]);
  dec(s, 6.35, 3.7, 1.75, 1.2, 'Equipe de folga pela escala?', 9.5);
  seta(s, [[8.1, 4.3], [8.4, 4.3]]); rotulo(s, 'Não', 7.95, 3.88, 0.5);
  dec(s, 8.4, 3.7, 1.8, 1.2, 'Equipe já confirmada?', 10);
  seta(s, [[10.2, 4.3], [10.5, 4.3]]); rotulo(s, 'Não', 10.05, 3.88, 0.5);
  box(s, 10.5, 3.75, 2.35, 1.1, 'Projeto entra na equipe', ['composicao_dia.projeto_ids', 'fila: ALOCADO'], C.prog, { fs: 11 });
  seta(s, [[3.275, 4.9], [3.275, 5.35]]); rotulo(s, 'Sim', 3.35, 4.95, 0.5);
  box(s, 2.4, 5.35, 1.75, 0.85, 'Não programa', ['data passada'], C.erro, { fs: 11 });
  seta(s, [[7.225, 4.9], [7.225, 5.35]]); rotulo(s, 'Sim', 7.3, 4.95, 0.5);
  box(s, 6.25, 5.35, 1.95, 0.85, 'Bloqueada', ['só com hora extra autorizada no quadro'], C.erro, { fs: 11 });
  seta(s, [[9.3, 4.9], [9.3, 5.35]]); rotulo(s, 'Sim', 9.38, 4.95, 0.5);
  box(s, 8.4, 5.35, 1.8, 0.85, 'Pergunta', ['incluir na programação já confirmada?'], C.prog, { fs: 11 });
  seta(s, [[10.2, 5.775], [11.675, 5.775], [11.675, 4.85]]); rotulo(s, 'confirma', 10.3, 5.8, 1.0);
  rotulo(s, 'Resultado: com a equipe ainda não confirmada, o projeto fica EM COMPOSIÇÃO; com a equipe já confirmada, fica PROGRAMADO. Também dá para incluir ou retirar projetos pela linha da equipe (📋 Projetos da equipe).', 0.5, 6.4, 12.3, { h: 0.55, fs: 11, bold: false, align: 'left', cor: '333333' });
}

// ── 5. Montar e confirmar equipe ────────────────────────────────────────
{
  const s = pres.addSlide();
  titulo(s, 'Etapa 4 · Montar e confirmar a equipe', 'Linha de cada equipe no quadro da Programação de Projetos', 5);
  box(s, 0.6, 1.55, 3.7, 1.05, '1. Colaboradores', ['Auto Escalar, slots, menu ou arrastar', 'bloqueia falta, folga, férias e quem já está em outra equipe'], C.prog, { fs: 12 });
  seta(s, [[2.45, 2.6], [2.45, 2.95]]);
  box(s, 0.6, 2.95, 3.7, 0.8, '2. Motorista', ['marcado no menu do slot'], C.prog);
  seta(s, [[2.45, 3.75], [2.45, 4.1]]);
  box(s, 0.6, 4.1, 3.7, 1.35, '3. Veículo do dia', ['placa (prog_veiculos_dia)', '🤝 compartilhar com 2ª equipe (máx. 2)', '🚛 carreta de cabos ou compressor, com placa'], C.prog);
  seta(s, [[4.3, 4.775], [4.75, 4.775]]);
  box(s, 4.75, 4.37, 1.9, 0.8, '💾 Salvar', null, C.forte, { fs: 14 });
  s.addText([
    { text: 'Verificações ao salvar (todas obrigatórias)', options: { bold: true, fontSize: 13, color: '1A1A18', breakLine: true } },
    { text: 'equipe fora da folga da escala (ou hora extra autorizada)', options: { bullet: true, fontSize: 12, color: '1A1A18', breakLine: true } },
    { text: 'mínimo de colaboradores do tipo de equipe', options: { bullet: true, fontSize: 12, color: '1A1A18', breakLine: true } },
    { text: 'placa, quando o tipo de equipe exige', options: { bullet: true, fontSize: 12, color: '1A1A18', breakLine: true } },
    { text: 'celular da equipe válido', options: { bullet: true, fontSize: 12, color: '1A1A18', breakLine: true } },
    { text: 'motorista, quando obrigatório', options: { bullet: true, fontSize: 12, color: '1A1A18' } },
  ], { shape: pres.shapes.ROUNDED_RECTANGLE, rectRadius: 0.08, x: 7.1, y: 1.55, w: 5.75, h: 2.05, fill: { color: C.cad.fill }, line: { color: C.cad.line, width: 1.25 }, fontFace: F, valign: 'middle', margin: 8, paraSpaceAfter: 2 });
  seta(s, [[8.25, 3.6], [8.25, 4.15]], { dash: 'dash', semPonta: true, cor: '6B6B6B' });
  seta(s, [[6.65, 4.775], [7.1, 4.775]]);
  dec(s, 7.1, 4.15, 2.3, 1.25, 'Passou em todas?', 11);
  seta(s, [[9.4, 4.775], [9.85, 4.775]]); rotulo(s, 'Sim', 9.38, 4.4, 0.5);
  box(s, 9.85, 4.05, 3.0, 1.45, 'Equipe PROGRAMADA', ['composicao_dia: confirmada + veículo, placa e motorista', 'prog_veiculos_dia confirmado'], C.campo, { fs: 12 });
  seta(s, [[8.25, 5.4], [8.25, 5.85]]); rotulo(s, 'Não', 8.33, 5.45, 0.5);
  box(s, 7.1, 5.85, 2.3, 0.8, 'Mostra o motivo', ['nada é confirmado'], C.erro, { fs: 11 });
  seta(s, [[11.35, 5.5], [11.35, 5.85]]);
  box(s, 9.85, 5.85, 3.0, 0.8, '↩ Desprog.', ['volta a não confirmada para alterar'], C.cad, { fs: 11 });
  rotulo(s, '🤝 Compartilhado: a outra equipe precisa estar com a mesma placa no mesmo dia; o vínculo fica nos dois lados e o banco bloqueia a 3ª equipe.', 0.6, 5.7, 3.7, { h: 1.0, fs: 10, bold: false, italic: true, align: 'left', cor: '555555' });
}

// ── 6. Portaria ─────────────────────────────────────────────────────────
{
  const s = pres.addSlide();
  titulo(s, 'Etapa 5 · Portaria: saída e retorno', 'Portaria → Equipes do dia (lista as equipes programadas da data)', 6);
  box(s, 0.5, 1.65, 2.35, 1.05, 'Equipes do dia', ['programadas, com o veículo do dia'], C.port);
  seta(s, [[2.85, 2.175], [3.2, 2.175]]);
  dec(s, 3.2, 1.5, 2.05, 1.35, 'Placa com saída aberta?', 10.5);
  seta(s, [[4.225, 2.85], [4.225, 3.2]]); rotulo(s, 'Sim', 4.3, 2.88, 0.5);
  box(s, 3.2, 3.2, 2.05, 0.85, 'Bloqueia', ['registrar o retorno antes'], C.erro, { fs: 11 });
  seta(s, [[5.25, 2.175], [5.6, 2.175]]); rotulo(s, 'Não', 5.15, 1.8, 0.5);
  box(s, 5.6, 1.6, 2.6, 1.15, 'Liberar saída', ['reconfere a placa programada', 'foto da carga · materiais · KM de saída'], C.port, { fs: 12 });
  seta(s, [[8.2, 2.175], [8.55, 2.175]]);
  db(s, 8.55, 1.6, 2.0, 1.15, 'frotas_portaria_saidas', ['status Em campo']);
  seta(s, [[10.55, 2.175], [10.9, 2.175]]);
  box(s, 10.9, 1.65, 1.95, 1.05, 'Em campo', ['execução do dia'], C.campo);
  seta(s, [[11.875, 2.7], [11.875, 4.55]]);
  box(s, 10.9, 4.55, 1.95, 1.05, 'Equipe volta', null, C.port);
  seta(s, [[10.9, 5.075], [10.55, 5.075]]);
  box(s, 7.95, 4.55, 2.6, 1.05, 'Vistoria de retorno', ['KM, foto, devolução de material'], C.port);
  seta(s, [[7.95, 5.075], [7.6, 5.075]]);
  db(s, 5.6, 4.5, 2.0, 1.15, 'status Retornado', ['data e KM de retorno']);
  seta(s, [[5.6, 5.075], [5.25, 5.075]]);
  box(s, 3.2, 4.55, 2.05, 1.05, 'Placa liberada', ['pode sair de novo'], C.cad);
  rotulo(s, '📶 Sem internet: saída e retorno ficam gravados no tablet e sincronizam depois (o retorno espera a saída subir).', 0.5, 4.45, 2.45, { h: 1.25, fs: 10, bold: false, italic: true, align: 'left', cor: '555555' });
  box(s, 0.5, 6.0, 12.35, 0.85, '⏳ Em aprovação — 8.1.211 (caminhão compartilhado)', 'a 2ª equipe sai junto, ligada à saída principal e sem KM; o retorno da principal fecha as duas. Aguarda aplicar a migration.', C.port, { align: 'left', dash: 'dash', fs: 12, margin: 8 });
}

// ── 7. Campo e Jornada ──────────────────────────────────────────────────
{
  const s = pres.addSlide();
  titulo(s, 'Etapas 6 e 7 · Campo, validação e próximo passo', 'O que a equipe executa vira quantidade executada; a Jornada decide o que vem depois', 7);
  box(s, 0.5, 1.6, 2.3, 1.05, 'Diário da equipe', ['projetos da composição do dia'], C.campo);
  seta(s, [[2.8, 2.125], [3.15, 2.125]]);
  box(s, 3.15, 1.6, 2.5, 1.05, 'Encarregado lança', ['quantidade por código', 'executado ou viabilizado'], C.campo);
  seta(s, [[5.65, 2.125], [6.0, 2.125]]);
  db(s, 6.0, 1.55, 2.0, 1.15, 'sot_lancamentos_campo', ['pendente']);
  seta(s, [[8.0, 2.125], [8.35, 2.125]]);
  dec(s, 8.35, 1.45, 2.0, 1.35, 'Supervisor aprova?', 11);
  seta(s, [[9.35, 2.8], [9.35, 3.1]]); rotulo(s, 'Não', 9.45, 2.82, 0.5);
  box(s, 8.35, 3.1, 2.0, 0.75, 'Rejeita', ['com motivo'], C.erro, { fs: 11 });
  seta(s, [[10.35, 2.125], [10.7, 2.125]]); rotulo(s, 'Sim', 10.28, 1.75, 0.45);
  db(s, 10.7, 1.5, 2.15, 1.25, 'sot_atividades', ['soma em qtd_executada', '(pode corrigir a qtd)']);
  seta(s, [[11.775, 2.75], [11.775, 4.0]]);
  dec(s, 10.65, 4.0, 2.25, 1.3, 'Jornada: o que falta?', 11);
  seta(s, [[10.65, 4.65], [10.45, 4.65]], { semPonta: true });
  seta(s, [[10.45, 4.325], [10.45, 6.125]], { semPonta: true });
  seta(s, [[10.45, 4.325], [10.2, 4.325]]);
  seta(s, [[10.45, 5.225], [10.2, 5.225]]);
  seta(s, [[10.45, 6.125], [10.2, 6.125]]);
  box(s, 7.2, 3.95, 3.0, 0.75, 'Programar próxima execução', ['falta executar e não há data'], C.jor, { fs: 11 });
  box(s, 7.2, 4.85, 3.0, 0.75, 'Continuar execução', ['falta executar e já há data'], C.jor, { fs: 11 });
  box(s, 7.2, 5.75, 3.0, 0.75, 'Criar parcial', ['há executado ainda não medido'], C.med, { fs: 11 });
  seta(s, [[7.2, 4.325], [6.9, 4.325]]);
  box(s, 4.3, 3.95, 2.6, 0.75, 'Volta à escolha da data', ['e o ciclo recomeça'], C.jor, { fs: 11 });
  seta(s, [[7.2, 6.125], [6.9, 6.125]]);
  box(s, 4.3, 5.75, 2.6, 0.75, 'Parcial', ['rascunho → aprovação'], C.med, { fs: 11 });
  seta(s, [[4.3, 6.125], [3.7, 6.125]]);
  box(s, 0.5, 5.75, 3.2, 0.75, 'Emitir NF', ['parcial aprovada'], C.med, { fs: 11 });
  box(s, 0.5, 3.95, 3.2, 1.5, 'Outras saídas da Jornada', ['Criar requisição (materiais sem requisição)', 'Conferir relatório · AS BUILT', 'Aguardar cliente / boletim'], C.cad, { fs: 12, align: 'left', margin: 8 });
  rotulo(s, 'A NF de uma parcial não encerra o projeto enquanto houver quantidade prevista sem executar.', 0.5, 6.65, 12.3, { h: 0.35, fs: 11, bold: false, italic: true, align: 'left', cor: '333333' });
}

// ── 8. Pontos de atenção ────────────────────────────────────────────────
{
  const s = pres.addSlide();
  titulo(s, 'Pontos de atenção', 'Comportamentos atuais do sistema que afetam a leitura do fluxo', 8);
  const cards = [
    ['Status do projeto não acompanha a programação', 'O status de sot_projetos (Programado, Em execução … Faturado) só muda à mão. A função antiga que marcaria "Programado" não é chamada por nenhuma tela.'],
    ['Desprogramar não atualiza a fila no banco', 'O registro em prog_projetos_agenda continua ALOCADO. A tela mostra certo porque lê a composição da equipe.'],
    ['Projetos do seletor do topo entram com a escala', 'Ao escalar colaboradores, os projetos escolhidos no seletor do topo da tela também são gravados na equipe.'],
    ['Portaria ainda não lê compartilhamento e carreta', 'A Portaria carrega a placa do dia sem os campos da 8.1.210. Isso entra na 8.1.211, que aguarda a aprovação da migration.'],
  ];
  const pos = [[0.55, 1.7], [6.8, 1.7], [0.55, 4.25], [6.8, 4.25]];
  cards.forEach(([t, b], i) => {
    const [x, y] = pos[i];
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w: 5.95, h: 2.15, rectRadius: 0.1, fill: { color: 'FFFFFF' }, line: { color: 'E0DFD8', width: 1 }, shadow: { type: 'outer', color: '000000', opacity: 0.12, blur: 6, offset: 2, angle: 90 } });
    s.addText(String(i + 1), { shape: pres.shapes.OVAL, x: x + 0.3, y: y + 0.3, w: 0.6, h: 0.6, fill: { color: i === 3 ? C.port.line : C.erro.line }, line: { color: 'FFFFFF', width: 1 }, fontFace: F, fontSize: 18, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle' });
    s.addText(t, { x: x + 1.1, y: y + 0.25, w: 4.6, h: 0.7, fontFace: F, fontSize: 16, bold: true, color: '1A1A18', valign: 'middle', margin: 0, isTextBox: true });
    s.addText(b, { x: x + 1.1, y: y + 1.0, w: 4.6, h: 1.25, fontFace: F, fontSize: 13, color: '444444', valign: 'top', margin: 0, isTextBox: true });
  });
}

// ── 9. Onde cada etapa grava ────────────────────────────────────────────
{
  const s = pres.addSlide();
  titulo(s, 'Onde cada etapa grava', 'Tabelas do banco envolvidas no fluxo', 9);
  const cab = { bold: true, color: 'FFFFFF', fill: { color: '1A1A18' }, fontSize: 13 };
  const linhas = [
    ['Cadastro', 'sot_projetos · sot_atividades', 'projeto, status administrativo (manual) e atividades: qtd prevista, executada e medida'],
    ['Jornada / fila', 'prog_projetos_agenda', 'projeto + data; AGUARDANDO_EQUIPE → ALOCADO (ou CANCELADO na troca de data)'],
    ['Equipe', 'composicao_dia', 'colaboradores, projetos (projeto_ids), motorista, veículo e confirmada'],
    ['Veículo', 'prog_veiculos_dia', 'placa do dia; compartilhamento com outra equipe; carreta de cabos ou compressor'],
    ['Portaria', 'frotas_portaria_saidas', 'saída e retorno: placa, KM, fotos, materiais, status Em campo / Retornado'],
    ['Campo', 'sot_lancamentos_campo', 'lançamentos do encarregado: pendente → aprovado ou rejeitado'],
  ];
  const rows = [[
    { text: 'Etapa', options: cab }, { text: 'Tabela', options: cab }, { text: 'O que grava', options: cab },
  ]].concat(linhas.map((l, i) => l.map((t, j) => ({ text: t, options: { fontSize: 12.5, color: '1A1A18', bold: j === 0, fontFace: j === 1 ? 'Courier New' : F, fill: { color: i % 2 ? 'FFFFFF' : 'F7F7F5' } } }))));
  s.addTable(rows, { x: 0.55, y: 1.55, w: 12.25, colW: [2.0, 3.3, 6.95], fontFace: F, border: { type: 'solid', pt: 0.75, color: 'E0DFD8' }, rowH: 0.62, valign: 'middle', margin: 0.08 });
}

pres.writeFile({ fileName: SAIDA }).then(f => console.log('gerado:', f));
