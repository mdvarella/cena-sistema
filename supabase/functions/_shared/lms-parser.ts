// ETAPA 1.3 (ENEL/LMS/WL) — parser do LMS original.
// Puro: recebe os bytes do arquivo e a biblioteca SheetJS; não acessa rede, banco nem Storage.
// Lê somente A:N da aba Planilha1 (cabeçalho na linha 3, identificação do projeto em D1).
// Conteúdo de O em diante nunca sai desta função (nem em erro, aviso, preview ou log).
// Cada linha do XLSX vira uma linha: nada é agregado, somado, deduplicado ou descartado por FT/KIT/código.
// Quant. Plan = quantidade planejada da fonte; Quant. Real = informação original do LMS (lms_qtd_real_informada).
// Fórmulas não são executadas: usa-se o valor gravado na célula (cellFormula: false).
// Mudou a interpretação do XLSX = nova PARSER_VERSION (importações antigas não são reinterpretadas).

export const PARSER_VERSION = "1";
export const WORKSHEET_ESPERADA = "Planilha1";
export const LINHA_CABECALHO = 3;
export const PRIMEIRA_LINHA_DADOS = 4;
export const CELULA_IDENTIFICACAO = "D1";
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const MIMES_INFORMADOS_ACEITOS = [
  XLSX_MIME,
  "application/octet-stream",
  "application/zip",
  "application/x-zip-compressed",
  "",
];

// Modelo real (Etapa 1.0): 4,4 MB, 10 partes no ZIP, planilha de 4,4 MB descompactada,
// 200 linhas reais e linhas formatadas vazias até 9994.
export const LIMITES = {
  arquivoBytes: 12 * 1024 * 1024,
  zipEntradas: 100,
  zipDescompactadoTotal: 40 * 1024 * 1024,
  zipDescompactadoEntrada: 30 * 1024 * 1024,
  zipRazaoMaxima: 200,
  linhasOperacionais: 5000,
  caracteresCelula: 2000,
  caracteresNomeArquivo: 200,
  amostraPreview: 50,
  linhasIgnoradasListadas: 100,
};

export const COLUNAS = [
  { col: "A", cabecalho: "WL", campo: "wl" },
  { col: "B", cabecalho: "CTG", campo: "ctg" },
  { col: "C", cabecalho: "FT", campo: "ft" },
  { col: "D", cabecalho: "Cód. Ma", campo: "codigo" },
  { col: "E", cabecalho: "KIT", campo: "kit" },
  { col: "F", cabecalho: "UMD", campo: "umd" },
  { col: "G", cabecalho: "Descrição", campo: "descricao" },
  { col: "H", cabecalho: "Quant. Plan", campo: "qtd_plan" },
  { col: "I", cabecalho: "Quant. Real", campo: "qtd_real" },
  { col: "J", cabecalho: "VALOR DE UPS ITEM", campo: "valor_ups_item" },
  { col: "K", cabecalho: "VALOR FINAL", campo: "valor_final" },
  { col: "L", cabecalho: "VALOR FINAL PLAN", campo: "valor_final_plan" },
  { col: "M", cabecalho: "Estorno", campo: "estorno" },
  { col: "N", cabecalho: "Adicionais", campo: "adicionais" },
] as const;

const COLS_AN = "ABCDEFGHIJKLMN";
const COLS_IDENTIFICACAO = "ABCDEFG";
const ESPACOS = /^[ \t\r\n\u00a0]+|[ \t\r\n\u00a0]+$/g;

export type Erro = { codigo: string; detalhe?: Record<string, unknown> };
export type FalhaArquivo = { ok: false; http: number; codigo: string; erros: Erro[] };

export type CelulaRaw = { t: string; v: string | number | boolean; w?: string };

