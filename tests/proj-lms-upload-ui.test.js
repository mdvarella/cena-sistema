'use strict';
// ETAPA 1.3 — frontend do envio do LMS ORIGINAL (aba "📥 LMS" no detalhe do projeto):
// situação (estado WL, RASCUNHO pendente, "Ir para confirmação"), bloqueio sem permissão / com ORIGINAL confirmada,
// pré-checagem do XLSX no navegador (SheetJS real), envio à Edge proj-lms-receber com confirm(), resposta e erros.
// Nunca confirma o LMS (sot_lms_confirmar) nem escreve em tabelas.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 400) : '')); }

const INI_CONF = '// ETAPA 1.3 — LMS: Confirmação humana do RASCUNHO (Projetos)';
const INI_UP = '// ETAPA 1.3 — LMS: envio do LMS ORIGINAL (ENEL) no detalhe do projeto';
const iConf = html.indexOf(INI_CONF);
const iUp = html.indexOf(INI_UP);
const fim = html.indexOf('\nfunction renderProjetosPorContrato(', iUp);
if (iConf < 0 || iUp < 0 || fim < 0) throw new Error('blocos LMS não encontrados');
const blocoLms = html.slice(iConf, fim);       // confirmação (helpers reutilizados) + envio
const blocoUp = html.slice(iUp, fim);
const upSemComent = blocoUp.replace(/\/\/[^\n]*/g, '');

function fnTexto(nome) {
  const m = new RegExp('\\n(?:async )?function ' + nome + '\\(').exec(html);
  if (!m) throw new Error('função não encontrada: ' + nome);
  const re = /\n(?:async function |function |var |\/\/ ═)/g;
  re.lastIndex = m.index + 12;
  const f = re.exec(html);
  return html.slice(m.index + 1, f ? f.index : undefined);
}

