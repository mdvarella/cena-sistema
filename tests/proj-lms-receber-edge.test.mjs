// ETAPA 1.3 — Edge Function proj-lms-receber (index.ts real) contra PGlite com as migrations reais
// (sessão, Etapa 1.1, Etapa 1.2 e Etapa 1.3). Auth e Storage simulados; o cliente "do usuário" executa as RPCs
// como authenticated com o auth.uid() do JWT e o cliente de serviço como service_role.
// Uso: PGLITE_PATH=<pasta com @electric-sql/pglite> XLSX_PATH=<.../xlsx.mjs> node tests/proj-lms-receber-edge.test.mjs
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';

const here = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.join(here, '..');
let PGlite, XLSX, xlsxPath;
try {
  const dir = process.env.PGLITE_PATH || path.join(process.env.TEMP || '/tmp', 'pglite-cena');
  const req = createRequire(path.join(dir, 'package.json'));
  ({ PGlite } = await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href));
  xlsxPath = process.env.XLSX_PATH || path.join(process.env.TEMP || '/tmp', 'cena-lms-parse', 'node_modules', 'xlsx', 'xlsx.mjs');
  XLSX = await import(pathToFileURL(xlsxPath).href);
} catch {
  console.log('proj-lms-receber-edge: SKIP (defina PGLITE_PATH e XLSX_PATH)');
  process.exit(0);
}
const parserPath = process.env.LMS_PARSER_PATH || path.join(raiz, 'supabase', 'functions', '_shared', 'lms-parser.ts');
const edgePath = process.env.LMS_EDGE_PATH || path.join(raiz, 'supabase', 'functions', 'proj-lms-receber', 'index.ts');
const migPath = process.env.LMS_MIG_PATH || path.join(raiz, 'supabase', 'migrations', '20261009193000_proj_lms_origem.sql');
const P = await import(pathToFileURL(parserPath).href);

const failed = [];
let total = 0;
const ok = (n, c, d) => { total++; if (!c) failed.push(n + (d !== undefined ? ' — ' + JSON.stringify(d).slice(0, 400) : '')); };

const migDir = path.join(raiz, 'supabase', 'migrations');
const semNotify = s => s.replace(/NOTIFY pgrst[^;]*;/g, '');
const ler = f => semNotify(fs.readFileSync(path.join(migDir, f), 'utf8'));
const migProg = fs.readFileSync(path.join(migDir, '20261004200000_prog_projetos_agenda.sql'), 'utf8');
const fimMarca = 'GRANT EXECUTE ON FUNCTION public.cena_prog_pode_programar_projetos() TO authenticated;';
const fnProg = migProg.slice(migProg.indexOf('CREATE OR REPLACE FUNCTION public.cena_prog_pode_programar_projetos()'), migProg.indexOf(fimMarca) + fimMarca.length);

