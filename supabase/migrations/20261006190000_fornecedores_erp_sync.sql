-- SINCRONIZAÇÃO DE FORNECEDORES — ERP CENA (/suppliers) -> public.fornecedores
-- A Edge Function erp-fornecedores-sync lê o ERP no servidor e grava por estas funções (só service_role).
--   * fornecedores ganha o vínculo com o ERP (erp_id único) e a origem (MANUAL | ERP);
--   * erp_sync_estado guarda a marca d'água (updated_at do ERP) e a trava de execução;
--   * erp_sync_execucoes registra cada execução; erp_sync_conflitos lista CNPJs ambíguos para revisão humana;
--   * vínculo automático só por CPF/CNPJ válido e único dos dois lados — nunca por nome;
--   * fornecedor que some do ERP é inativado, nunca apagado (lançamentos, frota e locação apontam para ele);
--   * pelo navegador (anon/authenticated) os campos mantidos pelo ERP não mudam e o vínculo não é forjado.
-- Idempotente. Não apaga dados. Não altera policies existentes de fornecedores.
-- O agendamento diário fica em 20261006190100_fornecedores_erp_sync_cron.sql (precisa dos segredos no Vault).

-- ── 0. Pré-condições (falha inteira, nada é aplicado) ────────────────────
DO $$
DECLARE
  v_faltando text;
BEGIN
  IF to_regclass('public.fornecedores') IS NULL THEN
    RAISE EXCEPTION 'public.fornecedores não existe';
  END IF;
  SELECT string_agg(c, ', ') INTO v_faltando
  FROM unnest(ARRAY['id','razao_social','cnpj_cpf','tipo','contato','telefone','email','status','deleted_at']) c
  WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'fornecedores' AND column_name = c);
  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION 'fornecedores sem as colunas: %', v_faltando;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'fornecedores'
                   AND column_name = 'id' AND column_default IS NOT NULL) THEN
    RAISE EXCEPTION 'fornecedores.id sem default: a sincronização insere sem informar o id';
  END IF;
  SELECT string_agg(column_name, ', ') INTO v_faltando
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'fornecedores'
    AND is_nullable = 'NO' AND column_default IS NULL
    AND column_name NOT IN ('id','razao_social','cnpj_cpf','tipo','contato','telefone','email','status',
                            'deleted_at','nome_fantasia','cidade','estado');
  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION 'fornecedores tem colunas NOT NULL sem default que a sincronização não preenche: %', v_faltando;
  END IF;
  IF to_regprocedure('public.cena_usuario_perfil_sessao()') IS NULL THEN
    RAISE EXCEPTION 'public.cena_usuario_perfil_sessao() não existe — aplique antes 20261004190000_seguranca_usuarios_sistema.sql';
  END IF;
  IF NOT coalesce((SELECT rolbypassrls FROM pg_roles WHERE rolname = 'service_role'), false) THEN
    RAISE EXCEPTION 'service_role sem BYPASSRLS: as funções da sincronização rodam como service_role';
  END IF;
END $$;

