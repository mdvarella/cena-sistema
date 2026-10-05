// Testa a migration 20261005170000_prog_veiculos_compartilhado_carreta.sql num Postgres embutido (PGlite).
// Uso: node tmp-fix/teste-migration-8.1.210.mjs  (PGlite instalado em %TEMP%\pglite-cena)
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const pgliteDir = path.join(process.env.TEMP || '/tmp', 'pglite-cena', 'node_modules', '@electric-sql', 'pglite', 'dist', 'index.js');
const { PGlite } = await import(pathToFileURL(pgliteDir).href);

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const sqlMig = readFileSync(path.join(raiz, 'supabase', 'migrations', '20261005170000_prog_veiculos_compartilhado_carreta.sql'), 'utf8');

const db = new PGlite();
let ok = 0, falha = 0;
function check(nome, cond, extra) {
  if (cond) { ok++; } else { falha++; console.log('FALHOU:', nome, extra !== undefined ? JSON.stringify(extra) : ''); }
}
async function erro(sql, params) {
  try { await db.query(sql, params); return null; } catch (e) { return e.message || String(e); }
}
async function comp(eq, data = '2026-10-06') {
  const r = await db.query('SELECT compartilhado_com_equipe_id c FROM prog_veiculos_dia WHERE equipe_id=$1 AND data=$2 AND coalesce(slot,1)=1 AND deleted_at IS NULL', [eq, data]);
  return r.rows[0] ? r.rows[0].c : 'SEM_LINHA';
}
const D = '2026-10-06';
async function ins(eq, placa, extra = {}) {
  const { data, ...resto } = extra;
  const cols = ['equipe_id', 'data', 'placa', ...Object.keys(resto)];
  const vals = [eq, data || D, placa, ...Object.values(resto)];
  const ph = cols.map((_, i) => '$' + (i + 1)).join(',');
  return db.query(`INSERT INTO prog_veiculos_dia (${cols.join(',')}) VALUES (${ph})`, vals);
}

// Estrutura real (consulta do usuário em 05/10/2026) + papéis do Supabase
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.prog_veiculos_dia (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    equipe_id text NOT NULL,
    data date NOT NULL,
    veiculo_id uuid,
    placa text,
    modelo text,
    justificativa text,
    alterado_por text,
    criado_em timestamptz DEFAULT now(),
    deleted_at timestamptz,
    slot smallint DEFAULT 1,
    CONSTRAINT prog_veiculos_dia_equipe_data_slot_key UNIQUE (equipe_id, data, slot)
  );
  INSERT INTO prog_veiculos_dia (equipe_id, data, placa, slot) VALUES ('LEGADO', '2026-10-01', 'AAA1111', 1), ('LEGADO', '2026-10-01', 'BBB2222', 2);
