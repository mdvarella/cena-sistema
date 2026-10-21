// PORTARIA 8.1.225 — testes SQL da migration 20261020120000_portaria_encerramento_administrativo.sql
// (encerramento administrativo sem horário fictício, proteção contra gravação direta, tablets antigos, conciliação de
// retorno real, identificação dos históricos sem alterar valores, reaplicação e rollback). PGlite; concorrência fica
// para o teste em PostgreSQL real (tests/pgreal/portaria-encerramento-concorrencia.ps1).
// Uso: PGLITE_PATH=<pasta com @electric-sql/pglite> node tests/portaria-encerramento-adm-sql.test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';

const here = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.join(here, '..');
let PGlite;
try {
  const dir = process.env.PGLITE_PATH || path.join(process.env.TEMP || '/tmp', 'pglite-cena');
  const req = createRequire(path.join(dir, 'package.json'));
  ({ PGlite } = await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href));
} catch {
  console.log('portaria-encerramento-adm-sql: SKIP (defina PGLITE_PATH)');
  process.exit(0);
}

const migDir = path.join(raiz, 'supabase', 'migrations');
const semNotify = s => s.replace(/NOTIFY pgrst[^;]*;/g, '');
const ler = f => fs.readFileSync(path.join(migDir, f), 'utf8').replace(/\r\n/g, '\n');
const migRaw = ler('20261020120000_portaria_encerramento_administrativo.sql');
const mig = semNotify(migRaw);
const codigo = migRaw.slice(0, migRaw.indexOf('-- Validação (somente leitura)')).replace(/--[^\n]*/g, '');
const desfazer = migRaw.slice(migRaw.indexOf('-- Para desfazer')).split('\n').slice(1)
  .map(l => l.replace(/^--\s?/, '')).join('\n').replace(/NOTIFY pgrst[^;]*;/g, '').trim();
const fixture = fs.readFileSync(path.join(here, 'fixtures', 'portaria', 'frotas-portaria-saidas-base.sql'), 'utf8');

const failed = [];
let total = 0;
const ok = (n, c, d) => { total++; if (!c) failed.push(n + (d !== undefined ? ' — ' + JSON.stringify(d).slice(0, 600) : '')); };
const corpo = nome => { const i = codigo.indexOf('FUNCTION public.' + nome + '('); return codigo.slice(i, codigo.indexOf('\n$$;', i)); };

// ── Estáticos ───────────────────────────────────────────────────
const cl = codigo.replace(/NOTIFY pgrst[^;]*;/g, '').trim();
ok('transação explícita: BEGIN; primeiro, COMMIT; último (só o NOTIFY depois)', cl.startsWith('BEGIN;') && cl.endsWith('COMMIT;')
  && /COMMIT;\s*NOTIFY pgrst, 'reload schema';\s*$/.test(codigo.trim()));
ok('nunca DELETE físico nem TRUNCATE nem DROP', !/DELETE\s+FROM/i.test(codigo) && !/TRUNCATE/i.test(codigo) && !/\bDROP\s+(TABLE|COLUMN)/i.test(codigo));
ok('nenhuma hora fictícia: as funções não usam 23:59', !/23:59/.test(corpo('fn_portaria_encerrar_saida_admin')) && !/23:59/.test(corpo('fn_portaria_converter_retorno_fisico')));
ok('encerrar grava data_retorno e km_retorno NULOS', /data_retorno = NULL, km_retorno = NULL/.test(corpo('fn_portaria_encerrar_saida_admin')));
ok('autor vem da sessão (auth.uid), não de parâmetro', /v_uid\s+uuid := auth\.uid\(\)/.test(corpo('fn_portaria_encerrar_saida_admin'))
  && /v_uid\s+uuid := auth\.uid\(\)/.test(corpo('fn_portaria_converter_retorno_fisico')));
