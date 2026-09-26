/** Anchors DocuSign — fail-closed. Sem Deno. */

export type PapelSigner = "EMPREGADO" | "EMPRESA" | "TESTEMUNHA" | string;

export function anchorAssinaturaPorPapel(papel: PapelSigner): string {
  const p = String(papel || "EMPREGADO").toUpperCase();
  if (p === "EMPRESA") return "[[ASSINATURA_EMPRESA]]";
  if (p === "TESTEMUNHA") return "[[ASSINATURA_TESTEMUNHA]]";
  return "[[ASSINATURA_EMPREGADO]]";
}

export const ANCHOR_DATA = "[[DATA_ASSINATURA]]";

export function validarAnchorsHtml(
  html: string,
  destinatarios: Array<{ papel?: string }>,
  opts?: { exigirData?: boolean },
): { ok: true } | { ok: false; error: "anchor_obrigatorio_ausente"; marker: string; papel?: string } {
  const src = String(html || "");
  const exigirData = opts?.exigirData !== false;
  if (!destinatarios.length) {
    return { ok: false, error: "anchor_obrigatorio_ausente", marker: "destinatarios" };
  }
  for (const d of destinatarios) {
    const marker = anchorAssinaturaPorPapel(d.papel);
    if (!src.includes(marker)) {
      return { ok: false, error: "anchor_obrigatorio_ausente", marker, papel: String(d.papel || "EMPREGADO") };
    }
  }
  if (exigirData && !src.includes(ANCHOR_DATA)) {
    return { ok: false, error: "anchor_obrigatorio_ausente", marker: ANCHOR_DATA };
  }
  return { ok: true };
}