`);

// 1) aplica duas vezes (idempotente) e não mexe nas linhas antigas
await db.exec(sqlMig);
let e2 = null;
try { await db.exec(sqlMig); } catch (e) { e2 = e.message || String(e); }
check('migration idempotente', e2 === null, e2);
const leg = await db.query("SELECT count(*)::int n FROM prog_veiculos_dia WHERE equipe_id='LEGADO' AND compartilhado_com_equipe_id IS NULL AND carreta_tipo IS NULL");
check('linhas antigas intactas', leg.rows[0].n === 2);

// 2) compartilhar: B→A grava A→B
await ins('EQA', 'ABC1D23');
await ins('EQB', 'ABC-1D23', { compartilhado_com_equipe_id: 'EQA' });
check('B aponta A', (await comp('EQB')) === 'EQA');
check('A aponta B (recíproco)', (await comp('EQA')) === 'EQB');

// 3) terceira equipe bloqueada
await ins('EQC', 'ABC1D23');
let m = await erro("UPDATE prog_veiculos_dia SET compartilhado_com_equipe_id='EQA' WHERE equipe_id='EQC'");
check('3ª equipe com A bloqueada', m && /já compartilha/.test(m), m);
m = await erro("UPDATE prog_veiculos_dia SET compartilhado_com_equipe_id='EQB' WHERE equipe_id='EQC'");
check('3ª equipe com B bloqueada', m && /já compartilha/.test(m), m);
check('C sem compartilhar continua gravada (turnos diferentes)', (await comp('EQC')) === null);
check('A e B intactos após bloqueio', (await comp('EQA')) === 'EQB' && (await comp('EQB')) === 'EQA');

// 4) placa diferente / parceiro sem veículo / a si mesma
await ins('EQD', 'XYZ9A88');
m = await erro("UPDATE prog_veiculos_dia SET compartilhado_com_equipe_id='EQC' WHERE equipe_id='EQD'");
check('placa diferente bloqueada', m && /mesma placa/.test(m), m);
m = await erro("UPDATE prog_veiculos_dia SET compartilhado_com_equipe_id='SEMVEIC' WHERE equipe_id='EQD'");
check('parceiro sem veículo bloqueado', m && /não tem veículo/.test(m), m);
m = await erro("UPDATE prog_veiculos_dia SET compartilhado_com_equipe_id='EQD' WHERE equipe_id='EQD'");
check('compartilhar consigo mesma bloqueado', m && /compart_outra_chk/.test(m), m);
check('D sem vínculo após erros', (await comp('EQD')) === null);

// 5) atualização sem relação mantém vínculo
m = await erro("UPDATE prog_veiculos_dia SET justificativa='x', alterado_por='y' WHERE equipe_id='EQA'");
check('update de justificativa ok', m === null, m);
check('vínculo mantido', (await comp('EQA')) === 'EQB' && (await comp('EQB')) === 'EQA');

// 6) desfazer de um lado desfaz o outro
await db.query("UPDATE prog_veiculos_dia SET compartilhado_com_equipe_id=NULL WHERE equipe_id='EQB'");
check('desfazer B limpa A', (await comp('EQA')) === null && (await comp('EQB')) === null);

// 7) trocar placa mantendo vínculo: bloqueia; trocando placa e limpando: desfaz o outro lado
await db.query("UPDATE prog_veiculos_dia SET compartilhado_com_equipe_id='EQA' WHERE equipe_id='EQB'");
check('recompartilhado', (await comp('EQA')) === 'EQB');
m = await erro("UPDATE prog_veiculos_dia SET placa='QWE1R23' WHERE equipe_id='EQA'");
check('trocar placa com vínculo bloqueia', m && /mesma placa/.test(m), m);
m = await erro("UPDATE prog_veiculos_dia SET placa='QWE1R23', compartilhado_com_equipe_id=NULL WHERE equipe_id='EQA'");
check('trocar placa limpando vínculo ok', m === null, m);
check('B desfeito quando A troca de placa', (await comp('EQB')) === null);

// 8) upsert do front (ON CONFLICT equipe_id,data,slot) trocando a placa de equipe compartilhada
await db.query("UPDATE prog_veiculos_dia SET placa='ABC1D23' WHERE equipe_id='EQA'");
await db.query("UPDATE prog_veiculos_dia SET compartilhado_com_equipe_id='EQA' WHERE equipe_id='EQB'");
m = await erro(`INSERT INTO prog_veiculos_dia (equipe_id,data,placa,slot) VALUES ('EQA','${D}','QWE1R23',1)
  ON CONFLICT (equipe_id,data,slot) DO UPDATE SET placa=EXCLUDED.placa`);
check('upsert trocando placa sem limpar vínculo bloqueia (fail-closed)', m && /mesma placa/.test(m), m);
m = await erro(`INSERT INTO prog_veiculos_dia (equipe_id,data,placa,slot,compartilhado_com_equipe_id) VALUES ('EQA','${D}','QWE1R23',1,NULL)
  ON CONFLICT (equipe_id,data,slot) DO UPDATE SET placa=EXCLUDED.placa, compartilhado_com_equipe_id=EXCLUDED.compartilhado_com_equipe_id`);
check('upsert trocando placa e limpando vínculo ok', m === null, m);
check('B desfeito após upsert', (await comp('EQB')) === null);
await db.query("UPDATE prog_veiculos_dia SET placa='ABC1D23' WHERE equipe_id='EQA'");

// 9) upsert do front criando o compartilhamento (linha nova)
await db.query("DELETE FROM prog_veiculos_dia WHERE equipe_id='EQB'");
m = await erro(`INSERT INTO prog_veiculos_dia (equipe_id,data,placa,slot,compartilhado_com_equipe_id) VALUES ('EQB','${D}','ABC1D23',1,'EQA')
  ON CONFLICT (equipe_id,data,slot) DO UPDATE SET placa=EXCLUDED.placa, compartilhado_com_equipe_id=EXCLUDED.compartilhado_com_equipe_id`);
check('upsert novo com compartilhamento ok', m === null, m);
check('upsert novo recíproco', (await comp('EQA')) === 'EQB' && (await comp('EQB')) === 'EQA');

// 10) exclusão lógica e física desfazem o outro lado
await db.query("UPDATE prog_veiculos_dia SET deleted_at=now() WHERE equipe_id='EQB'");
check('soft delete de B limpa A', (await comp('EQA')) === null);
const bMorta = await db.query("SELECT compartilhado_com_equipe_id c FROM prog_veiculos_dia WHERE equipe_id='EQB'");
check('linha excluída sem vínculo', bMorta.rows[0].c === null);
m = await erro("UPDATE prog_veiculos_dia SET compartilhado_com_equipe_id='EQB' WHERE equipe_id='EQA'");
check('compartilhar com linha excluída bloqueia', m && /não tem veículo/.test(m), m);
await db.query("UPDATE prog_veiculos_dia SET deleted_at=NULL WHERE equipe_id='EQB'");
check('restaurar B volta sem vínculo', (await comp('EQB')) === null);
await db.query("UPDATE prog_veiculos_dia SET compartilhado_com_equipe_id='EQB' WHERE equipe_id='EQA'");
check('A→B grava B→A', (await comp('EQB')) === 'EQA');
await db.query("DELETE FROM prog_veiculos_dia WHERE equipe_id='EQA'");
check('delete físico de A limpa B', (await comp('EQB')) === null);

// 11) outro dia não interfere
await ins('EQA', 'ABC1D23');
await ins('EQA', 'ABC1D23', { data: '2026-10-07' });
await ins('EQB', 'ABC1D23', { data: '2026-10-07' });
await db.query("UPDATE prog_veiculos_dia SET compartilhado_com_equipe_id='EQA' WHERE equipe_id='EQB' AND data='2026-10-07'");
check('dia 07 compartilhado', (await comp('EQA', '2026-10-07')) === 'EQB');
check('dia 06 não afetado', (await comp('EQA')) === null);

// 12) carreta
m = await erro("UPDATE prog_veiculos_dia SET carreta_tipo='carreta_cabos', carreta_placa='fzk-4d46' WHERE equipe_id='EQA' AND data='2026-10-06'");
check('carreta de cabos ok', m === null, m);
let r = await db.query("SELECT carreta_tipo t, carreta_placa p FROM prog_veiculos_dia WHERE equipe_id='EQA' AND data='2026-10-06'");
check('placa da carreta normalizada', r.rows[0].p === 'FZK4D46' && r.rows[0].t === 'carreta_cabos', r.rows[0]);
m = await erro("UPDATE prog_veiculos_dia SET carreta_tipo=' Compressor ', carreta_placa='EWA3587' WHERE equipe_id='EQA' AND data='2026-10-06'");
check('compressor (com espaço/maiúscula) ok', m === null, m);
m = await erro("UPDATE prog_veiculos_dia SET carreta_tipo='compressor', carreta_placa=NULL WHERE equipe_id='EQA' AND data='2026-10-06'");
check('carreta sem placa bloqueia', m && /carreta_par_chk/.test(m), m);
m = await erro("UPDATE prog_veiculos_dia SET carreta_tipo=NULL, carreta_placa='EWA3587' WHERE equipe_id='EQA' AND data='2026-10-06'");
check('placa sem tipo bloqueia', m && /carreta_par_chk/.test(m), m);
m = await erro("UPDATE prog_veiculos_dia SET carreta_tipo='gerador', carreta_placa='EWA3587' WHERE equipe_id='EQA' AND data='2026-10-06'");
check('tipo inválido bloqueia', m && /carreta_tipo_chk/.test(m), m);
m = await erro("UPDATE prog_veiculos_dia SET carreta_tipo='compressor', carreta_placa='123' WHERE equipe_id='EQA' AND data='2026-10-06'");
check('placa inválida bloqueia', m && /carreta_placa_chk/.test(m), m);
m = await erro("UPDATE prog_veiculos_dia SET carreta_tipo='compressor', carreta_placa='ABC1D23' WHERE equipe_id='EQA' AND data='2026-10-06'");
check('carreta igual ao caminhão bloqueia', m && /carreta_com_veiculo_chk/.test(m), m);
m = await erro("INSERT INTO prog_veiculos_dia (equipe_id,data,placa,carreta_tipo,carreta_placa) VALUES ('EQE','2026-10-06',NULL,'compressor','EWA3587')");
check('carreta sem caminhão bloqueia', m && /carreta_com_veiculo_chk/.test(m), m);
m = await erro("INSERT INTO prog_veiculos_dia (equipe_id,data,placa,slot,carreta_tipo,carreta_placa) VALUES ('EQA','2026-10-06','MOT1A11',2,'compressor','EWA3587')");
check('carreta no slot 2 bloqueia', m && /extras_slot1_chk/.test(m), m);
m = await erro("INSERT INTO prog_veiculos_dia (equipe_id,data,placa,carreta_veiculo_id) VALUES ('EQF','2026-10-06','JKL1M23',gen_random_uuid())");
check('id de carreta sem placa bloqueia', m && /carreta_veiculo_chk/.test(m), m);
m = await erro("UPDATE prog_veiculos_dia SET carreta_tipo=NULL, carreta_placa=NULL WHERE equipe_id='EQA' AND data='2026-10-06'");
check('remover carreta ok', m === null, m);

// 13) slot 2 (Moto Dupla) não compartilha
await ins('EQM', 'MOT1A11');
await db.query("INSERT INTO prog_veiculos_dia (equipe_id,data,placa,slot) VALUES ('EQN','2026-10-06','MOT1A11',2)");
m = await erro("UPDATE prog_veiculos_dia SET compartilhado_com_equipe_id='EQM' WHERE equipe_id='EQN' AND slot=2");
check('slot 2 não compartilha', m && /extras_slot1_chk/.test(m), m);

// 14) gravação comum (TMA) segue igual
m = await erro(`INSERT INTO prog_veiculos_dia (equipe_id,data,placa,modelo,slot,alterado_por,justificativa) VALUES ('TMA1','${D}','TMA1A23','Saveiro',1,'x','')
  ON CONFLICT (equipe_id,data,slot) DO UPDATE SET placa=EXCLUDED.placa, modelo=EXCLUDED.modelo`);
check('gravação comum ok', m === null, m);
m = await erro(`INSERT INTO prog_veiculos_dia (equipe_id,data,placa,slot) VALUES ('TMA1','${D}','TMA2B34',1)
  ON CONFLICT (equipe_id,data,slot) DO UPDATE SET placa=EXCLUDED.placa`);
check('troca de placa comum ok', m === null, m);
m = await erro("DELETE FROM prog_veiculos_dia WHERE equipe_id='TMA1'");
check('delete comum ok', m === null, m);

console.log(`\nMigration 8.1.210: ${ok} ok, ${falha} falha(s)`);
process.exit(falha ? 1 : 0);
