-- 00 — criar staging (rode 1 vez)
-- Depois: 01.sql ... 14.sql
-- Por ultimo: 99_aplicar.sql
-- Total linhas: 5427 | soma 41159.75

DROP TABLE IF EXISTS public._stg_ped_ago26;
CREATE TABLE public._stg_ped_ago26 (
  data_hora timestamptz,
  placa text,
  placa_norm text,
  centro_custo text,
  tipo text,
  estabelecimento text,
  valor numeric,
  status text,
  origem text,
  tipo_origem text,
  hash text
);
