// PORTARIA 8.1.224 — teste SQL da migration 20261017120000_portaria_saidas_km_ocr.sql
// PostgreSQL embutido (PGlite) com as colunas reais de frotas_portaria_saidas. Teste auxiliar:
// não substitui a conferência no Supabase real.
// Uso: PGLITE_PATH=<pasta com node_modules/@electric-sql/pglite> node tests/portaria-saidas-km-ocr-sql.test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';

const here = path.dirname(fileURLToPath(import.meta.url));
let PGlite;
try {
  const base = process.env.PGLITE_PATH ? path.join(process.env.PGLITE_PATH, 'package.json') : import.meta.url;
  const req = createRequire(base);
  ({ PGlite } = await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href));
} catch (e) {
  console.log('portaria-saidas-km-ocr-sql: SKIP (instale @electric-sql/pglite e defina PGLITE_PATH)');
  process.exit(0);
}

const mig = fs.readFileSync(path.join(here, '..', 'supabase', 'migrations', '20261017120000_portaria_saidas_km_ocr.sql'), 'utf8');
const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 400) : '')); }

const SCHEMA = `
create table frotas_portaria_saidas(id uuid primary key default gen_random_uuid(), veiculo_id uuid, placa text, modelo text,
  motorista text, equipe_id text, equipe_nome text, contrato_id text, contrato_nome text, base_saida text, data_saida timestamptz,
  previsao_retorno timestamptz, km_saida numeric, km_retorno numeric, data_retorno timestamptz, base_retorno text, status text,
  obs text, obs_retorno text, registrado_por text, criado_em timestamptz default now(), deleted_at timestamptz,
  foto_carga_saida_b64 text, foto_carga_saida_ts timestamptz, foto_carga_retorno_b64 text, foto_carga_retorno_ts timestamptz,
  tem_materiais_saida boolean, retorno_registrado_por text, status_devolucao text, destino text, equipe text, quem_saiu text,
  liberado_por text, tipo_liberacao text, km_ajustes jsonb, km_ajustado_por text, km_ajustado_em timestamptz,
  km_ajuste_justificativa text, saida_principal_id uuid);
`;

const db = new PGlite();
await db.exec(SCHEMA);
const pk = o => JSON.stringify(Object.assign({ v: 1, carga: 'data:image/jpeg;base64,C', km: 'data:image/jpeg;base64,K', extras: [] }, o));
const linhas = [
  ['a1000000-0000-4000-8000-000000000001', pk({ km_ocr: { km_lido_ocr: 37037, km_ocr_confianca: 0.85, km_confirmado_por: 'Portaria Embu', km_confirmado_em: '2026-10-17T11:40:30Z' } })],
  ['a1000000-0000-4000-8000-000000000002', pk({})],                                  // pacote antigo, sem OCR
  ['a1000000-0000-4000-8000-000000000003', 'data:image/jpeg;base64,SO'],             // carga em JPEG puro
  ['a1000000-0000-4000-8000-000000000004', '{"v":1,"km_ocr":{"km_lido_ocr":'],      // JSON quebrado
  ['a1000000-0000-4000-8000-000000000005', pk({ km_ocr: { km_lido_ocr: 'abc', km_ocr_confianca: 0, km_confirmado_em: 'ontem' } })],
  ['a1000000-0000-4000-8000-000000000006', null],
];
for (const [id, foto] of linhas) {
  await db.query("insert into frotas_portaria_saidas(id, placa, status, km_saida, foto_carga_saida_b64) values ($1,'TTN6F14','Em campo',37037,$2)", [id, foto]);
}
const antes = (await db.query('select id, foto_carga_saida_b64, km_saida, status from frotas_portaria_saidas order by id')).rows;

let erro = null;
try { await db.exec(mig); } catch (e) { erro = e.message; }
ok('migration roda sem erro', !erro, erro);
const cols = (await db.query(`select column_name, data_type from information_schema.columns
  where table_name='frotas_portaria_saidas' and column_name in ('km_lido_ocr','km_ocr_confianca','km_confirmado_por','km_confirmado_em') order by 1`)).rows;
ok('4 colunas criadas com os tipos certos', JSON.stringify(cols.map(c => c.column_name + ':' + c.data_type)) === JSON.stringify([
  'km_confirmado_em:timestamp with time zone', 'km_confirmado_por:text', 'km_lido_ocr:numeric', 'km_ocr_confianca:numeric']), cols);

const r = async id => (await db.query('select * from frotas_portaria_saidas where id=$1', [id])).rows[0];
let l = await r('a1000000-0000-4000-8000-000000000001');
ok('recupera o OCR do pacote', Number(l.km_lido_ocr) === 37037 && Number(l.km_ocr_confianca) === 0.85 && l.km_confirmado_por === 'Portaria Embu'
  && new Date(l.km_confirmado_em).toISOString() === '2026-10-17T11:40:30.000Z', l);
l = await r('a1000000-0000-4000-8000-000000000005');
ok('valores inválidos no pacote viram nulo, confiança 0 é mantida', l.km_lido_ocr === null && Number(l.km_ocr_confianca) === 0 && l.km_confirmado_em === null, l);
for (const id of ['a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000006']) {
  l = await r(id);
  ok('sem OCR no pacote / JSON inválido / nulo: colunas vazias (' + id.slice(-1) + ')', l.km_lido_ocr === null && l.km_ocr_confianca === null && l.km_confirmado_por === null, l);
}
const depois = (await db.query('select id, foto_carga_saida_b64, km_saida, status from frotas_portaria_saidas order by id')).rows;
ok('fotos, KM e status de todos os registros intactos', JSON.stringify(antes) === JSON.stringify(depois));

// Idempotência: rodar de novo não muda nada nem sobrescreve dado já gravado nas colunas
await db.query("update frotas_portaria_saidas set km_confirmado_por='Conferido' where id='a1000000-0000-4000-8000-000000000001'");
const snap = (await db.query('select * from frotas_portaria_saidas order by id')).rows;
erro = null;
try { await db.exec(mig); } catch (e) { erro = e.message; }
ok('segunda execução sem erro', !erro, erro);
ok('segunda execução não altera nada (não sobrescreve coluna preenchida)', JSON.stringify(snap) === JSON.stringify((await db.query('select * from frotas_portaria_saidas order by id')).rows));

ok('sem DROP/DELETE/TRUNCATE ativos', !/^\s*(drop|delete|truncate)\b/im.test(mig.replace(/--[^\n]*/g, '')));
ok('só ADD COLUMN IF NOT EXISTS', (mig.match(/add column if not exists/g) || []).length === 4 && !/add column (?!if not exists)/i.test(mig));
ok('recarrega o cache do PostgREST', /notify pgrst, 'reload schema'/.test(mig));

if (failed.length) { console.error('FALHOU ' + failed.length + '/' + total + ':\n- ' + failed.join('\n- ')); process.exit(1); }
console.log('portaria-saidas-km-ocr-sql: OK (' + total + ' verificações)');
