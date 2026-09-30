-- Portaria 8.1.179 — troca de veículo/escala na Programação chega na Portaria na hora.
-- Coloca public.prog_veiculos_dia e public.composicao_dia na publicação supabase_realtime.
-- Não altera dados, colunas nem RLS: o Realtime só entrega linhas que o usuário já pode ler.
-- Idempotente: tabela que já estiver na publicação é mantida como está.
-- Fail-closed: sem a publicação ou sem as tabelas, PARA sem alterar nada.
-- Sem esta migration a Portaria continua atualizando pelo polling (20s).

BEGIN;

DO $$
DECLARE
  v_tab text;
  v_faltando text[] := ARRAY[]::text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE EXCEPTION 'PARAR: publicação supabase_realtime não existe. Nada foi alterado.';
  END IF;

  FOREACH v_tab IN ARRAY ARRAY['prog_veiculos_dia', 'composicao_dia'] LOOP
    IF to_regclass('public.' || v_tab) IS NULL THEN
      v_faltando := v_faltando || v_tab;
    END IF;
  END LOOP;
  IF array_length(v_faltando, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'PARAR: tabela(s) inexistente(s): %. Nada foi alterado.', array_to_string(v_faltando, ', ');
  END IF;

  FOREACH v_tab IN ARRAY ARRAY['prog_veiculos_dia', 'composicao_dia'] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = v_tab
    ) THEN
      RAISE NOTICE 'public.% já estava no Realtime', v_tab;
    ELSE
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_tab);
      RAISE NOTICE 'public.% incluída no Realtime', v_tab;
    END IF;
  END LOOP;
END $$;

COMMIT;

-- Conferência:
-- SELECT tablename FROM pg_publication_tables
--  WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
--    AND tablename IN ('prog_veiculos_dia', 'composicao_dia');

-- Para desfazer
-- ALTER PUBLICATION supabase_realtime DROP TABLE public.prog_veiculos_dia, public.composicao_dia;