export type LinhaLms = {
  linha_excel: number;
  ordem: number;
  linha_raw: Record<string, CelulaRaw>;
  wl_raw: string | null;
  ctg_raw: string | null;
  ft_raw: string | null;
  codigo_raw: string | null;
  codigo_norm: string | null;
  kit_raw: string | null;
  umd_raw: string | null;
  descricao_raw: string | null;
  qtd_plan_raw: string | null;
  qtd_plan: number | null;
  qtd_real_raw: string | null;
  lms_qtd_real_informada: number | null;
  valor_ups_item_raw: string | null;
  valor_ups_item: number | null;
  valor_final_raw: string | null;
  valor_final: number | null;
  valor_final_plan_raw: string | null;
  valor_final_plan: number | null;
  estorno_raw: string | null;
  adicionais_raw: string | null;
  alertas: string[];
};

export type ResultadoParse =
  | {
    ok: true;
    parser_version: string;
    worksheet: string;
    projeto_identificacao_raw: string | null;
    linhas: LinhaLms[];
    linhas_ignoradas: number[];
    total_linhas_ignoradas: number;
  }
  | { ok: false; codigo: "FORMATO_LMS_INCOMPATIVEL"; erros: Erro[] };

// ── Normalização (mesma semântica de fn_proj_codigo_norm / fn_proj_texto_norm no banco) ──
// trim de espaço, tab, quebra de linha e NBSP; maiúsculas só em a-z (sem depender de locale).
function maiusculasAscii(s: string): string {
  return s.replace(/[a-z]/g, (c) => c.toUpperCase());
}

export function textoNorm(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = maiusculasAscii(String(v).replace(ESPACOS, ""));
  return t === "" ? null : t;
}

// 1. trim; 2. maiúsculas; 3. só dígitos → sem zeros à esquerda; 4. só zeros → "0"; 5. só espaço → null.
export function codigoNorm(v: string | null | undefined): string | null {
  const t = textoNorm(v);
  if (t === null) return null;
  if (/^[0-9]+$/.test(t)) return t.replace(/^0+/, "") || "0";
  return t;
}

// ── Números (célula numérica do XLSX ou texto pt-BR) ──
// "0,2616" → 0.2616; "1.234,5" → 1234.5; "0.5" → 0.5; "1.234" (ambíguo) → inválido.
export function numeroLms(c: CelulaRaw | undefined): { valor: number | null; invalido: boolean } {
  if (!c) return { valor: null, invalido: false };
  if (c.t === "n") {
    return typeof c.v === "number" && Number.isFinite(c.v) ? { valor: c.v, invalido: false } : { valor: null, invalido: true };
  }
  if (c.t !== "s") return { valor: null, invalido: true };
  const s = String(c.v).replace(ESPACOS, "");
  if (s === "") return { valor: null, invalido: false };
  let n: number | null = null;
  if (/^[+-]?\d+$/.test(s)) n = Number(s);
  else if (/^[+-]?\d+,\d+$/.test(s)) n = Number(s.replace(",", "."));
  else if (/^[+-]?\d{1,3}(\.\d{3})+,\d+$/.test(s)) n = Number(s.replace(/\./g, "").replace(",", "."));
  else if (/^[+-]?\d{1,3}(\.\d{3})+$/.test(s)) n = null;
  else if (/^[+-]?\d+\.\d+$/.test(s)) n = Number(s);
  return n !== null && Number.isFinite(n) ? { valor: n, invalido: false } : { valor: null, invalido: true };
}

export function sanitizarNomeArquivo(nome: string | null | undefined): string | null {
  const base = String(nome ?? "").split(/[\\/]/).pop() ?? "";
  const limpo = base.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, "").replace(ESPACOS, "");
  if (!limpo || limpo.length > LIMITES.caracteresNomeArquivo) return null;
  if (!/\.xlsx$/i.test(limpo)) return null;
  return limpo;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Validação do arquivo antes do SheetJS (tipo, tamanho, ZIP, conteúdo ativo, ZIP bomb) ──