ok('permissão própria PORT_ENCERRAR_SAIDA_ADMIN pelo cena_pode', /cena_pode\('PORT_ENCERRAR_SAIDA_ADMIN'/.test(corpo('fn_portaria_encerrar_saida_admin')));
ok('funções sem acesso anônimo', /REVOKE ALL ON FUNCTION public\.fn_portaria_encerrar_saida_admin\(uuid, text, jsonb\) FROM PUBLIC, anon;/.test(codigo)
  && /GRANT EXECUTE ON FUNCTION public\.fn_portaria_encerrar_saida_admin\(uuid, text, jsonb\) TO authenticated;/.test(codigo)
  && !/TO anon/.test(codigo));
ok('marca da função é local à transação', /set_config\('cena\.portaria_enc', '1', true\)/.test(codigo) && !/set_config\('cena\.portaria_enc', '1', false\)/.test(codigo));
ok('rollback não reabre saídas (nenhum status volta a Em campo)', !/status\s*=\s*'Em campo'/.test(desfazer) && /frotas_portaria_saidas_encerramento_bkp/.test(desfazer));

// ── Banco ───────────────────────────────────────────────────────
const U = n => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PERFIS = ['admin', 'gestor', 'coordenador', 'diretoria', 'supervisor', 'portaria', 'encarregado'];
const UID = Object.fromEntries(PERFIS.map((p, i) => [p, U(i + 1)]));
const C_ATIVO = 'c0000000-0000-4000-8000-000000000001';
const C_RESTRITO = 'c0000000-0000-4000-8000-000000000002';
const S = n => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const BASE = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text);
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
create table public.usuarios_sistema (id uuid primary key default gen_random_uuid(), nome text, email text unique,
  perfil text, ativo boolean default true, auth_user_id uuid, deleted_at timestamptz);
insert into public.usuarios_sistema (nome, email, perfil, auth_user_id) values
  ${PERFIS.map(p => `('Usuário ${p}', '${p}@cena', '${p}', '${UID[p]}')`).join(',\n  ')};
create table public.contratos (id uuid primary key default gen_random_uuid(), codigo text, nome text, cliente text, status text);
insert into public.contratos (id, codigo, nome, cliente, status) values
  ('${C_ATIVO}', '1', 'TMA OESTE', 'ENEL', 'Ativo'), ('${C_RESTRITO}', '2', 'RESTRITO', 'ENEL', 'Ativo');
`;
const migProg = ler('20261004200000_prog_projetos_agenda.sql');
const iniProg = migProg.indexOf('CREATE OR REPLACE FUNCTION public.cena_prog_pode_programar_projetos()');
const fimMarca = 'GRANT EXECUTE ON FUNCTION public.cena_prog_pode_programar_projetos() TO authenticated;';
const fnProg = migProg.slice(iniProg, migProg.indexOf(fimMarca) + fimMarca.length);
const CADEIA = [semNotify(ler('20261004190000_seguranca_usuarios_sistema.sql')), fnProg, semNotify(ler('20261007190000_cena_permissoes_acao.sql'))];

// Cenário: 3 encerramentos antigos (2 com auditoria), 1 retorno físico antigo, saídas abertas e uma dupla principal+acompanhante.
const CENARIO = `
insert into public.frotas_portaria_saidas (id, placa, equipe, equipe_id, contrato_id, data_saida, km_saida, km_retorno, data_retorno, status, obs_retorno, retorno_registrado_por) values
  ('${S(1)}', 'AAA1A11', 'EQ1', 'e1', '${C_ATIVO}', '2026-09-10 07:00-03', 1000, null, '2026-09-10 23:59:59-03', 'Retornado', '[Encerramento administrativo] Saída antiga sem retorno registrado', 'Marcos Varella'),
  ('${S(2)}', 'BBB2B22', 'EQ2', 'e2', '${C_ATIVO}', '2026-09-11 07:00-03', 2000, 2050, '2026-09-11 23:59:59-03', 'Retornado', '[Encerramento administrativo] Encerramento administrativo — saídas antigas sem retorno', 'Marcos Varella'),
  ('${S(3)}', 'CCC3C33', 'EQ3', 'e3', '${C_ATIVO}', '2026-09-12 07:00-03', 3000, null, '2026-09-12 23:59:59-03', 'Retornado', '[Encerramento administrativo] ', 'Gestor X'),
  ('${S(4)}', 'DDD4D44', 'EQ4', 'e4', '${C_ATIVO}', '2026-09-13 07:00-03', 4000, 4100, '2026-09-13 17:00-03', 'Retornado', 'ok', 'Portaria 1'),
  ('${S(5)}', 'EEE5E55', 'EQ5', 'e5', '${C_ATIVO}', '2026-10-16 07:00-03', 5000, null, null, 'Em campo', null, null),
  ('${S(6)}', 'FFF6F66', 'EQ6', 'e6', '${C_ATIVO}', '2026-10-16 07:10-03', 6000, null, null, 'Em campo', null, null),
  ('${S(7)}', 'GGG7G77', 'EQ7', 'e7', '${C_RESTRITO}', '2026-10-16 07:20-03', 7000, null, null, 'Em campo', null, null),
  ('${S(8)}', 'HHH8H88', 'EQ8', 'e8', 'texto-nao-uuid', '2026-10-16 07:30-03', 8000, null, null, 'Em campo', null, null),
  ('${S(9)}', 'III9I99', 'EQ9', 'e9', '${C_ATIVO}', '2026-10-17 07:00-03', 9000, null, null, 'Em campo', null, null),
  ('${S(11)}', 'KKK1K11', 'EQ11', 'e11', '${C_ATIVO}', '2026-10-18 07:00-03', 11000, null, null, 'Em campo', null, null);
