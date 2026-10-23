// TMA — status/histórico: homologação ponta a ponta com PostgREST + PostgreSQL REAIS, locais e temporários
// (127.0.0.1, credenciais fictícias, nunca produção). Executa as funções reais do index.html (gravação individual,
// lote, janela dos Disponíveis, progSetStatus, carga do dia com paginação) e os wrappers reais sbFetch/sbUpsert/
// sbDelete/sbUpdate. Um intermediário local injeta falhas (recusa, permissão, rede, prazo, página do meio).
// Toda prova é relida pelo PostgREST e conferida direto no banco.
// Uso: PG_BIN=<pasta pgsql\bin> POSTGREST_BIN=<pasta com postgrest.exe> node tests/pgreal/tma-status-postgrest-real.mjs
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import vm from 'vm';
import { spawn, spawnSync, execSync } from 'child_process';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.join(here, '..', '..');
const PG_BIN = process.env.PG_BIN, PGRST_BIN = process.env.POSTGREST_BIN;
const pgExe = n => path.join(PG_BIN || '', process.platform === 'win32' ? n + '.exe' : n);
const pgrstExe = path.join(PGRST_BIN || '', process.platform === 'win32' ? 'postgrest.exe' : 'postgrest');
if (!PG_BIN || !fs.existsSync(pgExe('pg_ctl')) || !PGRST_BIN || !fs.existsSync(pgrstExe)) {
  console.log('tma-status-postgrest-real: SKIP (defina PG_BIN e POSTGREST_BIN)'); process.exit(0);
}
const PG_PORTA = process.env.PG_PORTA || '55435', PGRST_PORTA = Number(process.env.PGRST_PORTA || 3012), PROXY_PORTA = Number(process.env.PROXY_PORTA || 3013);
const dados = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-pgrst-'));
const env = Object.assign({}, process.env, { PGHOST: '127.0.0.1', PGPORT: PG_PORTA, PGUSER: 'postgres', PGCLIENTENCODING: 'UTF8', PGOPTIONS: '-c client_min_messages=warning' });
const failed = []; let total = 0;
const ok = (n, c, d) => { total++; if (!c) failed.push(n + (d !== undefined ? ' — ' + JSON.stringify(d).slice(0, 500) : '')); };
const espera = ms => new Promise(r => setTimeout(r, ms));
const psql = (sql, db = 'homolog') => { const r = spawnSync(pgExe('psql'), ['-d', db, '-X', '-q', '-t', '-A', '-F', '|', '-v', 'ON_ERROR_STOP=1'], { input: sql, env, encoding: 'utf8' }); return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() }; };
const norm = s => s.replace(/\r\n/g, '\n');
const html = norm(fs.readFileSync(path.join(raiz, 'index.html'), 'utf8'));
let base = null;
try { base = norm(execSync('git show ' + (process.env.TMA_STATUS_BASE || '732987e') + ':index.html', { cwd: raiz, maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8')); } catch (e) { base = null; }
function fnDe(src, nome) {
  const re = new RegExp('\\n(?:async )?function ' + nome + '\\('); const n = src.split(re).length - 1;
  if (n !== 1) throw new Error('definição de ' + nome + ': ' + n);
  const ini = src.search(re) + 1; return src.slice(ini, src.indexOf('\n}\n', ini) + 2);
}
const varDe = (src, nome) => { const m = new RegExp('\\nvar ' + nome + '\\s*=[^;]*;').exec(src); if (!m) throw new Error('var ' + nome); return m[0].slice(1); };
const sbUpsertReal = src => fnDe(src.slice(src.indexOf('\nasync function sbUpsert', src.indexOf('\nasync function sbInsert'))), 'sbUpsert');

const DIA = '2026-10-22';
const CLEBER = '00000000-0000-4000-8000-000000000199', CLEBER_LINHA = 'a0000000-0000-4000-8000-000000000022';
const FERIAS = '00000000-0000-4000-8000-000000000112', VENCIDA = '00000000-0000-4000-8000-000000000111';

const SQL_BANCO = `
create role anon nologin;
create role authenticator login password 'homolog-local-senha-ficticia' noinherit;
grant anon to authenticator;
grant usage on schema public to anon;
create table public.prog_status_diario (
  id uuid primary key default gen_random_uuid(), colaborador_id text not null, data date not null,
  status text not null default 'disponivel', data_retorno date, registrado_por text, criado_em timestamptz default now(),
  deleted_at timestamptz, obs text, created_at timestamptz default now(), updated_at timestamptz default now(),
  constraint prog_status_diario_colaborador_id_data_key unique (colaborador_id, data));
create table public.audit_log (id bigserial primary key, acao text, modulo text, descricao text, usuario_id text, usuario_nome text,
  usuario_perfil text, dados_extra jsonb, data_hora timestamptz default now(), sessao_id text);
alter table public.prog_status_diario enable row level security;
alter table public.audit_log enable row level security;
create policy "Acesso total" on public.prog_status_diario for all to anon using (true) with check (true);
create policy "Acesso total" on public.audit_log for all to anon using (true) with check (true);
grant select, insert, update, delete on public.prog_status_diario, public.audit_log to anon;
grant usage, select on sequence public.audit_log_id_seq to anon;`;
const SQL_CENARIO = `
truncate public.prog_status_diario; truncate public.audit_log;
insert into public.prog_status_diario (id, colaborador_id, data, status, registrado_por, obs, criado_em, deleted_at) values
 ('${CLEBER_LINHA}', '${CLEBER}', '${DIA}', 'falta', 'RODRIGO (FICTÍCIO)', 'texto de 21/10', '2026-10-21 17:39:38-03', '2026-10-22 08:14:42-03');
insert into public.prog_status_diario (colaborador_id, data, status, data_retorno, registrado_por) values
 ('${FERIAS}', '2026-09-20', 'ferias', '2026-10-30', 'RH'), ('${VENCIDA}', '2026-10-01', 'afastado', '2026-10-10', 'RH');
insert into public.prog_status_diario (colaborador_id, data, status, registrado_por)
 select 'dem-' || (g % 150), date '2026-10-01' + (g / 150), 'demitido', 'CÓPIA' from generate_series(0, 3199) g;`;

// ── Intermediário local: injeta falhas, registra requisições e repassa ao PostgREST (sem chave/token, papel anon) ──
let regra = () => null; const reqs = [];
const sockets = new Set();
const proxy = http.createServer((req, res) => {
  let corpo = ''; req.on('data', c => { corpo += c; }); req.on('end', () => {
    const url = req.url.replace(/^\/rest\/v1/, ''); reqs.push({ metodo: req.method, url, corpo });
    const modo = regra({ metodo: req.method, url });
    if (modo === 'rede') { req.socket.destroy(); return; }
    if (modo === 'timeout') return; // nunca responde
    if (modo === 'recusa') { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ code: 'P0001', message: 'STATUS_BLOQUEADO: recusa simulada' })); }
    if (modo === 'permissao') { res.writeHead(403, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ code: '42501', message: 'permission denied for table prog_status_diario' })); }
    const cab = {}; ['content-type', 'prefer', 'accept'].forEach(h => { if (req.headers[h]) cab[h] = req.headers[h]; });
    if (corpo) cab['content-length'] = Buffer.byteLength(corpo);
    const r2 = http.request({ host: '127.0.0.1', port: PGRST_PORTA, method: req.method, path: url, headers: cab }, pr => {
      let b = ''; pr.on('data', c => { b += c; }); pr.on('end', () => { res.writeHead(pr.statusCode, { 'content-type': pr.headers['content-type'] || 'application/json' }); res.end(b); });
    });
    r2.on('error', e => { res.writeHead(502); res.end(String(e.message)); });
    if (corpo) r2.write(corpo); r2.end();
  });
});
proxy.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });

