-- RH-TERCEIROS-5D-IA.1 — storage privado de documentos da contratada PJ
-- NÃO altera o bucket público cena-docs nem fluxos CLT.
-- Idempotente.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'cena-rh-pj-documentos',
  'cena-rh-pj-documentos',
  false,
  15728640,
  ARRAY['application/pdf','image/jpeg','image/jpg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

ALTER TABLE public.rh_documento_ia_itens
  ADD COLUMN IF NOT EXISTS storage_bucket text,
  ADD COLUMN IF NOT EXISTS storage_path text;

COMMENT ON COLUMN public.rh_documento_ia_itens.storage_bucket IS
  'Bucket de staging. Documentos PJ usam cena-rh-pj-documentos (privado). Não persistir signed URL.';
COMMENT ON COLUMN public.rh_documento_ia_itens.storage_path IS
  'Path interno no bucket. Identidade permanente do arquivo (junto com hash_sha256).';

DROP POLICY IF EXISTS rh_pj_docs_select ON storage.objects;
DROP POLICY IF EXISTS rh_pj_docs_insert ON storage.objects;
DROP POLICY IF EXISTS rh_pj_docs_update ON storage.objects;
DROP POLICY IF EXISTS rh_pj_docs_delete ON storage.objects;

CREATE POLICY rh_pj_docs_select
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'cena-rh-pj-documentos'
    AND public.cena_rh_pode_dados_pj()
  );

CREATE POLICY rh_pj_docs_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'cena-rh-pj-documentos'
    AND public.cena_rh_pode_dados_pj()
  );

CREATE POLICY rh_pj_docs_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'cena-rh-pj-documentos'
    AND public.cena_rh_pode_dados_pj()
  )
  WITH CHECK (
    bucket_id = 'cena-rh-pj-documentos'
    AND public.cena_rh_pode_dados_pj()
  );

CREATE POLICY rh_pj_docs_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'cena-rh-pj-documentos'
    AND public.cena_rh_pode_dados_pj()
  );
