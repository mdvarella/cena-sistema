// Mesmo critério de rhDocPodeGerenciarModelos + perfilAcessoTotal.
// Fonte: usuarios_sistema.perfil + usuarios_sistema.auth_user_id (ativo=true).
import type { SupabaseClient, User } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export const RH_PERFIS_MODELOS = [
  "admin",
  "gestor",
  "administrativo",
  "dp",
  "rh",
  "diretoria",
];

export function perfilPodeGerenciarModelos(perfil: string | null | undefined): boolean {
  const p = String(perfil || "").toLowerCase().trim();
  if (!p) return false;
  if (p === "admin" || p === "diretoria") return true;
  return RH_PERFIS_MODELOS.indexOf(p) >= 0;
}

export type RhAuthOk = {
  ok: true;
  user: User;
  perfil: string;
  usuarioId: string;
  usuarioNome: string;
};

export async function exigirPermissaoRhModelos(
  admin: SupabaseClient,
  user: User | null,
): Promise<RhAuthOk | { ok: false; error: string; http: number }> {
  if (!user?.id) return { ok: false, error: "invalid_session", http: 401 };
  const { data, error } = await admin
    .from("usuarios_sistema")
    .select("id,nome,email,perfil,ativo,auth_user_id")
    .eq("auth_user_id", user.id)
    .eq("ativo", true)
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, error: "usuario_lookup_failed", http: 500 };
  if (!data) return { ok: false, error: "sem_permissao_rh", http: 403 };
  if (!perfilPodeGerenciarModelos(data.perfil)) {
    return { ok: false, error: "sem_permissao_rh", http: 403 };
  }
  return {
    ok: true,
    user,
    perfil: String(data.perfil || ""),
    usuarioId: String(data.id || ""),
    usuarioNome: String(data.nome || data.email || user.email || ""),
  };
}

export async function registrarAuditLog(
  admin: SupabaseClient,
  acao: string,
  descricao: string,
  who: { usuarioId?: string; usuarioNome?: string; perfil?: string },
  extra?: Record<string, unknown>,
) {
  try {
    await admin.from("audit_log").insert({
      acao,
      modulo: "rh",
      descricao: String(descricao || acao).slice(0, 500),
      usuario_id: who.usuarioId || "",
      usuario_nome: who.usuarioNome || "",
      usuario_perfil: who.perfil || "",
      dados_extra: extra || null,
      data_hora: new Date().toISOString(),
    });
  } catch {
    /* auditoria não derruba o fluxo */
  }
}
