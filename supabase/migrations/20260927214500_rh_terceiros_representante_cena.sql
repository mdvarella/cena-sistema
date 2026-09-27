-- RH-TERCEIROS-4 — representante da contratante CENA
-- Mestre em rh_empresa_representantes (N por empregadora).
-- Snapshot na própria rh_contratacao_partes_pj com prefixo contratante_*
-- (não reutiliza representante_* da CONTRATADA).
-- Idempotente. Não altera CTR-PJ nem inventa pessoas.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.cena_rh_cpf_somente_digitos(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '');
$$;

CREATE OR REPLACE FUNCTION public.cena_rh_cpf_valido(p text)
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
  d := public.cena_rh_cpf_somente_digitos(p);
  IF d IS NULL OR length(d) <> 11 THEN
    RETURN FALSE;
  END IF;
  IF d ~ '^(\d)\1{10}$' THEN
    RETURN FALSE;
  END IF;
  n := ARRAY(SELECT (substr(d, g, 1))::int FROM generate_series(1, 11) g);
  s := 0;
  FOR i IN 1..9 LOOP
    s := s + n[i] * (11 - i);
  END LOOP;
  dv1 := (s * 10) % 11;
  IF dv1 = 10 THEN dv1 := 0; END IF;
  IF n[10] <> dv1 THEN
    RETURN FALSE;
  END IF;
  s := 0;
  FOR i IN 1..10 LOOP
    s := s + n[i] * (12 - i);
  END LOOP;
  dv2 := (s * 10) % 11;
  IF dv2 = 10 THEN dv2 := 0; END IF;
  RETURN n[11] = dv2;
END;
$$;

REVOKE ALL ON FUNCTION public.cena_rh_cpf_somente_digitos(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cena_rh_cpf_valido(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cena_rh_cpf_somente_digitos(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cena_rh_cpf_valido(text) TO authenticated;

CREATE TABLE IF NOT EXISTS public.rh_empresa_representantes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_empregadora_id uuid NOT NULL REFERENCES public.rh_empresas_empregadoras(id) ON DELETE CASCADE,
  nome text NOT NULL,
  cpf text,
  rg text,
  nacionalidade text,
  estado_civil text,
  qualificacao text,
  email text,
  telefone text,
  padrao_contratos_pj boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  criado_por text,
  atualizado_por text,
  CONSTRAINT rh_empresa_representantes_cpf_chk
    CHECK (cpf IS NULL OR (cpf ~ '^\d{11}$' AND public.cena_rh_cpf_valido(cpf)))
);

CREATE INDEX IF NOT EXISTS rh_empresa_representantes_emp_idx
  ON public.rh_empresa_representantes (empresa_empregadora_id)
  WHERE ativo IS TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS rh_empresa_representantes_emp_cpf_uidx
  ON public.rh_empresa_representantes (empresa_empregadora_id, cpf)
  WHERE cpf IS NOT NULL AND ativo IS TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS rh_empresa_representantes_padrao_pj_uidx
  ON public.rh_empresa_representantes (empresa_empregadora_id)
  WHERE padrao_contratos_pj IS TRUE AND ativo IS TRUE;

DROP TRIGGER IF EXISTS trg_rh_empresa_representantes_touch ON public.rh_empresa_representantes;
CREATE TRIGGER trg_rh_empresa_representantes_touch
  BEFORE UPDATE ON public.rh_empresa_representantes
  FOR EACH ROW EXECUTE FUNCTION public.cena_rh_touch_atualizado_em();

ALTER TABLE public.rh_contratacao_partes_pj
  ADD COLUMN IF NOT EXISTS contratante_representante_id uuid REFERENCES public.rh_empresa_representantes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contratante_representante_nome text,
  ADD COLUMN IF NOT EXISTS contratante_representante_cpf text,
  ADD COLUMN IF NOT EXISTS contratante_representante_rg text,
  ADD COLUMN IF NOT EXISTS contratante_representante_nacionalidade text,
  ADD COLUMN IF NOT EXISTS contratante_representante_estado_civil text,
  ADD COLUMN IF NOT EXISTS contratante_representante_qualificacao text,
  ADD COLUMN IF NOT EXISTS contratante_representante_email text,
  ADD COLUMN IF NOT EXISTS contratante_representante_telefone text,
  ADD COLUMN IF NOT EXISTS contratante_representante_congelado_em timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rh_contratacao_partes_pj_contratante_cpf_chk'
  ) THEN
    ALTER TABLE public.rh_contratacao_partes_pj
      ADD CONSTRAINT rh_contratacao_partes_pj_contratante_cpf_chk
      CHECK (
        contratante_representante_cpf IS NULL
        OR (contratante_representante_cpf ~ '^\d{11}$' AND public.cena_rh_cpf_valido(contratante_representante_cpf))
      );
  END IF;
END $$;

ALTER TABLE public.rh_empresa_representantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_empresa_representantes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rh_empresa_representantes FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rh_empresa_representantes TO authenticated;
GRANT ALL ON TABLE public.rh_empresa_representantes TO service_role;

DROP POLICY IF EXISTS rh_empresa_representantes_all_rh ON public.rh_empresa_representantes;
CREATE POLICY rh_empresa_representantes_all_rh
  ON public.rh_empresa_representantes
  FOR ALL
  TO authenticated
  USING (public.cena_rh_pode_dados_pj())
  WITH CHECK (public.cena_rh_pode_dados_pj());
