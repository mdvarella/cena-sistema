-- 8.1.205 — Programação de Projetos: fila "Projetos a programar" (projeto + data, ainda sem equipe).
-- Aditiva e idempotente. Não altera composicao_dia, plpt_prog_*, equipes_disp nem a Programação TMA.
-- Estado mostrado: AGUARDANDO EQUIPE vem só desta tabela; EM COMPOSIÇÃO e PROGRAMADO continuam vindo de
-- composicao_dia (projeto_ids + confirmada). Escolher a data NÃO programa o projeto.

-- ── Permissão: perfis da Programação de Projetos (anon sem acesso) ────────
-- Somente auth.uid() → usuarios_sistema.auth_user_id. E-mail do JWT não autoriza.
CREATE OR REPLACE FUNCTION public.cena_prog_pode_programar_projetos()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_perfil text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;
  SELECT lower(btrim(coalesce(us.perfil, '')))
    INTO v_perfil
  FROM public.usuarios_sistema us
  WHERE us.auth_user_id = auth.uid()
    AND us.ativo IS TRUE
    AND us.deleted_at IS NULL
  LIMIT 1;
  RETURN coalesce(v_perfil, '') IN ('admin','diretoria','gestor','coordenador','supervisor','administrativo','escritorio');
END;
$$;

REVOKE ALL ON FUNCTION public.cena_prog_pode_programar_projetos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cena_prog_pode_programar_projetos() TO authenticated;

-- ── Tabela ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prog_projetos_agenda (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id      uuid NOT NULL REFERENCES public.sot_projetos(id),
  contrato_id     text NOT NULL,
  data            date NOT NULL,
  status          text NOT NULL DEFAULT 'AGUARDANDO_EQUIPE',
  equipe_id       text,
  origem          text NOT NULL DEFAULT 'jornada',
  obs             text,
  criado_por      text,
  criado_por_auth uuid,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  alocado_em      timestamptz,
  cancelado_em    timestamptz,
  cancelado_por   text,
  deleted_at      timestamptz,
  CONSTRAINT prog_projetos_agenda_status_chk
    CHECK (status IN ('AGUARDANDO_EQUIPE','ALOCADO','CANCELADO')),
  CONSTRAINT prog_projetos_agenda_origem_chk
    CHECK (origem IN ('jornada','programacao')),
  CONSTRAINT prog_projetos_agenda_alocado_equipe_chk
    CHECK (status <> 'ALOCADO' OR (equipe_id IS NOT NULL AND btrim(equipe_id) <> '')),
  CONSTRAINT prog_projetos_agenda_aguardando_sem_equipe_chk
    CHECK (status <> 'AGUARDANDO_EQUIPE' OR equipe_id IS NULL),
  CONSTRAINT prog_projetos_agenda_cancelado_em_chk
    CHECK (status <> 'CANCELADO' OR cancelado_em IS NOT NULL)
);

-- Um agendamento ativo por projeto + data; o mesmo projeto pode ter outras datas pendentes.
CREATE UNIQUE INDEX IF NOT EXISTS prog_projetos_agenda_projeto_data_uidx
  ON public.prog_projetos_agenda (projeto_id, data)
  WHERE deleted_at IS NULL AND status <> 'CANCELADO';

CREATE INDEX IF NOT EXISTS prog_projetos_agenda_contrato_data_idx
  ON public.prog_projetos_agenda (contrato_id, data)
  WHERE deleted_at IS NULL AND status <> 'CANCELADO';

CREATE INDEX IF NOT EXISTS prog_projetos_agenda_projeto_idx
  ON public.prog_projetos_agenda (projeto_id)
  WHERE deleted_at IS NULL AND status <> 'CANCELADO';