function u16(b: Uint8Array, o: number) { return b[o] | (b[o + 1] << 8); }
function u32(b: Uint8Array, o: number) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
const falha = (http: number, codigo: string, erro: string, detalhe?: Record<string, unknown>): FalhaArquivo =>
  ({ ok: false, http, codigo, erros: [{ codigo: erro, ...(detalhe ? { detalhe } : {}) }] });

type EntradaZip = { nome: string; metodo: number; compactado: number; descompactado: number; offsetLocal: number };

function lerDiretorioZip(b: Uint8Array): EntradaZip[] | FalhaArquivo {
  const inv = (e: string) => falha(415, "TIPO_ARQUIVO_INVALIDO", e);
  if (b.length < 22 || u32(b, 0) !== 0x04034b50) return inv("ASSINATURA_ZIP_AUSENTE");
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return inv("ZIP_SEM_DIRETORIO");
  const qtd = u16(b, eocd + 10);
  const tamDir = u32(b, eocd + 12);
  const iniDir = u32(b, eocd + 16);
  if (qtd === 0xffff || tamDir === 0xffffffff || iniDir === 0xffffffff) return inv("ZIP64_NAO_SUPORTADO");
  if (qtd === 0 || qtd > LIMITES.zipEntradas) return falha(413, "ARQUIVO_GRANDE_DEMAIS", "ZIP_ENTRADAS_EXCEDIDAS", { limite: LIMITES.zipEntradas });
  if (iniDir + tamDir > eocd) return inv("ZIP_DIRETORIO_INVALIDO");
  const dec = new TextDecoder("utf-8", { fatal: false });
  const entradas: EntradaZip[] = [];
  let p = iniDir;
  for (let i = 0; i < qtd; i++) {
    if (p + 46 > eocd || u32(b, p) !== 0x02014b50) return inv("ZIP_DIRETORIO_INVALIDO");
    const flags = u16(b, p + 8);
    const metodo = u16(b, p + 10);
    const compactado = u32(b, p + 20);
    const descompactado = u32(b, p + 24);
    const nNome = u16(b, p + 28), nExtra = u16(b, p + 30), nComent = u16(b, p + 32);
    const offsetLocal = u32(b, p + 42);
    const nome = dec.decode(b.subarray(p + 46, p + 46 + nNome));
    if (flags & 1) return inv("ZIP_CRIPTOGRAFADO");
    if (metodo !== 0 && metodo !== 8) return inv("ZIP_METODO_NAO_SUPORTADO");
    if (compactado === 0xffffffff || descompactado === 0xffffffff || offsetLocal === 0xffffffff) return inv("ZIP64_NAO_SUPORTADO");
    if (nome.startsWith("/") || nome.split("/").includes("..")) return inv("ZIP_CAMINHO_INVALIDO");
    entradas.push({ nome, metodo, compactado, descompactado, offsetLocal });
    p += 46 + nNome + nExtra + nComent;
  }
  return entradas;
}

async function descompactarEntrada(b: Uint8Array, e: EntradaZip, limite: number): Promise<Uint8Array | null> {
  const o = e.offsetLocal;
  if (o + 30 > b.length || u32(b, o) !== 0x04034b50) return null;
  const ini = o + 30 + u16(b, o + 26) + u16(b, o + 28);
  const dados = b.subarray(ini, ini + e.compactado);
  if (dados.length !== e.compactado) return null;
  if (e.metodo === 0) return dados.length <= limite ? dados : null;
  const stream = new Blob([dados]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limite) { await reader.cancel(); return null; }
      partes.push(value);
    }
  } catch {
    return null;
  }
  const out = new Uint8Array(total);
  let k = 0;
  for (const x of partes) { out.set(x, k); k += x.length; }
  return out;
}

