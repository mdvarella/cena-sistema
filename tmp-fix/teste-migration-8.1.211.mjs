// Testa a migration 20261005180000_portaria_saida_acompanhante.sql num Postgres embutido (PGlite).
// Uso: node tmp-fix/teste-migration-8.1.211.mjs  (PGlite instalado em %TEMP%\pglite-cena)
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const pgliteDir = path.join(process.env.TEMP || '/tmp', 'pglite-cena', 'node_modules', '@electric-sql', 'pglite', 'dist', 'index.js');
const { PGlite } = await import(pathToFileURL(pgliteDir).href);

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const sqlMig = readFileSync(path.join(raiz, 'supabase', 'migrations', '20261005180000_portaria_saida_acompanhante.sql'), 'utf8');

const db = new PGlite();
let ok = 0, falha = 0;
function check(nome, cond, extra) {
  if (cond) { ok++; } else { falha++; console.log('FALHOU:', nome, extra !== undefined ? JSON.stringify(extra) : ''); }
}
async function erro(sql, params) {
  try { await db.query(sql, params); return null; } catch (e) { return e.message || String(e); }
}
async function linha(id) {
  const r = await db.query('SELECT * FROM frotas_portaria_saidas WHERE id=$1', [id]);
  return r.rows[0];
}
let seq = 0;
function uid() { seq++; return '00000000-0000-4000-8000-' + String(seq).padStart(12, '0'); }
async function saida(campos) {
  const id = campos.id || uid();
  const c = { id, data_saida: '2026-10-06T07:00:00-03:00', status: 'Em campo', ...campos };
  const cols = Object.keys(c);
  const ph = cols.map((_, i) => '$' + (i + 1)).join(',');
  await db.query(`INSERT INTO frotas_portaria_saidas (${cols.join(',')}) VALUES (${ph})`, Object.values(c));
  return id;
}
async function saidaErro(campos) {
  try { await saida(campos); return null; } catch (e) { return e.message || String(e); }
}

// Estrutura real (consulta do usuário em 05/10/2026) + papéis do Supabase
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.frotas_veiculos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), placa text);
  CREATE TABLE public.frotas_portaria_saidas (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    veiculo_id uuid, placa text, modelo text, motorista text,
    equipe_id text, equipe_nome text, contrato_id text, contrato_nome text, base_saida text,
    data_saida timestamptz NOT NULL, previsao_retorno timestamptz,
    km_saida numeric, km_retorno numeric, data_retorno timestamptz, base_retorno text,
    status text DEFAULT 'Em campo'::text, obs text, obs_retorno text, registrado_por text,
    criado_em timestamptz DEFAULT now(), deleted_at timestamptz,
    foto_carga_saida_b64 text, foto_carga_saida_ts timestamptz, foto_carga_retorno_b64 text, foto_carga_retorno_ts timestamptz,
    tem_materiais_saida boolean DEFAULT false, retorno_registrado_por text, status_devolucao text,
    destino text, equipe text, quem_saiu text, liberado_por text, tipo_liberacao text,
    km_ajustes jsonb DEFAULT '[]'::jsonb, km_ajustado_por text, km_ajustado_em timestamptz, km_ajuste_justificativa text,
    CONSTRAINT frotas_portaria_saidas_pkey PRIMARY KEY (id),
    CONSTRAINT frotas_portaria_saidas_veiculo_id_fkey FOREIGN KEY (veiculo_id) REFERENCES frotas_veiculos(id)
  );
  CREATE INDEX idx_frt_port_placa ON public.frotas_portaria_saidas USING btree (placa);
  CREATE INDEX idx_frt_port_status ON public.frotas_portaria_saidas USING btree (status);
  CREATE INDEX idx_portaria_placa ON public.frotas_portaria_saidas USING btree (placa);
