-- FORNECEDORES — remove o acesso da chave anon (pública no navegador)
-- Aplicar ANTES da carga real da sincronização com o ERP (20261006190000_fornecedores_erp_sync.sql):
-- a tabela passa a ter ~2.080 cadastros do ERP com CPF, e-mail e telefone.
-- Remove as policies "Acesso total" (anon + authenticated) e fase2d_anon_all, e o GRANT de anon na tabela.
-- authenticated continua com acesso pela policy fase2d_authenticated_all (ou outra ALL para authenticated).
-- Efeito: quem entra só pelo login MD5, sem sessão Supabase Auth, deixa de ler e gravar fornecedores.
--
-- ANTES de aplicar, guarde as definições atuais (para desfazer, se preciso):
-- SELECT policyname, permissive, roles, cmd, qual, with_check
--   FROM pg_policies WHERE schemaname = 'public' AND tablename = 'fornecedores' ORDER BY policyname;

DO $$
DECLARE
  v_outras text;
BEGIN
  IF to_regclass('public.fornecedores') IS NULL THEN
    RAISE EXCEPTION 'tabela public.fornecedores não existe';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'fornecedores'
       AND policyname NOT IN ('Acesso total', 'fase2d_anon_all')
       AND permissive = 'PERMISSIVE' AND cmd = 'ALL'
       AND 'authenticated'::name = ANY (roles)
  ) THEN
    RAISE EXCEPTION 'fornecedores sem outra policy ALL para authenticated: remover as policies de anon deixaria o sistema sem acesso';
  END IF;

  SELECT string_agg(policyname, ', ' ORDER BY policyname) INTO v_outras
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'fornecedores'
     AND policyname NOT IN ('Acesso total', 'fase2d_anon_all')
     AND ('anon'::name = ANY (roles) OR 'public'::name = ANY (roles));
  IF v_outras IS NOT NULL THEN
    RAISE EXCEPTION 'fornecedores tem outras policies para anon/public (%): revisar antes de aplicar', v_outras;
  END IF;
END $$;

DROP POLICY IF EXISTS "Acesso total" ON public.fornecedores;
DROP POLICY IF EXISTS fase2d_anon_all ON public.fornecedores;

ALTER TABLE public.fornecedores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.fornecedores FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.fornecedores TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'fornecedores'
                AND ('anon'::name = ANY (roles) OR 'public'::name = ANY (roles))) THEN
    RAISE EXCEPTION 'ainda há policy de fornecedores para anon/public';
  END IF;
  IF has_table_privilege('anon', 'public.fornecedores', 'SELECT')
     OR has_table_privilege('anon', 'public.fornecedores', 'INSERT')
     OR has_table_privilege('anon', 'public.fornecedores', 'UPDATE')
     OR has_table_privilege('anon', 'public.fornecedores', 'DELETE') THEN
    RAISE EXCEPTION 'anon ainda tem privilégio em public.fornecedores (herdado de outro papel?)';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- Validação
-- SELECT policyname, roles, cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = 'fornecedores';
--   esperado: só fase2d_authenticated_all (ALL, authenticated)
-- SELECT has_table_privilege('anon', 'public.fornecedores', 'SELECT') AS anon_le;   -- esperado: false

-- Para desfazer (use as definições guardadas antes de aplicar; abaixo, o formato com USING/CHECK true)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.fornecedores TO anon;
-- CREATE POLICY "Acesso total" ON public.fornecedores FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
-- CREATE POLICY fase2d_anon_all ON public.fornecedores FOR ALL TO anon USING (true) WITH CHECK (true);
-- NOTIFY pgrst, 'reload schema';
