-- =====================================================================
-- CORREÇÃO PONTUAL — Dedup do óculos SPECTRA 2000 CA 6136 (CAMACAM/Matriz)
-- =====================================================================
-- Confirmado com o usuário: 60 unidades FÍSICAS (1 lote real). As entradas
-- de +200 e +100 foram duplicações do MESMO recebimento, cadastradas em
-- itens de catálogo diferentes (havia 4 itens para o mesmo óculos).
--
-- Estado atual lido do banco em 17/09/2026:
--   Catálogo (itens_catalogo):
--     c69c6c0d  OCULOS DE PROTEÇÃO SPECTRA 2000 CA 6136   (entrada +100 fantasma)
--     90492b78  OCULOS DE PROTEÇÃO SPECTRA 2000 CA 6136   (entrada +60 REAL)  <- MANTER
--     a79c6cc6  ÓCULOS DE SEGURANÇA SPECTRA 2000 CA6136    (entrada +200 fantasma)
--     0bfee3a5  ÓCULOS DE SEGURANÇA CA6136 SPECTRAL 2000
--   Estoque (estoque):
--     a38b0533  OCULOS DE PROTEÇÃO ...   saldo 60   <- CORRETO (manter)
--     9a72445c  ÓCULOS DE SEGURANÇA ...  saldo 200  <- zerar
--   Movimentos (movimentacoes_itens):
--     7ca0a745  item 90492b78  entrada +60   10/09  <- REAL (manter)
--     678e032b  item c69c6c0d  entrada +100  08/09  <- fantasma (soft-delete)
--     6b331150  item a79c6cc6  entrada +200  08/09  <- fantasma (soft-delete)
--     86ba0a62  item 90492b78  ajuste ESTORNO_ENTRADA +60  <- já revertido (deleted_at)
--
-- Resultado alvo: 1 item ativo (90492b78) com saldo 60; demais itens
-- inativados; linha SEGURANÇA zerada; relatório passa a mostrar só +60.
--
-- SQL MANUAL — revisar e rodar no Supabase. NÃO executado pelo ERP.
-- Sem DELETE físico (soft-delete via deleted_at + ativo=false). Reversível.
-- Rode dentro da transação; se a conferência final não bater, use ROLLBACK.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0) CONFERÊNCIA ANTES (opcional — rode e confira que bate com o cabeçalho)
-- ---------------------------------------------------------------------
-- select id, nome, ativo from itens_catalogo where nome ilike '%SPECTRA%';
-- select id, nome, saldo, deposito_id from estoque where nome ilike '%SPECTRA%';
-- select id, item_id, tipo_mov, quantidade, motivo, data_mov, deleted_at
--   from movimentacoes_itens
--  where item_id in (
--    'c69c6c0d-e971-478f-ac80-99a1ca3bc94d','90492b78-98d9-429e-baf1-9559089bdb8d',
--    'a79c6cc6-87c9-4fdf-86e0-c435f72284a1','0bfee3a5-b3a2-431b-8d5e-5fae26eb7b4c')
--  order by data_mov;

-- ---------------------------------------------------------------------
-- 1) Zerar o saldo físico da linha fantasma "ÓCULOS DE SEGURANÇA" (200 -> 0)
-- ---------------------------------------------------------------------
update estoque
   set saldo = 0
 where id = '9a72445c-e503-45c9-bcf4-eee8a87350fb'
   and saldo = 200;   -- guarda: só zera se ainda estiver em 200

-- ---------------------------------------------------------------------
-- 2) Garantir o saldo correto da linha canônica "OCULOS DE PROTEÇÃO" = 60
--    (já deve estar 60; idempotente)
-- ---------------------------------------------------------------------
update estoque
   set saldo = 60
 where id = 'a38b0533-3ddb-4ca8-a340-ad7f392dd5a4';

-- ---------------------------------------------------------------------
-- 3) Soft-delete dos movimentos fantasma (+200 e +100 do mesmo recebimento)
--    Mantém a entrada real +60 (7ca0a745) e o estorno já revertido (86ba0a62).
-- ---------------------------------------------------------------------
update movimentacoes_itens
   set deleted_at = now(),
       obs = coalesce(obs,'') || ' | DEDUP CA6136 (17/09/2026): entrada duplicada do mesmo recebimento; fisico=60.'
 where id in (
   '6b331150-a58f-4b52-9b2c-9428eef9aa99',  -- +200 (ÓCULOS DE SEGURANÇA)
   '678e032b-7b72-499e-954c-ccab33a552e4'   -- +100 (OCULOS DE PROTEÇÃO c69c6c0d)
 )
   and deleted_at is null;

-- ---------------------------------------------------------------------
-- 4) Inativar os 3 itens de catálogo duplicados (mantém 90492b78 ativo)
--    ativo=false preserva o histórico e não quebra referências por id.
-- ---------------------------------------------------------------------
update itens_catalogo
   set ativo = false
 where id in (
   'c69c6c0d-e971-478f-ac80-99a1ca3bc94d',  -- PROTEÇÃO duplicado (só tinha +100 fantasma)
   'a79c6cc6-87c9-4fdf-86e0-c435f72284a1',  -- SEGURANÇA
   '0bfee3a5-b3a2-431b-8d5e-5fae26eb7b4c'   -- SEGURANÇA / SPECTRAL
 );

-- ---------------------------------------------------------------------
-- 5) CONFERÊNCIA FINAL — esperado:
--    - itens_catalogo: só 90492b78 com ativo=true entre os SPECTRA
--    - estoque: PROTEÇÃO (a38b0533) saldo 60 ; SEGURANÇA (9a72445c) saldo 0
--    - movimentacoes_itens ativos (deleted_at is null): apenas o +60 (7ca0a745)
-- ---------------------------------------------------------------------
-- select id, nome, ativo from itens_catalogo where nome ilike '%SPECTRA%';
-- select id, nome, saldo from estoque where nome ilike '%SPECTRA%';
-- select id, item_id, tipo_mov, quantidade, deleted_at from movimentacoes_itens
--   where item_id in ('c69c6c0d-e971-478f-ac80-99a1ca3bc94d','90492b78-98d9-429e-baf1-9559089bdb8d',
--     'a79c6cc6-87c9-4fdf-86e0-c435f72284a1','0bfee3a5-b3a2-431b-8d5e-5fae26eb7b4c') order by data_mov;

commit;
-- Se algo não bater na conferência, troque o COMMIT acima por:  rollback;

-- =====================================================================
-- REVERSÃO (se precisar desfazer tudo depois do commit):
--   update estoque set saldo=200 where id='9a72445c-e503-45c9-bcf4-eee8a87350fb';
--   update movimentacoes_itens set deleted_at=null
--     where id in ('6b331150-a58f-4b52-9b2c-9428eef9aa99','678e032b-7b72-499e-954c-ccab33a552e4');
--   update itens_catalogo set ativo=true
--     where id in ('c69c6c0d-e971-478f-ac80-99a1ca3bc94d','a79c6cc6-87c9-4fdf-86e0-c435f72284a1','0bfee3a5-b3a2-431b-8d5e-5fae26eb7b4c');
-- =====================================================================