export async function validarArquivo(
  bytes: Uint8Array,
  nomeInformado: string | null | undefined,
  mimeInformado: string | null | undefined,
): Promise<{ ok: true; nome: string; mime_informado: string | null; mime_validado: string } | FalhaArquivo> {
  if (bytes.length > LIMITES.arquivoBytes) return falha(413, "ARQUIVO_GRANDE_DEMAIS", "TAMANHO_EXCEDIDO", { limite_bytes: LIMITES.arquivoBytes });
  if (bytes.length === 0) return falha(415, "TIPO_ARQUIVO_INVALIDO", "ARQUIVO_VAZIO");
  const nome = sanitizarNomeArquivo(nomeInformado);
  if (!nome) return falha(415, "TIPO_ARQUIVO_INVALIDO", "EXTENSAO_OU_NOME_INVALIDO");
  const mime = String(mimeInformado ?? "").split(";")[0].trim().toLowerCase();
  if (!MIMES_INFORMADOS_ACEITOS.includes(mime)) return falha(415, "TIPO_ARQUIVO_INVALIDO", "MIME_NAO_ACEITO");

  const dir = lerDiretorioZip(bytes);
  if (!Array.isArray(dir)) return dir;
  let total = 0;
  for (const e of dir) {
    total += e.descompactado;
    if (e.descompactado > LIMITES.zipDescompactadoEntrada || total > LIMITES.zipDescompactadoTotal) {
      return falha(413, "ARQUIVO_GRANDE_DEMAIS", "ZIP_DESCOMPACTADO_EXCEDIDO", { limite_bytes: LIMITES.zipDescompactadoTotal });
    }
    if (e.descompactado > 1024 * 1024 && (e.compactado === 0 || e.descompactado / e.compactado > LIMITES.zipRazaoMaxima)) {
      return falha(413, "ARQUIVO_GRANDE_DEMAIS", "ZIP_RAZAO_SUSPEITA");
    }
    if (/(^|\/)vbaProject\.bin$/i.test(e.nome) || /^xl\/(macrosheets|activeX)\//i.test(e.nome)) {
      return falha(415, "TIPO_ARQUIVO_INVALIDO", "ARQUIVO_COM_MACRO");
    }
  }
  const ct = dir.find((e) => e.nome === "[Content_Types].xml");
  if (!ct || !dir.some((e) => e.nome === "xl/workbook.xml")) return falha(415, "TIPO_ARQUIVO_INVALIDO", "NAO_E_XLSX");
  const ctBytes = await descompactarEntrada(bytes, ct, 1024 * 1024);
  if (!ctBytes) return falha(415, "TIPO_ARQUIVO_INVALIDO", "NAO_E_XLSX");
  // Só os Override valem: o SheetJS e o Excel gravam Default genérico para .bin com "macroEnabled" mesmo sem macro.
  const partes = new Map<string, string>();
  for (const tag of new TextDecoder().decode(ctBytes).match(/<Override\b[^>]*>/g) ?? []) {
    const parte = /\bPartName="([^"]*)"/.exec(tag)?.[1], tipo = /\bContentType="([^"]*)"/.exec(tag)?.[1];
    if (parte && tipo) partes.set(parte.toLowerCase(), tipo);
  }
  for (const tipo of partes.values()) {
    if (/macroEnabled|vbaProject|ms-excel\.(intl)?macrosheet|activeX/i.test(tipo)) return falha(415, "TIPO_ARQUIVO_INVALIDO", "ARQUIVO_COM_MACRO");
  }
  if (partes.get("/xl/workbook.xml") !== "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml") {
    return falha(415, "TIPO_ARQUIVO_INVALIDO", "NAO_E_XLSX");
  }
  // O tamanho descompactado declarado no ZIP pode mentir: confere o real, com limite, antes de entregar ao SheetJS.
  for (const e of dir) {
    if (e.metodo === 0 && e.compactado !== e.descompactado) return falha(415, "TIPO_ARQUIVO_INVALIDO", "ZIP_INCONSISTENTE");
    const real = await descompactarEntrada(bytes, e, e.descompactado);
    if (!real || real.length !== e.descompactado) return falha(415, "TIPO_ARQUIVO_INVALIDO", "ZIP_INCONSISTENTE");
  }
  return { ok: true, nome, mime_informado: mime || null, mime_validado: XLSX_MIME };
}

