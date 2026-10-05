-- 8.1.210 — Programação de Projetos: caminhão compartilhado por 2 equipes no mesmo dia/horário
-- e carreta (carreta de cabos ou compressor) com placa própria.
-- Aditiva e idempotente. Só acrescenta colunas opcionais em prog_veiculos_dia (NULL em todas as linhas atuais).
-- Não altera colunas existentes, composicao_dia, Programação TMA, Portaria nem frotas_portaria_saidas.
--
-- Regras garantidas no banco (fail-closed):
--   • compartilhamento e carreta só no veículo principal (slot 1) e em linha viva;
--   • a equipe parceira precisa ter o MESMO veículo (placa) no MESMO dia;
--   • no máximo 2 equipes compartilham a mesma placa no dia;
--   • o vínculo é sempre recíproco: gravar B→A grava A→B na mesma transação; desfazer, trocar a placa
--     sem parceiro ou excluir um lado desfaz o outro;
--   • carreta: tipo 'carreta_cabos' ou 'compressor', placa obrigatória no formato de placa, diferente
--     da placa do caminhão.

-- ── Colunas ──────────────────────────────────────────────────────────────
ALTER TABLE public.prog_veiculos_dia
  ADD COLUMN IF NOT EXISTS compartilhado_com_equipe_id text,
  ADD COLUMN IF NOT EXISTS carreta_tipo                text,
  ADD COLUMN IF NOT EXISTS carreta_placa               text,
  ADD COLUMN IF NOT EXISTS carreta_veiculo_id          uuid;

COMMENT ON COLUMN public.prog_veiculos_dia.compartilhado_com_equipe_id IS
  'Equipe que sai no mesmo veículo, no mesmo dia (vínculo recíproco, máx. 2 equipes). NULL = não compartilhado.';
COMMENT ON COLUMN public.prog_veiculos_dia.carreta_tipo IS
  'Carreta engatada no veículo: carreta_cabos | compressor. NULL = sem carreta.';
COMMENT ON COLUMN public.prog_veiculos_dia.carreta_placa IS
  'Placa da carreta (maiúsculas, sem traço). Obrigatória quando carreta_tipo está preenchido.';
COMMENT ON COLUMN public.prog_veiculos_dia.carreta_veiculo_id IS
  'frotas_veiculos.id da carreta, quando cadastrada na frota. NULL = placa digitada.';

-- ── Restrições ───────────────────────────────────────────────────────────
ALTER TABLE public.prog_veiculos_dia DROP CONSTRAINT IF EXISTS prog_veiculos_dia_carreta_tipo_chk;
ALTER TABLE public.prog_veiculos_dia ADD CONSTRAINT prog_veiculos_dia_carreta_tipo_chk
  CHECK (carreta_tipo IS NULL OR carreta_tipo IN ('carreta_cabos','compressor'));

ALTER TABLE public.prog_veiculos_dia DROP CONSTRAINT IF EXISTS prog_veiculos_dia_carreta_par_chk;
ALTER TABLE public.prog_veiculos_dia ADD CONSTRAINT prog_veiculos_dia_carreta_par_chk
  CHECK ((carreta_tipo IS NULL) = (carreta_placa IS NULL));