insert into public.frotas_portaria_saidas (id, placa, equipe, equipe_id, contrato_id, data_saida, status, saida_principal_id) values
  ('${S(10)}', 'III9I99', 'EQ10', 'e10', '${C_ATIVO}', '2026-10-17 07:00-03', 'Em campo', '${S(9)}');
insert into public.audit_log (acao, modulo, descricao, usuario_nome, dados_extra, data_hora) values
  ('editar', 'sistema', 'Alterou frotas_portaria_saidas [id=eq.${S(1)}]: status=Retornado', 'Marcos Varella',
   to_jsonb('{"dados":{"obs_retorno":"[Encerramento administrativo] Saída antiga sem retorno registrado"}}'::text), '2026-10-01 10:15:00-03'),
  ('editar', 'sistema', 'Alterou frotas_portaria_saidas [id=eq.${S(2)}]: status=Retornado', 'Marcos Varella',
   to_jsonb('{"dados":{"obs_retorno":"[Encerramento administrativo] Encerramento administrativo — saídas antigas sem retorno"}}'::text), '2026-10-02 11:20:00-03');
`;
const ASSIN = `select md5(string_agg(id::text||'|'||coalesce(status,'')||'|'||coalesce(data_retorno::text,'')||'|'||coalesce(km_retorno::text,'')
  ||'|'||coalesce(obs_retorno,'')||'|'||coalesce(retorno_registrado_por,'')||'|'||coalesce(km_saida::text,'')||'|'||coalesce(data_saida::text,''), ',' order by id)) v
  from public.frotas_portaria_saidas`;

async function novoBanco(comMig = true) {
  const db = new PGlite();
  await db.exec(BASE);
  for (const m of CADEIA) await db.exec(m);
  await db.exec(fixture);
  await db.exec(CENARIO);
  if (comMig) {
    await db.exec(mig);
    await db.exec(`insert into public.cena_permissoes_acao (perfil, acao, contrato_id, permitido, motivo)
      values ('gestor', 'PORT_ENCERRAR_SAIDA_ADMIN', '${C_RESTRITO}', false, 'teste: negado neste contrato')`);
  }
  return db;
}
async function como(db, role, uid, fn) {
  await db.exec(`set role ${role}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
  try { return await fn(); } finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}
const api = (db, sql, params, uid = UID.gestor, role = 'authenticated') => como(db, role, uid, async () => {
  try { return { r: (await db.query(sql, params)).rows[0] }; } catch (e) { return { e: e.message }; }
});
const linha = async (db, id) => (await db.query('select * from public.frotas_portaria_saidas where id=$1', [id])).rows[0];
const ENC = `select public.fn_portaria_encerrar_saida_admin($1::uuid, $2, $3::jsonb) v`;
const CONV = `select public.fn_portaria_converter_retorno_fisico($1::uuid, $2::timestamptz, $3::numeric, $4, $5, $6, $7::jsonb) v`;

