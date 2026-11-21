-- ============================================================
-- ROTINAS AUTOMÁTICAS (pg_cron) DE UM AMBIENTE
-- Agenda as 4 rotinas do app num banco Supabase:
--   whatsapp-messages   a cada 5 min   → <APP_URL>/api/cron/messages
--   payments-reconcile  todo dia 9h UTC → <APP_URL>/api/cron/payments
--   payments-creating   a cada 15 min  → <APP_URL>/api/cron/payments?scope=creating
--   expenses-recurring  todo dia 9h UTC → gera as despesas recorrentes no próprio banco
--
-- Como aplicar (uma vez em cada projeto: homologação e produção):
--   1. Supabase Dashboard > Database > Extensions: ative pg_cron e pg_net.
--   2. Troque os dois valores abaixo pelos do ambiente:
--        homologação: https://homolog.sistemadental.com.br
--        produção:    https://app.sistemadental.com.br
--      e o CRON_SECRET igual ao configurado no app desse ambiente (Coolify).
--   3. SQL Editor > New query > cole este arquivo > Run.
-- Pode rodar mais de uma vez: cada rotina é removida e recriada.
--
-- Conferir:  SELECT jobname, schedule, active FROM cron.job;
-- Histórico: SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
-- ============================================================

DO $do$
DECLARE
  -- ▼▼▼ preencha aqui ▼▼▼
  v_app_url TEXT := 'https://homolog.sistemadental.com.br';
  v_secret  TEXT := 'COLE-AQUI-O-CRON_SECRET';
  -- ▲▲▲ preencha aqui ▲▲▲
  v_job     TEXT;
BEGIN
  IF v_secret = 'COLE-AQUI-O-CRON_SECRET' THEN
    RAISE EXCEPTION 'Preencha v_app_url e v_secret antes de rodar.';
  END IF;

  FOREACH v_job IN ARRAY ARRAY['whatsapp-messages', 'payments-reconcile', 'payments-creating', 'expenses-recurring'] LOOP
    PERFORM cron.unschedule(v_job) WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_job);
  END LOOP;

  PERFORM cron.schedule('whatsapp-messages', '*/5 * * * *', format($sql$
    SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object('Authorization', %L),
      timeout_milliseconds := 60000
    )$sql$, v_app_url || '/api/cron/messages', 'Bearer ' || v_secret));

  PERFORM cron.schedule('payments-reconcile', '0 9 * * *', format($sql$
    SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object('Authorization', %L),
      timeout_milliseconds := 60000
    )$sql$, v_app_url || '/api/cron/payments', 'Bearer ' || v_secret));

  PERFORM cron.schedule('payments-creating', '*/15 * * * *', format($sql$
    SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object('Authorization', %L),
      timeout_milliseconds := 60000
    )$sql$, v_app_url || '/api/cron/payments?scope=creating', 'Bearer ' || v_secret));

  PERFORM cron.schedule('expenses-recurring', '0 9 * * *',
    $sql$SELECT public.generate_recurring_expenses(id) FROM clinics$sql$);
END
$do$;

SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;
