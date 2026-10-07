// Sondagem SOMENTE LEITURA da API externa do ERP CENA: descobre endpoints e a ESTRUTURA dos campos.
// Não grava nem mostra valores, nem o token. Resultado em tmp-fix/erp-sondagem-resultado.json.
//
// Uso recomendado — copie o token (Ctrl+C) e rode com --clipboard; o script lê sem mostrar e limpa a área de transferência:
//   node tmp-fix/erp-sondar-endpoints.mjs --clipboard financial-entries
// Sem --clipboard o script pede o token escondido (aparece só *):
//   node tmp-fix/erp-sondar-endpoints.mjs                          # tenta a lista padrão de caminhos
//   node tmp-fix/erp-sondar-endpoints.mjs financial-entries        # ou só os caminhos informados
// Também aceita o token em $env:ERP_TOKEN.
// Opcional: $env:ERP_URL (padrão https://erp.cenabr.app/api/external/v1)
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const ARGS = process.argv.slice(2);
const USAR_CLIPBOARD = ARGS.includes('--clipboard');

const BASE = (process.env.ERP_URL || 'https://erp.cenabr.app/api/external/v1').replace(/\/+$/, '');
const SAIDA = 'tmp-fix/erp-sondagem-resultado.json';

/** Lê o token sem mostrar na tela (um * por caractere, para conferir que a colagem entrou). */
function lerTokenEscondido() {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write('Token do ERP (cole com Ctrl+V ou clique direito e tecle Enter): ');
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let tok = '';
    const onData = (pedaco) => {
      for (const c of pedaco.replace(/\x1b\[20[01]~/g, '')) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData);
          const limpo = tok.trim().replace(/^Bearer\s+/i, '');
          process.stdout.write(`\n(${limpo.length} caracteres recebidos)\n`);
          return resolve(limpo);
        }
        if (c === '\u0003') { process.stdout.write('\n'); process.exit(1); }
        if (c === '\u007f' || c === '\b') { if (tok.length) { tok = tok.slice(0, -1); process.stdout.write('\b \b'); } continue; }
        tok += c;
        process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

/** Lê o token da área de transferência do Windows (sem mostrar) e limpa a área de transferência. */
function lerTokenDaAreaDeTransferencia() {
  let v = '';
  try {
    v = execFileSync('powershell', ['-NoProfile', '-Command', 'Get-Clipboard -Raw'], { encoding: 'utf8' });
  } catch { return ''; }
  try { execFileSync('powershell', ['-NoProfile', '-Command', "Set-Clipboard -Value ' '"]); } catch { /* segue */ }
  // Aceita o token puro ou um trecho com "Authorization:", "Bearer", aspas ou a linha de código inteira.
  const texto = String(v || '').replace(/Authorization\s*:/gi, ' ').replace(/Bearer/gi, ' ');
  const sanctum = texto.match(/\b\d+\|[A-Za-z0-9]{20,}/g) || [];
  const longos = texto.split(/[\s'"`;,=()]+/).filter(p => p.length >= 20 && !/^https?:/i.test(p));
  const candidatos = [...new Set(sanctum.length ? sanctum : longos)];
  if (candidatos.length !== 1) {
    console.error(`não deu para identificar o token no que foi copiado (${texto.trim().length} caracteres, ${candidatos.length} trechos candidatos). Copie só o token e rode de novo.`);
    process.exit(1);
  }
  const limpo = candidatos[0];
  console.log(`token identificado na área de transferência (${limpo.length} caracteres); área de transferência limpa`);
  return limpo;
}

if (!/^https:\/\//.test(BASE)) { console.error('ERP_URL precisa ser https'); process.exit(1); }
let TOKEN = process.env.ERP_TOKEN || '';
if (!TOKEN && USAR_CLIPBOARD) {
  // Espera o Enter: copiar o comando para colar no terminal sobrescreve a área de transferência.
  await new Promise((resolve) => {
    process.stdout.write('Agora copie o token na fonte (Ctrl+C) e tecle Enter aqui... ');
    process.stdin.resume();
    process.stdin.once('data', () => { process.stdin.pause(); resolve(); });
  });
  TOKEN = lerTokenDaAreaDeTransferencia();
}
if (!TOKEN && process.stdin.isTTY) TOKEN = await lerTokenEscondido();
if (!TOKEN) { console.error('Defina $env:ERP_TOKEN (veja o cabeçalho do arquivo). Se digitou e ainda assim veio vazio, a colagem não entrou: cole com clique direito ou Ctrl+Shift+V.'); process.exit(1); }

const PADRAO = [
  'suppliers',
  'financial-entries', 'financial-categories', 'financial-accounts', 'financial-entry-types',
  'transactions', 'financial-transactions', 'transaction-types',
  'receivables', 'accounts-receivable', 'payables', 'accounts-payable',
  'invoices', 'issued-invoices', 'received-invoices', 'bills', 'titles',
  'payments', 'receipts', 'installments',
  'fiscal-documents', 'nfe', 'nfes', 'documents',
  'cost-centers', 'chart-of-accounts', 'accounts', 'categories',
  'customers', 'clients', 'contracts', 'projects', 'companies', 'branches',
  'payment-methods',
];
const informados = ARGS.filter(a => !a.startsWith('--'));
const caminhos = informados.length ? informados : PADRAO;
const espera = ms => new Promise(r => setTimeout(r, ms));

async function get(caminho, query = {}) {
  const url = new URL(BASE + (caminho ? '/' + caminho.replace(/^\/+/, '') : ''));
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', Authorization: 'Bearer ' + TOKEN },
      redirect: 'manual', signal: ctrl.signal,
    });
    let json = null;
    const tipo = res.headers.get('content-type') || '';
    if (tipo.includes('json')) json = await res.json().catch(() => null);
    else await res.body?.cancel().catch(() => {});
    return { status: res.status, tipo: tipo.split(';')[0], json };
  } catch (e) {
    return { status: 0, erro: e.name === 'AbortError' ? 'tempo esgotado' : 'falha de rede' };
  } finally { clearTimeout(t); }
}

// Só formato, nunca o valor.
function formato(v) {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return 'array';
  const t = typeof v;
  if (t !== 'string') return t;
  const s = v.trim();
  if (!s) return 'string(vazia)';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return 'string(data-hora ISO)';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'string(data)';
  if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) return 'string(data BR)';
  if (/^-?\d+([.,]\d+)?$/.test(s)) return /[.,]/.test(s) ? 'string(decimal)' : `string(${s.replace('-', '').length} dígitos)`;
  if (/^[\d./-]+$/.test(s)) return `string(documento ${s.replace(/\D/g, '').length} dígitos)`;
  if (/^[0-9a-f-]{36}$/i.test(s)) return 'string(uuid)';
  if (/@/.test(s)) return 'string(e-mail)';
  if (/^https?:\/\//.test(s)) return 'string(url)';
  return 'string';
}

function estrutura(itens) {
  const campos = {};
  const visitar = (obj, prefixo, prof) => {
    for (const [k, v] of Object.entries(obj || {})) {
      const nome = prefixo + k;
      const c = campos[nome] || (campos[nome] = { formatos: {}, nulos: 0, presentes: 0 });
      c.presentes++;
      const f = formato(v);
      if (f === 'null') c.nulos++;
      c.formatos[f] = (c.formatos[f] || 0) + 1;
      if (prof < 2 && v && typeof v === 'object' && !Array.isArray(v)) visitar(v, nome + '.', prof + 1);
      if (prof < 2 && Array.isArray(v) && v[0] && typeof v[0] === 'object') visitar(v[0], nome + '[].', prof + 1);
    }
  };
  for (const it of itens) if (it && typeof it === 'object') visitar(it, '', 0);
  const out = {};
  for (const [k, c] of Object.entries(campos).sort(([a], [b]) => a.localeCompare(b))) {
    out[k] = { formatos: Object.keys(c.formatos).join(' | '), nulos: `${c.nulos}/${itens.length}` };
  }
  return out;
}

function meta(j) {
  const m = (j && (j.meta || j)) || {};
  const pick = {};
  for (const k of ['current_page', 'last_page', 'per_page', 'total']) if (typeof m[k] === 'number') pick[k] = m[k];
  return pick;
}

const resultado = { base: BASE, gerado_em: new Date().toISOString(), raiz: null, endpoints: {} };

const raiz = await get('');
resultado.raiz = { status: raiz.status, chaves: raiz.json && typeof raiz.json === 'object' ? Object.keys(raiz.json) : null };
console.log(`raiz: HTTP ${raiz.status}`);

// ── --perfil-financeiro: lê todos os financial-entries e conta só campos de classificação ──
// Entram: tipos, situações, origens, tipo de transação, centro de custo, filial, unidade, datas por ano, formatos.
// Não entram: nomes de clientes/fornecedores, descrições, observações, documentos e valores individuais.
if (ARGS.includes('--perfil-financeiro')) {
  const SAIDA_P = 'tmp-fix/erp-sondagem-financeiro.json';
  const cont = {};
  const inc = (grupo, chave, n = 1) => {
    const g = cont[grupo] || (cont[grupo] = {});
    const k = chave === null || chave === undefined || chave === '' ? '(vazio)' : String(chave);
    g[k] = (g[k] || 0) + n;
  };
  const lado = e => e?.entry_type?.is_credit ? 'credito' : e?.entry_type?.is_debit ? 'debito' : 'indefinido';
  const docsPorLado = { credito: new Map(), debito: new Map() };
  let lidos = 0, minUpd = null, maxUpd = null;

  function contar(e) {
    lidos++;
    const L = lado(e);
    inc('lado (credito=receber, debito=pagar)', L);
    inc('entry_type.value | label', `${e?.entry_type?.value} | ${e?.entry_type?.label}`);
    inc('status.value | label', `${e?.status?.value} | ${e?.status?.label} | pendente=${e?.status?.is_pending}`);
    inc(`status por lado`, `${L} | ${e?.status?.value}`);
    inc('origin.value | label', `${e?.origin?.value} | ${e?.origin?.label}`);
    inc('document_type', `${L} | ${e?.document_type}`);
    inc('transaction_type.name', `${L} | ${e?.transaction_type?.name}`);
    inc('branch.name', e?.branch?.name);
    inc('business_unit.name', e?.business_unit?.name);
    inc('entity.type', `${L} | ${e?.entity?.type}`);
    inc('beneficiary.type', `${L} | ${e?.beneficiary?.type}`);
    inc('supplier.type', `${L} | ${e?.supplier?.type}`);
    inc('supplier.id presente', `${L} | ${e?.supplier?.id != null}`);
    inc('is_forecast', `${L} | ${e?.is_forecast}`);
    inc('has_installments', `${L} | ${e?.has_installments}`);
    inc('parcelas (total_installments)', `${L} | ${(e?.total_installments ?? 0) > 1 ? 'parcelado' : 'à vista'}`);
    inc('ano de emissão', `${L} | ${String(e?.issuance_at || '').slice(0, 4) || '(vazio)'}`);
    inc('ano de vencimento', `${L} | ${String(e?.due_date || '').slice(0, 4) || '(vazio)'}`);
    inc('cancelado', `${L} | ${e?.cancelled_at ? 'sim' : 'não'}`);
    inc('estornado', `${L} | ${e?.reversed_at ? 'sim' : 'não'}`);
    inc('caucao > 0', `${L} | ${(e?.caucao || 0) > 0}`);
    inc('taxes.retention_total > 0', `${L} | ${(e?.taxes?.retention_total || 0) > 0}`);
    const d = String(e?.entity?.document ?? '');
    inc('entity.document formato', `${L} | ${d ? (/[a-z]/i.test(d) ? 'contém letras' : `${d.replace(/\D/g, '').length} dígitos${/[./-]/.test(d) ? ' com máscara' : ''}`) : '(vazio)'}`);
    const al = Array.isArray(e?.allocations) ? e.allocations : [];
    inc('quantidade de centros de custo no lançamento', `${L} | ${al.length >= 3 ? '3+' : al.length}`);
    for (const a of al) inc('centro de custo (allocations)', `${L} | ${a?.cost_center?.id} | ${a?.cost_center?.name}`);
    inc('allocation_method', e?.allocations_summary?.allocation_method);
    const doc = e?.document_number;
    inc('document_number presente', `${L} | ${doc ? 'sim' : 'não'}`);
    if (doc && docsPorLado[L]) docsPorLado[L].set(doc, (docsPorLado[L].get(doc) || 0) + 1);
    const u = e?.updated_at ? Date.parse(e.updated_at) : NaN;
    if (Number.isFinite(u)) { minUpd = minUpd === null ? u : Math.min(minUpd, u); maxUpd = maxUpd === null ? u : Math.max(maxUpd, u); }
  }

  const p1 = await get('financial-entries', { per_page: '100', page: '1' });
  if (p1.status !== 200 || !Array.isArray(p1.json?.data)) { console.error(`financial-entries: HTTP ${p1.status}`); process.exit(1); }
  const ultima = Number(p1.json.meta?.last_page || 1);
  const total = Number(p1.json.meta?.total || 0);
  p1.json.data.forEach(contar);
  let proxima = 2, falhas = 0;
  const inicio = Date.now();
  async function trabalhador() {
    while (proxima <= ultima) {
      const n = proxima++;
      let r = null;
      for (let t = 0; t < 4; t++) {
        r = await get('financial-entries', { per_page: '100', page: String(n) });
        if (r.status === 200) break;
        await espera(500 * 2 ** t);
      }
      if (r?.status === 200 && Array.isArray(r.json?.data)) r.json.data.forEach(contar); else falhas++;
      if (n % 25 === 0) process.stdout.write(`  página ${n}/${ultima}\r`);
    }
  }
  await Promise.all([1, 2, 3, 4].map(trabalhador));

  const ordenar = g => Object.fromEntries(Object.entries(g).sort((a, b) => b[1] - a[1]).slice(0, 400));
  const repetidos = m => { let grupos = 0, regs = 0; for (const n of m.values()) if (n > 1) { grupos++; regs += n; } return { numeros_distintos: m.size, numeros_repetidos: grupos, registros_com_numero_repetido: regs }; };
  const perfil = {
    gerado_em: new Date().toISOString(), total_informado: total, lidos, paginas: ultima, paginas_com_falha: falhas,
    segundos: Math.round((Date.now() - inicio) / 1000),
    updated_at_min: minUpd ? new Date(minUpd).toISOString() : null, updated_at_max: maxUpd ? new Date(maxUpd).toISOString() : null,
    document_number_repetidos: { credito: repetidos(docsPorLado.credito), debito: repetidos(docsPorLado.debito) },
    contagens: Object.fromEntries(Object.entries(cont).map(([k, g]) => [k, ordenar(g)])),
  };
  const txt = JSON.stringify(perfil, null, 2);
  if (txt.includes(TOKEN)) { console.error('abortado: o token apareceria no resultado'); process.exit(1); }
  fs.writeFileSync(SAIDA_P, txt);
  console.log(`\nperfil gravado em ${SAIDA_P}: ${lidos}/${total} lidos, ${falhas} páginas com falha, ${perfil.segundos}s`);
  process.exit(0);
}

for (const c of caminhos) {
  const r = await get(c, { per_page: '20', page: '1' });
  const reg = { status: r.status };
  if (r.erro) reg.erro = r.erro;
  if (r.status >= 300 && r.status < 400) reg.redirecionamento = true;
  if (r.status === 200 && r.json) {
    const lista = Array.isArray(r.json) ? r.json : Array.isArray(r.json.data) ? r.json.data : null;
    reg.chaves_resposta = Array.isArray(r.json) ? '(array)' : Object.keys(r.json);
    reg.paginacao = meta(r.json);
    reg.itens_amostra = lista ? lista.length : null;
    reg.parametros_filtro = r.json.filters || r.json.meta?.filters ? Object.keys(r.json.filters || r.json.meta.filters) : undefined;
    if (lista) {
      reg.campos = estrutura(lista);
      reg.tem_updated_at = lista.some(i => i && 'updated_at' in i);
      await espera(200);
      const m100 = await get(c, { per_page: '100', page: '1' });
      reg.per_page_maximo_aceito = meta(m100.json).per_page ?? null;
      await espera(200);
      const fut = await get(c, { per_page: '1', page: '1', updated_since: '2999-01-01T00:00:00Z' });
      const totalFut = meta(fut.json).total;
      reg.filtro_updated_since = fut.status !== 200 ? `HTTP ${fut.status}`
        : (typeof totalFut === 'number' && typeof reg.paginacao.total === 'number')
          ? (totalFut === 0 && reg.paginacao.total > 0 ? 'funciona' : totalFut === reg.paginacao.total ? 'ignorado' : `total mudou (${totalFut})`)
          : 'indeterminado';
    }
  }
  resultado.endpoints[c] = reg;
  console.log(`${c.padEnd(24)} HTTP ${r.status}${reg.paginacao?.total != null ? `  total=${reg.paginacao.total}` : ''}${reg.campos ? `  campos=${Object.keys(reg.campos).length}` : ''}${reg.filtro_updated_since ? `  updated_since=${reg.filtro_updated_since}` : ''}`);
  await espera(150);
}

const texto = JSON.stringify(resultado, null, 2);
if (texto.includes(TOKEN)) { console.error('abortado: o token apareceria no resultado'); process.exit(1); }
fs.writeFileSync(SAIDA, texto);
console.log(`\nestrutura gravada em ${SAIDA} (sem valores, sem token)`);