// ── Estáticos do index.ts ───────────────────────────────────────
const edgeSrc = fs.readFileSync(edgePath, 'utf8');
const edgeCodigo = edgeSrc.replace(/\/\/[^\n]*/g, '');
ok('Edge sem segredo/JWT/URL privada hardcoded', !/eyJ[A-Za-z0-9_-]{10,}|sb_secret_|https:\/\/[a-z0-9]{20}\.supabase\.co/i.test(edgeSrc));
ok('Edge lê chaves só de Deno.env', /Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/.test(edgeSrc));
ok('autorização só pelo cliente do usuário', /userClient\.rpc\("sot_lms_autorizar_recebimento"/.test(edgeCodigo) && !/admin\.rpc\("sot_lms_autorizar/.test(edgeCodigo)
  && !/cena_pode/.test(edgeCodigo));
ok('registro só pelo cliente de serviço', /admin\.rpc\("sot_lms_importacao_registrar"/.test(edgeCodigo) && !/userClient\.rpc\("sot_lms_importacao_registrar"/.test(edgeCodigo));
ok('não confia em perfil/contrato/e-mail/user_id do cliente', !/searchParams\.get\("(perfil|contrato|email|user_id|usuario)/i.test(edgeCodigo)
  && !/headers\.get\("x-(perfil|contrato|email|user)/i.test(edgeCodigo));
ok('não congela perfil, não toca materiais/atividades/WL/TMA', !/congelar|sot_materiais|sot_atividades|sot_wl|composicao_dia|equipes_disp|progTma/i.test(edgeCodigo));
ok('sem URL pública nem signed URL', !/getPublicUrl|createSignedUrl/.test(edgeCodigo));
ok('upload sem sobrescrever (upsert: false)', /upsert: false/.test(edgeCodigo) && !/upsert: true/.test(edgeCodigo));
ok('parser separado (Edge só orquestra)', /from "\.\.\/_shared\/lms-parser\.ts"/.test(edgeSrc) && !/function parseLms|XLSX\.read\(/.test(edgeCodigo));
ok('SheetJS 0.20.3 fixado', /https:\/\/cdn\.sheetjs\.com\/xlsx-0\.20\.3\/package\/xlsx\.mjs/.test(edgeSrc));
const cfg = fs.readFileSync(path.join(raiz, 'supabase', 'config.toml'), 'utf8');
ok('config.toml: proj-lms-receber com verify_jwt = true', /\[functions\.proj-lms-receber\]\r?\nverify_jwt = true/.test(cfg));

// ── Banco ───────────────────────────────────────────────────────
const U = n => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const UID = { gestor: U(1), supervisor: U(2), coordenador: U(3), inativo: U(901), semCadastro: U(903) };
const C1 = 'c0000000-0000-4000-8000-000000000001';
const PJ = n => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P_OK = PJ(1), P_OK2 = PJ(2), P_TEXTO = PJ(6), P_EXCLUIDO = PJ(8), P_INEXISTENTE = PJ(99);
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table public.usuarios_sistema (id uuid primary key default gen_random_uuid(), nome text, email text unique,
  perfil text, ativo boolean default true, auth_user_id uuid, deleted_at timestamptz);
insert into public.usuarios_sistema (nome, email, perfil, auth_user_id, ativo) values
  ('g', 'g@cena', 'gestor', '${UID.gestor}', true), ('s', 's@cena', 'supervisor', '${UID.supervisor}', true),
  ('c', 'c@cena', 'coordenador', '${UID.coordenador}', true), ('x', 'x@cena', 'admin', '${UID.inativo}', false);
create table public.contratos (id uuid primary key default gen_random_uuid(), codigo text, nome text, cliente text, status text);
insert into public.contratos (id, codigo, nome, cliente, status) values ('${C1}', '4600003971', 'RDSE', 'ENEL', 'Ativo');
create table public.sot_projetos (id uuid primary key, contrato_id text, nome text, status text, deleted_at timestamptz);
insert into public.sot_projetos (id, contrato_id, nome, status, deleted_at) values
  ('${P_OK}', '${C1}', 'P1', 'Recebido', null), ('${P_OK2}', null, 'P2', 'Recebido', null),
  ('${P_TEXTO}', 'RDSE', 'Texto', 'Recebido', null), ('${P_EXCLUIDO}', '${C1}', 'Excluído', 'Recebido', now());
create table public.composicao_dia (id uuid primary key default gen_random_uuid(), equipe_id text, data date, projeto_ids text);
create table public.equipes_disp (id uuid primary key default gen_random_uuid(), equipe_id text, data date);
`);
await db.exec(ler('20261004190000_seguranca_usuarios_sistema.sql'));
await db.exec(fnProg);
await db.exec(ler('20261007190000_cena_permissoes_acao.sql'));
await db.exec(ler('20261009173000_proj_perfil_processo.sql'));
await db.exec(semNotify(fs.readFileSync(migPath, 'utf8')));

async function como(role, uid, fn) {
  await db.exec(`set role ${role}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
  try { return await fn(); } finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}
const pgErro = e => ({ code: e.code ?? 'XX000', message: e.message });

// ── Supabase simulado ───────────────────────────────────────────
const ENV = { SUPABASE_URL: 'https://local.test', SUPABASE_ANON_KEY: 'anon-key-local', SUPABASE_SERVICE_ROLE_KEY: 'service-key-local' };
const S = {
  env: { ...ENV },
  tokens: { 'jwt-gestor': UID.gestor, 'jwt-supervisor': UID.supervisor, 'jwt-coord': UID.coordenador, 'jwt-inativo': UID.inativo, 'jwt-sem': UID.semCadastro },
  objetos: new Map(),
  chamadas: [],
  falharUpload: false,
  falharRegistro: null,
  falharRemove: false,
};
globalThis.__cenaCreateClient = (url, key, opts) => {
  const header = opts?.global?.headers?.Authorization;
  if (key === ENV.SUPABASE_ANON_KEY) {
    const uid = S.tokens[String(header ?? '').replace(/^Bearer /, '')];
    return {
      auth: { getUser: async () => (uid ? { data: { user: { id: uid } }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } }) },
      rpc: async (fn, args) => {
        S.chamadas.push(['usuario', fn]);
        if (fn !== 'sot_lms_autorizar_recebimento') return { data: null, error: { code: '42883', message: 'não exposta' } };
        return como('authenticated', uid, async () => {
          try { return { data: (await db.query(`select public.sot_lms_autorizar_recebimento($1::uuid) v`, [args.p_projeto_id])).rows[0].v, error: null }; }
          catch (e) { return { data: null, error: pgErro(e) }; }
        });
      },
      storage: { from: () => ({ upload: async () => { S.chamadas.push(['usuario', 'storage']); return { error: { statusCode: '403' } }; } }) },
    };
  }
  if (key === ENV.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      rpc: async (fn, args) => {
        S.chamadas.push(['servico', fn]);
        if (fn !== 'sot_lms_importacao_registrar') return { data: null, error: { code: '42883', message: 'desconhecida' } };
        if (S.falharRegistro) return { data: null, error: S.falharRegistro };
        return como('service_role', null, async () => {
          try {
            const r = await db.query(`select public.sot_lms_importacao_registrar($1::uuid, $2::uuid, $3::jsonb, $4::jsonb) v`,
              [args.p_auth, args.p_projeto_id, JSON.stringify(args.p_importacao), args.p_linhas === null ? null : JSON.stringify(args.p_linhas)]);
            return { data: r.rows[0].v, error: null };
          } catch (e) { return { data: null, error: pgErro(e) }; }
        });
      },
      from: (tab) => {
        const filtros = [];
        const q = {
          select: () => q,
          eq: (c, v) => { filtros.push([c, v]); return q; },
          maybeSingle: async () => como('service_role', null, async () => {
            S.chamadas.push(['servico', 'select:' + tab]);
            try {
              const w = filtros.map(([c], i) => `${c} = $${i + 1}`).join(' and ');
              const r = await db.query(`select id from public.${tab} where ${w} limit 1`, filtros.map(f => f[1]));
              return { data: r.rows[0] ?? null, error: null };
            } catch (e) { return { data: null, error: pgErro(e) }; }
          }),
        };
        return q;
      },
      storage: {
        from: (bucket) => ({
          upload: async (p, bytes, o) => {
            S.chamadas.push(['servico', 'upload']);
            if (bucket !== 'proj-lms' || o?.upsert !== false) return { error: { statusCode: '400', message: 'uso inesperado' } };
            if (S.falharUpload) return { error: { statusCode: '500', message: 'storage fora' } };
            if (S.objetos.has(p)) return { error: { statusCode: '409', message: 'The resource already exists' } };
            S.objetos.set(p, { bytes: new Uint8Array(bytes), contentType: o.contentType });
            return { data: { path: p }, error: null };
          },
          remove: async (ps) => {
            S.chamadas.push(['servico', 'remove']);
            if (S.falharRemove) return { error: { message: 'falhou' } };
            for (const p of ps) S.objetos.delete(p);
            return { data: ps, error: null };
          },
        }),
      },
    };
  }
  throw new Error('chave inesperada');
};

let handler = null;
globalThis.Deno = { env: { get: k => S.env[k] }, serve: h => { handler = h; } };
const codigoEdge = edgeSrc
  .replace(/^import \{ createClient \} from "[^"]+";$/m, 'const createClient = globalThis.__cenaCreateClient;')
  .replace(/from "https:\/\/cdn\.sheetjs\.com\/[^"]+";/, `from ${JSON.stringify(pathToFileURL(xlsxPath).href)};`)
  .replace(/from "\.\.\/_shared\/lms-parser\.ts";/, `from ${JSON.stringify(pathToFileURL(parserPath).href)};`);
const tmp = path.join(os.tmpdir(), `cena-proj-lms-receber-${process.pid}-${Date.now()}.mts`);
fs.writeFileSync(tmp, codigoEdge);
try { await import(pathToFileURL(tmp).href); } finally { fs.rmSync(tmp, { force: true }); }
ok('Edge registrou o handler', typeof handler === 'function');

const logs = [];
const logOriginal = console.log;
console.log = (...a) => logs.push(a.map(String).join(' '));
const fixture = new Uint8Array(fs.readFileSync(path.join(raiz, 'tests', 'fixtures', 'lms', 'modelo-lms-anonimizado.xlsx')));
const esperado = JSON.parse(fs.readFileSync(path.join(raiz, 'tests', 'fixtures', 'lms', 'modelo-lms-esperado.json'), 'utf8'));
const sha = b => createHash('sha256').update(b).digest('hex');

async function enviar({ token = 'jwt-gestor', projeto = P_OK, bytes = fixture, nome = 'Modelo LMS.xlsx', mime = P.XLSX_MIME, metodo = 'POST', semAuth = false, headers = {}, corpoStream = false } = {}) {
  const h = { ...headers };
  if (!semAuth) h.Authorization = `Bearer ${token}`;
  if (nome !== null) h['x-lms-nome'] = encodeURIComponent(nome);
  if (mime !== null) h['content-type'] = mime;
  let body = metodo === 'POST' || metodo === 'PUT' ? bytes : undefined;
  if (body && corpoStream) {
    const b = body;
    body = new ReadableStream({ start(c) { for (let i = 0; i < b.length; i += 1 << 20) c.enqueue(b.subarray(i, i + (1 << 20))); c.close(); } });
  }
  const url = `https://local.test/functions/v1/proj-lms-receber${projeto === null ? '' : `?projeto_id=${projeto}`}`;
  const res = await handler(new Request(url, { method: metodo, headers: h, body, ...(corpoStream ? { duplex: 'half' } : {}) }));
  const txt = await res.text();
  let j = null; try { j = JSON.parse(txt); } catch {}
  return { status: res.status, j, txt, headers: res.headers };
}
const contar = async () => (await db.query(`select (select count(*) from public.sot_lms_importacoes)::int imp,
  (select count(*) from public.sot_lms_linhas)::int lin, (select count(*) from public.sot_lms_importacao_eventos)::int ev`)).rows[0];
const vazio = async () => { const c = await contar(); return c.imp === 0 && c.lin === 0 && c.ev === 0 && S.objetos.size === 0; };

let r = await enviar({ metodo: 'OPTIONS' });
ok('OPTIONS: CORS com x-lms-nome', r.status === 200 && /x-lms-nome/.test(r.headers.get('access-control-allow-headers') || ''));
r = await enviar({ metodo: 'GET' });
ok('GET → 405', r.status === 405);
S.env.SUPABASE_SERVICE_ROLE_KEY = '';
r = await enviar();
ok('sem service role configurada → 503, nada gravado', r.status === 503 && await vazio());
S.env = { ...ENV };

// Seção 46 — segurança
r = await enviar({ semAuth: true });
ok('JWT ausente → 401', r.status === 401 && r.j?.error === 'SEM_SESSAO');
r = await enviar({ token: 'anon-key-local' });
ok('anon (chave anon como bearer, sem usuário) → 401', r.status === 401 && r.j?.error === 'SESSAO_INVALIDA');
r = await enviar({ token: 'jwt-forjado' });
ok('JWT inválido → 401', r.status === 401);
r = await enviar({ token: 'jwt-sem' });
ok('usuário sem cadastro ERP → 403 USUARIO_ERP_INATIVO', r.status === 403 && r.j?.error === 'USUARIO_ERP_INATIVO');
r = await enviar({ token: 'jwt-inativo' });
ok('usuário inativo → 403', r.status === 403 && r.j?.error === 'USUARIO_ERP_INATIVO');
r = await enviar({ token: 'jwt-supervisor' });
ok('sem PROJ_IMPORTAR_LMS → 403 SEM_PERMISSAO', r.status === 403 && r.j?.error === 'SEM_PERMISSAO');
r = await enviar({ projeto: P_INEXISTENTE });
ok('projeto inexistente → 404', r.status === 404 && r.j?.error === 'PROJETO_INEXISTENTE');
r = await enviar({ projeto: P_EXCLUIDO });
ok('projeto excluído → 409', r.status === 409 && r.j?.error === 'PROJETO_EXCLUIDO');
r = await enviar({ projeto: P_TEXTO });
ok('contrato inválido → 403 CONTRATO_NAO_IDENTIFICADO', r.status === 403 && r.j?.error === 'CONTRATO_NAO_IDENTIFICADO');
r = await enviar({ projeto: 'nao-uuid' });
ok('projeto_id inválido → 400', r.status === 400);
r = await enviar({ projeto: null });
ok('sem projeto_id → 400', r.status === 400);
r = await enviar({ headers: { 'x-perfil': 'admin', 'x-contrato': C1 }, token: 'jwt-supervisor' });
ok('perfil/contrato enviados pelo cliente são ignorados', r.status === 403);
ok('nenhuma tentativa negada gravou objeto ou linha', await vazio());
ok('serviço nunca foi usado para autorizar', !S.chamadas.some(([q, f]) => q === 'servico' && /autorizar/.test(f)));
ok('negados não chegaram ao Storage nem ao registro', !S.chamadas.some(([q]) => q === 'servico'));

r = await enviar({ bytes: new TextEncoder().encode('WL;CTG\n1;WP\n'), nome: 'lms.xlsx' });
ok('CSV renomeado → 415, nada gravado', r.status === 415 && r.j?.error === 'TIPO_ARQUIVO_INVALIDO' && await vazio());
r = await enviar({ nome: 'lms.xlsm' });
ok('extensão .xlsm → 415', r.status === 415);
r = await enviar({ mime: 'text/plain' });
ok('MIME text/plain → 415', r.status === 415);
r = await enviar({ nome: null });
ok('sem nome do arquivo → 415', r.status === 415);
r = await enviar({ bytes: new Uint8Array(P.LIMITES.arquivoBytes + 10) });
ok('arquivo acima de 12 MiB → 413, nada gravado', r.status === 413 && r.j?.error === 'ARQUIVO_GRANDE_DEMAIS' && await vazio());
r = await enviar({ bytes: new Uint8Array(P.LIMITES.arquivoBytes + 10), corpoStream: true });
ok('arquivo grande sem content-length (stream) → 413', r.status === 413);

function planilha(linhas, { cab = esperado.colunas, extra = {} } = {}) {
  const sheet = XLSX.utils.aoa_to_sheet([['Definição de projeto:', null, null, 'DMP/A.OES.00.00003'], [], cab, ...linhas]);
  for (const [ref, cell] of Object.entries(extra)) sheet[ref] = cell;
  sheet['!ref'] = 'A1:Z40';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Planilha1');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}
const L = ['1', 'WP', 'I', 324894, 'NK-AMAR-RC', 'M', 'FIO', 6, 6, null, null, null, null, null];
r = await enviar({ bytes: planilha([L], { cab: esperado.colunas.map((c, i) => (i === 7 ? 'Quantidade' : c)) }) });
ok('estrutura XLSX errada (cabeçalho H) → 422 FORMATO_LMS_INCOMPATIVEL, nada no Storage nem no banco', r.status === 422
  && r.j?.error === 'FORMATO_LMS_INCOMPATIVEL' && r.j.erros[0].detalhe.coluna === 'H' && await vazio(), r.j);

// Sucesso com a fixture
S.chamadas = [];
r = await enviar();
const caminho = `${P_OK}/${sha(fixture)}.xlsx`;
ok('fixture → 200 RASCUNHO/ORIGINAL', r.status === 200 && r.j?.ok === true && r.j.reenvio === false && r.j.status === 'RASCUNHO' && r.j.tipo_importacao === 'ORIGINAL', r.j);
ok('original no Storage privado em <projeto>/<sha256>.xlsx, bytes idênticos', S.objetos.size === 1 && S.objetos.has(caminho)
  && sha(S.objetos.get(caminho).bytes) === sha(fixture) && S.objetos.get(caminho).contentType === P.XLSX_MIME);
ok('preview: projeto, nome, SHA-256, tamanho, worksheet, D1', r.j?.projeto_id === P_OK && r.j.arquivo.nome === 'Modelo LMS.xlsx'
  && r.j.arquivo.sha256 === sha(fixture) && r.j.arquivo.tamanho === fixture.length && r.j.worksheet === 'Planilha1'
  && r.j.projeto_identificacao_raw === 'DMP/A.OES.00.00001' && r.j.parser_version === '1');
ok('preview: total de linhas, WLs, lista de WLs, Plan=0/Real>0, repetidos, nulos', r.j?.qtd_linhas === esperado.linhas_reais
  && r.j.qtd_wls_distintas === esperado.wls && r.j.resumo.wls.length === esperado.wls && r.j.resumo.plan_zero_real_positivo === 0
  && r.j.resumo.codigos_repetidos === 42 && r.j.resumo.codigos_nulos === 0 && r.j.resumo.duplicados_wl_codigo_ft === esperado.duplicados_wl_codigo_ft
  && Array.isArray(r.j.erros) && typeof r.j.avisos === 'object');
ok('preview paginado: amostra de 50, sem linha_raw', r.j?.amostra.length === 50 && !('linha_raw' in r.j.amostra[0]) && r.txt.length < 200000, r.txt.length);
ok('resposta sem conteúdo fora de A:N', !/PESSOA|ANONIMA/.test(r.txt));
let c = await contar();
ok('banco: 1 importação, 200 linhas, evento CRIADA', c.imp === 1 && c.lin === esperado.linhas_reais && c.ev === 1, c);
const imp = (await db.query(`select * from public.sot_lms_importacoes`)).rows[0];
ok('importação: autoria = auth.uid() do JWT; caminho e hash', imp.criado_por_auth === UID.gestor && imp.storage_path === caminho && imp.hash_sha256 === sha(fixture));
ok('ordem das chamadas: autoriza (usuário) → upload → registro (serviço)', JSON.stringify(S.chamadas.map(x => x.join(':')))
  === JSON.stringify(['usuario:sot_lms_autorizar_recebimento', 'servico:upload', 'servico:sot_lms_importacao_registrar']), S.chamadas);

// Reenvio idempotente
S.chamadas = [];
r = await enviar({ token: 'jwt-coord', nome: 'outro nome.xlsx' });
ok('mesmos bytes (outro nome, outro usuário) → 200 reenvio, mesma importação', r.status === 200 && r.j?.reenvio === true && r.j.importacao_id === imp.id
  && r.j.arquivo.nome === 'Modelo LMS.xlsx' && r.j.amostra.length === 50, r.j);
c = await contar();
ok('reenvio: sem importação/linhas novas, 1 objeto, evento REENVIO', c.imp === 1 && c.lin === 200 && c.ev === 2 && S.objetos.size === 1, c);
ok('reenvio não removeu o objeto existente', !S.chamadas.some(([, f]) => f === 'remove') && S.objetos.has(caminho));
r = await enviar({ projeto: P_OK2 });
ok('mesmo arquivo em outro projeto → nova importação e novo objeto', r.status === 200 && r.j.reenvio === false && S.objetos.size === 2);

// Conteúdo fora de A:N
const comFora = planilha([L, ['2', 'WP', 'R', 'R-AHO234', 'S-AHO234', 'US3', 'SERV', 1, 1, '0,2616', 0.2616, 0.2616, null, null]],
  { extra: { R4: { t: 's', v: 'PESSOA SECRETA R:123456' }, O5: { t: 's', v: 'FORA O' }, U6: { t: 's', v: 'FORA U' } } });
r = await enviar({ bytes: comFora, nome: 'Fulano de Tal LMS.xlsx' });
ok('conteúdo fora de A:N: 200 e ignorado na resposta', r.status === 200 && r.j.qtd_linhas === 2 && !/SECRETA|FORA O|FORA U|123456/.test(r.txt), r.j);
const linhasFora = (await db.query(`select l.* from public.sot_lms_linhas l join public.sot_lms_importacoes i on i.id = l.importacao_id where i.id = $1`, [r.j?.importacao_id])).rows;
ok('conteúdo fora de A:N não chega ao banco', linhasFora.length === 2 && !/SECRETA|FORA O|FORA U|123456/.test(JSON.stringify(linhasFora)));
ok('Real em lms_qtd_real_informada, Plan em qtd_plan, valor pt-BR', linhasFora.some(l => l.codigo_norm === 'R-AHO234' && Number(l.valor_ups_item) === 0.2616 && l.valor_ups_item_raw === '0,2616'));

// Compensação
const n0 = await contar();
S.falharUpload = true;
r = await enviar({ bytes: planilha([L, L]) });
ok('falha no Storage → 500 FALHA_STORAGE, nada registrado', r.status === 500 && r.j?.error === 'FALHA_STORAGE' && JSON.stringify(await contar()) === JSON.stringify(n0));
S.falharUpload = false;
const novo = planilha([L, L, L]);
S.falharRegistro = { code: 'XX000', message: 'boom interno com detalhe sensível' };
r = await enviar({ bytes: novo });
ok('Storage ok + banco falhou → objeto recém-criado removido, 500 sem detalhe interno', r.status === 500 && r.j?.error === 'FALHA_REGISTRO'
  && !S.objetos.has(`${P_OK}/${sha(novo)}.xlsx`) && !/boom|sensível/.test(r.txt) && JSON.stringify(await contar()) === JSON.stringify(n0));
ok('log da compensação registra OBJETO_REMOVIDO', logs.some(l => /REGISTRO_FALHOU/.test(l) && /OBJETO_REMOVIDO/.test(l)));
S.falharRemove = true;
r = await enviar({ bytes: novo });
ok('remoção da compensação falhou → log PENDENTE (falha não escondida)', r.status === 500 && logs.some(l => /REGISTRO_FALHOU/.test(l) && /PENDENTE/.test(l)));
S.falharRemove = false; S.objetos.delete(`${P_OK}/${sha(novo)}.xlsx`);
r = await enviar({ token: 'jwt-gestor' });
ok('banco falhou em reenvio (objeto já existia) → objeto da importação mantido', r.status === 500 && S.objetos.has(caminho), r.j);
S.falharRegistro = { code: '22023', message: 'x' };
r = await enviar({ bytes: novo });
ok('registro recusado por inconsistência → 422 REGISTRO_INCONSISTENTE', r.status === 422 && r.j?.error === 'REGISTRO_INCONSISTENTE');
S.falharRegistro = null;
S.objetos.delete(caminho);
r = await enviar();
ok('objeto sumiu do Storage e importação existe → reenvio regrava o original', r.status === 200 && r.j.reenvio === true && S.objetos.has(caminho)
  && sha(S.objetos.get(caminho).bytes) === sha(fixture));

// Logs
const tudo = logs.join('\n');
ok('logs sem JWT, chaves, nome do arquivo ou conteúdo', !/jwt-gestor|jwt-coord|service-key-local|anon-key-local|Modelo LMS|Fulano|PESSOA|SECRETA|FIO AL/.test(tudo), logs.slice(-3));
ok('logs com projeto, importação, hash, status, linhas e auth.uid', logs.some(l => {
  try { const o = JSON.parse(l); return o.evento === 'RECEBIDO' && o.projeto_id && o.importacao_id && /^[0-9a-f]{64}$/.test(o.hash) && o.status === 'RASCUNHO' && o.linhas > 0 && o.auth_uid; } catch { return false; }
}));
ok('logs categorizam negações e recusas', ['NEGADO', 'ARQUIVO_RECUSADO', 'FORMATO_RECUSADO', 'STORAGE_FALHOU'].every(e => tudo.includes(`"evento":"${e}"`)));

console.log = logOriginal;
if (failed.length) {
  console.log(`proj-lms-receber-edge: FALHOU ${failed.length}/${total}`);
  for (const f of failed) console.log('  - ' + f);
  process.exit(1);
}
console.log(`proj-lms-receber-edge: OK (${total} verificações)`);
