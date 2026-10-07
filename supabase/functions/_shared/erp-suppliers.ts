// Fornecedores do ERP CENA (/suppliers): leitura paginada, normalização e hash.
// Sem dependências externas: roda no Deno (Edge Function) e no Node (testes).
// Só os campos de cadastro e contato saem daqui — banco, PIX, notas e o registro bruto ficam no ERP.

export type ErpSupplierRaw = Record<string, unknown>;

export type FornecedorErp = {
  erp_id: number;
  erp_parent_id: number | null;
  razao_social: string;
  nome_fantasia: string | null;
  cnpj_cpf: string;
  doc_valido: boolean;
  email: string | null;
  telefone: string | null;
  cidade: string | null;
  estado: string | null;
  ativo: boolean;
  erp_updated_at: string | null;
};

export type FornecedorErpItem = FornecedorErp & { cnpj_dup_erp: boolean; hash: string };

export type ModoSync = "INCREMENTAL" | "COMPLETA" | "SIMULACAO";

export const ERP_URL_PADRAO = "https://erp.cenabr.app/api/external/v1";
export const POR_PAGINA = 100;
export const SOBREPOSICAO_MS = 10 * 60 * 1000;
export const COMPLETA_A_CADA_MS = 7 * 24 * 60 * 60 * 1000;

const CAMPOS_HASH = [
  "erp_id", "erp_parent_id", "razao_social", "nome_fantasia", "cnpj_cpf",
  "email", "telefone", "cidade", "estado", "ativo",
] as const;

export class ErroErp extends Error {
  repetir: boolean;
  constructor(mensagem: string, repetir: boolean) {
    super(mensagem);
    this.name = "ErroErp";
    this.repetir = repetir;
  }
}

