-- 8.1.211 — Portaria: saída acompanhante (2ª equipe no mesmo caminhão compartilhado).
-- Aditiva e idempotente. Só acrescenta uma coluna opcional em frotas_portaria_saidas (NULL em todas as linhas atuais).
-- Não altera colunas existentes, prog_veiculos_dia, composicao_dia nem Programação TMA.
--
-- Modelo: a saída da equipe que sai junto (acompanhante) aponta para a saída principal (a que tem o KM).
--
-- Regras garantidas no banco (fail-closed):
--   • a acompanhante não tem KM (km_saida e km_retorno NULL): o trajeto conta uma vez só, na principal;
--   • a principal precisa existir, estar viva, em campo (sem retorno), com a MESMA placa e ser de OUTRA equipe;
--   • só um nível: acompanhante não pode ser principal de outra, e principal não vira acompanhante;
--   • no máximo 1 acompanhante viva por principal (= no máximo 2 equipes no veículo);
--   • retorno registrado na principal fecha a acompanhante no mesmo instante (status/data_retorno), sem KM.

-- ── Coluna ───────────────────────────────────────────────────────────────
ALTER TABLE public.frotas_portaria_saidas
  ADD COLUMN IF NOT EXISTS saida_principal_id uuid;

COMMENT ON COLUMN public.frotas_portaria_saidas.saida_principal_id IS
  'Saída principal (mesmo veículo, outra equipe) quando esta é a saída acompanhante. NULL = saída normal/principal. Acompanhante não tem KM.';

ALTER TABLE public.frotas_portaria_saidas DROP CONSTRAINT IF EXISTS frotas_portaria_saidas_saida_principal_fkey;
ALTER TABLE public.frotas_portaria_saidas ADD CONSTRAINT frotas_portaria_saidas_saida_principal_fkey
  FOREIGN KEY (saida_principal_id) REFERENCES public.frotas_portaria_saidas(id) ON DELETE SET NULL;

-- ── Restrições ───────────────────────────────────────────────────────────
ALTER TABLE public.frotas_portaria_saidas DROP CONSTRAINT IF EXISTS frotas_portaria_saidas_acomp_outra_chk;
ALTER TABLE public.frotas_portaria_saidas ADD CONSTRAINT frotas_portaria_saidas_acomp_outra_chk
  CHECK (saida_principal_id IS NULL OR saida_principal_id <> id);

ALTER TABLE public.frotas_portaria_saidas DROP CONSTRAINT IF EXISTS frotas_portaria_saidas_acomp_sem_km_chk;
ALTER TABLE public.frotas_portaria_saidas ADD CONSTRAINT frotas_portaria_saidas_acomp_sem_km_chk
  CHECK (saida_principal_id IS NULL OR (km_saida IS NULL AND km_retorno IS NULL));

CREATE UNIQUE INDEX IF NOT EXISTS frotas_portaria_saidas_acomp_uniq
  ON public.frotas_portaria_saidas (saida_principal_id)
  WHERE saida_principal_id IS NOT NULL AND deleted_at IS NULL;

-- ── Validação da acompanhante (antes de gravar) ──────────────────────────
CREATE OR REPLACE FUNCTION public.cena_portaria_saida_acomp_validar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  p          public.frotas_portaria_saidas%ROWTYPE;
  v_placa    text;
  v_placa_p  text;
  v_eq       text;
  v_eq_p     text;
BEGIN
  -- Esta linha é principal de alguém? Então não pode virar acompanhante.
  IF NEW.saida_principal_id IS NOT NULL AND NEW.deleted_at IS NULL AND EXISTS (
       SELECT 1 FROM public.frotas_portaria_saidas a
        WHERE a.saida_principal_id = NEW.id AND a.deleted_at IS NULL AND a.id <> NEW.id) THEN
    RAISE EXCEPTION 'Esta saída já é a principal de outra equipe; não pode ser acompanhante.' USING ERRCODE = '23514';
  END IF;

  IF NEW.saida_principal_id IS NULL OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Retorno, ajuste de foto/obs etc. numa acompanhante já validada: não revalida a principal.
  IF TG_OP = 'UPDATE'
     AND OLD.deleted_at IS NULL
     AND NEW.saida_principal_id IS NOT DISTINCT FROM OLD.saida_principal_id
     AND NEW.placa     IS NOT DISTINCT FROM OLD.placa
     AND NEW.equipe_id IS NOT DISTINCT FROM OLD.equipe_id
     AND NEW.equipe    IS NOT DISTINCT FROM OLD.equipe THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('portaria_saida_acomp|' || NEW.saida_principal_id::text));

  SELECT * INTO p FROM public.frotas_portaria_saidas WHERE id = NEW.saida_principal_id;
  IF NOT FOUND OR p.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Saída principal não encontrada (ou excluída). A saída acompanhante não foi gravada.' USING ERRCODE = '23514';
  END IF;
  IF p.saida_principal_id IS NOT NULL THEN
    RAISE EXCEPTION 'A saída indicada já é acompanhante de outra; aponte para a saída principal.' USING ERRCODE = '23514';
  END IF;
  IF p.data_retorno IS NOT NULL OR p.status = 'Retornado' THEN
    RAISE EXCEPTION 'O veículo % já retornou nessa saída; registre uma saída nova.', p.placa USING ERRCODE = '23514';
  END IF;

  v_placa   := upper(regexp_replace(coalesce(NEW.placa, ''), '[^A-Za-z0-9]', '', 'g'));
  v_placa_p := upper(regexp_replace(coalesce(p.placa, ''),   '[^A-Za-z0-9]', '', 'g'));
  IF v_placa = '' OR v_placa <> v_placa_p THEN
    RAISE EXCEPTION 'A saída acompanhante precisa da mesma placa da principal (%).', coalesce(nullif(v_placa_p, ''), 'sem placa')
      USING ERRCODE = '23514';
  END IF;

  v_eq   := coalesce(nullif(btrim(NEW.equipe_id), ''), 'nome:' || nullif(lower(btrim(coalesce(NEW.equipe, NEW.equipe_nome))), ''));
  v_eq_p := coalesce(nullif(btrim(p.equipe_id), ''),   'nome:' || nullif(lower(btrim(coalesce(p.equipe, p.equipe_nome))), ''));
  IF v_eq IS NULL THEN
    RAISE EXCEPTION 'A saída acompanhante precisa identificar a equipe.' USING ERRCODE = '23514';
  END IF;
  IF v_eq = v_eq_p THEN
    RAISE EXCEPTION 'A saída acompanhante precisa ser de outra equipe (a principal já é desta equipe).' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (SELECT 1 FROM public.frotas_portaria_saidas a
              WHERE a.saida_principal_id = p.id AND a.deleted_at IS NULL AND a.id <> NEW.id) THEN
    RAISE EXCEPTION 'O veículo % já saiu com 2 equipes nessa saída. Máximo de 2 equipes.', p.placa USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_portaria_saida_acomp_validar ON public.frotas_portaria_saidas;
