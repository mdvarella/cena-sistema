-- sql_colaborador_credenciais_rfid_core_1_fix_permissao.sql
-- Hotfix 8.1.106 — RFID vincular.
-- 1) 403 RFID_SEM_PERMISSAO: casa usuário por auth_user_id OU e-mail do JWT.
-- 2) 400 42804: audit_log.dados_extra é jsonb (não text).
-- Aplicar no SQL Editor do Supabase (NÃO pelo ERP). Idempotente.

CREATE OR REPLACE FUNCTION public.cena_rfid_usuario_sessao()
RETURNS public.usuarios_sistema
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_us public.usuarios_sistema%ROWTYPE;
  v_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_us
  FROM public.usuarios_sistema us
  WHERE us.auth_user_id = auth.uid()
    AND us.ativo IS TRUE
    AND us.deleted_at IS NULL
  LIMIT 1;
  IF v_us.id IS NOT NULL THEN
    RETURN v_us;
  END IF;

  v_email := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  IF v_email = '' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_us
  FROM public.usuarios_sistema us
  WHERE lower(btrim(us.email)) = v_email
    AND us.ativo IS TRUE
    AND us.deleted_at IS NULL
  ORDER BY CASE WHEN us.auth_user_id = auth.uid() THEN 0 WHEN us.auth_user_id IS NULL THEN 1 ELSE 2 END
  LIMIT 1;
  RETURN v_us;
END;
$$;

CREATE OR REPLACE FUNCTION public.cena_rfid_pode_cadastrar()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_us public.usuarios_sistema%ROWTYPE;
BEGIN
  v_us := public.cena_rfid_usuario_sessao();
  RETURN v_us.id IS NOT NULL
    AND lower(btrim(coalesce(v_us.perfil, ''))) IN ('admin','diretoria','dp','rh','gestor');
END;
$$;

CREATE OR REPLACE FUNCTION public.cena_rfid_audit_registrar(
  p_acao text,
  p_descricao text,
  p_dados_extra jsonb,
  p_sessao_id text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_us public.usuarios_sistema%ROWTYPE;
BEGIN
  IF p_acao IS NULL OR btrim(p_acao) = '' THEN
    RAISE EXCEPTION 'Auditoria RFID: ação obrigatória'
      USING ERRCODE = '22023', HINT = 'RFID_AUDIT_ACAO';
  END IF;

  v_us := public.cena_rfid_usuario_sessao();

  INSERT INTO public.audit_log (
    acao,
    modulo,
    descricao,
    usuario_id,
    usuario_nome,
    usuario_perfil,
    dados_extra,
    data_hora,
    sessao_id
  ) VALUES (
    p_acao,
    'rh',
    coalesce(p_descricao, p_acao),
    coalesce(v_us.id::text, auth.uid()::text, ''),
    coalesce(v_us.nome, ''),
    coalesce(v_us.perfil, ''),
    jsonb_strip_nulls(coalesce(p_dados_extra, '{}'::jsonb)),
    now(),
    coalesce(p_sessao_id, 'rpc:rfid')
  );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auditoria RFID: falha ao gravar audit_log'
      USING ERRCODE = 'P0001', HINT = 'RFID_AUDIT_FALHOU';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.cena_rfid_usuario_sessao() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cena_rfid_pode_cadastrar() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cena_rfid_audit_registrar(text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cena_rfid_pode_cadastrar() TO authenticated;