(async () => {
  // ── 1. Históricos: só colunas novas; campos originais idênticos ──
  const db0 = await novoBanco(false);
  const antes = (await db0.query(ASSIN)).rows[0].v;
  let erro = null;
  try { await db0.exec(mig); } catch (e) { erro = e.message; }
  ok('migration roda sem erro', !erro, erro);
  ok('históricos: campos originais idênticos depois da migration (assinatura)', (await db0.query(ASSIN)).rows[0].v === antes);
  let r1 = await linha(db0, S(1)), r2 = await linha(db0, S(2)), r3 = await linha(db0, S(3)), r4 = await linha(db0, S(4)), r5 = await linha(db0, S(5));
  ok('históricos: marcados como ENCERRAMENTO_ADMINISTRATIVO / LEGADO_23_59, horário desconhecido',
    [r1, r2, r3].every(r => r.tipo_encerramento === 'ENCERRAMENTO_ADMINISTRATIVO' && r.encerramento_origem === 'LEGADO_23_59' && r.retorno_horario_conhecido === false));
  ok('históricos: 23:59:59 preservado em data_retorno e copiado como convencional',
    [r1, r2, r3].every(r => r.data_retorno && +r.data_retorno === +r.data_retorno_convencional) && new Date(r1.data_retorno).toISOString() === '2026-09-11T02:59:59.000Z');
  ok('históricos: data/hora e responsável da regularização vêm da auditoria',
    new Date(r1.encerrado_em).toISOString() === '2026-10-01T13:15:00.000Z' && r1.encerrado_por === 'Marcos Varella'
    && new Date(r2.encerrado_em).toISOString() === '2026-10-02T14:20:00.000Z' && r1.encerramento_evidencia.fonte_regularizacao === 'audit_log');
  ok('históricos: sem auditoria fica identificado como tal (não inventa autor)', r3.encerramento_evidencia.fonte_regularizacao === 'sem_auditoria' && r3.encerrado_por === 'Gestor X');
  ok('históricos: justificativa vem do texto original', r1.encerramento_justificativa === 'Saída antiga sem retorno registrado' && r3.encerramento_justificativa === 'saída antiga sem retorno');
  ok('históricos: KM de retorno existente preservado (não apagado)', Number(r2.km_retorno) === 2050);
  ok('retorno físico antigo não é reclassificado em massa', r4.tipo_encerramento === null && r4.encerramento_origem === null);
  ok('saída aberta intocada', r5.tipo_encerramento === null && r5.status === 'Em campo');
  const snap = (await db0.query('select * from public.frotas_portaria_saidas order by id')).rows;
  erro = null; try { await db0.exec(mig); } catch (e) { erro = e.message; }
  ok('reaplicar a migration: sem erro', !erro, erro);
  ok('reaplicar a migration: nada muda', JSON.stringify(snap) === JSON.stringify((await db0.query('select * from public.frotas_portaria_saidas order by id')).rows));
  ok('permissão: matriz admin/gestor/coordenador/diretoria', (await db0.query(`select string_agg(perfil, ',' order by perfil) v from public.cena_permissoes_acao
    where acao='PORT_ENCERRAR_SAIDA_ADMIN' and contrato_id is null and permitido and deleted_at is null`)).rows[0].v === 'admin,coordenador,diretoria,gestor');

  // ── 2. Encerramento administrativo ──
  const db = await novoBanco(true);
  let x = await api(db, ENC, [S(5), 'Retorno de 16/10 não registrado; horário real desconhecido.', null], null, 'anon');
  ok('sem login (anon): recusa', !!x.e && /permission denied|SEM_SESSAO/.test(x.e), x);
  x = await api(db, ENC, [S(5), 'Retorno de 16/10 não registrado; horário real desconhecido.', null], null, 'authenticated');
  ok('autenticado sem uid: SEM_SESSAO', /SEM_SESSAO/.test(x.e || ''), x);
  x = await api(db, ENC, [S(5), 'Retorno de 16/10 não registrado; horário real desconhecido.', null], UID.supervisor);
  ok('supervisor (sem permissão): SEM_PERMISSAO', /SEM_PERMISSAO/.test(x.e || ''), x);
  x = await api(db, ENC, [S(5), 'Retorno de 16/10 não registrado; horário real desconhecido.', null], UID.portaria);
  ok('portaria (sem permissão): SEM_PERMISSAO', /SEM_PERMISSAO/.test(x.e || ''), x);
  x = await api(db, ENC, [S(5), 'curta', null]);
  ok('justificativa curta: recusa', /JUSTIFICATIVA/.test(x.e || ''), x);
  x = await api(db, ENC, [S(5), 'Veículo conferido no pátio, retorno não registrado.', '{"km_observado":"abc"}']);
  ok('KM observado inválido: recusa', /EVIDENCIA/.test(x.e || ''), x);
  ok('nada gravado nas recusas', (await linha(db, S(5))).status === 'Em campo' && (await linha(db, S(5))).tipo_encerramento === null);
  const t0 = Date.now();
  x = await api(db, ENC, [S(5), 'Veículo conferido no pátio em 20/10 08:10; retorno de 16/10 não registrado.',
    '{"km_observado": 5123, "foto": "data:image/jpeg;base64,AAAA", "observado_por": "Porteiro 1", "local": "Coaquira 01"}']);
  const e5 = await linha(db, S(5));
  ok('gestor encerra: ok', x.r && x.r.v.ok === true && x.r.v.idempotente === false, x);
  ok('encerrado: status Retornado (situação operacional)', e5.status === 'Retornado');
  ok('encerrado: SEM horário de retorno e SEM KM de retorno', e5.data_retorno === null && e5.km_retorno === null);
  ok('encerrado: tipo e horário desconhecido', e5.tipo_encerramento === 'ENCERRAMENTO_ADMINISTRATIVO' && e5.retorno_horario_conhecido === false && e5.encerramento_origem === 'FUNCAO');
  ok('encerrado: hora real da regularização', e5.encerrado_em && Math.abs(new Date(e5.encerrado_em).getTime() - t0) < 60000);
  ok('encerrado: usuário autenticado e nome', e5.encerrado_por_auth === UID.gestor && e5.encerrado_por === 'Usuário gestor' && e5.retorno_registrado_por === 'Usuário gestor');
  ok('encerrado: KM do pátio só como evidência', Number(e5.encerramento_evidencia.km_observado) === 5123 && e5.km_retorno === null && !!e5.encerramento_evidencia.registrado_em);
  ok('encerrado: observação com o prefixo (compatível com telas e tablets antigos)', /^\[Encerramento administrativo\] Veículo conferido/.test(e5.obs_retorno));
  const aud = (await db.query(`select * from public.audit_log where acao='encerrar_admin'`)).rows;
  ok('auditoria registrada (usuário, perfil, saída, justificativa)', aud.length === 1 && aud[0].usuario_id === UID.gestor && aud[0].usuario_perfil === 'gestor'
    && aud[0].dados_extra.id === S(5) && /retorno de 16\/10/.test(aud[0].dados_extra.justificativa));
  x = await api(db, ENC, [S(5), 'Veículo conferido no pátio em 20/10 08:10; retorno de 16/10 não registrado.', null]);
  ok('repetir: idempotente, sem duplicar nem mudar', x.r && x.r.v.idempotente === true && (await db.query(`select count(*)::int n from public.audit_log where acao='encerrar_admin'`)).rows[0].n === 1
    && JSON.stringify(await linha(db, S(5))) === JSON.stringify(e5), x);
  x = await api(db, ENC, [S(4), 'Tentando encerrar saída que já retornou fisicamente.', null]);
  ok('saída já retornada: JA_RETORNADA', /JA_RETORNADA/.test(x.e || ''), x);
  x = await api(db, ENC, [S(10), 'Tentando encerrar só a acompanhante da saída.', null]);
  ok('acompanhante sozinha: ACOMPANHANTE', /ACOMPANHANTE/.test(x.e || ''), x);
  x = await api(db, ENC, [S(7), 'Contrato com permissão negada para gestor.', null]);
  ok('negação por contrato vale (gestor no contrato restrito)', /SEM_PERMISSAO/.test(x.e || ''), x);
  x = await api(db, ENC, [S(7), 'Admin no contrato restrito continua podendo.', null], UID.admin);
  ok('admin no contrato restrito: ok', x.r && x.r.v.ok, x);
  x = await api(db, ENC, [S(8), 'Contrato gravado como texto não-uuid usa a regra geral.', null], UID.diretoria);
  ok('diretoria + contrato texto: ok (regra geral)', x.r && x.r.v.ok, x);
  x = await api(db, ENC, [S(9), 'Principal com acompanhante: as duas encerradas juntas.', null], UID.coordenador);
  const e9 = await linha(db, S(9)), e10 = await linha(db, S(10));
  ok('principal + acompanhante: as duas encerradas, vínculo preservado', x.r && x.r.v.acompanhantes === 1 && e9.tipo_encerramento === 'ENCERRAMENTO_ADMINISTRATIVO'
    && e10.tipo_encerramento === 'ENCERRAMENTO_ADMINISTRATIVO' && e10.saida_principal_id === S(9) && e10.data_retorno === null, x);

  // ── 3. Proteção contra gravação direta (como o app/PostgREST, papel authenticated) ──
  const tela = (sql, uid = UID.admin) => como(db, 'authenticated', uid, async () => { try { const r = await db.query(sql); return { n: r.affectedRows }; } catch (e) { return { e: e.message }; } });
  x = await tela(`update public.frotas_portaria_saidas set data_retorno=now(), km_retorno=5200 where id='${S(5)}'`);
  ok('direto: pôr hora/KM de retorno num encerramento → ENCERRAMENTO_PROTEGIDO', /ENCERRAMENTO_PROTEGIDO/.test(x.e || ''), x);
  x = await tela(`update public.frotas_portaria_saidas set status='Em campo' where id='${S(5)}'`);
  ok('direto: reabrir encerramento → recusa', /ENCERRAMENTO_PROTEGIDO/.test(x.e || ''), x);
  x = await tela(`update public.frotas_portaria_saidas set tipo_encerramento='RETORNO_FISICO', retorno_horario_conhecido=true where id='${S(5)}'`);
  ok('direto: trocar o tipo → recusa', /ENCERRAMENTO_PROTEGIDO/.test(x.e || ''), x);
  x = await tela(`update public.frotas_portaria_saidas set data_retorno=now(), km_retorno=1100 where id='${S(1)}'`);
  ok('direto: histórico também protegido', /ENCERRAMENTO_PROTEGIDO/.test(x.e || ''), x);
  x = await tela(`update public.frotas_portaria_saidas set km_saida=5001, km_ajustado_em=now(), km_ajuste_justificativa='dígito' where id='${S(5)}'`);
  ok('direto: ajuste do KM de SAÍDA continua permitido', x.n === 1 && Number((await linha(db, S(5))).km_saida) === 5001, x);
  x = await tela(`update public.frotas_portaria_saidas set tipo_encerramento='ENCERRAMENTO_ADMINISTRATIVO', retorno_horario_conhecido=false,
    encerrado_em=now(), encerramento_justificativa='forçado por SQL', encerramento_origem='FUNCAO', status='Retornado' where id='${S(6)}'`);
  ok('direto: criar encerramento sem a função → recusa', /ENCERRAMENTO_PROTEGIDO/.test(x.e || ''), x);
  x = await tela(`insert into public.frotas_portaria_saidas (placa, data_saida, status, tipo_encerramento) values ('ZZZ', now(), 'Em campo', 'RETORNO_FISICO')`);
  ok('direto: inserir já com tipo → recusa', /ENCERRAMENTO_PROTEGIDO/.test(x.e || ''), x);
  x = await tela(`update public.frotas_portaria_saidas set data_retorno=now(), km_retorno=5300, status='Retornado'
    where id='${S(5)}' and deleted_at is null and data_retorno is null and status='Em campo'`);
  ok('retorno físico com a trava status=Em campo: 0 linhas no encerrado (sem erro)', x.n === 0, x);

  // Retorno físico normal e tablet antigo
  x = await tela(`update public.frotas_portaria_saidas set status='Retornado', data_retorno='2026-10-16 17:00-03', km_retorno=6100
    where id='${S(6)}' and deleted_at is null and data_retorno is null`);
  const f6 = await linha(db, S(6));
  ok('retorno físico normal (qualquer versão): classificado RETORNO_FISICO, horário conhecido', x.n === 1 && f6.tipo_encerramento === 'RETORNO_FISICO' && f6.retorno_horario_conhecido === true, x);
  x = await tela(`update public.frotas_portaria_saidas set status='Retornado', data_retorno='2026-10-18T23:59:59', obs_retorno='[Encerramento administrativo] Saída antiga sem retorno registrado',
    retorno_registrado_por='Gestor Antigo', status_devolucao=null where id='${S(11)}'`, UID.gestor);
  const f11 = await linha(db, S(11));
  ok('tablet antigo (23:59:59): aceito e identificado como TABLET_ANTIGO_23_59', x.n === 1 && f11.tipo_encerramento === 'ENCERRAMENTO_ADMINISTRATIVO'
    && f11.encerramento_origem === 'TABLET_ANTIGO_23_59' && f11.retorno_horario_conhecido === false, x);
  ok('tablet antigo: valor enviado preservado e marcado como convencional; hora real da regularização registrada',
    +f11.data_retorno === +f11.data_retorno_convencional && f11.encerrado_por === 'Gestor Antigo' && f11.encerrado_por_auth === UID.gestor
    && Math.abs(new Date(f11.encerrado_em).getTime() - Date.now()) < 60000);

  // ── 4. Conciliação de retorno real ──
  x = await api(db, CONV, [S(5), '2026-10-16 17:30-03', 5150, 'OFFLINE_SINCRONIZADO', null, null, '{"placa":"EEE5E55"}'], UID.portaria);
  ok('offline sem id do evento: EVENTO', /EVENTO/.test(x.e || ''), x);
  x = await api(db, CONV, [S(5), '2026-10-16 17:30-03', 5150, 'OFFLINE_SINCRONIZADO', null, 'ev-1', '{"placa":"XXX0X00"}'], UID.portaria);
  ok('offline com outra placa: VEICULO', /VEICULO/.test(x.e || ''), x);
  x = await api(db, CONV, [S(5), '2026-10-15 17:30-03', 5150, 'OFFLINE_SINCRONIZADO', null, 'ev-1', '{"placa":"EEE5E55"}'], UID.portaria);
  ok('offline com horário antes da saída: HORARIO', /HORARIO/.test(x.e || ''), x);
  x = await api(db, CONV, [S(5), '2026-10-16 17:30-03', 4000, 'OFFLINE_SINCRONIZADO', null, 'ev-1', '{"placa":"EEE5E55"}'], UID.portaria);
  ok('offline com KM menor que a saída: KM', /KM/.test(x.e || ''), x);
  x = await api(db, CONV, [S(5), '2026-10-16 17:30-03', 5150, 'GESTOR_COM_EVIDENCIA', 'Retorno confirmado pelo rastreador.', null, null], UID.supervisor);
  ok('conciliação por gestor sem permissão: SEM_PERMISSAO', /SEM_PERMISSAO/.test(x.e || ''), x);
  x = await api(db, CONV, [S(4), '2026-10-16 17:30-03', 5150, 'OFFLINE_SINCRONIZADO', null, 'ev-9', null], UID.portaria);
  ok('conciliar saída não encerrada: NAO_ENCERRADA', /NAO_ENCERRADA/.test(x.e || ''), x);
  ok('nada mudou nas recusas de conciliação', (await linha(db, S(5))).tipo_encerramento === 'ENCERRAMENTO_ADMINISTRATIVO');
  x = await api(db, CONV, [S(5), '2026-10-16 17:30-03', 5150, 'OFFLINE_SINCRONIZADO', null, 'ev-1',
    '{"placa":"EEE-5E55","obs_retorno":"retorno do tablet","retorno_registrado_por":"Porteiro 1","foto_carga_retorno_b64":"data:image/jpeg;base64,BBBB"}'], UID.portaria);
  const c5 = await linha(db, S(5));
  ok('offline legítimo: convertido em retorno físico com hora e KM reais', x.r && x.r.v.ok && c5.tipo_encerramento === 'RETORNO_FISICO' && c5.retorno_horario_conhecido === true
    && new Date(c5.data_retorno).toISOString() === '2026-10-16T20:30:00.000Z' && Number(c5.km_retorno) === 5150, x);
  ok('conversão preserva o encerramento original (quem, quando, justificativa, evidência)', c5.encerrado_por === 'Usuário gestor' && +new Date(c5.encerrado_em) === +new Date(e5.encerrado_em)
    && c5.encerramento_justificativa === e5.encerramento_justificativa && Number(c5.encerramento_evidencia.km_observado) === 5123);
  ok('conversão registra origem, evento, autor e foto', c5.conversao_origem === 'OFFLINE_SINCRONIZADO' && c5.conversao_evento_offline === 'ev-1'
    && c5.convertido_retorno_por_auth === UID.portaria && c5.foto_carga_retorno_b64 === 'data:image/jpeg;base64,BBBB' && c5.retorno_registrado_por === 'Porteiro 1');
  ok('conversão troca o prefixo (telas deixam de mostrar "encerrado")', /^\[Retorno físico conciliado após encerramento administrativo\] retorno do tablet/.test(c5.obs_retorno));
  ok('conversão auditada', (await db.query(`select count(*)::int n from public.audit_log where acao='conciliar_retorno'`)).rows[0].n === 1);
  x = await api(db, CONV, [S(9), '2026-10-17 16:00-03', 9100, 'GESTOR_COM_EVIDENCIA', 'Retorno confirmado pela foto do pátio.', null, null], UID.gestor);
  const c9 = await linha(db, S(9)), c10 = await linha(db, S(10));
  ok('conversão da principal leva a acompanhante junto', x.r && x.r.v.acompanhantes === 1 && c9.tipo_encerramento === 'RETORNO_FISICO'
    && c10.tipo_encerramento === 'RETORNO_FISICO' && +c10.data_retorno === +c9.data_retorno && c10.km_retorno === null, x);
  x = await api(db, CONV, [S(1), '2026-09-10 18:00-03', 1090, 'GESTOR_COM_EVIDENCIA', 'Retorno real achado no rastreador.', null, null], UID.admin);
  const c1 = await linha(db, S(1));
  ok('conversão de histórico: 23:59:59 original guardado em data_retorno_convencional', x.r && x.r.v.ok && new Date(c1.data_retorno_convencional).toISOString() === '2026-09-11T02:59:59.000Z'
    && new Date(c1.data_retorno).toISOString() === '2026-09-10T21:00:00.000Z', x);

  // ── 5. Rollback ──
  const antesRb = (await db.query(`select id, status from public.frotas_portaria_saidas order by id`)).rows;
  erro = null; try { await db.exec(desfazer); } catch (e) { erro = e.message; }
  ok('rollback roda sem erro', !erro, erro);
  ok('rollback: nenhuma saída reaberta (status iguais)', JSON.stringify(antesRb) === JSON.stringify((await db.query(`select id, status from public.frotas_portaria_saidas order by id`)).rows));
  const bkp = (await db.query(`select count(*)::int n from public.frotas_portaria_saidas_encerramento_bkp`)).rows[0].n;
  ok('rollback: dados do encerramento copiados para a tabela de backup', bkp >= 6, bkp);
  const cols = (await db.query(`select count(*)::int n from information_schema.columns where table_name='frotas_portaria_saidas' and column_name in ('tipo_encerramento','encerrado_em')`)).rows[0].n;
  ok('rollback: colunas e funções removidas', cols === 0 && !(await db.query(`select to_regprocedure('public.fn_portaria_encerrar_saida_admin(uuid,text,jsonb)') v`)).rows[0].v);
  ok('rollback: permissão desativada (sem exclusão física)', (await db.query(`select count(*)::int n from public.cena_permissoes_acao where acao='PORT_ENCERRAR_SAIDA_ADMIN' and deleted_at is null`)).rows[0].n === 0
    && (await db.query(`select count(*)::int n from public.cena_permissoes_acao where acao='PORT_ENCERRAR_SAIDA_ADMIN'`)).rows[0].n >= 4);
  const e7 = (await db.query(`select * from public.frotas_portaria_saidas_encerramento_bkp where id='${S(7)}'`)).rows[0];
  await db.exec(`insert into public.frotas_portaria_saidas (id, placa, equipe, data_saida, km_saida, status) values ('${S(12)}', 'LLL2L22', 'EQ12', now() - interval '3 hours', 12000, 'Em campo')`);
  x = await tela(`update public.frotas_portaria_saidas set status='Retornado', data_retorno=now(), km_retorno=12100 where id='${S(12)}' and status='Em campo'`);
  ok('depois do rollback a Portaria volta a gravar retorno normalmente', x.n === 1, x);
  erro = null; try { await db.exec(mig); } catch (e) { erro = e.message; }
  ok('reaplicar depois do rollback: sem erro', !erro, erro);
  const r7 = await linha(db, S(7)), r12 = await linha(db, S(12));
  ok('reaplicar depois do rollback: encerramentos da função restaurados do backup (hora real, autor, origem)', r7.tipo_encerramento === 'ENCERRAMENTO_ADMINISTRATIVO'
    && r7.encerramento_origem === 'FUNCAO' && +new Date(r7.encerrado_em) === +new Date(e7.encerrado_em) && r7.encerrado_por_auth === UID.admin && r7.data_retorno === null, r7);
  ok('reaplicar depois do rollback: conversões restauradas', (await linha(db, S(5))).tipo_encerramento === 'RETORNO_FISICO' && (await linha(db, S(5))).conversao_evento_offline === 'ev-1');
  ok('reaplicar depois do rollback: retorno feito sem a 8.1.225 continua sem classificação', r12.tipo_encerramento === null && r12.status === 'Retornado');

  if (failed.length) { console.error('FALHOU ' + failed.length + '/' + total + ':\n- ' + failed.join('\n- ')); process.exit(1); }
  console.log('portaria-encerramento-adm-sql: OK (' + total + ' verificações)');
})().catch(e => { console.error(e); process.exit(1); });
