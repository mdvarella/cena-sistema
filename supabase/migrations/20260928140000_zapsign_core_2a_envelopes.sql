-- ZAPSIGN-CORE-2A — envelopes: provider ZAPSIGN + metadata JSONB.
-- Não altera registros DocuSign existentes. Não db reset.

ALTER TABLE public.rh_documento_envelopes
  ADD COLUMN IF NOT EXISTS metadata jsonb;

COMMENT ON COLUMN public.rh_documento_envelopes.metadata IS
  'Metadados de assinatura (provider, external_id, pdf_input_hash, sandbox). Sem API token, CPF ou payload integral.';

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'rh_documento_envelopes'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%provider%'
      AND pg_get_constraintdef(c.oid) NOT ILIKE '%ZAPSIGN%'
  LOOP
    EXECUTE format('ALTER TABLE public.rh_documento_envelopes DROP CONSTRAINT %I', r.conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'rh_documento_envelopes'
      AND c.conname = 'rh_documento_envelopes_provider_chk'
  ) THEN
    ALTER TABLE public.rh_documento_envelopes
      ADD CONSTRAINT rh_documento_envelopes_provider_chk
      CHECK (provider IN ('DOCUSIGN', 'ZAPSIGN'));
  END IF;
END $$;
