-- RH-TERCEIROS-3 — modelo de dados da contratação PJ
-- Idempotente. Não altera rh_contratacoes, colaboradores, CTR-PJ nem assinatura.
-- Cadastro mestre (reutilizável por CNPJ) + snapshot 1:1 por contratação.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Permissão RH/administrativo (anon sem acesso) ────────────────────────
CREATE OR REPLACE FUNCTION public.cena_rh_pode_dados_pj()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text;
  v_perfil text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;
  v_email := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  SELECT lower(btrim(coalesce(us.perfil, '')))
    INTO v_perfil
  FROM public.usuarios_sistema us
  WHERE us.ativo IS TRUE
    AND (us.deleted_at IS NULL)
    AND (
      us.auth_user_id = auth.uid()
      OR (v_email <> '' AND lower(btrim(us.email)) = v_email)
    )
  ORDER BY CASE WHEN us.auth_user_id = auth.uid() THEN 0 ELSE 1 END
  LIMIT 1;
  RETURN v_perfil IN ('admin','diretoria','dp','rh','gestor','administrativo');
END;
$$;

REVOKE ALL ON FUNCTION public.cena_rh_pode_dados_pj() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cena_rh_pode_dados_pj() TO authenticated;

CREATE OR REPLACE FUNCTION public.cena_rh_cnpj_somente_digitos(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '');
$$;