-- ── Regras de gravação (fail-closed) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cena_prog_projetos_agenda_validar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_contrato text;
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT sp.contrato_id::text INTO v_contrato
    FROM public.sot_projetos sp
    WHERE sp.id = NEW.projeto_id AND sp.deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Projeto inexistente ou excluído: %', NEW.projeto_id USING ERRCODE = '23503';
    END IF;
    IF v_contrato IS NULL OR btrim(v_contrato) = '' THEN
      RAISE EXCEPTION 'Projeto % sem contrato', NEW.projeto_id USING ERRCODE = '23514';
    END IF;
    IF NEW.contrato_id IS NULL OR btrim(NEW.contrato_id) = '' THEN
      NEW.contrato_id := v_contrato;
    ELSIF NEW.contrato_id <> v_contrato THEN
      RAISE EXCEPTION 'Contrato % não é o do projeto (%)', NEW.contrato_id, v_contrato USING ERRCODE = '23514';
    END IF;
    IF NEW.data IS NULL OR NEW.data < v_hoje THEN
      RAISE EXCEPTION 'Data da execução % já passou', NEW.data USING ERRCODE = '23514';
    END IF;
    IF NEW.status IS DISTINCT FROM 'AGUARDANDO_EQUIPE' THEN
      RAISE EXCEPTION 'Agendamento novo começa em AGUARDANDO_EQUIPE' USING ERRCODE = '23514';
    END IF;
    IF NEW.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Agendamento novo não pode nascer excluído' USING ERRCODE = '23514';
    END IF;
    NEW.equipe_id := NULL;
    NEW.alocado_em := NULL;
    NEW.cancelado_em := NULL;
    NEW.cancelado_por := NULL;
    NEW.criado_por_auth := auth.uid();
    NEW.criado_em := now();
  ELSE
    IF NEW.projeto_id IS DISTINCT FROM OLD.projeto_id
       OR NEW.contrato_id IS DISTINCT FROM OLD.contrato_id
       OR NEW.data IS DISTINCT FROM OLD.data
       OR NEW.origem IS DISTINCT FROM OLD.origem
       OR NEW.criado_em IS DISTINCT FROM OLD.criado_em
       OR NEW.criado_por IS DISTINCT FROM OLD.criado_por
       OR NEW.criado_por_auth IS DISTINCT FROM OLD.criado_por_auth THEN
      RAISE EXCEPTION 'Projeto, contrato, data e origem do agendamento não mudam. Para trocar a data, cancele e crie outro.'
        USING ERRCODE = '23514';
    END IF;
    IF OLD.status = 'CANCELADO' AND NEW.status <> 'CANCELADO' THEN
      RAISE EXCEPTION 'Agendamento cancelado não volta para a fila' USING ERRCODE = '23514';
    END IF;
    IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      RAISE EXCEPTION 'Agendamento excluído não é restaurado' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'ALOCADO' AND NEW.equipe_id IS DISTINCT FROM OLD.equipe_id THEN
      NEW.alocado_em := now();
    END IF;
  END IF;

  IF NEW.status = 'AGUARDANDO_EQUIPE' THEN
    NEW.equipe_id := NULL;
    NEW.alocado_em := NULL;
  ELSIF NEW.status = 'ALOCADO' THEN
    NEW.alocado_em := coalesce(NEW.alocado_em, now());
  ELSIF NEW.status = 'CANCELADO' THEN
    NEW.cancelado_em := coalesce(NEW.cancelado_em, now());
  END IF;
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prog_projetos_agenda_validar ON public.prog_projetos_agenda;
CREATE TRIGGER trg_prog_projetos_agenda_validar
  BEFORE INSERT OR UPDATE ON public.prog_projetos_agenda
  FOR EACH ROW EXECUTE FUNCTION public.cena_prog_projetos_agenda_validar();
REVOKE ALL ON FUNCTION public.cena_prog_projetos_agenda_validar() FROM PUBLIC, anon;

-- ── RLS: só usuário autenticado com perfil da Programação; sem DELETE (cancelamento é lógico) ──
ALTER TABLE public.prog_projetos_agenda ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prog_projetos_agenda FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.prog_projetos_agenda FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.prog_projetos_agenda TO authenticated;
GRANT ALL ON TABLE public.prog_projetos_agenda TO service_role;

DROP POLICY IF EXISTS prog_projetos_agenda_select ON public.prog_projetos_agenda;
CREATE POLICY prog_projetos_agenda_select
  ON public.prog_projetos_agenda
  FOR SELECT
  TO authenticated
  USING (public.cena_prog_pode_programar_projetos());

DROP POLICY IF EXISTS prog_projetos_agenda_insert ON public.prog_projetos_agenda;
CREATE POLICY prog_projetos_agenda_insert
  ON public.prog_projetos_agenda
  FOR INSERT
  TO authenticated
  WITH CHECK (public.cena_prog_pode_programar_projetos());

DROP POLICY IF EXISTS prog_projetos_agenda_update ON public.prog_projetos_agenda;
CREATE POLICY prog_projetos_agenda_update
  ON public.prog_projetos_agenda
  FOR UPDATE
  TO authenticated
  USING (public.cena_prog_pode_programar_projetos())
  WITH CHECK (public.cena_prog_pode_programar_projetos());

NOTIFY pgrst, 'reload schema';

-- Validação (rodar depois):
-- SELECT count(*) FROM public.prog_projetos_agenda;                              -- 0 logo após criar
-- SELECT polname FROM pg_policy WHERE polrelid = 'public.prog_projetos_agenda'::regclass;  -- select/insert/update
-- SELECT has_table_privilege('anon', 'public.prog_projetos_agenda', 'SELECT');   -- false

-- Para desfazer
-- DROP TABLE IF EXISTS public.prog_projetos_agenda;
-- DROP FUNCTION IF EXISTS public.cena_prog_projetos_agenda_validar();
-- DROP FUNCTION IF EXISTS public.cena_prog_pode_programar_projetos();
-- NOTIFY pgrst, 'reload schema';