// ── Estáticos ───────────────────────────────────────────────────
ok('ES5 no bloco de envio: sem let/const/arrow/template literal', !/\blet\s|\bconst\s|=>|`/.test(upSemComent));
ok('bloco de envio nunca chama sot_lms_confirmar nem escreve em tabela',
  !/sot_lms_confirmar|projLmsConfirmar|sbInsert|sbUpdate|sbDelete|sbUpload|\/rest\/v1\/(?!rpc)/.test(upSemComent));
ok('não toca materiais/atividades/WL/TMA', !/sot_materiais|sot_atividades|sot_wl\b|composicao_dia|\btma\b/i.test(upSemComent));
ok('envia para a Edge proj-lms-receber com POST ?projeto_id, Authorization e x-lms-nome',
  /SB\.url\+'\/functions\/v1\/proj-lms-receber\?projeto_id='\+encodeURIComponent\(projetoId\)/.test(blocoUp)
  && /method:'POST'/.test(blocoUp) && /'Authorization': 'Bearer '\+tok/.test(blocoUp) && /'x-lms-nome': encodeURIComponent/.test(blocoUp));
const detalhe = fnTexto('sotRenderDetalhe');
ok('aba 📥 LMS no detalhe do projeto, logo depois de Materiais',
  /\['atividades','materiais','lms','reserva',/.test(detalhe) && /lms:'📥 LMS'/.test(detalhe));
const mostrar = fnTexto('sotMostrarTab');
ok('sotMostrarTab ativa a aba lms e carrega o envio',
  /'materiais','lms','reserva'/.test(mostrar) && /else if\(tab==='lms'\) projLmsUpCarregar\(p\.id, content\);/.test(mostrar));
const atualizar = fnTexto('sotAtualizarAbaAtual');
ok('sotAtualizarAbaAtual mantém a aba lms (não cai em Documentos)',
  /'materiais','lms','reserva'/.test(atualizar) && /tabAtiva==='lms'\)\{\s*projLmsUpRender\(projetoId, content\);/.test(atualizar));
ok('mensagem de bloqueio com ORIGINAL confirmada é a aprovada',
  blocoUp.indexOf("'Este projeto já possui LMS ORIGINAL confirmado. Revisões do LMS serão tratadas em etapa futura.'") > 0);
ok('confirm() explícito "Enviar e gravar como RASCUNHO?"', /confirm\(msg\)/.test(blocoUp) && /'Enviar e gravar como RASCUNHO\?/.test(blocoUp));
const chamadasEnviar = html.match(/projLmsUpEnviar\(/g) || [];
ok('envio só pelo botão (definição + 1 onclick)', chamadasEnviar.length === 2, chamadasEnviar.length);

(async () => {
  const XLSX = await import(pathToFileURL(path.join(raiz, 'supabase', 'functions', '_shared', 'vendor', 'xlsx-0.20.3.mjs')).href);
  const fixture = new Uint8Array(fs.readFileSync(path.join(raiz, 'tests', 'fixtures', 'lms', 'modelo-lms-anonimizado.xlsx')));
  const esp = JSON.parse(fs.readFileSync(path.join(raiz, 'tests', 'fixtures', 'lms', 'modelo-lms-esperado.json'), 'utf8'));
  const wbFix = XLSX.read(fixture, { type: 'array', sheets: 'Planilha1' });
  const identFix = String(wbFix.Sheets.Planilha1.D1.v).trim();

  const xlsx = (aoa, aba) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), aba || 'Planilha1');
    return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
  };
  const linhaOk = ['1', 'WP', 'I', '324894', 'NK', 'M', 'FIO', 1, 1, null, null, null, null, null];
  const arq = (nome, bytes, extra) => Object.assign({ name: nome, size: bytes.length, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }, extra || {});

  const PJ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const IMP = '11111111-1111-4111-8111-111111111111';
  const HASH = 'cd'.repeat(32);

  function montar(cfg) {
    cfg = cfg || {};
    const els = {};
    const mk = (id, hidden) => {
      const cls = new Set(hidden ? ['hidden'] : []);
      els[id] = { id, innerHTML: '', style: {}, classList: { contains: c => cls.has(c), add: c => cls.add(c), remove: c => cls.delete(c) } };
      return els[id];
    };
    mk('sot-tab-content');
    mk('pg-contrato-obras', !cfg.painelAberto);
    const log = { rpc: [], edge: [], confirm: [], nav: [] };
    let rascunhos = cfg.rascunhos || [];
    const sb = {
      console: { error() {}, warn() {}, log() {} },
      DEMO: false, SB: { url: 'https://x.supabase.co', key: 'anon' },
      XLSX, window: { _sotTabAtiva: cfg.aba || 'lms' }, usuarioLogado: { id: 'u1' },
      sot_projetos: [{ id: PJ, nome: 'Obra Teste', codigo_cliente: cfg.codigo === undefined ? identFix : cfg.codigo }],
      cenaAuthGetValidToken: async () => (cfg.token === undefined ? 'jwt-auth' : cfg.token),
      sbAuthJwtIsAuthenticated: t => t === 'jwt-auth',
      document: { getElementById: id => els[id] || null },
      confirm: m => { log.confirm.push(m); return cfg.confirmar !== false; },
      coMostrarTab: t => log.nav.push('co:' + t), projMostrarTab: t => log.nav.push('proj:' + t),
      fetch: async (url, opt) => {
        if (url.indexOf('/functions/v1/proj-lms-receber') >= 0) {
          log.edge.push({ url, headers: opt.headers, body: opt.body, method: opt.method });
          const r = cfg.edge ? cfg.edge() : { status: 200, body: { ok: true, reenvio: false, importacao_id: IMP, projeto_id: PJ, status: 'RASCUNHO',
            tipo_importacao: 'ORIGINAL', arquivo: { nome: 'LMS obra.xlsx', tamanho: 10, sha256: HASH }, worksheet: 'Planilha1',
            projeto_identificacao_raw: identFix, qtd_linhas: 200, qtd_wls_distintas: 7,
            resumo: {}, amostra: Array.from({ length: 50 }, (_, i) => ({ linha_excel: 4 + i, ordem: i + 1, wl_raw: '1', ctg_raw: 'WP', ft_raw: 'I',
              codigo_raw: '324894', kit_raw: 'NK', umd_raw: 'M', descricao_raw: i === 0 ? '<b>FIO</b>' : 'FIO', qtd_plan: 6.5, lms_qtd_real_informada: 0,
              alertas: i === 0 ? ['LINHA_REPETIDA'] : [] })), avisos: { LINHA_REPETIDA: 2, PLAN_ZERO_REAL_POSITIVO: 1 } } };
          if (r.status === 200 && r.body && r.body.ok) rascunhos = [{ id: IMP, projeto_id: PJ, status: 'RASCUNHO', arquivo_nome_original: 'LMS obra.xlsx',
            qtd_linhas: 200, criado_em: '2026-10-11T18:00:00Z', hash_sha256: HASH, pode_confirmar: true }];
          return { ok: r.status < 400, status: r.status, text: async () => JSON.stringify(r.body) };
        }
        const fn = url.split('/rpc/')[1];
        const body = JSON.parse(opt.body || '{}');
        log.rpc.push({ fn, body });
        let r;
        if (cfg.rpc && cfg.rpc[fn]) r = cfg.rpc[fn](body);
        else if (fn === 'sot_lms_autorizar_recebimento') r = { status: 200, body: { permitido: true, motivo: 'OK' } };
        else if (fn === 'sot_lms_estado_wl') r = { status: 200, body: cfg.estado || 'LEGADO_SEM_WL' };
        else if (fn === 'sot_lms_rascunhos_listar') r = { status: 200, body: rascunhos };
        else r = { status: 404, body: { code: 'PGRST202', message: 'not found' } };
        return { ok: r.status < 400, status: r.status, text: async () => JSON.stringify(r.body) };
      }
    };
    vm.createContext(sb);
    vm.runInContext(blocoLms, sb);
    return { sb, els, log, html: () => els['sot-tab-content'].innerHTML };
  }

  // ── Pré-checagem (SheetJS real) ─────────────────────────────────
  let t = montar();
  const P = { id: PJ, nome: 'Obra Teste', codigo_cliente: identFix };
  let r = t.sb.projLmsUpPrechecar({ name: 'Modelo LMS.xlsx' }, fixture, P);
  ok('pré-checagem aceita o modelo real (Planilha1, cabeçalho A3:N3, linhas, D1)',
    r.ok && r.linhas === esp.linhas_reais && r.identificacao === identFix && r.confere === 'CONFERE' && !r.avisos.length, r);
  r = t.sb.projLmsUpPrechecar({ name: 'Modelo LMS.xlsx' }, fixture, { id: PJ, nome: 'Outra obra', codigo_cliente: 'XYZ/0000/9999' });
  ok('identificação diferente do projeto: aceita com alerta', r.ok && r.confere === 'DIFERENTE' && /não bate com o projeto aberto/.test(r.avisos[0]), r);
  const semD1 = xlsx([[], [], esp.colunas, linhaOk]);
  r = t.sb.projLmsUpPrechecar({ name: 'a.xlsx' }, semD1, P);
  ok('sem identificação em D1: aceita com alerta', r.ok && r.confere === 'SEM_IDENTIFICACAO' && r.avisos.length === 1, r);
  const casos = [
    ['extensão .xls', { name: 'lms.xls' }, fixture, 'EXTENSAO_OU_NOME_INVALIDO'],
    ['extensão .xlsm', { name: 'lms.xlsm' }, fixture, 'EXTENSAO_OU_NOME_INVALIDO'],
    ['arquivo vazio', { name: 'lms.xlsx' }, new Uint8Array(0), 'ARQUIVO_VAZIO'],
    ['não é ZIP/XLSX', { name: 'lms.xlsx' }, new TextEncoder().encode('isto nao e um xlsx'), 'NAO_E_XLSX'],
    ['macro (vbaProject.bin)', { name: 'lms.xlsx' }, new TextEncoder().encode('PK\u0003\u0004....xl/vbaProject.bin....'), 'ARQUIVO_COM_MACRO'],
    ['aba ausente (só "LMS - F")', { name: 'lms.xlsx' }, xlsx([['Definição de projeto:', null, null, 'X'], [], esp.colunas, linhaOk], 'LMS - F'), 'WORKSHEET_AUSENTE'],
    ['cabeçalho diferente (Código em D3)', { name: 'lms.xlsx' }, xlsx([[], [], esp.colunas.map((c, i) => (i === 3 ? 'Código' : c)), linhaOk]), 'CABECALHO_INCOMPATIVEL'],
    ['sem linhas a partir da 4', { name: 'lms.xlsx' }, xlsx([['Definição de projeto:', null, null, 'X'], [], esp.colunas]), 'SEM_LINHAS_OPERACIONAIS']
  ];
  for (const [nome, a, bytes, cod] of casos) {
    r = t.sb.projLmsUpPrechecar(a, bytes, P);
    ok('pré-checagem recusa: ' + nome, !r.ok && r.erros[0] === cod, r.erros);
  }
  r = t.sb.projLmsUpPrechecar({ name: 'lms.xlsx' }, xlsx([[], [], esp.colunas.map((c, i) => (i === 3 ? 'Código' : c)), linhaOk]), P);
  ok('cabeçalho diferente: detalhe aponta a coluna', r.detalhes.length === 1 && /^D3: esperado "Cód\. Ma", encontrado "CÓDIGO"/.test(r.detalhes[0]), r.detalhes);
  r = t.sb.projLmsUpPrechecar({ name: 'grande.xlsx' }, new Uint8Array(12 * 1024 * 1024 + 1).fill(0x50), P);
  ok('pré-checagem recusa arquivo acima de 12 MB', !r.ok && r.erros[0] === 'ARQUIVO_GRANDE_DEMAIS');

  // ── Situação do projeto ─────────────────────────────────────────
  t = montar();
  await t.sb.projLmsUpCarregar(PJ, t.els['sot-tab-content']);
  let h = t.html();
  ok('situação: estado WL via sot_lms_estado_wl e permissão via sot_lms_autorizar_recebimento',
    /Legado \(sem WL\)/.test(h) && t.log.rpc.some(x => x.fn === 'sot_lms_estado_wl' && x.body.p_projeto_id === PJ)
    && t.log.rpc.some(x => x.fn === 'sot_lms_autorizar_recebimento' && x.body.p_projeto_id === PJ));
  ok('sem RASCUNHO: informa e libera o envio', /Nenhum RASCUNHO pendente para este projeto/.test(h)
    && /id="proj-lms-up-arquivo"/.test(h) && !/proj-lms-up-bloqueio/.test(h) && !/Ir para confirmação/.test(h));

  t = montar({ estado: 'EM_CONCILIACAO' });
  await t.sb.projLmsUpCarregar(PJ, t.els['sot-tab-content']);
  h = t.html();
  ok('ORIGINAL confirmada (EM_CONCILIACAO): bloqueia o envio com a mensagem aprovada',
    /proj-lms-up-bloqueio/.test(h) && h.indexOf('Este projeto já possui LMS ORIGINAL confirmado. Revisões do LMS serão tratadas em etapa futura.') >= 0
    && !/id="proj-lms-up-arquivo"/.test(h));
  t = montar({ estado: 'ESTRUTURADO' });
  await t.sb.projLmsUpCarregar(PJ, t.els['sot-tab-content']);
  ok('ORIGINAL confirmada (ESTRUTURADO): também bloqueia', /proj-lms-up-bloqueio/.test(t.html()) && !/proj-lms-up-arquivo/.test(t.html()));
  t = montar({ estado: 'ESTRUTURA_PENDENTE' });
  await t.sb.projLmsUpCarregar(PJ, t.els['sot-tab-content']);
  h = t.html();
  ok('ESTRUTURA_PENDENTE (Etapa 1.4): bloqueia com a mensagem de ORIGINAL confirmada e mostra o rótulo "Estrutura pendente"',
    /proj-lms-up-bloqueio/.test(h) && h.indexOf('Este projeto já possui LMS ORIGINAL confirmado.') >= 0
    && /Estrutura pendente <span[^>]*>\(ESTRUTURA_PENDENTE\)/.test(h) && !/proj-lms-up-arquivo/.test(h));
  t = montar({ estado: 'ESTADO_FUTURO_X' });
  await t.sb.projLmsUpCarregar(PJ, t.els['sot-tab-content']);
  ok('estado que esta versão não conhece: bloqueia (fail-closed)',
    /Estado LMS do projeto não reconhecido \(ESTADO_FUTURO_X\)\. Envio bloqueado por segurança/.test(t.html()) && !/proj-lms-up-arquivo/.test(t.html()));
  t = montar({ rpc: { sot_lms_estado_wl: () => ({ status: 200, body: '' }) } });
  await t.sb.projLmsUpCarregar(PJ, t.els['sot-tab-content']);
  ok('estado vazio: bloqueia (fail-closed)', /Envio bloqueado por segurança/.test(t.html()) && !/proj-lms-up-arquivo/.test(t.html()));
  t = montar({ estado: 'ESTRUTURA_PENDENTE', rpc: { sot_lms_autorizar_recebimento: () => ({ status: 200, body: { permitido: false, motivo: 'SEM_PERMISSAO' } }) } });
  await t.sb.projLmsUpCarregar(PJ, t.els['sot-tab-content']);
  ok('sem permissão vence o estado: motivo de permissão', /PROJ_IMPORTAR_LMS/.test(t.html()) && !/proj-lms-up-arquivo/.test(t.html()));
  const blocoSemComent = blocoUp.replace(/\/\/[^\n]*/g, '');
  ok('envio só é liberado com estado exatamente LEGADO_SEM_WL',
    /s\.estado !== 'LEGADO_SEM_WL' \?/.test(blocoSemComent)
    && /PROJ_LMS_UP_ESTADOS_CONFIRMADA = \['EM_CONCILIACAO', 'ESTRUTURA_PENDENTE', 'ESTRUTURADO'\]/.test(blocoSemComent));

  t = montar({ rpc: { sot_lms_autorizar_recebimento: () => ({ status: 200, body: { permitido: false, motivo: 'SEM_PERMISSAO' } }) } });
  await t.sb.projLmsUpCarregar(PJ, t.els['sot-tab-content']);
  ok('sem PROJ_IMPORTAR_LMS: bloqueia com motivo claro', /PROJ_IMPORTAR_LMS/.test(t.html()) && !/proj-lms-up-arquivo/.test(t.html()));
  t = montar({ rpc: { sot_lms_estado_wl: () => ({ status: 500, body: { message: 'falhou' } }) } });
  await t.sb.projLmsUpCarregar(PJ, t.els['sot-tab-content']);
  ok('estado WL indisponível: bloqueia por segurança (fail-closed)', /Envio bloqueado por segurança/.test(t.html()) && !/proj-lms-up-arquivo/.test(t.html()));
  t = montar({ token: 'anon-key' });
  await t.sb.projLmsUpCarregar(PJ, t.els['sot-tab-content']);
  ok('login MD5: bloqueia e pede sessão Auth', /Sessão Auth obrigatória/.test(t.html()) && !/proj-lms-up-arquivo/.test(t.html()));

  const rasc = (pode) => [{ id: IMP, projeto_id: PJ, status: 'RASCUNHO', arquivo_nome_original: 'LMS antigo.xlsx', qtd_linhas: 200,
    criado_em: '2026-10-10T11:25:00Z', hash_sha256: HASH, pode_confirmar: pode },
  { id: '22222222-2222-4222-8222-222222222222', projeto_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', status: 'RASCUNHO', arquivo_nome_original: 'outro.xlsx',
    qtd_linhas: 1, criado_em: '2026-10-10T11:25:00Z', hash_sha256: HASH, pode_confirmar: true }];
  t = montar({ rascunhos: rasc(true) });
  await t.sb.projLmsUpCarregar(PJ, t.els['sot-tab-content']);
  h = t.html();
  ok('RASCUNHO pendente do projeto: mostra só o deste projeto + "Ir para confirmação"',
    /RASCUNHO pendente de confirmação/.test(h) && /LMS antigo\.xlsx/.test(h) && !/outro\.xlsx/.test(h) && /id="proj-lms-up-ir"[^>]*>Ir para confirmação</.test(h));
  ok('com RASCUNHO pendente o envio continua possível, com aviso de duplicidade', /proj-lms-up-arquivo/.test(h) && /só um deles poderá ser confirmado/.test(h));
  ok('aba de envio não tem botão de confirmar', !/Confirmar como|projLmsConfirmar/.test(h));
  t = montar({ rascunhos: rasc(false) });
  await t.sb.projLmsUpCarregar(PJ, t.els['sot-tab-content']);
  ok('sem PROJ_CONFIRMAR_LMS: sem botão, aviso de que aguarda confirmação', !/proj-lms-up-ir/.test(t.html()) && /Aguardando confirmação por quem tem a permissão PROJ_CONFIRMAR_LMS/.test(t.html()));

  // Ir para confirmação
  t = montar({ painelAberto: true });
  t.sb.projLmsUpIrConfirmacao();
  ok('"Ir para confirmação" no painel do contrato abre a aba LMS — Confirmação', t.log.nav[0] === 'co:lms_confirmar', t.log.nav);
  t = montar({ painelAberto: false });
  t.sb.projLmsUpIrConfirmacao();
  ok('"Ir para confirmação" fora do painel usa projMostrarTab(lms_confirmar)', t.log.nav[0] === 'proj:lms_confirmar', t.log.nav);

  // ── Seleção + envio ─────────────────────────────────────────────
  t = montar();
  await t.sb.projLmsUpCarregar(PJ, t.els['sot-tab-content']);
  await t.sb.projLmsUpSelecionar({ files: [arq('LMS obra.xlsx', fixture)] });
  h = t.html();
  ok('arquivo válido: pré-checagem OK e botão "Enviar e gravar como RASCUNHO"',
    /Pré-checagem OK/.test(h) && /id="proj-lms-up-enviar"[^>]*>Enviar e gravar como RASCUNHO</.test(h) && /confere com o projeto/.test(h));
  ok('selecionar arquivo não envia nada', t.log.edge.length === 0 && t.log.confirm.length === 0);

  t = montar({ confirmar: false });
  await t.sb.projLmsUpCarregar(PJ, t.els['sot-tab-content']);
  await t.sb.projLmsUpSelecionar({ files: [arq('LMS obra.xlsx', fixture)] });
  await t.sb.projLmsUpEnviar();
  ok('cancelar o confirm() não envia', t.log.confirm.length === 1 && t.log.edge.length === 0 && /Enviar e gravar como RASCUNHO\?/.test(t.log.confirm[0]));

  t = montar();
  await t.sb.projLmsUpCarregar(PJ, t.els['sot-tab-content']);
  const arqOk = arq('LMS obra ç.xlsx', fixture);
  await t.sb.projLmsUpSelecionar({ files: [arqOk] });
  const nListar = t.log.rpc.filter(x => x.fn === 'sot_lms_rascunhos_listar').length;
  await t.sb.projLmsUpEnviar();
  const e = t.log.edge[0] || {};
  ok('envio: POST na Edge com projeto_id, Bearer JWT, x-lms-nome codificado e o próprio arquivo',
    t.log.edge.length === 1 && e.method === 'POST' && e.url === 'https://x.supabase.co/functions/v1/proj-lms-receber?projeto_id=' + PJ
    && e.headers.Authorization === 'Bearer jwt-auth' && e.headers['x-lms-nome'] === encodeURIComponent('LMS obra ç.xlsx')
    && e.headers['Content-Type'] === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' && e.body === arqOk, e.headers);
  h = t.html();
  ok('resposta: importacao_id, status, hash, linhas, WLs distintas', h.indexOf(IMP) >= 0 && /LMS recebido e gravado como RASCUNHO/.test(h)
    && h.indexOf('title="' + HASH + '"') >= 0 && /Linhas:<\/span> 200/.test(h) && /WLs distintas:<\/span> 7/.test(h));
  ok('resposta: avisos traduzidos e amostra de 50 linhas (escapada)',
    /Linha repetida: 2/.test(h) && /Plan zero com Real positivo: 1/.test(h) && /Amostra \(50 primeiras linhas\)/.test(h)
    && (h.match(/<tr>/g) || []).length === 51 && h.indexOf('<b>FIO</b>') < 0 && h.indexOf('&lt;b&gt;FIO') >= 0);
  ok('após enviar, a situação é recarregada e mostra o novo RASCUNHO com "Ir para confirmação"',
    t.log.rpc.filter(x => x.fn === 'sot_lms_rascunhos_listar').length === nListar + 1 && /id="proj-lms-up-ir"/.test(h));
  ok('o confirm() avisa projeto, arquivo, linhas e identificação', /Projeto: Obra Teste/.test(t.log.confirm[0]) && /Linhas: 200/.test(t.log.confirm[0])
    && t.log.confirm[0].indexOf(identFix) >= 0 && !/NÃO bate/.test(t.log.confirm[0]));
  ok('em nenhum momento chama sot_lms_confirmar', !t.log.rpc.some(x => x.fn === 'sot_lms_confirmar'));

  t = montar({ codigo: 'XYZ/0000/9999' });
  await t.sb.projLmsUpCarregar(PJ, t.els['sot-tab-content']);
  await t.sb.projLmsUpSelecionar({ files: [arq('LMS.xlsx', fixture)] });
  ok('projeto diferente: alerta na tela antes de enviar', /não bate com o projeto aberto/.test(t.html()));
  await t.sb.projLmsUpEnviar();
  ok('projeto diferente: confirm() destaca o alerta', /ATENÇÃO: a identificação do arquivo NÃO bate/.test(t.log.confirm[0] || ''));

  // Reenvio
  t = montar({ edge: () => ({ status: 200, body: { ok: true, reenvio: true, importacao_id: IMP, status: 'RASCUNHO', arquivo: { nome: 'x.xlsx', sha256: HASH },
    qtd_linhas: 200, qtd_wls_distintas: 7, amostra: [], avisos: {} } }) });
  await t.sb.projLmsUpCarregar(PJ, t.els['sot-tab-content']);
  await t.sb.projLmsUpSelecionar({ files: [arq('x.xlsx', fixture)] });
  await t.sb.projLmsUpEnviar();
  ok('reenvio do mesmo arquivo: informa que nada foi duplicado', /Nada foi duplicado/.test(t.html()) && /\(reenvio\)/.test(t.html()));

  // Erros da Edge
  const errosEdge = [
    ['aba ausente', 422, { ok: false, error: 'FORMATO_LMS_INCOMPATIVEL', erros: [{ codigo: 'WORKSHEET_AUSENTE' }] }, /não tem a aba &quot;Planilha1&quot;/],
    ['cabeçalho', 422, { ok: false, error: 'FORMATO_LMS_INCOMPATIVEL', erros: [{ codigo: 'CABECALHO_INCOMPATIVEL', detalhe: { coluna: 'D', esperado: 'Cód. Ma' } }] }, /cabeçalho da linha 3.*D: esperado &quot;Cód\. Ma&quot;/],
    ['macro', 415, { ok: false, error: 'TIPO_ARQUIVO_INVALIDO', erros: [{ codigo: 'ARQUIVO_COM_MACRO' }] }, /macro não é aceito/],
    ['grande', 413, { ok: false, error: 'ARQUIVO_GRANDE_DEMAIS' }, /máximo 12 MB/],
    ['sem permissão', 403, { ok: false, error: 'SEM_PERMISSAO' }, /PROJ_IMPORTAR_LMS/],
    ['projeto excluído', 409, { ok: false, error: 'PROJETO_EXCLUIDO' }, /projeto foi excluído/],
    ['sessão', 401, { code: 401, message: 'Invalid JWT' }, /Sessão expirada/],
    ['storage', 500, { ok: false, error: 'FALHA_STORAGE' }, /Falha ao guardar o arquivo/],
    ['função não publicada', 404, { code: 'NOT_FOUND', message: 'Requested function was not found' }, /Erro no recebimento do LMS: NOT_FOUND|função proj-lms-receber não encontrada/]
  ];
  for (const [nome, status, body, re] of errosEdge) {
    t = montar({ edge: () => ({ status, body }) });
    await t.sb.projLmsUpCarregar(PJ, t.els['sot-tab-content']);
    await t.sb.projLmsUpSelecionar({ files: [arq('x.xlsx', fixture)] });
    await t.sb.projLmsUpEnviar();
    ok('erro da Edge traduzido: ' + nome, /LMS não enviado:/.test(t.html()) && re.test(t.html()), t.html().slice(-400));
  }

  // Seleção recusada não habilita envio
  t = montar();
  await t.sb.projLmsUpCarregar(PJ, t.els['sot-tab-content']);
  await t.sb.projLmsUpSelecionar({ files: [arq('lms.xlsx', xlsx([[], [], esp.colunas]))] });
  h = t.html();
  ok('pré-checagem recusada: mensagem clara e sem botão de envio', /Arquivo recusado na pré-checagem: A planilha não tem linhas/.test(h) && !/proj-lms-up-enviar/.test(h));
  await t.sb.projLmsUpEnviar();
  ok('pré-checagem recusada: projLmsUpEnviar não envia', t.log.edge.length === 0 && t.log.confirm.length === 0);
  await t.sb.projLmsUpSelecionar({ files: [arq('enorme.xlsx', fixture, { size: 13 * 1024 * 1024, arrayBuffer: async () => { throw new Error('não deveria ler'); } })] });
  ok('arquivo acima de 12 MB é recusado sem ler o conteúdo', /máximo 12 MB/.test(t.html()));

  // Bloqueio vence estado forçado
  t = montar({ estado: 'EM_CONCILIACAO' });
  await t.sb.projLmsUpCarregar(PJ, t.els['sot-tab-content']);
  t.sb._projLmsUpSt.pre = { ok: true, linhas: 1, avisos: [], detalhes: [], erros: [] };
  t.sb._projLmsUpSt.arquivo = arq('x.xlsx', fixture);
  await t.sb.projLmsUpEnviar();
  ok('com ORIGINAL confirmada, projLmsUpEnviar não envia mesmo com arquivo pronto', t.log.edge.length === 0 && t.log.confirm.length === 0);

  // Duplo clique
  t = montar();
  await t.sb.projLmsUpCarregar(PJ, t.els['sot-tab-content']);
  await t.sb.projLmsUpSelecionar({ files: [arq('x.xlsx', fixture)] });
  await Promise.all([t.sb.projLmsUpEnviar(), t.sb.projLmsUpEnviar()]);
  ok('duplo clique envia uma vez só', t.log.edge.length === 1);

  // Render não invade outra aba
  t = montar({ aba: 'materiais' });
  t.els['sot-tab-content'].innerHTML = 'MATERIAIS';
  await t.sb.projLmsUpCarregar(PJ, t.els['sot-tab-content']);
  ok('se o usuário trocou de aba, o LMS não sobrescreve o conteúdo', t.html() === 'MATERIAIS');

  if (failed.length) {
    console.log(`proj-lms-upload-ui: FALHOU ${failed.length}/${total}`);
    for (const f of failed) console.log('  - ' + f);
    process.exit(1);
  }
  console.log(`proj-lms-upload-ui: OK (${total} verificações)`);
})().catch(err => { console.error(err); process.exit(1); });