ALTER TABLE public.prog_veiculos_dia DROP CONSTRAINT IF EXISTS prog_veiculos_dia_carreta_placa_chk;
ALTER TABLE public.prog_veiculos_dia ADD CONSTRAINT prog_veiculos_dia_carreta_placa_chk
  CHECK (carreta_placa IS NULL OR carreta_placa ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$');

ALTER TABLE public.prog_veiculos_dia DROP CONSTRAINT IF EXISTS prog_veiculos_dia_carreta_veiculo_chk;
ALTER TABLE public.prog_veiculos_dia ADD CONSTRAINT prog_veiculos_dia_carreta_veiculo_chk
  CHECK (carreta_veiculo_id IS NULL OR carreta_placa IS NOT NULL);

ALTER TABLE public.prog_veiculos_dia DROP CONSTRAINT IF EXISTS prog_veiculos_dia_carreta_com_veiculo_chk;
ALTER TABLE public.prog_veiculos_dia ADD CONSTRAINT prog_veiculos_dia_carreta_com_veiculo_chk
  CHECK (carreta_placa IS NULL OR (
    btrim(coalesce(placa,'')) <> ''
    AND carreta_placa <> upper(regexp_replace(placa, '[^A-Za-z0-9]', '', 'g'))
  ));

ALTER TABLE public.prog_veiculos_dia DROP CONSTRAINT IF EXISTS prog_veiculos_dia_compart_outra_chk;
ALTER TABLE public.prog_veiculos_dia ADD CONSTRAINT prog_veiculos_dia_compart_outra_chk
  CHECK (compartilhado_com_equipe_id IS NULL OR (
    btrim(compartilhado_com_equipe_id) <> '' AND compartilhado_com_equipe_id <> equipe_id
  ));

ALTER TABLE public.prog_veiculos_dia DROP CONSTRAINT IF EXISTS prog_veiculos_dia_extras_slot1_chk;
ALTER TABLE public.prog_veiculos_dia ADD CONSTRAINT prog_veiculos_dia_extras_slot1_chk
  CHECK ((carreta_tipo IS NULL AND compartilhado_com_equipe_id IS NULL) OR coalesce(slot, 1) = 1);

CREATE INDEX IF NOT EXISTS prog_veiculos_dia_compart_idx
  ON public.prog_veiculos_dia (data, compartilhado_com_equipe_id)
  WHERE compartilhado_com_equipe_id IS NOT NULL;

-- ── Validação do compartilhamento (antes de gravar) ──────────────────────
CREATE OR REPLACE FUNCTION public.cena_prog_veiculos_dia_compart_validar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_placa      text;
  v_parc_placa text;
  v_parc_comp  text;
  v_outra      text;
BEGIN
  IF NEW.carreta_placa IS NOT NULL THEN
    NEW.carreta_placa := nullif(upper(regexp_replace(NEW.carreta_placa, '[^A-Za-z0-9]', '', 'g')), '');
  END IF;
  IF NEW.carreta_tipo IS NOT NULL THEN
    NEW.carreta_tipo := nullif(lower(btrim(NEW.carreta_tipo)), '');
  END IF;
  IF NEW.compartilhado_com_equipe_id IS NOT NULL THEN
    NEW.compartilhado_com_equipe_id := nullif(btrim(NEW.compartilhado_com_equipe_id), '');
  END IF;

  -- Linha excluída não compartilha (o outro lado é desfeito pelo trigger AFTER).
  IF NEW.deleted_at IS NOT NULL THEN
    NEW.compartilhado_com_equipe_id := NULL;
    RETURN NEW;
  END IF;
  IF NEW.compartilhado_com_equipe_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.deleted_at IS NULL
     AND NEW.compartilhado_com_equipe_id IS NOT DISTINCT FROM OLD.compartilhado_com_equipe_id
     AND NEW.placa  IS NOT DISTINCT FROM OLD.placa
     AND NEW.slot   IS NOT DISTINCT FROM OLD.slot
     AND NEW.data      = OLD.data
     AND NEW.equipe_id = OLD.equipe_id THEN
    RETURN NEW;
  END IF;

  v_placa := upper(regexp_replace(coalesce(NEW.placa, ''), '[^A-Za-z0-9]', '', 'g'));
  IF v_placa = '' THEN
    RAISE EXCEPTION 'Veículo compartilhado precisa de placa.' USING ERRCODE = '23514';
  END IF;

  -- Serializa gravações concorrentes da mesma placa no mesmo dia.
  PERFORM pg_advisory_xact_lock(hashtext('prog_veic_compart|' || NEW.data::text || '|' || v_placa));

  SELECT upper(regexp_replace(coalesce(pv.placa, ''), '[^A-Za-z0-9]', '', 'g')), pv.compartilhado_com_equipe_id
    INTO v_parc_placa, v_parc_comp
  FROM public.prog_veiculos_dia pv
  WHERE pv.equipe_id = NEW.compartilhado_com_equipe_id
    AND pv.data = NEW.data
    AND coalesce(pv.slot, 1) = 1
    AND pv.deleted_at IS NULL
  ORDER BY pv.criado_em DESC NULLS LAST
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A equipe % não tem veículo programado em %.', NEW.compartilhado_com_equipe_id, NEW.data
      USING ERRCODE = '23514';
  END IF;
  IF v_parc_placa IS DISTINCT FROM v_placa THEN
    RAISE EXCEPTION 'A equipe % está com outro veículo (%) em %; o compartilhamento exige a mesma placa (%).',
      NEW.compartilhado_com_equipe_id, v_parc_placa, NEW.data, v_placa USING ERRCODE = '23514';
  END IF;
  IF v_parc_comp IS NOT NULL AND v_parc_comp <> NEW.equipe_id THEN
    RAISE EXCEPTION 'A equipe % já compartilha o veículo % com a equipe %.',
      NEW.compartilhado_com_equipe_id, v_placa, v_parc_comp USING ERRCODE = '23514';
  END IF;

  SELECT pv.equipe_id INTO v_outra
  FROM public.prog_veiculos_dia pv
  WHERE pv.data = NEW.data
    AND coalesce(pv.slot, 1) = 1
    AND pv.deleted_at IS NULL
    AND pv.compartilhado_com_equipe_id IS NOT NULL
    AND upper(regexp_replace(coalesce(pv.placa, ''), '[^A-Za-z0-9]', '', 'g')) = v_placa
    AND pv.equipe_id NOT IN (NEW.equipe_id, NEW.compartilhado_com_equipe_id)
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'O veículo % já é compartilhado por 2 equipes em % (inclui a equipe %). Máximo de 2 equipes.',
      v_placa, NEW.data, v_outra USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prog_veiculos_dia_compart_validar ON public.prog_veiculos_dia;
CREATE TRIGGER trg_prog_veiculos_dia_compart_validar
  BEFORE INSERT OR UPDATE ON public.prog_veiculos_dia
  FOR EACH ROW EXECUTE FUNCTION public.cena_prog_veiculos_dia_compart_validar();
REVOKE ALL ON FUNCTION public.cena_prog_veiculos_dia_compart_validar() FROM PUBLIC, anon;

-- ── Reciprocidade (depois de gravar) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cena_prog_veiculos_dia_compart_sincronizar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.compartilhado_com_equipe_id IS NOT DISTINCT FROM OLD.compartilhado_com_equipe_id
     AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at
     AND NEW.placa      IS NOT DISTINCT FROM OLD.placa
     AND NEW.slot       IS NOT DISTINCT FROM OLD.slot
     AND NEW.data      = OLD.data
     AND NEW.equipe_id = OLD.equipe_id THEN
    RETURN NULL;
  END IF;

  -- Quem apontava para esta linha e deixou de ser o parceiro: desfaz o outro lado.
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    UPDATE public.prog_veiculos_dia pv
       SET compartilhado_com_equipe_id = NULL
     WHERE pv.data = OLD.data
       AND pv.compartilhado_com_equipe_id = OLD.equipe_id
       AND pv.equipe_id <> OLD.equipe_id
       AND NOT (
         TG_OP = 'UPDATE'
         AND NEW.deleted_at IS NULL
         AND NEW.data = OLD.data
         AND NEW.equipe_id = OLD.equipe_id
         AND pv.equipe_id IS NOT DISTINCT FROM NEW.compartilhado_com_equipe_id
       );
  END IF;

  -- Gravou B→A: grava A→B.
  IF TG_OP <> 'DELETE' AND NEW.deleted_at IS NULL AND NEW.compartilhado_com_equipe_id IS NOT NULL THEN
    UPDATE public.prog_veiculos_dia pv
       SET compartilhado_com_equipe_id = NEW.equipe_id
     WHERE pv.equipe_id = NEW.compartilhado_com_equipe_id
       AND pv.data = NEW.data
       AND coalesce(pv.slot, 1) = 1
       AND pv.deleted_at IS NULL
       AND pv.compartilhado_com_equipe_id IS DISTINCT FROM NEW.equipe_id;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_prog_veiculos_dia_compart_sincronizar ON public.prog_veiculos_dia;
CREATE TRIGGER trg_prog_veiculos_dia_compart_sincronizar
  AFTER INSERT OR UPDATE OR DELETE ON public.prog_veiculos_dia
  FOR EACH ROW EXECUTE FUNCTION public.cena_prog_veiculos_dia_compart_sincronizar();
REVOKE ALL ON FUNCTION public.cena_prog_veiculos_dia_compart_sincronizar() FROM PUBLIC, anon;

NOTIFY pgrst, 'reload schema';

-- Validação (rodar depois):
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='prog_veiculos_dia'
--    AND column_name IN ('compartilhado_com_equipe_id','carreta_tipo','carreta_placa','carreta_veiculo_id');  -- 4 linhas
-- SELECT conname FROM pg_constraint WHERE conrelid='public.prog_veiculos_dia'::regclass ORDER BY conname;   -- + 7 _chk
-- SELECT tgname FROM pg_trigger WHERE tgrelid='public.prog_veiculos_dia'::regclass AND NOT tgisinternal;     -- 2 trg_
-- SELECT count(*) FROM public.prog_veiculos_dia
--  WHERE compartilhado_com_equipe_id IS NOT NULL OR carreta_tipo IS NOT NULL;                               -- 0

-- Para desfazer
-- DROP TRIGGER IF EXISTS trg_prog_veiculos_dia_compart_sincronizar ON public.prog_veiculos_dia;
-- DROP TRIGGER IF EXISTS trg_prog_veiculos_dia_compart_validar ON public.prog_veiculos_dia;
-- DROP FUNCTION IF EXISTS public.cena_prog_veiculos_dia_compart_sincronizar();
-- DROP FUNCTION IF EXISTS public.cena_prog_veiculos_dia_compart_validar();
-- DROP INDEX IF EXISTS public.prog_veiculos_dia_compart_idx;
-- ALTER TABLE public.prog_veiculos_dia
--   DROP CONSTRAINT IF EXISTS prog_veiculos_dia_carreta_tipo_chk,
--   DROP CONSTRAINT IF EXISTS prog_veiculos_dia_carreta_par_chk,
--   DROP CONSTRAINT IF EXISTS prog_veiculos_dia_carreta_placa_chk,
--   DROP CONSTRAINT IF EXISTS prog_veiculos_dia_carreta_veiculo_chk,
--   DROP CONSTRAINT IF EXISTS prog_veiculos_dia_carreta_com_veiculo_chk,
--   DROP CONSTRAINT IF EXISTS prog_veiculos_dia_compart_outra_chk,
--   DROP CONSTRAINT IF EXISTS prog_veiculos_dia_extras_slot1_chk,
--   DROP COLUMN IF EXISTS carreta_veiculo_id,
--   DROP COLUMN IF EXISTS carreta_placa,
--   DROP COLUMN IF EXISTS carreta_tipo,
--   DROP COLUMN IF EXISTS compartilhado_com_equipe_id;
-- NOTIFY pgrst, 'reload schema';