CREATE TRIGGER trg_portaria_saida_acomp_validar
  BEFORE INSERT OR UPDATE ON public.frotas_portaria_saidas
  FOR EACH ROW EXECUTE FUNCTION public.cena_portaria_saida_acomp_validar();
REVOKE ALL ON FUNCTION public.cena_portaria_saida_acomp_validar() FROM PUBLIC, anon;

-- ── Retorno da principal fecha a acompanhante (depois de gravar) ─────────
CREATE OR REPLACE FUNCTION public.cena_portaria_saida_acomp_retorno()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.saida_principal_id IS NOT NULL OR NEW.deleted_at IS NOT NULL
     OR NEW.data_retorno IS NULL OR OLD.data_retorno IS NOT NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.frotas_portaria_saidas a
     SET status                 = NEW.status,
         data_retorno           = NEW.data_retorno,
         base_retorno           = coalesce(a.base_retorno, NEW.base_retorno),
         retorno_registrado_por = coalesce(a.retorno_registrado_por, NEW.retorno_registrado_por)
   WHERE a.saida_principal_id = NEW.id
     AND a.deleted_at IS NULL
     AND a.data_retorno IS NULL;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_portaria_saida_acomp_retorno ON public.frotas_portaria_saidas;
CREATE TRIGGER trg_portaria_saida_acomp_retorno
  AFTER UPDATE OF data_retorno ON public.frotas_portaria_saidas
  FOR EACH ROW EXECUTE FUNCTION public.cena_portaria_saida_acomp_retorno();
REVOKE ALL ON FUNCTION public.cena_portaria_saida_acomp_retorno() FROM PUBLIC, anon;

NOTIFY pgrst, 'reload schema';

-- Validação (rodar depois):
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='frotas_portaria_saidas' AND column_name='saida_principal_id';  -- 1 linha (uuid)
-- SELECT conname FROM pg_constraint WHERE conrelid='public.frotas_portaria_saidas'::regclass ORDER BY conname;  -- + saida_principal_fkey, acomp_outra_chk, acomp_sem_km_chk
-- SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='frotas_portaria_saidas';          -- + frotas_portaria_saidas_acomp_uniq
-- SELECT tgname FROM pg_trigger WHERE tgrelid='public.frotas_portaria_saidas'::regclass AND NOT tgisinternal; -- 2 trg_portaria_saida_acomp_
-- SELECT count(*) FROM public.frotas_portaria_saidas WHERE saida_principal_id IS NOT NULL;                    -- 0

-- Para desfazer
-- DROP TRIGGER IF EXISTS trg_portaria_saida_acomp_retorno ON public.frotas_portaria_saidas;
-- DROP TRIGGER IF EXISTS trg_portaria_saida_acomp_validar ON public.frotas_portaria_saidas;
-- DROP FUNCTION IF EXISTS public.cena_portaria_saida_acomp_retorno();
-- DROP FUNCTION IF EXISTS public.cena_portaria_saida_acomp_validar();
-- DROP INDEX IF EXISTS public.frotas_portaria_saidas_acomp_uniq;
-- ALTER TABLE public.frotas_portaria_saidas
--   DROP CONSTRAINT IF EXISTS frotas_portaria_saidas_acomp_sem_km_chk,
--   DROP CONSTRAINT IF EXISTS frotas_portaria_saidas_acomp_outra_chk,
--   DROP CONSTRAINT IF EXISTS frotas_portaria_saidas_saida_principal_fkey,
--   DROP COLUMN IF EXISTS saida_principal_id;
-- NOTIFY pgrst, 'reload schema';