// ── Funções reais no sandbox, falando HTTP de verdade com o intermediário ─────────────────
function criarCtx(src) {
  const el = {};
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, window: {}, DEMO: false, SB: { url: 'http://127.0.0.1:' + PROXY_PORTA, key: 'chave-ficticia' }, _sbAuthToken: '',
    Promise, Object, Array, String, JSON, Date, Number, Math, RegExp, URL, clearTimeout, parseInt, TypeError,
    setTimeout: (f, ms) => setTimeout(f, ms >= 20000 ? 1500 : ms),   // prazo de 20 s comprimido
    usuarioLogado: { id: 'u1', nome: 'SUPERVISOR TESTE', perfil: 'supervisor_tma' },
    _progStatus: {}, _progStatusInfo: {}, _progData: DIA, _progStatusDateCache: 'x', composicao_dia: [], colaboradores: [{ id: CLEBER, nome: 'CLEBER TESTE', ativo: true }, { id: 'colab-x', nome: 'X TESTE', ativo: true }, { id: 'colab-y', nome: 'Y TESTE', ativo: true }, { id: 'colab-z', nome: 'Z TESTE', ativo: true }], equipes_disp: [],
    PROG_STATUS: { falta: { label: 'Faltou' }, observacao: { label: 'Observação' }, treinamento: { label: 'Treinamento' }, ferias: { label: 'Férias' } },
    toasts: [], fechou: 0, ls: {}, _cenaAuthHadSession: false, sbAuthJwtIsAuthenticated: () => false,
  };
  ctx.localStorage = { getItem: k => (k in ctx.ls ? ctx.ls[k] : null), setItem: (k, v) => { ctx.ls[k] = String(v); }, removeItem: k => { delete ctx.ls[k]; } };
  ctx.progShowToast = (m, t) => ctx.toasts.push({ m: String(m), erro: t === 'erro' });
  ctx.closeModal = () => { ctx.fechou++; }; ctx.progRenderQuadro = () => {}; ctx.setModal = () => {}; ctx.escHtml = s => String(s == null ? '' : s);
  ctx.progGetData = () => ctx._diaTela || DIA; ctx.dataHojeLocal = () => ctx._hoje || DIA; ctx.dataHoje = () => ctx._hoje || DIA;
  ctx._compDataStr = v => String(v || '').slice(0, 10);
  ctx.vtGarantirTratamento = () => {}; ctx.vtAtualizarAbaAlerta = () => {}; ctx.progLancarFaltaPLR = () => {}; ctx._progSalvarCacheDia = () => {};
  ctx.parseColabIds = r => (Array.isArray(r) ? r : []); ctx.fmtD = d => d; ctx.confirm = () => true; ctx._auditAuto = () => {};
  // auditLog real grava em lote via sbInsert; aqui grava direto (mesmo destino: audit_log pelo PostgREST)
  ctx.auditLog = (acao, modulo, descricao, extra) => { ctx._auditPend = (ctx._auditPend || Promise.resolve()).then(() => ctx.sbInsert('audit_log', { acao, modulo, descricao, usuario_nome: ctx.usuarioLogado.nome, dados_extra: extra || null }, { silent: true })); };
  // Mesmo contrato do cenaAuthAuthorizedFetch do app; erro de rede com a mensagem do navegador ("Failed to fetch")
  ctx.cenaAuthAuthorizedFetch = (url, opts) => fetch(url, { method: opts.method, headers: Object.assign({ apikey: 'chave-ficticia' }, opts.headers || {}), body: opts.body })
    .then(r => r.text().then(t => { let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; } return { ok: r.ok, status: r.status, text: t, json: j, aborted: false }; }),
      () => ({ ok: false, status: 0, text: 'Failed to fetch', aborted: false, json: null }));
  ctx.fetch = (url, opts) => fetch(url, opts).catch(() => { throw new TypeError('Failed to fetch'); });
  ctx.el = el;
  ctx.document = { getElementById: id => el[id] || null, querySelector: sel => (/progSalvarMenuStatus/.test(sel) ? (el.__btnSalvar || null) : /progConfirmarStatus/.test(sel) ? (el.__btnConfirmar || null) : null), querySelectorAll: () => [] };
  vm.createContext(ctx);
  const nomes = ['isUUID', 'sbFetch', 'sbInsert', 'sbDelete', 'sbUpdate', 'progMarcarAutorStatus', 'progDataRetornoStr', 'progRetornoAindaFora', 'progRetornoExpirouNoDia',
    'progFiltrosStatusPersistentes', 'progExpirarPersistenteLinha', 'progAplicarStatusDoBanco', 'progSalvarPersistente', 'progRemoverPersistente',
    'progSalvarStatus', 'progSalvarMenuStatus', 'progSetStatus', 'progVerificarRetornos', 'progAlterarStatusPool'];
  const novos = /function progStatusGravarDia\(/.test(src) ? ['progStatusComPrazo', 'progStatusClassificarErro', 'progStatusMsgErro', 'progStatusGravarDia', 'progBuscarStatusPersistentes'] : [];
  vm.runInContext(['var _SOFT_DELETE_TABLES = ["prog_status_diario"];', varDe(src, 'PROG_STATUS_PERSISTENTES')]
    .concat(nomes.map(n => fnDe(src, n)), [sbUpsertReal(src)], novos.map(n => fnDe(src, n))).join('\n'), ctx);
  return ctx;
}
async function recarregar(ctx, diaTela, colab) {
  const d = diaTela || DIA;
  const dia = await ctx.sbFetch('prog_status_diario', { filters: ['data=eq.' + d, 'deleted_at=is.null'] });
  const pers = ctx.progBuscarStatusPersistentes ? await ctx.progBuscarStatusPersistentes(d)
    : await ctx.sbFetch('prog_status_diario', { filters: ctx.progFiltrosStatusPersistentes(d), order: 'data.desc', limit: 500 });
  ctx._progStatus = {}; ctx._progStatusInfo = {};
  ctx.progAplicarStatusDoBanco(dia || [], pers || [], d);
  const c = colab || CLEBER;
  return { status: ctx._progStatus[c] || 'disponivel', obs: (ctx._progStatusInfo[c] || {}).obs || '', pers };
}
const linhaBanco = colab => psql(`select status || '|' || coalesce(obs,'') || '|' || coalesce(data_retorno::text,'') || '|' || coalesce(registrado_por,'') || '|' || (case when deleted_at is null then 't' else 'f' end) from public.prog_status_diario where colaborador_id='${colab}' and data='${DIA}'`).out;
const ult = ctx => (ctx.toasts[ctx.toasts.length - 1] || { m: '' });
const abrirMenu = (ctx, colab, st, texto, retorno) => { ctx._progStatus[colab] = st; ctx.el['obs-status-input'] = { value: texto }; ctx.el['retorno-data'] = { value: retorno || '' }; ctx.el.__btnSalvar = { disabled: false, textContent: '💾 Salvar' }; };