`);
const legado = await saida({ placa: 'AAA1111', equipe_id: 'EQL', km_saida: 1000, km_retorno: 1050, data_retorno: '2026-10-01T18:00:00-03:00', status: 'Retornado' });
const legado2 = await saida({ placa: 'BBB2222', equipe: 'Equipe sem id', km_saida: 500 });

// 1) idempotente e não mexe nas linhas antigas
await db.exec(sqlMig);
let e2 = null;
try { await db.exec(sqlMig); } catch (e) { e2 = e.message || String(e); }
check('migration idempotente', e2 === null, e2);
const leg = await db.query('SELECT count(*)::int n FROM frotas_portaria_saidas WHERE saida_principal_id IS NULL');
check('linhas antigas intactas (sem vínculo)', leg.rows[0].n === 2);
check('legado mantém km', Number((await linha(legado)).km_saida) === 1000 && Number((await linha(legado2)).km_saida) === 500);

// 2) acompanhante válida
const pA = await saida({ placa: 'ABC1D23', equipe_id: 'EQA', equipe: 'DAC-01', km_saida: 12000 });
let m = await saidaErro({ id: uid(), placa: 'ABC-1D23', equipe_id: 'EQB', equipe: 'DAC-02', saida_principal_id: pA });
check('acompanhante ok (placa com traço)', m === null, m);
const acB = '00000000-0000-4000-8000-' + String(seq).padStart(12, '0');
check('acompanhante gravada sem km', (await linha(acB)).km_saida === null);

// 3) acompanhante com km bloqueia
const pKm = await saida({ placa: 'KMM1A23', equipe_id: 'EQKM1', km_saida: 50 });
m = await saidaErro({ placa: 'KMM1A23', equipe_id: 'EQKM2', km_saida: 50, saida_principal_id: pKm });
check('acompanhante com km_saida bloqueia', m && /acomp_sem_km_chk/.test(m), m);
m = await erro('UPDATE frotas_portaria_saidas SET km_retorno=12100 WHERE id=$1', [acB]);
check('km_retorno na acompanhante bloqueia', m && /acomp_sem_km_chk/.test(m), m);

// 4) terceira equipe bloqueada
m = await saidaErro({ placa: 'ABC1D23', equipe_id: 'EQC', saida_principal_id: pA });
check('3ª equipe bloqueada', m && /Máximo de 2 equipes/.test(m), m);

// 5) placa diferente / mesma equipe / sem equipe / a si mesma / principal inexistente
m = await saidaErro({ placa: 'XYZ9A88', equipe_id: 'EQD', saida_principal_id: pA });
check('placa diferente bloqueia', m && /mesma placa/.test(m), m);
const pX = await saida({ placa: 'QWE1R23', equipe_id: 'EQX', km_saida: 1 });
m = await saidaErro({ placa: 'QWE1R23', equipe_id: 'EQX', saida_principal_id: pX });
check('mesma equipe bloqueia', m && /outra equipe/.test(m), m);
m = await saidaErro({ placa: 'QWE1R23', saida_principal_id: pX });
check('sem equipe bloqueia', m && /identificar a equipe/.test(m), m);
const pNome = await saida({ placa: 'NOM1E11', equipe: 'Equipe Norte', km_saida: 1 });
m = await saidaErro({ placa: 'NOM1E11', equipe: ' equipe norte ', saida_principal_id: pNome });
check('mesma equipe por nome (sem id) bloqueia', m && /outra equipe/.test(m), m);
m = await saidaErro({ placa: 'NOM1E11', equipe: 'Equipe Sul', saida_principal_id: pNome });
check('outra equipe por nome ok', m === null, m);
const self = uid();
m = await saidaErro({ id: self, placa: 'QWE1R23', equipe_id: 'EQY', saida_principal_id: self });
check('apontar para si mesma bloqueia', m && /(acomp_outra_chk|não encontrada)/.test(m), m);
m = await saidaErro({ placa: 'QWE1R23', equipe_id: 'EQY', saida_principal_id: '00000000-0000-4000-8000-999999999999' });
check('principal inexistente bloqueia', m && /não encontrada/.test(m), m);

// 6) só um nível
m = await saidaErro({ placa: 'ABC1D23', equipe_id: 'EQE', saida_principal_id: acB });
check('apontar para acompanhante bloqueia', m && /(já é acompanhante|Máximo)/.test(m), m);
m = await erro('UPDATE frotas_portaria_saidas SET saida_principal_id=$1 WHERE id=$2', [pX, pA]);
check('principal não vira acompanhante', m && /já é a principal/.test(m), m);

// 7) principal excluída ou já retornada
const pDel = await saida({ placa: 'DEL1E11', equipe_id: 'EQ1', km_saida: 1, deleted_at: '2026-10-06T08:00:00-03:00' });
m = await saidaErro({ placa: 'DEL1E11', equipe_id: 'EQ2', saida_principal_id: pDel });
check('principal excluída bloqueia', m && /não encontrada/.test(m), m);
m = await saidaErro({ placa: 'AAA1111', equipe_id: 'EQ2', saida_principal_id: legado });
check('principal já retornada bloqueia', m && /já retornou/.test(m), m);

// 8) retorno da principal fecha a acompanhante, sem km
m = await erro(`UPDATE frotas_portaria_saidas SET status='Retornado', km_retorno=12080, data_retorno='2026-10-06T17:30:00-03:00',
  base_retorno='Base Centro', retorno_registrado_por='Porteiro 1', obs_retorno='ok' WHERE id=$1`, [pA]);
check('retorno da principal ok', m === null, m);
let b = await linha(acB);
check('acompanhante Retornado', b.status === 'Retornado', b.status);
check('acompanhante mesma data_retorno', b.data_retorno && new Date(b.data_retorno).toISOString() === new Date('2026-10-06T17:30:00-03:00').toISOString(), b.data_retorno);
check('acompanhante sem km_retorno', b.km_retorno === null);
check('acompanhante base/porteiro copiados', b.base_retorno === 'Base Centro' && b.retorno_registrado_por === 'Porteiro 1');
check('obs_retorno não copiada', b.obs_retorno === null);
check('principal com km_retorno', Number((await linha(pA)).km_retorno) === 12080);

// 9) ajustes posteriores na acompanhante já fechada (obs/foto) seguem ok
m = await erro("UPDATE frotas_portaria_saidas SET obs_retorno='material ok', status_devolucao='ok' WHERE id=$1", [acB]);
check('ajuste na acompanhante após retorno ok', m === null, m);
// e não se cria outra acompanhante para principal já retornada
m = await saidaErro({ placa: 'ABC1D23', equipe_id: 'EQC', saida_principal_id: pA });
check('nova acompanhante em principal retornada bloqueia', m && /já retornou/.test(m), m);

// 10) acompanhante entrou depois (a principal já estava em campo)
const pF = await saida({ placa: 'FGH1J23', equipe_id: 'EQF', km_saida: 300 });
m = await saidaErro({ placa: 'FGH1J23', equipe_id: 'EQG', data_saida: '2026-10-06T09:00:00-03:00', saida_principal_id: pF });
check('acompanhante registrada depois ok', m === null, m);
const acG = '00000000-0000-4000-8000-' + String(seq).padStart(12, '0');

// 11) acompanhante excluída libera a vaga; principal excluída não fecha a acompanhante
await db.query('UPDATE frotas_portaria_saidas SET deleted_at=now() WHERE id=$1', [acG]);
m = await saidaErro({ placa: 'FGH1J23', equipe_id: 'EQH', saida_principal_id: pF });
check('após excluir acompanhante, outra pode entrar', m === null, m);
const acH = '00000000-0000-4000-8000-' + String(seq).padStart(12, '0');
await db.query('UPDATE frotas_portaria_saidas SET deleted_at=now() WHERE id=$1', [pF]);
let h = await linha(acH);
check('principal excluída não fecha acompanhante', h.data_retorno === null && h.status === 'Em campo');
m = await erro(`UPDATE frotas_portaria_saidas SET status='Retornado', data_retorno=now(), retorno_registrado_por='P2' WHERE id=$1`, [acH]);
check('acompanhante órfã retorna sozinha (sem km)', m === null, m);

// 12) delete físico da principal: acompanhante perde o vínculo
const pK = await saida({ placa: 'KLM1N23', equipe_id: 'EQK', km_saida: 1 });
const acK = await saida({ placa: 'KLM1N23', equipe_id: 'EQL2', saida_principal_id: pK });
await db.query('DELETE FROM frotas_portaria_saidas WHERE id=$1', [pK]);
check('delete físico: vínculo vira NULL', (await linha(acK)).saida_principal_id === null);

// 13) gravação comum da Portaria segue igual (insert, retorno, ajuste de km)
const pN = await saida({ placa: 'NOR1M23', equipe_id: 'EQN', km_saida: 700, tipo_liberacao: 'equipe' });
m = await erro(`UPDATE frotas_portaria_saidas SET status='Retornado', km_retorno=760, data_retorno=now() WHERE id=$1`, [pN]);
check('retorno comum ok', m === null, m);
m = await erro(`UPDATE frotas_portaria_saidas SET km_saida=705, km_ajustes='[{"de":700,"para":705}]'::jsonb, km_ajustado_por='G' WHERE id=$1`, [pN]);
check('ajuste de km comum ok', m === null, m);
m = await saidaErro({ placa: 'NOR1M23', equipe_id: 'EQN', km_saida: 760 });
check('saída comum sem vínculo ok', m === null, m);

console.log(`\nMigration 8.1.211: ${ok} ok, ${falha} falha(s)`);
process.exit(falha ? 1 : 0);