// ── Células ──
type XlsxLib = { read: (data: Uint8Array, opts: Record<string, unknown>) => any; utils: { decode_cell: (a: string) => { r: number; c: number } } };
type Planilha = Record<string, any>;

// Célula só com espaço é preservada no raw, mas não conta como conteúdo.
function celula(ws: Planilha, ref: string): CelulaRaw | undefined {
  const c = ws[ref];
  if (!c || c.v === undefined || c.v === null || c.v === "") return undefined;
  const out: CelulaRaw = { t: String(c.t), v: c.t === "e" ? String(c.w ?? "#ERRO") : c.v };
  if (c.t === "n" && typeof c.w === "string" && c.w !== String(c.v)) out.w = c.w;
  return out;
}

function temConteudo(c: CelulaRaw | undefined): boolean {
  return c !== undefined && !(c.t === "s" && String(c.v).replace(ESPACOS, "") === "");
}

function textoRaw(c: CelulaRaw | undefined): string | null {
  if (!c) return null;
  if (c.t === "b") return c.v ? "TRUE" : "FALSE";
  return String(c.v);
}

function cabecalhoNorm(v: unknown): string {
  return String(v ?? "").normalize("NFC").replace(/\s+/g, " ").trim().toUpperCase();
}

function incompativel(erros: Erro[]): ResultadoParse {
  return { ok: false, codigo: "FORMATO_LMS_INCOMPATIVEL", erros };
}

export function parseLms(bytes: Uint8Array, XLSX: XlsxLib): ResultadoParse {
  let wb: any;
  try {
    wb = XLSX.read(bytes, {
      type: "array",
      sheets: WORKSHEET_ESPERADA,
      cellFormula: false,
      cellHTML: false,
      cellNF: false,
      cellStyles: false,
      cellDates: false,
      sheetStubs: false,
      bookVBA: false,
      bookDeps: false,
      bookFiles: false,
      WTF: false,
    });
  } catch {
    return incompativel([{ codigo: "XLSX_ILEGIVEL" }]);
  }
  if (!wb || !Array.isArray(wb.SheetNames) || !wb.SheetNames.includes(WORKSHEET_ESPERADA) || !wb.Sheets?.[WORKSHEET_ESPERADA]) {
    return incompativel([{ codigo: "WORKSHEET_AUSENTE", detalhe: { esperada: WORKSHEET_ESPERADA } }]);
  }
  const ws: Planilha = wb.Sheets[WORKSHEET_ESPERADA];

  const erros: Erro[] = [];
  for (const k of COLUNAS) {
    const c = ws[k.col + LINHA_CABECALHO];
    const achado = cabecalhoNorm(c?.v);
    if (achado !== cabecalhoNorm(k.cabecalho)) {
      erros.push({ codigo: "CABECALHO_INCOMPATIVEL", detalhe: { coluna: k.col, esperado: k.cabecalho, encontrado: achado.slice(0, 60) } });
    }
  }
  if (erros.length) return incompativel(erros);

  // Só células A:N; o resto da planilha não é lido daqui em diante.
  const porLinha = new Map<number, Record<string, CelulaRaw>>();
  let identificacao: CelulaRaw | undefined;
  for (const ref of Object.keys(ws)) {
    const m = /^([A-N])([1-9][0-9]*)$/.exec(ref);
    if (!m) continue;
    const r = Number(m[2]);
    const c = celula(ws, ref);
    if (!c) continue;
    if (c.t === "s" && String(c.v).length > LIMITES.caracteresCelula) {
      return incompativel([{ codigo: "CELULA_GRANDE_DEMAIS", detalhe: { celula: ref, limite: LIMITES.caracteresCelula } }]);
    }
    if (ref === CELULA_IDENTIFICACAO) identificacao = c;
    if (r < PRIMEIRA_LINHA_DADOS) continue;
    let linha = porLinha.get(r);
    if (!linha) { linha = {}; porLinha.set(r, linha); }
    linha[m[1]] = c;
  }

  const linhas: LinhaLms[] = [];
  const ignoradas: number[] = [];
  let totalIgnoradas = 0;
  for (const r of [...porLinha.keys()].sort((a, b) => a - b)) {
    const cel = porLinha.get(r)!;
    const temIdent = [...COLS_IDENTIFICACAO].some((c) => temConteudo(cel[c]));
    const plan = numeroLms(cel.H);
    const real = numeroLms(cel.I);
    const temQtd = (plan.valor !== null && plan.valor !== 0) || (real.valor !== null && real.valor !== 0);
    if (!temIdent && !temQtd) {
      totalIgnoradas++;
      if (ignoradas.length < LIMITES.linhasIgnoradasListadas) ignoradas.push(r);
      continue;
    }
    if (linhas.length >= LIMITES.linhasOperacionais) {
      return incompativel([{ codigo: "LIMITE_LINHAS_EXCEDIDO", detalhe: { limite: LIMITES.linhasOperacionais } }]);
    }
    linhas.push(montarLinha(r, linhas.length + 1, cel, plan, real));
  }
  if (!linhas.length) return incompativel([{ codigo: "SEM_LINHAS_OPERACIONAIS" }]);
  marcarRepetidas(linhas);

  return {
    ok: true,
    parser_version: PARSER_VERSION,
    worksheet: WORKSHEET_ESPERADA,
    projeto_identificacao_raw: textoRaw(identificacao),
    linhas,
    linhas_ignoradas: ignoradas,
    total_linhas_ignoradas: totalIgnoradas,
  };
}

