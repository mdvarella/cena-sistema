-- ERP CENA 8.1.224 — Portaria: dados da leitura do KM na saída (OCR e confirmação).
--
-- Antes desta migration a tela já coletava estes dados, mas a tabela não tinha as colunas: cada saída gerava
-- PATCHes com 400 (PGRST204) e o dado ficava só no aparelho. Não há outra estrutura no ERP que guarde isso
-- (conferido em 17/10/2026: nenhuma coluna *ocr*/km_confirmado* em public; audit_log só registra PATCH bem-sucedido).
--
-- A partir da 8.1.224 o app detecta as colunas pela linha devolvida no insert:
--   * sem elas  → o OCR vai junto no pacote de fotos (foto_carga_saida_b64 = {"v":1,...,"km_ocr":{...}});
--   * com elas  → grava direto nas colunas, no mesmo PATCH das fotos.
-- O passo 2 copia para as colunas o OCR que tiver ficado no pacote entre a publicação e esta migration.
--
-- Idempotente e só aditiva: não apaga nada, não altera o pacote de fotos, não mexe em KM, status ou retorno.

begin;

-- 1. Colunas
alter table public.frotas_portaria_saidas
  add column if not exists km_lido_ocr       numeric,
  add column if not exists km_ocr_confianca  numeric,
  add column if not exists km_confirmado_por text,
  add column if not exists km_confirmado_em  timestamptz;

comment on column public.frotas_portaria_saidas.km_lido_ocr is
  'KM lido automaticamente da foto do hodômetro na saída (OCR). Nulo quando digitado sem leitura.';
comment on column public.frotas_portaria_saidas.km_ocr_confianca is
  'Confiança da leitura do OCR (0 a 1). 0 = leitura falhou e o KM foi digitado.';
comment on column public.frotas_portaria_saidas.km_confirmado_por is
  'Porteiro que confirmou o KM da saída na tela de liberação.';
comment on column public.frotas_portaria_saidas.km_confirmado_em is
  'Data e hora em que o KM da saída foi confirmado.';

-- 2. Recupera o OCR que ficou no pacote de fotos (só preenche colunas vazias; JSON inválido é ignorado)
update public.frotas_portaria_saidas s
   set km_lido_ocr = coalesce(s.km_lido_ocr,
         case when pg_input_is_valid(x.o->>'km_lido_ocr', 'numeric') then (x.o->>'km_lido_ocr')::numeric end),
       km_ocr_confianca = coalesce(s.km_ocr_confianca,
         case when pg_input_is_valid(x.o->>'km_ocr_confianca', 'numeric') then (x.o->>'km_ocr_confianca')::numeric end),
       km_confirmado_por = coalesce(s.km_confirmado_por, nullif(x.o->>'km_confirmado_por', '')),
       km_confirmado_em = coalesce(s.km_confirmado_em,
         case when pg_input_is_valid(x.o->>'km_confirmado_em', 'timestamptz') then (x.o->>'km_confirmado_em')::timestamptz end)
  from (
    select id,
           case when pg_input_is_valid(foto_carga_saida_b64, 'jsonb')
                then (foto_carga_saida_b64::jsonb)->'km_ocr' end as o
      from public.frotas_portaria_saidas
     where left(foto_carga_saida_b64, 1) = '{'
       and position('"km_ocr"' in foto_carga_saida_b64) > 0
       and pg_input_is_valid(foto_carga_saida_b64, 'jsonb')
  ) x
 where s.id = x.id
   and jsonb_typeof(x.o) = 'object'
   and (s.km_lido_ocr is null or s.km_ocr_confianca is null or s.km_confirmado_por is null or s.km_confirmado_em is null);

commit;

-- 3. PostgREST passa a enxergar as colunas novas sem esperar o recarregamento automático
notify pgrst, 'reload schema';

-- Conferência (somente leitura):
-- select column_name, data_type from information_schema.columns
--  where table_schema='public' and table_name='frotas_portaria_saidas'
--    and column_name in ('km_lido_ocr','km_ocr_confianca','km_confirmado_por','km_confirmado_em');
--
-- Reversão (somente com autorização; perde os dados de OCR gravados):
-- alter table public.frotas_portaria_saidas
--   drop column if exists km_lido_ocr, drop column if exists km_ocr_confianca,
--   drop column if exists km_confirmado_por, drop column if exists km_confirmado_em;
