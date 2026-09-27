-- RH-TERCEIROS-5B — data jurídica do instrumento PJ
-- Idempotente. Não altera CTR-PJ-CENA v1, não cria despesas/reembolsos,
-- não toca assinatura eletrônica nem cadastro mestre.

ALTER TABLE public.rh_contratacao_partes_pj
  ADD COLUMN IF NOT EXISTS data_instrumento date;

COMMENT ON COLUMN public.rh_contratacao_partes_pj.data_instrumento IS
  'Data jurídica/documental do instrumento PJ (DATA_INSTRUMENTO_CONTRATO). Distinta da data/hora da assinatura eletrônica futura.';