let pgOn = false, pgrst = null;
try {
  let r = spawnSync(pgExe('initdb'), ['-D', dados, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C'], { env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('initdb: ' + r.stderr);
  r = spawnSync(pgExe('pg_ctl'), ['-D', dados, '-o', `-p ${PG_PORTA} -c listen_addresses=127.0.0.1 -c timezone=America/Sao_Paulo`, '-l', path.join(dados, 'log.txt'), '-w', 'start'], { env, stdio: 'ignore' });
  if (r.status !== 0) throw new Error('pg_ctl start falhou'); pgOn = true;
  psql('create database homolog', 'postgres');
  r = psql(SQL_BANCO); if (r.code !== 0) throw new Error('estrutura: ' + r.err);
  const conf = path.join(dados, 'postgrest.conf');
  fs.writeFileSync(conf, [`db-uri = "postgres://authenticator:homolog-local-senha-ficticia@127.0.0.1:${PG_PORTA}/homolog"`, 'db-schemas = "public"', 'db-anon-role = "anon"',
    'server-host = "127.0.0.1"', `server-port = ${PGRST_PORTA}`, 'jwt-secret = "homolog-local-segredo-ficticio-com-32-caracteres-ou-mais"'].join('\n'));
  // O postgrest.exe do Windows usa a libpq.dll da pasta do PostgreSQL
  const envPgrst = Object.assign({}, process.env, { PATH: PG_BIN + path.delimiter + (process.env.PATH || process.env.Path || '') });
  pgrst = spawn(pgrstExe, [conf], { env: envPgrst, stdio: ['ignore', fs.openSync(path.join(dados, 'postgrest.log'), 'w'), fs.openSync(path.join(dados, 'postgrest.err'), 'w')] });
  let pronto = false;
  for (let i = 0; i < 60 && !pronto; i++) { await espera(500); try { const rr = await fetch('http://127.0.0.1:' + PGRST_PORTA + '/prog_status_diario?limit=1'); pronto = rr.ok; } catch (e) {} }
  if (!pronto) throw new Error('PostgREST não respondeu: ' + fs.readFileSync(path.join(dados, 'postgrest.err'), 'utf8').slice(0, 400));
  const versao = await fetch('http://127.0.0.1:' + PGRST_PORTA + '/').then(x => x.json()).then(j => j && j.info && j.info.version).catch(() => '');
  ok('PostgREST real respondendo em 127.0.0.1 (versão ' + versao + ')', !!versao, versao);
  await new Promise(res => proxy.listen(PROXY_PORTA, '127.0.0.1', res));
  psql(SQL_CENARIO);

  // ═══ 0. Main (8.1.225) contra o PostgREST real: confirma as causas ═══
  if (base) {
    const ctx = criarCtx(base);
    abrirMenu(ctx, CLEBER, 'observacao', 'texto do supervisor');
    ctx.progSalvarMenuStatus(CLEBER); await espera(1200);
    const ind = reqs.filter(x => x.metodo === 'POST' && /on_conflict=prog_status_diario_colaborador_id_data_key/.test(x.url));
    ok('main: gravação individual usa o nome da regra no on_conflict', ind.length === 1);
    const resp = await fetch('http://127.0.0.1:' + PGRST_PORTA + '/prog_status_diario?on_conflict=prog_status_diario_colaborador_id_data_key',
      { method: 'POST', headers: { 'content-type': 'application/json', prefer: 'resolution=merge-duplicates' }, body: JSON.stringify([{ colaborador_id: 'x', data: DIA, status: 'falta' }]) });
    const corpoResp = await resp.text();
    ok('PostgREST real recusa on_conflict pelo nome da regra (mesmo resultado do teste SQL)', resp.status >= 400 && /42703|does not exist|column/i.test(corpoResp), resp.status + ' ' + corpoResp);
    ok('main: tela mostra "Status salvo" mesmo assim', ctx.toasts.some(t => /Status salvo/.test(t.m)));
    ok('main: lote grava na linha excluída, que continua excluída', /^observacao\|texto do supervisor\|\|.*\|f$/.test(linhaBanco(CLEBER)), linhaBanco(CLEBER));
    const rel = await recarregar(criarCtx(base));
    ok('main: depois de Atualizar a observação some (defeito reproduzido no PostgREST)', rel.status === 'disponivel', rel.status);
    const relF = await recarregar(criarCtx(base), DIA, FERIAS);
    ok('main: limite de 500 omite a férias de 20/09 (PostgREST real, 3.203 linhas)', relF.status === 'disponivel', relF.status);
    psql(SQL_CENARIO);
  }

  // ═══ 1. Cleber: treinamento 22/10, retorno 23/10, sobre a linha excluída ═══
  {
    const ctx = criarCtx(html);
    abrirMenu(ctx, CLEBER, 'treinamento', '', '2026-10-23');
    ctx.progSalvarMenuStatus(CLEBER);
    ok('cleber: janela aberta até o banco confirmar', ctx.fechou === 0);
    await espera(1200); await ctx._auditPend;
    ok('cleber: sucesso só após confirmação', /Status salvo/.test(ult(ctx).m) && ctx.fechou === 1, ctx.toasts);
    ok('cleber: no banco — treinamento, retorno 23/10, ativo', /^treinamento\|\|2026-10-23\|SUPERVISOR TESTE\|t$/.test(linhaBanco(CLEBER)), linhaBanco(CLEBER));
    ok('cleber: mesma linha (id e criação originais), sem duplicar', psql(`select count(*) || '|' || min(id::text) || '|' || to_char(min(criado_em) at time zone 'America/Sao_Paulo','DD/MM HH24:MI') from public.prog_status_diario where colaborador_id='${CLEBER}'`).out === `1|${CLEBER_LINHA}|21/10 17:39`);
    const aud = psql(`select descricao || ' ## ' || (dados_extra->>'status_anterior') || ' ## ' || (dados_extra->>'excluido_em') from public.audit_log where descricao like 'Reativou%'`).out;
    ok('cleber: reativação no audit_log com status e exclusão anteriores', /Reativou status do dia excluído/.test(aud) && /## falta ##/.test(aud) && /2026-10-22/.test(aud), aud);
    for (const hoje of [DIA, '2026-10-23', '2026-10-30']) {
      for (const [diaTela, esperado] of [['2026-10-21', 'disponivel'], [DIA, 'treinamento'], ['2026-10-23', 'disponivel'], ['2026-10-24', 'disponivel']]) {
        const c2 = criarCtx(html); c2._hoje = hoje;
        const rel = await recarregar(c2, diaTela);
        ok('histórico (hoje ' + hoje + ') consulta ' + diaTela + ' → ' + esperado, rel.status === esperado, rel.status);
      }
    }
    ok('histórico: depois do retorno a linha de 22/10 continua ativa no banco', /\|t$/.test(linhaBanco(CLEBER)), linhaBanco(CLEBER));
  }

  // ═══ 2. Férias, afastamento vencido e paginação > 3.000 ═══
  {
    const ctx = criarCtx(html);
    const n0 = reqs.length;
    let rel = await recarregar(ctx, DIA, FERIAS);
    ok('paginação: férias de 20/09 aparece em 22/10', rel.status === 'ferias', rel.status);
    const pags = reqs.slice(n0).filter(x => x.metodo === 'GET' && /offset=/.test(x.url));
    const esperado = Number(psql(`select count(*) from public.prog_status_diario where status in ('ferias','afastado','treinamento','demitido','inapto') and data <= '${DIA}' and deleted_at is null and (data_retorno is null or data_retorno > '${DIA}')`).out);
    ok('paginação: 4 páginas de 1000 pelo PostgREST real, todas as linhas pertinentes', pags.length === 4 && rel.pers.length === esperado && esperado > 3000, { pags: pags.length, linhas: rel.pers.length, esperado });
    ok('paginação: linhas sem repetição', new Set(rel.pers.map(x => x.id)).size === rel.pers.length);
    ok('paginação: filtro or=(data_retorno…) aceito pelo PostgREST', /or=\(data_retorno\.is\.null,data_retorno\.gt\.2026-10-22\)/.test(decodeURIComponent(pags[0].url)));
    rel = await recarregar(criarCtx(html), DIA, VENCIDA);
    ok('afastamento vencido (retorno 10/10) não vale em 22/10', rel.status === 'disponivel' && !rel.pers.some(x => x.colaborador_id === VENCIDA));
    rel = await recarregar(criarCtx(html), '2026-10-05', VENCIDA);
    ok('afastamento consultado em 05/10 (dentro do período) aparece', rel.status === 'afastado', rel.status);
    let k = 0; regra = x => (x.metodo === 'GET' && /offset=2000/.test(x.url) && k++ === 0 ? 'rede' : null);
    const parcial = await ctx.progBuscarStatusPersistentes(DIA);
    ok('falha na página do meio → null (nunca lista parcial)', parcial === null);
    regra = () => null;
  }

  // ═══ 3. Gravação individual, lote, janela dos Disponíveis, progSetStatus ═══
  {
    const X = 'colab-x', Y = 'colab-y', Z = 'colab-z';
    let ctx = criarCtx(html);
    ctx.progSetStatus(X, 'falta', null); await espera(1200);
    ok('progSetStatus: falta gravada', /^falta\|/.test(linhaBanco(X)), linhaBanco(X));
    ctx._progStatus[Y] = 'patio'; ctx._progStatusInfo[Y] = { obs: 'pátio' }; ctx.progMarcarAutorStatus(Y); ctx.progSalvarStatus(); await espera(1200);
    ok('lote: colaborador editado gravado', /^patio\|pátio\|/.test(linhaBanco(Y)), linhaBanco(Y));
    ctx = criarCtx(html);
    ctx.progAlterarStatusPool(Z); ctx.window.progStSelecionar(Z, 'observacao'); ctx.el['prog-st-obs'] = { value: 'pela janela' }; ctx.el.__btnConfirmar = { disabled: false, textContent: 'Confirmar' };
    ctx.window.progConfirmarStatus(Z); await espera(1200);
    ok('janela dos Disponíveis: grava e confirma', /^observacao\|pela janela\|/.test(linhaBanco(Z)) && /✅ Status salvo/.test(ult(ctx).m), [linhaBanco(Z), ult(ctx).m]);
  }

  // ═══ 4. Concorrência e aba antiga ═══
  {
    const A = criarCtx(html), B = criarCtx(html);
    B._progStatus[CLEBER] = 'falta'; B._progStatusInfo[CLEBER] = { obs: 'memória antiga' };
    B._progStatus.w = 'patio'; B.progMarcarAutorStatus('w'); B.progSalvarStatus(); await espera(1200);
    ok('aba antiga: editar outro colaborador não sobrescreve o treinamento do Cleber', /^treinamento\|/.test(linhaBanco(CLEBER)), linhaBanco(CLEBER));
    const c1 = criarCtx(html), c2 = criarCtx(html);
    abrirMenu(c1, 'duplo', 'observacao', 'A'); abrirMenu(c2, 'duplo', 'observacao', 'B');
    c1.progSalvarMenuStatus('duplo'); c2.progSalvarMenuStatus('duplo'); await espera(1500);
    ok('dois supervisores ao mesmo tempo: uma linha, sem erro', psql(`select count(*) from public.prog_status_diario where colaborador_id='duplo'`).out === '1' && /^observacao\|[AB]\|/.test(linhaBanco('duplo')) && c1.fechou === 1 && c2.fechou === 1);
    abrirMenu(A, CLEBER, 'treinamento', '', '2026-10-23'); // mantém o estado do Cleber
  }

  // ═══ 5. Falhas: recusa, permissão, rede, prazo (nada muda no banco, texto preservado) ═══
  for (const [modo, re] of [['recusa', /O banco recusou/], ['permissao', /não tem permissão/], ['rede', /Sem conexão/], ['timeout', /não respondeu a tempo/]]) {
    const ctx = criarCtx(html);
    const antes = linhaBanco(CLEBER);
    regra = x => (x.metodo === 'POST' ? modo : null);
    abrirMenu(ctx, CLEBER, 'observacao', 'texto que não pode sumir');
    ctx.progSalvarMenuStatus(CLEBER); await espera(modo === 'timeout' ? 3000 : 1200);
    regra = () => null;
    ok('[' + modo + '] mensagem clara, sem "salvo"', re.test(ult(ctx).m) && !ctx.toasts.some(t => /Status salvo/.test(t.m)), ult(ctx).m);
    ok('[' + modo + '] janela aberta e texto preservado', ctx.fechou === 0 && ctx.el['obs-status-input'].value === 'texto que não pode sumir');
    ok('[' + modo + '] banco inalterado', linhaBanco(CLEBER) === antes, [antes, linhaBanco(CLEBER)]);
  }
} catch (e) {
  failed.push('exceção: ' + (e && e.stack || e));
} finally {
  try { sockets.forEach(s => s.destroy()); proxy.close(); } catch (_) {}
  if (pgrst) { try { pgrst.kill(); } catch (_) {} }
  if (pgOn) spawnSync(pgExe('pg_ctl'), ['-D', dados, '-m', 'fast', '-w', 'stop'], { env, stdio: 'ignore' });
  await espera(300);
  try { fs.rmSync(dados, { recursive: true, force: true }); } catch (_) {}
}
if (failed.length) { console.error('FALHOU ' + failed.length + '/' + total + ':\n- ' + failed.join('\n- ')); process.exit(1); }
console.log('tma-status-postgrest-real: OK (' + total + ' verificações, PostgREST + PostgreSQL reais)');
process.exit(0);