-- ── 1. Colunas de vínculo em fornecedores ────────────────────────────────
ALTER TABLE public.fornecedores ADD COLUMN IF NOT EXISTS nome_fantasia text;
ALTER TABLE public.fornecedores ADD COLUMN IF NOT EXISTS cidade text;
ALTER TABLE public.fornecedores ADD COLUMN IF NOT EXISTS estado text;
ALTER TABLE public.fornecedores ADD COLUMN IF NOT EXISTS erp_id integer;
ALTER TABLE public.fornecedores ADD COLUMN IF NOT EXISTS erp_parent_id integer;
ALTER TABLE public.fornecedores ADD COLUMN IF NOT EXISTS erp_hash text;
ALTER TABLE public.fornecedores ADD COLUMN IF NOT EXISTS erp_updated_at timestamptz;
ALTER TABLE public.fornecedores ADD COLUMN IF NOT EXISTS erp_sincronizado_em timestamptz;
ALTER TABLE public.fornecedores ADD COLUMN IF NOT EXISTS erp_ausente_desde timestamptz;
ALTER TABLE public.fornecedores ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'MANUAL';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.fornecedores'::regclass AND conname = 'fornecedores_erp_id_key') THEN
    ALTER TABLE public.fornecedores ADD CONSTRAINT fornecedores_erp_id_key UNIQUE (erp_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.fornecedores'::regclass AND conname = 'fornecedores_origem_chk') THEN
    ALTER TABLE public.fornecedores ADD CONSTRAINT fornecedores_origem_chk
      CHECK (origem IN ('MANUAL', 'ERP'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.fornecedores'::regclass AND conname = 'fornecedores_erp_vinculo_chk') THEN
    ALTER TABLE public.fornecedores ADD CONSTRAINT fornecedores_erp_vinculo_chk
      CHECK ((origem = 'ERP') = (erp_id IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.fornecedores'::regclass AND conname = 'fornecedores_erp_hash_chk') THEN
    ALTER TABLE public.fornecedores ADD CONSTRAINT fornecedores_erp_hash_chk
      CHECK (erp_hash IS NULL OR erp_hash ~ '^[0-9a-f]{64}$');
  END IF;
END $$;

-- Busca do vínculo por CPF/CNPJ só com dígitos (cadastro manual guarda com máscara).
CREATE INDEX IF NOT EXISTS fornecedores_cnpj_digitos_idx
  ON public.fornecedores ((regexp_replace(coalesce(cnpj_cpf, ''), '\D', '', 'g')));

-- ── 2. Estado, execuções e conflitos ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_sync_estado (
  recurso text PRIMARY KEY CHECK (recurso IN ('suppliers')),
  watermark_updated_at timestamptz,
  ultima_completa_em timestamptz,
  ultima_execucao_id uuid,
  em_execucao_desde timestamptz,
  em_execucao_id uuid,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.erp_sync_estado (recurso) VALUES ('suppliers') ON CONFLICT (recurso) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.erp_sync_execucoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recurso text NOT NULL CHECK (recurso IN ('suppliers')),
  modo text NOT NULL CHECK (modo IN ('INCREMENTAL', 'COMPLETA', 'SIMULACAO')),
  disparo text NOT NULL CHECK (disparo IN ('CRON', 'MANUAL')),
  iniciado_por_auth uuid,
  iniciado_em timestamptz NOT NULL DEFAULT now(),
  finalizado_em timestamptz,
  status text NOT NULL DEFAULT 'EM_EXECUCAO' CHECK (status IN ('EM_EXECUCAO', 'OK', 'PARCIAL', 'ERRO')),
  paginas integer NOT NULL DEFAULT 0,
  lidos integer NOT NULL DEFAULT 0,
  inseridos integer NOT NULL DEFAULT 0,
  atualizados integer NOT NULL DEFAULT 0,
  inalterados integer NOT NULL DEFAULT 0,
  vinculados integer NOT NULL DEFAULT 0,
  inativados integer NOT NULL DEFAULT 0,
  conflitos integer NOT NULL DEFAULT 0,
  ignorados integer NOT NULL DEFAULT 0,
  watermark_anterior timestamptz,
  watermark_novo timestamptz,
  erro text,
  resumo jsonb,
  CONSTRAINT erp_sync_execucoes_manual_auth_chk CHECK (disparo <> 'MANUAL' OR iniciado_por_auth IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS erp_sync_execucoes_recurso_inicio_idx
  ON public.erp_sync_execucoes (recurso, iniciado_em DESC);

CREATE TABLE IF NOT EXISTS public.erp_sync_conflitos (
  id bigserial PRIMARY KEY,
  recurso text NOT NULL CHECK (recurso IN ('suppliers')),
  execucao_id uuid REFERENCES public.erp_sync_execucoes (id),
  erp_id integer NOT NULL,
  motivo text NOT NULL CHECK (motivo IN ('CNPJ_DUPLICADO_ERP', 'CNPJ_DUPLICADO_LOCAL', 'LOCAL_JA_VINCULADO')),
  fornecedor_id text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  resolvido_em timestamptz,
  resolvido_por_auth uuid,
  resolucao text
);
CREATE UNIQUE INDEX IF NOT EXISTS erp_sync_conflitos_aberto_uidx
  ON public.erp_sync_conflitos (recurso, erp_id, motivo) WHERE resolvido_em IS NULL;

-- ── 3. Permissão de disparo manual (helper existente: cena_usuario_perfil_sessao) ──
CREATE OR REPLACE FUNCTION public.cena_forn_pode_sincronizar_erp()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(public.cena_usuario_perfil_sessao() IN ('admin', 'diretoria', 'gestor', 'administrativo'), false)
$$;
REVOKE ALL ON FUNCTION public.cena_forn_pode_sincronizar_erp() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cena_forn_pode_sincronizar_erp() TO authenticated, service_role;

-- ── 4. RLS e grants das tabelas novas ────────────────────────────────────
ALTER TABLE public.erp_sync_estado ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_sync_estado FORCE ROW LEVEL SECURITY;
ALTER TABLE public.erp_sync_execucoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_sync_execucoes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.erp_sync_conflitos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_sync_conflitos FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.erp_sync_estado FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.erp_sync_execucoes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.erp_sync_conflitos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.erp_sync_conflitos_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.erp_sync_estado TO authenticated;
GRANT SELECT ON TABLE public.erp_sync_execucoes TO authenticated;
GRANT SELECT ON TABLE public.erp_sync_conflitos TO authenticated;
GRANT ALL ON TABLE public.erp_sync_estado TO service_role;
GRANT ALL ON TABLE public.erp_sync_execucoes TO service_role;
GRANT ALL ON TABLE public.erp_sync_conflitos TO service_role;
GRANT ALL ON SEQUENCE public.erp_sync_conflitos_id_seq TO service_role;

DROP POLICY IF EXISTS erp_sync_estado_select ON public.erp_sync_estado;
CREATE POLICY erp_sync_estado_select ON public.erp_sync_estado
  FOR SELECT TO authenticated USING ((SELECT public.cena_usuario_erp_ativo()));
DROP POLICY IF EXISTS erp_sync_execucoes_select ON public.erp_sync_execucoes;
CREATE POLICY erp_sync_execucoes_select ON public.erp_sync_execucoes
  FOR SELECT TO authenticated USING ((SELECT public.cena_usuario_erp_ativo()));
DROP POLICY IF EXISTS erp_sync_conflitos_select ON public.erp_sync_conflitos;
CREATE POLICY erp_sync_conflitos_select ON public.erp_sync_conflitos
  FOR SELECT TO authenticated USING ((SELECT public.cena_forn_pode_sincronizar_erp()));

-- ── 5. Gatilho: o navegador não altera o que vem do ERP ──────────────────
-- SECURITY INVOKER de propósito: current_user separa anon/authenticated (navegador) de service_role (Edge).
CREATE OR REPLACE FUNCTION public.fn_fornecedores_erp_proteger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.erp_id IS NOT NULL OR NEW.origem IS DISTINCT FROM 'MANUAL'
       OR NEW.erp_parent_id IS NOT NULL OR NEW.erp_hash IS NOT NULL OR NEW.erp_updated_at IS NOT NULL
       OR NEW.erp_sincronizado_em IS NOT NULL OR NEW.erp_ausente_desde IS NOT NULL THEN
      RAISE EXCEPTION 'fornecedores: cadastro do ERP só é gravado pela sincronização' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.origem = 'ERP' OR OLD.erp_id IS NOT NULL THEN
      RAISE EXCEPTION 'fornecedores: fornecedor do ERP não é excluído aqui — inative no ERP CENA' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.erp_id IS DISTINCT FROM OLD.erp_id OR NEW.origem IS DISTINCT FROM OLD.origem
     OR NEW.erp_parent_id IS DISTINCT FROM OLD.erp_parent_id OR NEW.erp_hash IS DISTINCT FROM OLD.erp_hash
     OR NEW.erp_updated_at IS DISTINCT FROM OLD.erp_updated_at
     OR NEW.erp_sincronizado_em IS DISTINCT FROM OLD.erp_sincronizado_em
     OR NEW.erp_ausente_desde IS DISTINCT FROM OLD.erp_ausente_desde THEN
    RAISE EXCEPTION 'fornecedores: vínculo com o ERP só muda pela sincronização' USING ERRCODE = '42501';
  END IF;
  IF OLD.origem = 'ERP' AND (
       NEW.razao_social IS DISTINCT FROM OLD.razao_social
    OR NEW.nome_fantasia IS DISTINCT FROM OLD.nome_fantasia
    OR NEW.cnpj_cpf IS DISTINCT FROM OLD.cnpj_cpf
    OR NEW.email IS DISTINCT FROM OLD.email
    OR NEW.telefone IS DISTINCT FROM OLD.telefone
    OR NEW.cidade IS DISTINCT FROM OLD.cidade
    OR NEW.estado IS DISTINCT FROM OLD.estado
    OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
  ) THEN
    RAISE EXCEPTION 'fornecedores: dados mantidos pelo ERP CENA — altere no ERP' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_fornecedores_erp_proteger() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_fornecedores_erp_proteger ON public.fornecedores;
CREATE TRIGGER trg_fornecedores_erp_proteger
  BEFORE INSERT OR UPDATE OR DELETE ON public.fornecedores
  FOR EACH ROW EXECUTE FUNCTION public.fn_fornecedores_erp_proteger();

-- ── 6. Funções da sincronização (SECURITY INVOKER, EXECUTE só service_role) ──
CREATE OR REPLACE FUNCTION public.fn_erp_sync_exigir_execucao(p_execucao uuid, p_recurso text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_execucao IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.erp_sync_execucoes e
    JOIN public.erp_sync_estado s ON s.recurso = e.recurso AND s.em_execucao_id = e.id
    WHERE e.id = p_execucao AND e.recurso = p_recurso AND e.status = 'EM_EXECUCAO'
  ) THEN
    RAISE EXCEPTION 'ERP_SYNC_EXECUCAO_INVALIDA' USING ERRCODE = '22023';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_erp_sync_iniciar(p_recurso text, p_modo text, p_disparo text, p_auth uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_wm timestamptz;
  v_uc timestamptz;
BEGIN
  IF p_recurso IS DISTINCT FROM 'suppliers' THEN
    RAISE EXCEPTION 'ERP_SYNC_RECURSO_INVALIDO' USING ERRCODE = '22023';
  END IF;
  IF p_modo IS NULL OR p_modo NOT IN ('INCREMENTAL', 'COMPLETA', 'SIMULACAO') THEN
    RAISE EXCEPTION 'ERP_SYNC_MODO_INVALIDO' USING ERRCODE = '22023';
  END IF;
  IF p_disparo IS NULL OR p_disparo NOT IN ('CRON', 'MANUAL') THEN
    RAISE EXCEPTION 'ERP_SYNC_DISPARO_INVALIDO' USING ERRCODE = '22023';
  END IF;
  IF p_disparo = 'MANUAL' AND p_auth IS NULL THEN
    RAISE EXCEPTION 'ERP_SYNC_MANUAL_SEM_USUARIO' USING ERRCODE = '22023';
  END IF;

  UPDATE public.erp_sync_estado
     SET em_execucao_desde = now(), em_execucao_id = v_id, atualizado_em = now()
   WHERE recurso = p_recurso
     AND (em_execucao_desde IS NULL OR em_execucao_desde < now() - interval '15 minutes')
  RETURNING watermark_updated_at, ultima_completa_em INTO v_wm, v_uc;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERP_SYNC_EM_EXECUCAO' USING ERRCODE = '55P03';
  END IF;

  UPDATE public.erp_sync_execucoes
     SET status = 'ERRO', finalizado_em = now(), erro = 'abandonada: trava expirou sem finalizar'
   WHERE recurso = p_recurso AND status = 'EM_EXECUCAO';

  INSERT INTO public.erp_sync_execucoes (id, recurso, modo, disparo, iniciado_por_auth, watermark_anterior)
  VALUES (v_id, p_recurso, p_modo, p_disparo, p_auth, v_wm);

  RETURN jsonb_build_object('execucao_id', v_id, 'watermark_updated_at', v_wm, 'ultima_completa_em', v_uc);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_fornecedores_erp_aplicar(p_execucao uuid, p_itens jsonb, p_simular boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  v_id text;
  v_hash text;
  v_del timestamptz;
  v_aus timestamptz;
  v_n integer;
  v_cand text;
  v_outro text;
  v_motivo text;
  c_ins integer := 0;
  c_upd integer := 0;
  c_ok integer := 0;
  c_vinc integer := 0;
  c_conf integer := 0;
  c_ign integer := 0;
  v_conf jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.fn_erp_sync_exigir_execucao(p_execucao, 'suppliers');
  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' THEN
    RAISE EXCEPTION 'ERP_SYNC_ITENS_INVALIDOS' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_itens) > 500 THEN
    RAISE EXCEPTION 'ERP_SYNC_LOTE_GRANDE' USING ERRCODE = '22023';
  END IF;

  BEGIN
    FOR r IN
      SELECT * FROM jsonb_to_recordset(p_itens) AS x(
        erp_id integer, erp_parent_id integer, razao_social text, nome_fantasia text,
        cnpj_cpf text, doc_valido boolean, cnpj_dup_erp boolean, email text, telefone text,
        cidade text, estado text, ativo boolean, erp_updated_at timestamptz, hash text)
    LOOP
      IF r.erp_id IS NULL OR r.erp_id <= 0 OR nullif(btrim(r.razao_social), '') IS NULL
         OR r.ativo IS NULL OR r.hash IS NULL OR r.hash !~ '^[0-9a-f]{64}$' THEN
        c_ign := c_ign + 1;
        CONTINUE;
      END IF;

      SELECT f.id::text, f.erp_hash, f.deleted_at, f.erp_ausente_desde
        INTO v_id, v_hash, v_del, v_aus
        FROM public.fornecedores f
       WHERE f.erp_id = r.erp_id;
      IF FOUND THEN
        IF v_hash = r.hash AND v_del IS NULL AND v_aus IS NULL THEN
          c_ok := c_ok + 1;
          CONTINUE;
        END IF;
        UPDATE public.fornecedores f
           SET razao_social = btrim(r.razao_social),
               nome_fantasia = nullif(btrim(r.nome_fantasia), ''),
               cnpj_cpf = coalesce(r.cnpj_cpf, ''),
               email = coalesce(r.email, ''),
               telefone = coalesce(r.telefone, ''),
               cidade = nullif(btrim(r.cidade), ''),
               estado = nullif(btrim(r.estado), ''),
               status = CASE WHEN r.ativo THEN 'Ativo' ELSE 'Inativo' END,
               erp_parent_id = r.erp_parent_id,
               erp_hash = r.hash,
               erp_updated_at = r.erp_updated_at,
               erp_sincronizado_em = now(),
               erp_ausente_desde = NULL,
               deleted_at = NULL
         WHERE f.id::text = v_id;
        c_upd := c_upd + 1;
        CONTINUE;
      END IF;

      v_n := 0;
      v_cand := NULL;
      v_outro := NULL;
      v_motivo := NULL;
      IF coalesce(r.doc_valido, false) AND r.cnpj_cpf ~ '^([0-9]{11}|[0-9]{14})$' THEN
        SELECT count(*), min(f.id::text) INTO v_n, v_cand
          FROM public.fornecedores f
         WHERE f.deleted_at IS NULL AND f.erp_id IS NULL
           AND regexp_replace(coalesce(f.cnpj_cpf, ''), '\D', '', 'g') = r.cnpj_cpf;
        SELECT f.id::text INTO v_outro
          FROM public.fornecedores f
         WHERE f.erp_id IS NOT NULL
           AND regexp_replace(coalesce(f.cnpj_cpf, ''), '\D', '', 'g') = r.cnpj_cpf
         ORDER BY f.erp_id
         LIMIT 1;
        IF v_n > 1 THEN
          v_motivo := 'CNPJ_DUPLICADO_LOCAL';
        ELSIF v_n = 1 AND coalesce(r.cnpj_dup_erp, false) THEN
          v_motivo := 'CNPJ_DUPLICADO_ERP';
        ELSIF v_outro IS NOT NULL THEN
          v_motivo := 'LOCAL_JA_VINCULADO';
          IF v_n = 0 THEN
            v_cand := v_outro;
          END IF;
        END IF;
      END IF;

      IF v_n = 1 AND v_motivo IS NULL THEN
        UPDATE public.fornecedores f
           SET razao_social = btrim(r.razao_social),
               nome_fantasia = nullif(btrim(r.nome_fantasia), ''),
               cnpj_cpf = r.cnpj_cpf,
               email = coalesce(r.email, ''),
               telefone = coalesce(r.telefone, ''),
               cidade = nullif(btrim(r.cidade), ''),
               estado = nullif(btrim(r.estado), ''),
               status = CASE WHEN r.ativo THEN 'Ativo' ELSE 'Inativo' END,
               erp_id = r.erp_id,
               origem = 'ERP',
               erp_parent_id = r.erp_parent_id,
               erp_hash = r.hash,
               erp_updated_at = r.erp_updated_at,
               erp_sincronizado_em = now(),
               erp_ausente_desde = NULL
         WHERE f.id::text = v_cand AND f.erp_id IS NULL;
        c_vinc := c_vinc + 1;
        CONTINUE;
      END IF;

      INSERT INTO public.fornecedores (
        razao_social, nome_fantasia, cnpj_cpf, tipo, contato, telefone, email, cidade, estado, status,
        erp_id, origem, erp_parent_id, erp_hash, erp_updated_at, erp_sincronizado_em)
      VALUES (
        btrim(r.razao_social), nullif(btrim(r.nome_fantasia), ''), coalesce(r.cnpj_cpf, ''), 'Fornecedor', '',
        coalesce(r.telefone, ''), coalesce(r.email, ''), nullif(btrim(r.cidade), ''), nullif(btrim(r.estado), ''),
        CASE WHEN r.ativo THEN 'Ativo' ELSE 'Inativo' END,
        r.erp_id, 'ERP', r.erp_parent_id, r.hash, r.erp_updated_at, now());
      c_ins := c_ins + 1;

      IF v_motivo IS NOT NULL THEN
        INSERT INTO public.erp_sync_conflitos (recurso, execucao_id, erp_id, motivo, fornecedor_id)
        VALUES ('suppliers', p_execucao, r.erp_id, v_motivo, v_cand)
        ON CONFLICT (recurso, erp_id, motivo) WHERE resolvido_em IS NULL DO NOTHING;
        c_conf := c_conf + 1;
        v_conf := v_conf || jsonb_build_array(
          jsonb_build_object('erp_id', r.erp_id, 'motivo', v_motivo, 'fornecedor_id', v_cand));
      END IF;
    END LOOP;

    IF p_simular THEN
      RAISE EXCEPTION 'CENA_ERP_SIMULACAO' USING ERRCODE = 'P0099';
    END IF;
  EXCEPTION WHEN SQLSTATE 'P0099' THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'inseridos', c_ins, 'atualizados', c_upd, 'inalterados', c_ok, 'vinculados', c_vinc,
    'conflitos', c_conf, 'ignorados', c_ign, 'conflitos_lista', v_conf, 'simulado', coalesce(p_simular, false));
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_fornecedores_erp_marcar_ausentes(p_execucao uuid, p_ids_vistos integer[], p_total_erp integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_vinc integer;
  v_aus integer;
  v_lim integer;
  v_n integer;
BEGIN
  PERFORM public.fn_erp_sync_exigir_execucao(p_execucao, 'suppliers');
  IF p_ids_vistos IS NULL OR cardinality(p_ids_vistos) = 0 OR p_total_erp IS NULL OR p_total_erp <= 0
     OR (SELECT count(DISTINCT x) FROM unnest(p_ids_vistos) x WHERE x IS NOT NULL) <> p_total_erp THEN
    RAISE EXCEPTION 'ERP_SYNC_LEITURA_INCOMPLETA' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_vinc
    FROM public.fornecedores f
   WHERE f.erp_id IS NOT NULL AND f.erp_ausente_desde IS NULL;
  SELECT count(*) INTO v_aus
    FROM public.fornecedores f
   WHERE f.erp_id IS NOT NULL AND f.erp_ausente_desde IS NULL AND NOT (f.erp_id = ANY (p_ids_vistos));
  v_lim := greatest(20, ceil(v_vinc * 0.10)::integer);
  IF v_aus > v_lim THEN
    RAISE EXCEPTION 'ERP_SYNC_AUSENTES_ACIMA_DO_LIMITE: % ausentes de % vinculados (limite %)', v_aus, v_vinc, v_lim
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.fornecedores f
     SET status = 'Inativo', erp_ausente_desde = now(), erp_sincronizado_em = now()
   WHERE f.erp_id IS NOT NULL AND f.erp_ausente_desde IS NULL AND NOT (f.erp_id = ANY (p_ids_vistos));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_erp_sync_finalizar(
  p_execucao uuid, p_status text, p_modo text, p_contadores jsonb,
  p_watermark_novo timestamptz, p_erro text, p_resumo jsonb DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rec text;
  v_avanca boolean := p_status = 'OK' AND p_modo <> 'SIMULACAO';
  c jsonb := coalesce(p_contadores, '{}'::jsonb);
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('OK', 'PARCIAL', 'ERRO') THEN
    RAISE EXCEPTION 'ERP_SYNC_STATUS_INVALIDO' USING ERRCODE = '22023';
  END IF;
  IF p_modo IS NULL OR p_modo NOT IN ('INCREMENTAL', 'COMPLETA', 'SIMULACAO') THEN
    RAISE EXCEPTION 'ERP_SYNC_MODO_INVALIDO' USING ERRCODE = '22023';
  END IF;

  UPDATE public.erp_sync_execucoes e
     SET status = p_status,
         modo = p_modo,
         finalizado_em = now(),
         paginas = coalesce((c ->> 'paginas')::integer, 0),
         lidos = coalesce((c ->> 'lidos')::integer, 0),
         inseridos = coalesce((c ->> 'inseridos')::integer, 0),
         atualizados = coalesce((c ->> 'atualizados')::integer, 0),
         inalterados = coalesce((c ->> 'inalterados')::integer, 0),
         vinculados = coalesce((c ->> 'vinculados')::integer, 0),
         inativados = coalesce((c ->> 'inativados')::integer, 0),
         conflitos = coalesce((c ->> 'conflitos')::integer, 0),
         ignorados = coalesce((c ->> 'ignorados')::integer, 0),
         watermark_novo = CASE WHEN v_avanca THEN p_watermark_novo END,
         erro = left(p_erro, 1000),
         resumo = p_resumo
   WHERE e.id = p_execucao AND e.status = 'EM_EXECUCAO'
  RETURNING e.recurso INTO v_rec;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERP_SYNC_EXECUCAO_INVALIDA' USING ERRCODE = '22023';
  END IF;

  UPDATE public.erp_sync_estado s
     SET em_execucao_desde = NULL,
         em_execucao_id = NULL,
         ultima_execucao_id = p_execucao,
         atualizado_em = now(),
         watermark_updated_at = CASE
           WHEN v_avanca AND p_watermark_novo IS NOT NULL
             THEN greatest(coalesce(s.watermark_updated_at, p_watermark_novo), p_watermark_novo)
           ELSE s.watermark_updated_at END,
         ultima_completa_em = CASE WHEN v_avanca AND p_modo = 'COMPLETA' THEN now() ELSE s.ultima_completa_em END
   WHERE s.recurso = v_rec AND s.em_execucao_id = p_execucao;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_erp_sync_exigir_execucao(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_erp_sync_iniciar(text, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_fornecedores_erp_aplicar(uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_fornecedores_erp_marcar_ausentes(uuid, integer[], integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_erp_sync_finalizar(uuid, text, text, jsonb, timestamptz, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_erp_sync_exigir_execucao(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_erp_sync_iniciar(text, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_fornecedores_erp_aplicar(uuid, jsonb, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_fornecedores_erp_marcar_ausentes(uuid, integer[], integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_erp_sync_finalizar(uuid, text, text, jsonb, timestamptz, text, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';

-- Validação
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'fornecedores' AND (column_name LIKE 'erp_%' OR column_name IN ('origem','nome_fantasia','cidade','estado'));
-- SELECT * FROM public.erp_sync_estado;
-- SELECT p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
--        has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_exec
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.proname LIKE 'fn_%erp%';
-- SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
--  WHERE relname IN ('erp_sync_estado','erp_sync_execucoes','erp_sync_conflitos');
-- SELECT origem, count(*) FROM public.fornecedores WHERE deleted_at IS NULL GROUP BY origem;

-- Para desfazer
-- DROP TRIGGER IF EXISTS trg_fornecedores_erp_proteger ON public.fornecedores;
-- DROP FUNCTION IF EXISTS public.fn_fornecedores_erp_proteger();
-- DROP FUNCTION IF EXISTS public.fn_erp_sync_finalizar(uuid, text, text, jsonb, timestamptz, text, jsonb);
-- DROP FUNCTION IF EXISTS public.fn_fornecedores_erp_marcar_ausentes(uuid, integer[], integer);
-- DROP FUNCTION IF EXISTS public.fn_fornecedores_erp_aplicar(uuid, jsonb, boolean);
-- DROP FUNCTION IF EXISTS public.fn_erp_sync_iniciar(text, text, text, uuid);
-- DROP FUNCTION IF EXISTS public.fn_erp_sync_exigir_execucao(uuid, text);
-- DROP TABLE IF EXISTS public.erp_sync_conflitos;
-- DROP TABLE IF EXISTS public.erp_sync_execucoes;
-- DROP TABLE IF EXISTS public.erp_sync_estado;
-- DROP FUNCTION IF EXISTS public.cena_forn_pode_sincronizar_erp();
-- DROP INDEX IF EXISTS public.fornecedores_cnpj_digitos_idx;
-- ALTER TABLE public.fornecedores DROP CONSTRAINT IF EXISTS fornecedores_erp_hash_chk;
-- ALTER TABLE public.fornecedores DROP CONSTRAINT IF EXISTS fornecedores_erp_vinculo_chk;
-- ALTER TABLE public.fornecedores DROP CONSTRAINT IF EXISTS fornecedores_origem_chk;
-- ALTER TABLE public.fornecedores DROP CONSTRAINT IF EXISTS fornecedores_erp_id_key;
-- ALTER TABLE public.fornecedores DROP COLUMN IF EXISTS origem, DROP COLUMN IF EXISTS erp_ausente_desde,
--   DROP COLUMN IF EXISTS erp_sincronizado_em, DROP COLUMN IF EXISTS erp_updated_at, DROP COLUMN IF EXISTS erp_hash,
--   DROP COLUMN IF EXISTS erp_parent_id, DROP COLUMN IF EXISTS erp_id;
-- NOTIFY pgrst, 'reload schema';