CREATE OR REPLACE FUNCTION public.cena_rh_cnpj_valido(p text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  d text;
  n int[];
  i int;
  s int;
  dv1 int;
  dv2 int;
BEGIN
  d := public.cena_rh_cnpj_somente_digitos(p);
  IF d IS NULL OR length(d) <> 14 THEN
    RETURN FALSE;
  END IF;
  IF d ~ '^(\d)\1{13}$' THEN
    RETURN FALSE;
  END IF;
  n := ARRAY(SELECT (substr(d, g, 1))::int FROM generate_series(1, 14) g);
  s := 0;
  FOR i IN 1..12 LOOP
    s := s + n[i] * (ARRAY[5,4,3,2,9,8,7,6,5,4,3,2])[i];
  END LOOP;
  dv1 := s % 11;
  dv1 := CASE WHEN dv1 < 2 THEN 0 ELSE 11 - dv1 END;
  IF n[13] <> dv1 THEN
    RETURN FALSE;
  END IF;
  s := 0;
  FOR i IN 1..13 LOOP
    s := s + n[i] * (ARRAY[6,5,4,3,2,9,8,7,6,5,4,3,2])[i];
  END LOOP;
  dv2 := s % 11;
  dv2 := CASE WHEN dv2 < 2 THEN 0 ELSE 11 - dv2 END;
  RETURN n[14] = dv2;
END;
$$;

REVOKE ALL ON FUNCTION public.cena_rh_cnpj_somente_digitos(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cena_rh_cnpj_valido(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cena_rh_cnpj_somente_digitos(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cena_rh_cnpj_valido(text) TO authenticated;

-- ── Cadastro mestre da PJ contratada (não é empregadora CENA) ────────────
CREATE TABLE IF NOT EXISTS public.rh_pessoas_juridicas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  razao_social text,
  nome_fantasia text,
  cnpj text,
  email text,
  telefone text,
  cep text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  uf text,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  criado_por text,
  atualizado_por text,
  CONSTRAINT rh_pessoas_juridicas_cnpj_digitos
    CHECK (cnpj IS NULL OR (cnpj ~ '^\d{14}$' AND public.cena_rh_cnpj_valido(cnpj))),
  CONSTRAINT rh_pessoas_juridicas_uf_chk
    CHECK (uf IS NULL OR uf ~ '^[A-Z]{2}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS rh_pessoas_juridicas_cnpj_uidx
  ON public.rh_pessoas_juridicas (cnpj)
  WHERE cnpj IS NOT NULL;

CREATE INDEX IF NOT EXISTS rh_pessoas_juridicas_razao_idx
  ON public.rh_pessoas_juridicas (razao_social);

-- ── Snapshot contratual + representante + instrumento (1 por processo) ───
CREATE TABLE IF NOT EXISTS public.rh_contratacao_partes_pj (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contratacao_id uuid NOT NULL REFERENCES public.rh_contratacoes(id) ON DELETE CASCADE,
  pessoa_juridica_id uuid REFERENCES public.rh_pessoas_juridicas(id) ON DELETE SET NULL,

  razao_social text,
  nome_fantasia text,
  cnpj text,
  email text,
  telefone text,
  cep text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  uf text,

  representante_nome text,
  representante_cpf text,
  representante_rg text,
  representante_nacionalidade text,
  representante_estado_civil text,
  representante_qualificacao text,
  representante_email text,
  representante_telefone text,
  representante_endereco text,

  numero_contrato text,
  objeto_contrato text,
  descricao_atividades text,
  valor_honorarios numeric(14,2),
  forma_pagamento text,
  data_inicio date,
  data_fim date,
  tipo_vigencia text,
  observacoes text,

  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  criado_por text,
  atualizado_por text,

  CONSTRAINT rh_contratacao_partes_pj_contratacao_uidx UNIQUE (contratacao_id),
  CONSTRAINT rh_contratacao_partes_pj_cnpj_chk
    CHECK (cnpj IS NULL OR (cnpj ~ '^\d{14}$' AND public.cena_rh_cnpj_valido(cnpj))),
  CONSTRAINT rh_contratacao_partes_pj_cpf_chk
    CHECK (representante_cpf IS NULL OR representante_cpf ~ '^\d{11}$'),
  CONSTRAINT rh_contratacao_partes_pj_uf_chk
    CHECK (uf IS NULL OR uf ~ '^[A-Z]{2}$'),
  CONSTRAINT rh_contratacao_partes_pj_vigencia_chk
    CHECK (tipo_vigencia IS NULL OR tipo_vigencia IN ('determinado','indeterminado'))
);

CREATE INDEX IF NOT EXISTS rh_contratacao_partes_pj_pj_idx
  ON public.rh_contratacao_partes_pj (pessoa_juridica_id);

CREATE OR REPLACE FUNCTION public.cena_rh_touch_atualizado_em()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rh_pessoas_juridicas_touch ON public.rh_pessoas_juridicas;
CREATE TRIGGER trg_rh_pessoas_juridicas_touch
  BEFORE UPDATE ON public.rh_pessoas_juridicas
  FOR EACH ROW EXECUTE FUNCTION public.cena_rh_touch_atualizado_em();

DROP TRIGGER IF EXISTS trg_rh_contratacao_partes_pj_touch ON public.rh_contratacao_partes_pj;
CREATE TRIGGER trg_rh_contratacao_partes_pj_touch
  BEFORE UPDATE ON public.rh_contratacao_partes_pj
  FOR EACH ROW EXECUTE FUNCTION public.cena_rh_touch_atualizado_em();

ALTER TABLE public.rh_pessoas_juridicas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_pessoas_juridicas FORCE ROW LEVEL SECURITY;
ALTER TABLE public.rh_contratacao_partes_pj ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_contratacao_partes_pj FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.rh_pessoas_juridicas FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.rh_contratacao_partes_pj FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rh_pessoas_juridicas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rh_contratacao_partes_pj TO authenticated;
GRANT ALL ON TABLE public.rh_pessoas_juridicas TO service_role;
GRANT ALL ON TABLE public.rh_contratacao_partes_pj TO service_role;

DROP POLICY IF EXISTS rh_pessoas_juridicas_all_rh ON public.rh_pessoas_juridicas;
CREATE POLICY rh_pessoas_juridicas_all_rh
  ON public.rh_pessoas_juridicas
  FOR ALL
  TO authenticated
  USING (public.cena_rh_pode_dados_pj())
  WITH CHECK (public.cena_rh_pode_dados_pj());

DROP POLICY IF EXISTS rh_contratacao_partes_pj_all_rh ON public.rh_contratacao_partes_pj;
CREATE POLICY rh_contratacao_partes_pj_all_rh
  ON public.rh_contratacao_partes_pj
  FOR ALL
  TO authenticated
  USING (public.cena_rh_pode_dados_pj())
  WITH CHECK (public.cena_rh_pode_dados_pj());