function montarLinha(
  r: number,
  ordem: number,
  cel: Record<string, CelulaRaw>,
  plan: { valor: number | null; invalido: boolean },
  real: { valor: number | null; invalido: boolean },
): LinhaLms {
  const raw: Record<string, CelulaRaw> = {};
  for (const c of COLS_AN) if (cel[c]) raw[c] = cel[c];
  const ups = numeroLms(cel.J), fin = numeroLms(cel.K), finPlan = numeroLms(cel.L);
  const alertas: string[] = [];
  const vazio = (c: string, codigo: string) => { if (!temConteudo(cel[c])) alertas.push(codigo); };
  vazio("A", "WL_VAZIA");
  vazio("B", "CTG_VAZIA");
  vazio("C", "FT_VAZIA");
  vazio("D", "CODIGO_VAZIO");
  vazio("E", "KIT_VAZIO");
  vazio("F", "UMD_VAZIA");
  vazio("G", "DESCRICAO_VAZIA");
  vazio("H", "QTD_PLAN_VAZIA");
  if (plan.invalido) alertas.push("QTD_PLAN_INVALIDA");
  if (real.invalido) alertas.push("QTD_REAL_INVALIDA");
  if (ups.invalido) alertas.push("VALOR_UPS_ITEM_INVALIDO");
  if (fin.invalido) alertas.push("VALOR_FINAL_INVALIDO");
  if (finPlan.invalido) alertas.push("VALOR_FINAL_PLAN_INVALIDO");
  if ((plan.valor ?? 0) < 0 || (real.valor ?? 0) < 0) alertas.push("QTD_NEGATIVA");
  if (plan.valor === 0 && real.valor !== null && real.valor > 0) alertas.push("PLAN_ZERO_REAL_POSITIVO");
  if (Object.values(cel).some((c) => c.t === "e")) alertas.push("CELULA_COM_ERRO");
  if (temConteudo(cel.M)) alertas.push("ESTORNO_INFORMADO");
  if (temConteudo(cel.N)) alertas.push("ADICIONAIS_INFORMADO");
  const codigo = codigoNorm(textoRaw(cel.D));
  const servico = codigo ? /^([IR])-(.+)$/.exec(codigo) : null;
  if (servico) {
    if (textoNorm(textoRaw(cel.C)) !== servico[1]) alertas.push("SERVICO_PREFIXO_DIFERENTE_FT");
    if (temConteudo(cel.E) && textoNorm(textoRaw(cel.E)) !== "S-" + servico[2]) alertas.push("SERVICO_KIT_FORA_DO_PADRAO");
  }
  return {
    linha_excel: r,
    ordem,
    linha_raw: raw,
    wl_raw: textoRaw(cel.A),
    ctg_raw: textoRaw(cel.B),
    ft_raw: textoRaw(cel.C),
    codigo_raw: textoRaw(cel.D),
    codigo_norm: codigo,
    kit_raw: textoRaw(cel.E),
    umd_raw: textoRaw(cel.F),
    descricao_raw: textoRaw(cel.G),
    qtd_plan_raw: textoRaw(cel.H),
    qtd_plan: plan.valor,
    qtd_real_raw: textoRaw(cel.I),
    lms_qtd_real_informada: real.valor,
    valor_ups_item_raw: textoRaw(cel.J),
    valor_ups_item: ups.valor,
    valor_final_raw: textoRaw(cel.K),
    valor_final: fin.valor,
    valor_final_plan_raw: textoRaw(cel.L),
    valor_final_plan: finPlan.valor,
    estorno_raw: textoRaw(cel.M),
    adicionais_raw: textoRaw(cel.N),
    alertas,
  };
}