export function soDigitos(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

export function docValido(digitos: string): boolean {
  return (digitos.length === 11 || digitos.length === 14) && !/^0+$/.test(digitos);
}

function texto(v: unknown): string | null {
  if (v == null || typeof v === "object") return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s || null;
}

function inteiroPositivo(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(String(v ?? "").trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

function dataIso(v: unknown): string | null {
  if (v == null || v === "") return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function ativoErp(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

export function normalizarSupplier(raw: ErpSupplierRaw): FornecedorErp | null {
  if (!raw || typeof raw !== "object") return null;
  const erpId = inteiroPositivo(raw.id);
  const razao = texto(raw.name) ?? texto(raw.trade_name);
  if (!erpId || !razao) return null;
  const doc = soDigitos(raw.cpf_cnpj);
  const email = texto(raw.email);
  const estado = texto(raw.state);
  return {
    erp_id: erpId,
    erp_parent_id: inteiroPositivo(raw.parent_supplier_id),
    razao_social: razao.slice(0, 300),
    nome_fantasia: texto(raw.trade_name),
    cnpj_cpf: doc,
    doc_valido: docValido(doc),
    email: email ? email.toLowerCase() : null,
    telefone: texto(raw.phone) ?? texto(raw.mobile),
    cidade: texto(raw.city),
    estado: estado ? estado.toUpperCase() : null,
    ativo: ativoErp(raw.is_active),
    erp_updated_at: dataIso(raw.updated_at),
  };
}

export async function hashFornecedor(f: FornecedorErp): Promise<string> {
  const base = JSON.stringify(CAMPOS_HASH.map((k) => f[k] ?? null));
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(base));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Normaliza, descarta inválidos, mantém um registro por erp_id e marca CPF/CNPJ repetidos no conjunto lido. */
export async function prepararItens(raws: ErpSupplierRaw[]): Promise<{ itens: FornecedorErpItem[]; ignorados: number }> {
  const porId = new Map<number, FornecedorErp>();
  let ignorados = 0;
  for (const raw of raws) {
    const f = normalizarSupplier(raw);
    if (!f) {
      ignorados++;
      continue;
    }
    porId.set(f.erp_id, f);
  }
  const contagem = new Map<string, number>();
  for (const f of porId.values()) {
    if (f.doc_valido) contagem.set(f.cnpj_cpf, (contagem.get(f.cnpj_cpf) ?? 0) + 1);
  }
  const itens: FornecedorErpItem[] = [];
  for (const f of porId.values()) {
    itens.push({ ...f, cnpj_dup_erp: f.doc_valido && (contagem.get(f.cnpj_cpf) ?? 0) > 1, hash: await hashFornecedor(f) });
  }
  return { itens, ignorados };
}

export function escolherModo(opts: {
  solicitado: "auto" | "completa" | "simulacao";
  watermark: string | null;
  ultimaCompleta: string | null;
  agora: number;
}): ModoSync {
  if (opts.solicitado === "simulacao") return "SIMULACAO";
  if (opts.solicitado === "completa") return "COMPLETA";
  if (!opts.watermark || !opts.ultimaCompleta) return "COMPLETA";
  const uc = Date.parse(opts.ultimaCompleta);
  if (!Number.isFinite(uc) || opts.agora - uc >= COMPLETA_A_CADA_MS) return "COMPLETA";
  return "INCREMENTAL";
}

export function filtroIncremental(watermark: string): Record<string, string> {
  const t = Date.parse(watermark) - SOBREPOSICAO_MS;
  return { updated_since: new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z") };
}

export function maiorUpdatedAt(itens: FornecedorErpItem[]): string | null {
  let max: number | null = null;
  for (const i of itens) {
    if (!i.erp_updated_at) continue;
    const t = Date.parse(i.erp_updated_at);
    if (Number.isFinite(t) && (max === null || t > max)) max = t;
  }
  return max === null ? null : new Date(max).toISOString();
}

/** O ERP publica updated_at? Sem isso o filtro updated_since não é confiável. */
export function erpTemUpdatedAt(raws: ErpSupplierRaw[]): boolean {
  return raws.some((r) => r && typeof r === "object" && "updated_at" in r);
}

export type LeituraErp = {
  itens: ErpSupplierRaw[];
  paginas: number;
  total: number;
  idsUnicos: number;
  completo: boolean;
};

type PaginaErp = { data: ErpSupplierRaw[]; meta?: { last_page?: unknown; total?: unknown }; last_page?: unknown; total?: unknown };

export async function lerSuppliers(opts: {
  baseUrl: string;
  token: string;
  filtros?: Record<string, string>;
  fetchFn?: typeof fetch;
  porPagina?: number;
  concorrencia?: number;
  tentativas?: number;
  timeoutMs?: number;
  esperaBaseMs?: number;
}): Promise<LeituraErp> {
  const fetchFn = opts.fetchFn ?? fetch;
  const porPagina = opts.porPagina ?? POR_PAGINA;
  const concorrencia = Math.max(1, opts.concorrencia ?? 4);
  const tentativas = Math.max(0, opts.tentativas ?? 3);
  const timeoutMs = opts.timeoutMs ?? 20000;
  const esperaBaseMs = opts.esperaBaseMs ?? 500;
  const base = opts.baseUrl.replace(/\/+$/, "") + "/suppliers";

  async function pagina(n: number): Promise<PaginaErp> {
    const url = new URL(base);
    url.searchParams.set("per_page", String(porPagina));
    url.searchParams.set("page", String(n));
    for (const [k, v] of Object.entries(opts.filtros ?? {})) url.searchParams.set(k, v);
    let ultimo = "";
    for (let t = 0; t <= tentativas; t++) {
      if (t > 0) await new Promise((r) => setTimeout(r, esperaBaseMs * 2 ** (t - 1)));
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchFn(url.toString(), {
          headers: { Accept: "application/json", Authorization: "Bearer " + opts.token },
          signal: ctrl.signal,
        });
        if (res.status === 429 || res.status >= 500) {
          ultimo = "HTTP " + res.status;
          try { await res.body?.cancel(); } catch { /* corpo já consumido */ }
          continue;
        }
        if (!res.ok) throw new ErroErp(`ERP respondeu HTTP ${res.status} na página ${n}`, false);
        const j = await res.json().catch(() => null) as PaginaErp | null;
        if (!j || !Array.isArray(j.data)) throw new ErroErp(`resposta inválida do ERP na página ${n}`, false);
        return j;
      } catch (e) {
        if (e instanceof ErroErp) throw e;
        ultimo = (e as Error)?.name === "AbortError" ? "tempo esgotado" : "falha de rede";
      } finally {
        clearTimeout(timer);
      }
    }
    throw new ErroErp(`ERP indisponível na página ${n} (${ultimo})`, true);
  }

  const p1 = await pagina(1);
  const ultima = Number(p1.meta?.last_page ?? p1.last_page ?? 1);
  const total = Number(p1.meta?.total ?? p1.total ?? p1.data.length);
  if (!Number.isInteger(ultima) || ultima < 1 || ultima > 1000 || !Number.isInteger(total) || total < 0) {
    throw new ErroErp("paginação inválida na resposta do ERP", false);
  }

  const resto: ErpSupplierRaw[][] = new Array(Math.max(0, ultima - 1));
  let proxima = 2;
  async function trabalhador() {
    while (proxima <= ultima) {
      const n = proxima++;
      resto[n - 2] = (await pagina(n)).data;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concorrencia, Math.max(0, ultima - 1)) }, trabalhador));

  const itens = p1.data.concat(...resto);
  const ids = new Set(itens.map((i) => i?.id).filter((v) => v != null).map(String));
  return { itens, paginas: ultima, total, idsUnicos: ids.size, completo: ids.size === total };
}
