-- RH Contratação — vários arquivos no mesmo item do kit
-- Idempotente. Mantém arquivo_url/arquivo_nome como arquivo principal;
-- os demais ficam em arquivos_extras: [{url, nome, em, por, ia_item_id?, origem?}].

ALTER TABLE public.rh_contratacao_documentos
  ADD COLUMN IF NOT EXISTS arquivos_extras jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.rh_contratacao_documentos.arquivos_extras IS
  'Arquivos adicionais do item do kit (além de arquivo_url). Lista JSON de {url, nome, em, por, ia_item_id, origem}.';

NOTIFY pgrst, 'reload schema';