const CAMPOS_RAW = [
  "wl_raw", "ctg_raw", "ft_raw", "codigo_raw", "kit_raw", "umd_raw", "descricao_raw", "qtd_plan_raw", "qtd_real_raw",
  "valor_ups_item_raw", "valor_final_raw", "valor_final_plan_raw", "estorno_raw", "adicionais_raw",
] as const;

function marcarRepetidas(linhas: LinhaLms[]) {
  const grupos = new Map<string, LinhaLms[]>();
  for (const l of linhas) {
    const k = JSON.stringify(CAMPOS_RAW.map((c) => l[c]));
    const g = grupos.get(k);
    if (g) g.push(l); else grupos.set(k, [l]);
  }
  for (const g of grupos.values()) if (g.length > 1) for (const l of g) l.alertas.push("LINHA_REPETIDA");
}

// ── Preview (diagnóstico; não corrige nada) ──
// classe_preview só orienta a homologação; a classificação oficial fica para a estruturação.
export function classePreview(codigoNormalizado: string | null): string {
  if (codigoNormalizado === null) return "SEM_CODIGO";
  if (/^[0-9]+$/.test(codigoNormalizado)) return "MATERIAL_PROVAVEL";
  if (/^[IR]-/.test(codigoNormalizado)) return "SERVICO_PROVAVEL";
  return "INDEFINIDO";
}

function excedentes(linhas: LinhaLms[], chave: (l: LinhaLms) => string): number {
  const n = new Map<string, number>();
  for (const l of linhas) {
    if (l.codigo_norm === null) continue;
    const k = chave(l);
    n.set(k, (n.get(k) ?? 0) + 1);
  }
  let extra = 0;
  for (const v of n.values()) if (v > 1) extra += v - 1;
  return extra;
}

