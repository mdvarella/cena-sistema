-- AGENDAMENTO DIÁRIO — sincronização de fornecedores ERP CENA (03:00 de Brasília = 06:00 UTC)
-- Requer 20261006190000_fornecedores_erp_sync.sql e dois segredos no Vault; habilita pg_cron e pg_net se faltarem.
-- Segredos no Vault
-- (Supabase > Project Settings > Vault), criados pelo painel — nunca neste arquivo:
--   erp_sync_edge_url    = https://<ref>.supabase.co/functions/v1/erp-fornecedores-sync
--   erp_sync_cron_secret = o mesmo valor do secret ERP_SYNC_CRON_SECRET da Edge Function
-- O job lê os dois segredos na hora de rodar: nada sensível fica gravado em cron.job.
-- Idempotente: recria o job com o mesmo nome.

-- ── 0. Pré-condições ─────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.fn_erp_sync_iniciar(text, text, text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'aplique antes 20261006190000_fornecedores_erp_sync.sql';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    RAISE EXCEPTION 'extensão pg_cron indisponível neste projeto';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    RAISE EXCEPTION 'extensão pg_net indisponível neste projeto';
  END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE EXCEPTION 'Vault indisponível (vault.decrypted_secrets)';
  END IF;
  IF (SELECT count(*) FROM vault.decrypted_secrets
      WHERE name IN ('erp_sync_edge_url', 'erp_sync_cron_secret')
        AND coalesce(decrypted_secret, '') <> '') <> 2 THEN
    RAISE EXCEPTION 'crie no Vault os segredos erp_sync_edge_url e erp_sync_cron_secret antes de agendar';
  END IF;
  IF (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'erp_sync_edge_url')
     !~ '^https://[a-z0-9-]+\.supabase\.co/functions/v1/erp-fornecedores-sync$' THEN
    RAISE EXCEPTION 'erp_sync_edge_url deve ser https://<ref>.supabase.co/functions/v1/erp-fornecedores-sync';
  END IF;
  IF length((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'erp_sync_cron_secret')) < 32 THEN
    RAISE EXCEPTION 'erp_sync_cron_secret precisa de pelo menos 32 caracteres';
  END IF;
END $$;

-- ── 1. Extensões (esquemas padrão do Supabase) ───────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ── 2. Job ───────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'erp-fornecedores-sync-diario') THEN
    PERFORM cron.unschedule('erp-fornecedores-sync-diario');
  END IF;
END $$;

SELECT cron.schedule(
  'erp-fornecedores-sync-diario',
  '0 6 * * *',
  $job$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'erp_sync_edge_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'erp_sync_cron_secret')),
    body := '{"modo":"auto"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);

-- Validação
-- SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'erp-fornecedores-sync-diario';
-- SELECT status, return_message, start_time FROM cron.job_run_details
--  WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'erp-fornecedores-sync-diario')
--  ORDER BY start_time DESC LIMIT 5;
-- SELECT status, modo, disparo, lidos, inseridos, atualizados, inalterados, inativados, erro, iniciado_em
--   FROM public.erp_sync_execucoes ORDER BY iniciado_em DESC LIMIT 5;

-- Para desfazer (as extensões ficam: outros jobs podem usá-las)
-- SELECT cron.unschedule('erp-fornecedores-sync-diario');