function ordemWl(a: string, b: string): number {
  const na = /^\d+$/.test(a), nb = /^\d+$/.test(b);
  if (na && nb) return Number(a) - Number(b);
  if (na !== nb) return na ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function montarResumo(r: Extract<ResultadoParse, { ok: true }>) {
  const wls = new Map<string, { wl: string; linhas: number; material_provavel: number; servico_provavel: number; outros: number }>();
  const alertas: Record<string, number> = {};
  const porCodigo = new Map<string, number>();
  let codigosNulos = 0, planZeroRealPositivo = 0;
  for (const l of r.linhas) {
    for (const a of l.alertas) alertas[a] = (alertas[a] ?? 0) + 1;
    if (l.codigo_norm === null) codigosNulos++;
    else porCodigo.set(l.codigo_norm, (porCodigo.get(l.codigo_norm) ?? 0) + 1);
    if (l.alertas.includes("PLAN_ZERO_REAL_POSITIVO")) planZeroRealPositivo++;
    const wl = textoNorm(l.wl_raw);
    if (wl === null) continue;
    const g = wls.get(wl) ?? { wl, linhas: 0, material_provavel: 0, servico_provavel: 0, outros: 0 };
    g.linhas++;
    const cls = classePreview(l.codigo_norm);
    if (cls === "MATERIAL_PROVAVEL") g.material_provavel++;
    else if (cls === "SERVICO_PROVAVEL") g.servico_provavel++;
    else g.outros++;
    wls.set(wl, g);
  }
  const k = (l: LinhaLms) => [textoNorm(l.wl_raw), l.codigo_norm, textoNorm(l.ft_raw)].join("\u0001");
  return {
    parser_version: r.parser_version,
    worksheet: r.worksheet,
    projeto_identificacao_raw: r.projeto_identificacao_raw,
    qtd_linhas: r.linhas.length,
    qtd_wls_distintas: wls.size,
    wls: [...wls.values()].sort((a, b) => ordemWl(a.wl, b.wl)),
    plan_zero_real_positivo: planZeroRealPositivo,
    codigos_nulos: codigosNulos,
    codigos_repetidos: [...porCodigo.values()].filter((n) => n > 1).length,
    duplicados_wl_codigo_ft: excedentes(r.linhas, k),
    duplicados_wl_codigo_ft_kit: excedentes(r.linhas, (l) => k(l) + "\u0001" + textoNorm(l.kit_raw)),
    linhas_repetidas: alertas["LINHA_REPETIDA"] ?? 0,
    linhas_ignoradas: { total: r.total_linhas_ignoradas, linhas: r.linhas_ignoradas },
    alertas,
  };
}

// Parâmetros de sot_lms_importacao_registrar. Caminho e bucket não vão: o banco deriva de projeto + hash.
export function payloadRegistro(
  r: Extract<ResultadoParse, { ok: true }>,
  arquivo: { hash_sha256: string; nome: string; tamanho: number; mime_informado: string | null; mime_validado: string },
) {
  const resumo = montarResumo(r);
  return {
    p_importacao: {
      hash_sha256: arquivo.hash_sha256,
      arquivo_nome_original: arquivo.nome,
      arquivo_tamanho: arquivo.tamanho,
      mime_informado: arquivo.mime_informado,
      mime_validado: arquivo.mime_validado,
      parser_version: r.parser_version,
      worksheet: r.worksheet,
      projeto_identificacao_raw: r.projeto_identificacao_raw,
      qtd_linhas: resumo.qtd_linhas,
      qtd_wls_distintas: resumo.qtd_wls_distintas,
      resumo,
    },
    p_linhas: r.linhas,
  };
}

export function amostraPreview(linhas: LinhaLms[], n = LIMITES.amostraPreview) {
  return linhas.slice(0, n).map((l) => ({
    linha_excel: l.linha_excel,
    ordem: l.ordem,
    wl_raw: l.wl_raw,
    ctg_raw: l.ctg_raw,
    ft_raw: l.ft_raw,
    codigo_raw: l.codigo_raw,
    codigo_norm: l.codigo_norm,
    kit_raw: l.kit_raw,
    umd_raw: l.umd_raw,
    descricao_raw: l.descricao_raw,
    qtd_plan: l.qtd_plan,
    lms_qtd_real_informada: l.lms_qtd_real_informada,
    valor_ups_item: l.valor_ups_item,
    valor_final: l.valor_final,
    valor_final_plan: l.valor_final_plan,
    estorno_raw: l.estorno_raw,
    adicionais_raw: l.adicionais_raw,
    alertas: l.alertas,
  }));
}
