-- ETAPA 1.2 (ENEL/LMS/WL) — Perfil de processo por contrato e projeto
-- Catálogo versionado (cena_processo_perfis + histórico), sugestão por contrato (cena_contrato_processo_perfil),
-- processo congelado do projeto (sot_projeto_processo) com histórico append-only (sot_projeto_processo_eventos),
-- leitura do perfil efetivo e RPCs controladas. Nenhuma tela usa isso ainda: zero mudança de comportamento.
-- Projeto sem linha em sot_projeto_processo = BASE_PROJETOS derivado (fluxo atual do ERP). Sem backfill.
-- Sugestão do contrato nunca congela projeto; congelar e alterar só por RPC explícita.
-- Estrutura WL (etapas futuras) e perfil de processo são independentes: nada aqui reage a LMS/WL.
-- Aditiva. Não altera sot_projetos, contratos, usuarios_sistema, matriz da Etapa 1.1, TMA nem a Programação atual.
-- Sem FK física para sot_projetos (há fluxo legado que pode apagar projeto fisicamente); a existência é validada nas funções.
-- Autorização só por auth.uid() → usuarios_sistema.auth_user_id e cena_pode('PROJ_ALTERAR_PERFIL_PROCESSO', contrato).
-- Transação explícita (também no SQL Editor): qualquer falha desfaz a Etapa 1.2 inteira.

BEGIN;

-- ── 0. Pré-condições (falha inteira, nada é aplicado) ────────────────────
DO $$
BEGIN
  IF to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'auth.uid() não existe';
  END IF;
  IF to_regprocedure('public.cena_usuario_perfil_sessao()') IS NULL
     OR to_regprocedure('public.cena_usuario_id_sessao()') IS NULL
     OR to_regprocedure('public.cena_usuario_erp_ativo()') IS NULL
     OR to_regprocedure('public.cena_usuarios_pode_administrar()') IS NULL THEN
    RAISE EXCEPTION 'aplique antes 20261004190000_seguranca_usuarios_sistema.sql (helpers de sessão)';
  END IF;
  IF to_regprocedure('public.cena_pode(text, uuid)') IS NULL OR to_regclass('public.cena_acoes') IS NULL THEN
    RAISE EXCEPTION 'aplique antes 20261007190000_cena_permissoes_acao.sql (cena_pode)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cena_acoes WHERE codigo = 'PROJ_ALTERAR_PERFIL_PROCESSO' AND ativo IS TRUE) THEN
    RAISE EXCEPTION 'ação PROJ_ALTERAR_PERFIL_PROCESSO ausente ou inativa em cena_acoes';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'contratos'
                   AND column_name = 'id' AND data_type = 'uuid') THEN
    RAISE EXCEPTION 'contratos.id não é uuid';
  END IF;
  IF to_regclass('public.sot_projetos') IS NULL THEN
    RAISE EXCEPTION 'public.sot_projetos não existe';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'sot_projetos'
                   AND column_name = 'id' AND data_type = 'uuid') THEN
    RAISE EXCEPTION 'sot_projetos.id não é uuid';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'sot_projetos' AND column_name = 'contrato_id') THEN
    RAISE EXCEPTION 'sot_projetos sem a coluna contrato_id';
  END IF;
  IF NOT coalesce((SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user), false) THEN
    RAISE EXCEPTION 'Rode como dono com BYPASSRLS: as funções SECURITY DEFINER leem tabelas com RLS FORCE';
  END IF;
END $$;

-- ── 1. Catálogo versionado de perfis de processo ─────────────────────────
-- Imutáveis sempre: id, codigo_perfil, versao, requisitos, criado_em, criado_por_auth.
-- Administrativos (com justificativa e histórico): nome, descricao, ativo.
-- Mudou o processo = nova versão. Versão inativa não entra em congelamento/sugestão nova;
-- projeto já congelado nela continua com ela.
CREATE TABLE IF NOT EXISTS public.cena_processo_perfis (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_perfil       text NOT NULL,
  versao              integer NOT NULL,
  nome                text NOT NULL,
  descricao           text NOT NULL,
  requisitos          jsonb NOT NULL DEFAULT '{}'::jsonb,
  ativo               boolean NOT NULL DEFAULT true,
  justificativa       text NOT NULL,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  criado_por_auth     uuid,
  atualizado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_por_auth uuid,
  CONSTRAINT cena_processo_perfis_codigo_versao_key UNIQUE (codigo_perfil, versao),
  CONSTRAINT cena_processo_perfis_codigo_chk CHECK (codigo_perfil ~ '^[A-Z][A-Z0-9_]{2,62}$'),
  CONSTRAINT cena_processo_perfis_versao_chk CHECK (versao > 0),
  CONSTRAINT cena_processo_perfis_nome_chk CHECK (btrim(nome) <> ''),
  CONSTRAINT cena_processo_perfis_descricao_chk CHECK (btrim(descricao) <> ''),
  CONSTRAINT cena_processo_perfis_requisitos_chk CHECK (jsonb_typeof(requisitos) = 'object'),
  CONSTRAINT cena_processo_perfis_justificativa_chk CHECK (btrim(justificativa) <> '')
);
COMMENT ON TABLE public.cena_processo_perfis IS
  'Etapa 1.2: catálogo versionado de perfis de processo. Requisitos de uma versão nunca mudam; mudança = nova versão.';

CREATE TABLE IF NOT EXISTS public.cena_processo_perfis_eventos (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  perfil_id      uuid NOT NULL REFERENCES public.cena_processo_perfis (id),
  codigo_perfil  text NOT NULL,
  versao         integer NOT NULL,
  tipo_evento    text NOT NULL,
  antes          jsonb,
  depois         jsonb NOT NULL,
  justificativa  text NOT NULL,
  por_auth       uuid,
  por_usuario_id text,
  registrado_em  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cena_processo_perfis_eventos_tipo_chk
    CHECK (tipo_evento IN ('CRIAR', 'ATIVAR', 'DESATIVAR', 'ALTERAR_TEXTO'))
);
CREATE INDEX IF NOT EXISTS cena_processo_perfis_eventos_perfil_idx
  ON public.cena_processo_perfis_eventos (perfil_id, id);
COMMENT ON TABLE public.cena_processo_perfis_eventos IS 'Etapa 1.2: histórico append-only do catálogo de perfis.';

-- ── 2. Sugestão por contrato (só orienta congelamentos futuros; não retroage) ──
-- Linha revogada é definitiva; trocar a sugestão = revogar a vigente e criar outra. As linhas são o histórico.
CREATE TABLE IF NOT EXISTS public.cena_contrato_processo_perfil (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id             uuid NOT NULL REFERENCES public.contratos (id),
  perfil_codigo           text NOT NULL,
  perfil_versao           integer NOT NULL,
  justificativa           text NOT NULL,
  definido_em             timestamptz NOT NULL DEFAULT now(),
  definido_por_auth       uuid NOT NULL,
  revogado_em             timestamptz,
  revogado_por_auth       uuid,
  justificativa_revogacao text,
  CONSTRAINT cena_contrato_processo_perfil_perfil_fkey
    FOREIGN KEY (perfil_codigo, perfil_versao) REFERENCES public.cena_processo_perfis (codigo_perfil, versao),
  CONSTRAINT cena_contrato_processo_perfil_justificativa_chk CHECK (btrim(justificativa) <> ''),
  CONSTRAINT cena_contrato_processo_perfil_revogacao_chk CHECK (
    (revogado_em IS NULL AND revogado_por_auth IS NULL AND justificativa_revogacao IS NULL)
    OR (revogado_em IS NOT NULL AND revogado_por_auth IS NOT NULL AND btrim(coalesce(justificativa_revogacao, '')) <> ''))
);
CREATE UNIQUE INDEX IF NOT EXISTS cena_contrato_processo_perfil_vigente_uidx
  ON public.cena_contrato_processo_perfil (contrato_id) WHERE revogado_em IS NULL;
COMMENT ON TABLE public.cena_contrato_processo_perfil IS
  'Etapa 1.2: perfil SUGERIDO pelo contrato. Não é o perfil do projeto e não altera projetos já congelados.';

-- ── 3. Processo congelado do projeto (fonte oficial) ─────────────────────
-- Sem FK para sot_projetos. Sem linha = BASE_PROJETOS derivado. Um processo atual por projeto (UNIQUE).
-- congelado_* = perfil/versão vigentes; criado_* = primeiro congelamento. Escrita só pelas funções desta migration.
CREATE TABLE IF NOT EXISTS public.sot_projeto_processo (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id          uuid NOT NULL,
  perfil_codigo       text NOT NULL,
  perfil_versao       integer NOT NULL,
  origem_congelamento text NOT NULL,
  justificativa       text NOT NULL,
  metadados           jsonb NOT NULL DEFAULT '{}'::jsonb,
  congelado_em        timestamptz NOT NULL DEFAULT now(),
  congelado_por_auth  uuid NOT NULL,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  criado_por_auth     uuid NOT NULL,
  CONSTRAINT sot_projeto_processo_projeto_key UNIQUE (projeto_id),
  CONSTRAINT sot_projeto_processo_perfil_fkey
    FOREIGN KEY (perfil_codigo, perfil_versao) REFERENCES public.cena_processo_perfis (codigo_perfil, versao),
  CONSTRAINT sot_projeto_processo_origem_chk
    CHECK (origem_congelamento IN ('GESTOR', 'LMS_ORIGINAL_ESTRUTURA_NOVA')),
  CONSTRAINT sot_projeto_processo_justificativa_chk CHECK (btrim(justificativa) <> ''),
  CONSTRAINT sot_projeto_processo_metadados_chk CHECK (jsonb_typeof(metadados) = 'object')
);
CREATE INDEX IF NOT EXISTS sot_projeto_processo_perfil_idx
  ON public.sot_projeto_processo (perfil_codigo, perfil_versao);
COMMENT ON TABLE public.sot_projeto_processo IS
  'Etapa 1.2: processo CONGELADO do projeto. Sem linha = BASE_PROJETOS derivado. Sem FK para sot_projetos (exclusão física legada).';

-- Primeiro congelamento: anterior = BASE_PROJETOS derivado (sem versão). Alteração: anterior = versão congelada.
CREATE TABLE IF NOT EXISTS public.sot_projeto_processo_eventos (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  projeto_id             uuid NOT NULL REFERENCES public.sot_projeto_processo (projeto_id),
  tipo_evento            text NOT NULL,
  origem                 text NOT NULL,
  perfil_codigo_anterior text NOT NULL,
  perfil_versao_anterior integer,
  perfil_codigo_novo     text NOT NULL,
  perfil_versao_novo     integer NOT NULL,
  contrato_id_projeto    text,
  justificativa          text NOT NULL,
  metadados              jsonb NOT NULL DEFAULT '{}'::jsonb,
  por_auth               uuid NOT NULL,
  por_usuario_id         text,
  registrado_em          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sot_projeto_processo_eventos_tipo_chk CHECK (
    (tipo_evento = 'CONGELAR' AND perfil_codigo_anterior = 'BASE_PROJETOS' AND perfil_versao_anterior IS NULL)
    OR (tipo_evento = 'ALTERAR' AND perfil_versao_anterior IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS sot_projeto_processo_eventos_projeto_idx
  ON public.sot_projeto_processo_eventos (projeto_id, id);
COMMENT ON TABLE public.sot_projeto_processo_eventos IS 'Etapa 1.2: histórico append-only do processo do projeto.';

-- ── 4. Projeto real (estrutura real de sot_projetos; deleted_at opcional) ──
-- contrato_id de sot_projetos é texto legado: devolvido como texto, sem CAST aqui.
DO $$
DECLARE
  v_excluido text := 'false';
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'sot_projetos' AND column_name = 'deleted_at') THEN
    v_excluido := 'sp.deleted_at IS NOT NULL';
  END IF;
  EXECUTE format($f$
    CREATE OR REPLACE FUNCTION public.sot_projeto_processo_contexto(p_projeto_id uuid)
    RETURNS TABLE (o_excluido boolean, o_contrato text)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $b$
      SELECT %s, nullif(btrim(sp.contrato_id::text), '')
      FROM public.sot_projetos sp
      WHERE sp.id = p_projeto_id
    $b$
  $f$, v_excluido);
END $$;

-- Texto legado de sot_projetos.contrato_id → contratos.id, sem CAST que possa falhar.
-- NULL quando não é UUID válido ou não existe em contratos.
CREATE OR REPLACE FUNCTION public.sot_projeto_processo_contrato_uuid(p_contrato text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_txt text := btrim(coalesce(p_contrato, ''));
BEGIN
  IF v_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  RETURN (SELECT c.id FROM public.contratos c WHERE c.id = v_txt::uuid);
END;
$$;

-- Sugestão vigente do contrato do projeto (pode não existir).
CREATE OR REPLACE FUNCTION public.sot_projeto_processo_sugestao(p_contrato text)
RETURNS TABLE (o_codigo text, o_versao integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.perfil_codigo, s.perfil_versao
  FROM public.cena_contrato_processo_perfil s
  WHERE s.contrato_id = public.sot_projeto_processo_contrato_uuid(p_contrato) AND s.revogado_em IS NULL
$$;

-- ── 5. Gatilhos do catálogo ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cena_processo_perfis_proteger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'cena_processo_perfis: escrita direta não permitida; use cena_processo_perfil_criar_versao / cena_processo_perfil_administrar'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'cena_processo_perfis: versão de perfil não é apagada; desative-a' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.codigo_perfil IS DISTINCT FROM OLD.codigo_perfil
     OR NEW.versao IS DISTINCT FROM OLD.versao
     OR NEW.requisitos IS DISTINCT FROM OLD.requisitos
     OR NEW.criado_em IS DISTINCT FROM OLD.criado_em
     OR NEW.criado_por_auth IS DISTINCT FROM OLD.criado_por_auth THEN
    RAISE EXCEPTION 'cena_processo_perfis: código, versão e requisitos de uma versão não mudam; crie uma nova versão'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cena_processo_perfis_proteger ON public.cena_processo_perfis;
CREATE TRIGGER trg_cena_processo_perfis_proteger
  BEFORE INSERT OR UPDATE OR DELETE ON public.cena_processo_perfis
  FOR EACH ROW EXECUTE FUNCTION public.cena_processo_perfis_proteger();
DROP TRIGGER IF EXISTS trg_cena_processo_perfis_sem_truncate ON public.cena_processo_perfis;
CREATE TRIGGER trg_cena_processo_perfis_sem_truncate
  BEFORE TRUNCATE ON public.cena_processo_perfis
  FOR EACH STATEMENT EXECUTE FUNCTION public.cena_processo_perfis_proteger();

CREATE OR REPLACE FUNCTION public.cena_processo_perfis_auditar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tipo text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_tipo := 'CRIAR';
  ELSIF NEW.ativo IS DISTINCT FROM OLD.ativo THEN
    v_tipo := CASE WHEN NEW.ativo THEN 'ATIVAR' ELSE 'DESATIVAR' END;
  ELSE
    v_tipo := 'ALTERAR_TEXTO';
  END IF;
  INSERT INTO public.cena_processo_perfis_eventos
    (perfil_id, codigo_perfil, versao, tipo_evento, antes, depois, justificativa, por_auth, por_usuario_id)
  VALUES
    (NEW.id, NEW.codigo_perfil, NEW.versao, v_tipo,
     CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END, to_jsonb(NEW), NEW.justificativa,
     auth.uid(), public.cena_usuario_id_sessao()::text);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_cena_processo_perfis_auditar ON public.cena_processo_perfis;
CREATE TRIGGER trg_cena_processo_perfis_auditar
  AFTER INSERT OR UPDATE ON public.cena_processo_perfis
  FOR EACH ROW EXECUTE FUNCTION public.cena_processo_perfis_auditar();

-- ── 6. Gatilhos da sugestão por contrato ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.cena_contrato_processo_perfil_proteger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'cena_contrato_processo_perfil: escrita direta não permitida; use cena_contrato_processo_perfil_definir'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'cena_contrato_processo_perfil: sugestão não é apagada; revogue-a' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.revogado_em IS NOT NULL THEN
      RAISE EXCEPTION 'cena_contrato_processo_perfil: sugestão revogada não muda' USING ERRCODE = '42501';
    END IF;
    IF NEW.revogado_em IS NULL
       OR NEW.id IS DISTINCT FROM OLD.id
       OR NEW.contrato_id IS DISTINCT FROM OLD.contrato_id
       OR NEW.perfil_codigo IS DISTINCT FROM OLD.perfil_codigo
       OR NEW.perfil_versao IS DISTINCT FROM OLD.perfil_versao
       OR NEW.justificativa IS DISTINCT FROM OLD.justificativa
       OR NEW.definido_em IS DISTINCT FROM OLD.definido_em
       OR NEW.definido_por_auth IS DISTINCT FROM OLD.definido_por_auth THEN
      RAISE EXCEPTION 'cena_contrato_processo_perfil: só é permitido revogar a sugestão vigente' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cena_contrato_processo_perfil_proteger ON public.cena_contrato_processo_perfil;
CREATE TRIGGER trg_cena_contrato_processo_perfil_proteger
  BEFORE INSERT OR UPDATE OR DELETE ON public.cena_contrato_processo_perfil
  FOR EACH ROW EXECUTE FUNCTION public.cena_contrato_processo_perfil_proteger();
DROP TRIGGER IF EXISTS trg_cena_contrato_processo_perfil_sem_truncate ON public.cena_contrato_processo_perfil;
CREATE TRIGGER trg_cena_contrato_processo_perfil_sem_truncate
  BEFORE TRUNCATE ON public.cena_contrato_processo_perfil
  FOR EACH STATEMENT EXECUTE FUNCTION public.cena_contrato_processo_perfil_proteger();

-- ── 7. Gatilhos do processo congelado e dos históricos ───────────────────
-- Vale para todos: escrita só com sessão autenticada (auth.uid()), dentro das funções SECURITY DEFINER.
-- anon/authenticated não gravam direto nem que um GRANT apareça depois; SQL Editor sem sessão não faz backfill.
CREATE OR REPLACE FUNCTION public.sot_projeto_processo_proteger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'sot_projeto_processo: escrita direta não permitida; use cena_projeto_processo_congelar / cena_projeto_processo_alterar'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'sot_projeto_processo: processo congelado não é apagado' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'sot_projeto_processo: gravação exige sessão autenticada (auth.uid())' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.criado_por_auth IS DISTINCT FROM auth.uid() OR NEW.congelado_por_auth IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'sot_projeto_processo: autoria deve ser o usuário da sessão' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.projeto_id IS DISTINCT FROM OLD.projeto_id
       OR NEW.criado_em IS DISTINCT FROM OLD.criado_em
       OR NEW.criado_por_auth IS DISTINCT FROM OLD.criado_por_auth THEN
      RAISE EXCEPTION 'sot_projeto_processo: projeto e congelamento original não mudam' USING ERRCODE = '42501';
    END IF;
    IF NEW.congelado_por_auth IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'sot_projeto_processo: autoria deve ser o usuário da sessão' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sot_projeto_processo_proteger ON public.sot_projeto_processo;
CREATE TRIGGER trg_sot_projeto_processo_proteger
  BEFORE INSERT OR UPDATE OR DELETE ON public.sot_projeto_processo
  FOR EACH ROW EXECUTE FUNCTION public.sot_projeto_processo_proteger();
DROP TRIGGER IF EXISTS trg_sot_projeto_processo_sem_truncate ON public.sot_projeto_processo;
CREATE TRIGGER trg_sot_projeto_processo_sem_truncate
  BEFORE TRUNCATE ON public.sot_projeto_processo
  FOR EACH STATEMENT EXECUTE FUNCTION public.sot_projeto_processo_proteger();

-- Todo INSERT/UPDATE gera evento (mesmo que uma função futura grave por outro caminho).
CREATE OR REPLACE FUNCTION public.sot_projeto_processo_auditar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_contrato text;
  v_sug_cod  text;
  v_sug_ver  integer;
BEGIN
  SELECT c.o_contrato INTO v_contrato FROM public.sot_projeto_processo_contexto(NEW.projeto_id) c;
  SELECT s.o_codigo, s.o_versao INTO v_sug_cod, v_sug_ver FROM public.sot_projeto_processo_sugestao(v_contrato) s;
  INSERT INTO public.sot_projeto_processo_eventos
    (projeto_id, tipo_evento, origem, perfil_codigo_anterior, perfil_versao_anterior,
     perfil_codigo_novo, perfil_versao_novo, contrato_id_projeto, justificativa, metadados, por_auth, por_usuario_id)
  VALUES
    (NEW.projeto_id,
     CASE WHEN TG_OP = 'INSERT' THEN 'CONGELAR' ELSE 'ALTERAR' END,
     NEW.origem_congelamento,
     CASE WHEN TG_OP = 'INSERT' THEN 'BASE_PROJETOS' ELSE OLD.perfil_codigo END,
     CASE WHEN TG_OP = 'UPDATE' THEN OLD.perfil_versao END,
     NEW.perfil_codigo, NEW.perfil_versao, v_contrato, NEW.justificativa,
     NEW.metadados || jsonb_build_object(
       'anterior_derivado', TG_OP = 'INSERT',
       'sugestao_contrato', CASE WHEN v_sug_cod IS NULL THEN NULL
                                 ELSE jsonb_build_object('perfil_codigo', v_sug_cod, 'perfil_versao', v_sug_ver) END),
     auth.uid(), public.cena_usuario_id_sessao()::text);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sot_projeto_processo_auditar ON public.sot_projeto_processo;
CREATE TRIGGER trg_sot_projeto_processo_auditar
  AFTER INSERT OR UPDATE ON public.sot_projeto_processo
  FOR EACH ROW EXECUTE FUNCTION public.sot_projeto_processo_auditar();

CREATE OR REPLACE FUNCTION public.cena_processo_historico_imutavel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION '%: histórico não é alterado nem apagado', TG_TABLE_NAME USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_sot_projeto_processo_eventos_imutavel ON public.sot_projeto_processo_eventos;
CREATE TRIGGER trg_sot_projeto_processo_eventos_imutavel
  BEFORE UPDATE OR DELETE ON public.sot_projeto_processo_eventos
  FOR EACH ROW EXECUTE FUNCTION public.cena_processo_historico_imutavel();
DROP TRIGGER IF EXISTS trg_sot_projeto_processo_eventos_sem_truncate ON public.sot_projeto_processo_eventos;
CREATE TRIGGER trg_sot_projeto_processo_eventos_sem_truncate
  BEFORE TRUNCATE ON public.sot_projeto_processo_eventos
  FOR EACH STATEMENT EXECUTE FUNCTION public.cena_processo_historico_imutavel();
DROP TRIGGER IF EXISTS trg_cena_processo_perfis_eventos_imutavel ON public.cena_processo_perfis_eventos;
CREATE TRIGGER trg_cena_processo_perfis_eventos_imutavel
  BEFORE UPDATE OR DELETE ON public.cena_processo_perfis_eventos
  FOR EACH ROW EXECUTE FUNCTION public.cena_processo_historico_imutavel();
DROP TRIGGER IF EXISTS trg_cena_processo_perfis_eventos_sem_truncate ON public.cena_processo_perfis_eventos;
CREATE TRIGGER trg_cena_processo_perfis_eventos_sem_truncate
  BEFORE TRUNCATE ON public.cena_processo_perfis_eventos
  FOR EACH STATEMENT EXECUTE FUNCTION public.cena_processo_historico_imutavel();

-- ── 8. Funções internas (sem EXECUTE para ninguém) ───────────────────────
CREATE OR REPLACE FUNCTION public.cena_processo_perfil_exigir(p_codigo text, p_versao integer)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ativo boolean;
BEGIN
  IF p_codigo IS NULL OR btrim(p_codigo) = '' OR p_versao IS NULL THEN
    RAISE EXCEPTION 'perfil de processo: código e versão obrigatórios' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cena_processo_perfis WHERE codigo_perfil = p_codigo) THEN
    RAISE EXCEPTION 'perfil de processo inexistente: %', p_codigo USING ERRCODE = '22023';
  END IF;
  SELECT ativo INTO v_ativo FROM public.cena_processo_perfis WHERE codigo_perfil = p_codigo AND versao = p_versao;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'perfil de processo %: versão % inexistente', p_codigo, p_versao USING ERRCODE = '22023';
  END IF;
  IF v_ativo IS NOT TRUE THEN
    RAISE EXCEPTION 'perfil de processo %: versão % inativa', p_codigo, p_versao USING ERRCODE = '22023';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.cena_processo_exigir_sessao()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.cena_usuario_perfil_sessao() IS NULL THEN
    RAISE EXCEPTION 'perfil de processo: sem sessão de usuário ativo' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Projeto existe e quem chama tem PROJ_ALTERAR_PERFIL_PROCESSO no contrato do projeto.
-- Sem contrato → regra global de cena_pode. Contrato em texto que não é contratos.id → recusa (nunca cai para a global).
CREATE OR REPLACE FUNCTION public.sot_projeto_processo_autorizar(p_projeto_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existe   boolean;
  v_contrato text;
  v_ctr      uuid;
BEGIN
  SELECT true, c.o_contrato INTO v_existe, v_contrato FROM public.sot_projeto_processo_contexto(p_projeto_id) c;
  IF v_existe IS NULL THEN
    RAISE EXCEPTION 'perfil de processo: projeto inexistente' USING ERRCODE = 'P0002';
  END IF;
  IF v_contrato IS NOT NULL THEN
    v_ctr := public.sot_projeto_processo_contrato_uuid(v_contrato);
    IF v_ctr IS NULL THEN
      RAISE EXCEPTION 'perfil de processo: contrato do projeto não identificado' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NOT coalesce(public.cena_pode('PROJ_ALTERAR_PERFIL_PROCESSO', v_ctr), false) THEN
    RAISE EXCEPTION 'perfil de processo: sem permissão PROJ_ALTERAR_PERFIL_PROCESSO neste contrato' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Grava (congela ou altera). Não autoriza: quem chama já autorizou.
-- CONGELAR: só projeto sem processo; repetir o mesmo perfil/versão = SEM_MUDANCA (duplo clique, duas abas).
-- ALTERAR: só projeto congelado; exige o perfil/versão atual que o usuário viu (concorrência otimista).
-- A Etapa 1.3 (LMS ORIGINAL em ESTRUTURA_NOVA) chama esta função com origem LMS_ORIGINAL_ESTRUTURA_NOVA.
CREATE OR REPLACE FUNCTION public.sot_projeto_processo_gravar(
  p_projeto_id uuid, p_modo text, p_perfil_codigo text, p_perfil_versao integer, p_origem text, p_justificativa text,
  p_atual_codigo text DEFAULT NULL, p_atual_versao integer DEFAULT NULL, p_metadados jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_just     text := btrim(coalesce(p_justificativa, ''));
  v_meta     jsonb := coalesce(p_metadados, '{}'::jsonb);
  v_existe   boolean;
  v_excluido boolean;
  v_atual    public.sot_projeto_processo%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'perfil de processo: sem sessão autenticada' USING ERRCODE = '42501';
  END IF;
  IF p_projeto_id IS NULL THEN
    RAISE EXCEPTION 'perfil de processo: projeto obrigatório' USING ERRCODE = '22023';
  END IF;
  IF p_modo IS NULL OR p_modo NOT IN ('CONGELAR', 'ALTERAR') THEN
    RAISE EXCEPTION 'perfil de processo: modo inválido' USING ERRCODE = '22023';
  END IF;
  IF v_just = '' THEN
    RAISE EXCEPTION 'perfil de processo: justificativa obrigatória' USING ERRCODE = '22023';
  END IF;
  IF p_origem IS NULL OR p_origem NOT IN ('GESTOR', 'LMS_ORIGINAL_ESTRUTURA_NOVA') THEN
    RAISE EXCEPTION 'perfil de processo: origem inválida' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_meta) <> 'object' THEN
    RAISE EXCEPTION 'perfil de processo: metadados devem ser objeto JSON' USING ERRCODE = '22023';
  END IF;
  IF p_modo = 'ALTERAR' AND (p_atual_codigo IS NULL OR p_atual_versao IS NULL) THEN
    RAISE EXCEPTION 'perfil de processo: informe o perfil e a versão atuais do projeto' USING ERRCODE = '22023';
  END IF;
  PERFORM public.cena_processo_perfil_exigir(p_perfil_codigo, p_perfil_versao);

  PERFORM pg_advisory_xact_lock(hashtextextended('sot_projeto_processo|' || p_projeto_id::text, 0));

  SELECT true, c.o_excluido INTO v_existe, v_excluido FROM public.sot_projeto_processo_contexto(p_projeto_id) c;
  IF v_existe IS NULL THEN
    RAISE EXCEPTION 'perfil de processo: projeto inexistente' USING ERRCODE = 'P0002';
  END IF;
  IF v_excluido THEN
    RAISE EXCEPTION 'perfil de processo: projeto excluído' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_atual FROM public.sot_projeto_processo WHERE projeto_id = p_projeto_id FOR UPDATE;

  IF p_modo = 'CONGELAR' THEN
    IF FOUND THEN
      IF v_atual.perfil_codigo = p_perfil_codigo AND v_atual.perfil_versao = p_perfil_versao THEN
        RETURN jsonb_build_object('projeto_id', p_projeto_id, 'perfil_codigo', v_atual.perfil_codigo,
                                  'perfil_versao', v_atual.perfil_versao, 'operacao', 'SEM_MUDANCA');
      END IF;
      RAISE EXCEPTION 'perfil de processo: projeto já congelado em % v%; use cena_projeto_processo_alterar',
        v_atual.perfil_codigo, v_atual.perfil_versao USING ERRCODE = '55000';
    END IF;
    INSERT INTO public.sot_projeto_processo
      (projeto_id, perfil_codigo, perfil_versao, origem_congelamento, justificativa, metadados,
       congelado_por_auth, criado_por_auth)
    VALUES
      (p_projeto_id, p_perfil_codigo, p_perfil_versao, p_origem, v_just, v_meta, auth.uid(), auth.uid());
    RETURN jsonb_build_object('projeto_id', p_projeto_id, 'perfil_codigo', p_perfil_codigo,
                              'perfil_versao', p_perfil_versao, 'operacao', 'CONGELAR');
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'perfil de processo: projeto sem processo congelado (BASE_PROJETOS derivado); use cena_projeto_processo_congelar'
      USING ERRCODE = '55000';
  END IF;
  IF v_atual.perfil_codigo IS DISTINCT FROM p_atual_codigo OR v_atual.perfil_versao IS DISTINCT FROM p_atual_versao THEN
    RAISE EXCEPTION 'perfil de processo: o processo do projeto mudou (agora % v%); recarregue antes de alterar',
      v_atual.perfil_codigo, v_atual.perfil_versao USING ERRCODE = '55000';
  END IF;
  IF v_atual.perfil_codigo = p_perfil_codigo AND v_atual.perfil_versao = p_perfil_versao THEN
    RETURN jsonb_build_object('projeto_id', p_projeto_id, 'perfil_codigo', v_atual.perfil_codigo,
                              'perfil_versao', v_atual.perfil_versao, 'operacao', 'SEM_MUDANCA');
  END IF;
  UPDATE public.sot_projeto_processo
     SET perfil_codigo = p_perfil_codigo, perfil_versao = p_perfil_versao, origem_congelamento = p_origem,
         justificativa = v_just, metadados = v_meta, congelado_em = now(), congelado_por_auth = auth.uid()
   WHERE projeto_id = p_projeto_id;
  RETURN jsonb_build_object('projeto_id', p_projeto_id, 'perfil_codigo', p_perfil_codigo,
                            'perfil_versao', p_perfil_versao, 'operacao', 'ALTERAR');
END;
$$;

-- ── 9. RPCs do projeto ───────────────────────────────────────────────────
-- Perfil efetivo e sugerido, em colunas separadas.
-- congelado = false → BASE_PROJETOS derivado (fluxo atual), sem versão e sem requisitos.
-- sugerido_* = sugestão vigente do contrato; informativo, nunca é o efetivo. Projeto inexistente → nenhuma linha.
CREATE OR REPLACE FUNCTION public.cena_projeto_processo_efetivo(p_projeto_id uuid)
RETURNS TABLE (projeto_id uuid, congelado boolean, perfil_codigo text, perfil_versao integer, origem text,
               congelado_em timestamptz, requisitos jsonb, sugerido_perfil_codigo text, sugerido_perfil_versao integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existe   boolean;
  v_contrato text;
  v_sug_cod  text;
  v_sug_ver  integer;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.cena_usuario_erp_ativo(), false) THEN
    RAISE EXCEPTION 'perfil de processo: sem sessão de usuário ativo' USING ERRCODE = '42501';
  END IF;
  SELECT true, c.o_contrato INTO v_existe, v_contrato FROM public.sot_projeto_processo_contexto(p_projeto_id) c;
  IF v_existe IS NULL THEN
    RETURN;
  END IF;
  SELECT s.o_codigo, s.o_versao INTO v_sug_cod, v_sug_ver FROM public.sot_projeto_processo_sugestao(v_contrato) s;
  RETURN QUERY
    SELECT p_projeto_id, true, pp.perfil_codigo, pp.perfil_versao, pp.origem_congelamento, pp.congelado_em,
           cp.requisitos, v_sug_cod, v_sug_ver
    FROM public.sot_projeto_processo pp
    JOIN public.cena_processo_perfis cp ON cp.codigo_perfil = pp.perfil_codigo AND cp.versao = pp.perfil_versao
    WHERE pp.projeto_id = p_projeto_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT p_projeto_id, false, 'BASE_PROJETOS'::text, NULL::integer, 'SEM_REGISTRO_BASE_PROJETOS'::text,
                        NULL::timestamptz, NULL::jsonb, v_sug_cod, v_sug_ver;
  END IF;
END;
$$;

-- Congelamento explícito por quem tem PROJ_ALTERAR_PERFIL_PROCESSO no contrato do projeto.
-- Também é o caminho BASE_PROJETOS (derivado) → outro perfil de um projeto legado.
CREATE OR REPLACE FUNCTION public.cena_projeto_processo_congelar(
  p_projeto_id uuid, p_perfil_codigo text, p_perfil_versao integer, p_justificativa text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.cena_processo_exigir_sessao();
  IF p_projeto_id IS NULL THEN
    RAISE EXCEPTION 'perfil de processo: projeto obrigatório' USING ERRCODE = '22023';
  END IF;
  IF btrim(coalesce(p_justificativa, '')) = '' THEN
    RAISE EXCEPTION 'perfil de processo: justificativa obrigatória' USING ERRCODE = '22023';
  END IF;
  PERFORM public.cena_processo_perfil_exigir(p_perfil_codigo, p_perfil_versao);
  PERFORM public.sot_projeto_processo_autorizar(p_projeto_id);
  RETURN public.sot_projeto_processo_gravar(p_projeto_id, 'CONGELAR', p_perfil_codigo, p_perfil_versao, 'GESTOR', p_justificativa);
END;
$$;

-- Troca do processo de projeto já congelado. p_perfil_atual_* = o que o usuário estava vendo.
CREATE OR REPLACE FUNCTION public.cena_projeto_processo_alterar(
  p_projeto_id uuid, p_perfil_atual_codigo text, p_perfil_atual_versao integer,
  p_perfil_codigo text, p_perfil_versao integer, p_justificativa text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.cena_processo_exigir_sessao();
  IF p_projeto_id IS NULL THEN
    RAISE EXCEPTION 'perfil de processo: projeto obrigatório' USING ERRCODE = '22023';
  END IF;
  IF btrim(coalesce(p_justificativa, '')) = '' THEN
    RAISE EXCEPTION 'perfil de processo: justificativa obrigatória' USING ERRCODE = '22023';
  END IF;
  PERFORM public.cena_processo_perfil_exigir(p_perfil_codigo, p_perfil_versao);
  PERFORM public.sot_projeto_processo_autorizar(p_projeto_id);
  RETURN public.sot_projeto_processo_gravar(p_projeto_id, 'ALTERAR', p_perfil_codigo, p_perfil_versao, 'GESTOR',
                                            p_justificativa, p_perfil_atual_codigo, p_perfil_atual_versao);
END;
$$;

-- ── 10. RPCs da sugestão por contrato ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cena_contrato_processo_perfil_definir(
  p_contrato_id uuid, p_perfil_codigo text, p_perfil_versao integer, p_justificativa text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_just  text := btrim(coalesce(p_justificativa, ''));
  v_atual public.cena_contrato_processo_perfil%ROWTYPE;
  v_id    uuid;
BEGIN
  PERFORM public.cena_processo_exigir_sessao();
  IF p_contrato_id IS NULL THEN
    RAISE EXCEPTION 'perfil de processo: contrato obrigatório' USING ERRCODE = '22023';
  END IF;
  IF v_just = '' THEN
    RAISE EXCEPTION 'perfil de processo: justificativa obrigatória' USING ERRCODE = '22023';
  END IF;
  PERFORM public.cena_processo_perfil_exigir(p_perfil_codigo, p_perfil_versao);
  IF NOT coalesce(public.cena_pode('PROJ_ALTERAR_PERFIL_PROCESSO', p_contrato_id), false) THEN
    RAISE EXCEPTION 'perfil de processo: sem permissão PROJ_ALTERAR_PERFIL_PROCESSO neste contrato (ou contrato não ativo)'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('cena_contrato_processo_perfil|' || p_contrato_id::text, 0));
  SELECT * INTO v_atual FROM public.cena_contrato_processo_perfil
   WHERE contrato_id = p_contrato_id AND revogado_em IS NULL FOR UPDATE;
  IF FOUND THEN
    IF v_atual.perfil_codigo = p_perfil_codigo AND v_atual.perfil_versao = p_perfil_versao THEN
      RETURN v_atual.id;
    END IF;
    UPDATE public.cena_contrato_processo_perfil
       SET revogado_em = now(), revogado_por_auth = auth.uid(), justificativa_revogacao = 'Substituída: ' || v_just
     WHERE id = v_atual.id;
  END IF;
  INSERT INTO public.cena_contrato_processo_perfil
    (contrato_id, perfil_codigo, perfil_versao, justificativa, definido_por_auth)
  VALUES (p_contrato_id, p_perfil_codigo, p_perfil_versao, v_just, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cena_contrato_processo_perfil_revogar(p_contrato_id uuid, p_justificativa text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_just text := btrim(coalesce(p_justificativa, ''));
  v_id   uuid;
BEGIN
  PERFORM public.cena_processo_exigir_sessao();
  IF v_just = '' THEN
    RAISE EXCEPTION 'perfil de processo: justificativa obrigatória' USING ERRCODE = '22023';
  END IF;
  IF NOT coalesce(public.cena_pode('PROJ_ALTERAR_PERFIL_PROCESSO', p_contrato_id), false) THEN
    RAISE EXCEPTION 'perfil de processo: sem permissão PROJ_ALTERAR_PERFIL_PROCESSO neste contrato (ou contrato não ativo)'
      USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cena_contrato_processo_perfil|' || p_contrato_id::text, 0));
  SELECT id INTO v_id FROM public.cena_contrato_processo_perfil
   WHERE contrato_id = p_contrato_id AND revogado_em IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  UPDATE public.cena_contrato_processo_perfil
     SET revogado_em = now(), revogado_por_auth = auth.uid(), justificativa_revogacao = v_just
   WHERE id = v_id;
  RETURN TRUE;
END;
$$;

-- ── 11. RPCs do catálogo (regra GLOBAL de PROJ_ALTERAR_PERFIL_PROCESSO) ──
-- Regra só de contrato não administra o catálogo: o catálogo vale para todos os contratos.
CREATE OR REPLACE FUNCTION public.cena_processo_perfil_exigir_admin()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.cena_processo_exigir_sessao();
  IF NOT coalesce(public.cena_pode('PROJ_ALTERAR_PERFIL_PROCESSO', NULL), false) THEN
    RAISE EXCEPTION 'perfil de processo: catálogo exige PROJ_ALTERAR_PERFIL_PROCESSO global' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Cria a versão p_versao (= última + 1; 1 para código novo). Repetir com o mesmo conteúdo devolve a mesma versão.
-- BASE_PROJETOS representa o fluxo atual do ERP e não recebe nova versão.
CREATE OR REPLACE FUNCTION public.cena_processo_perfil_criar_versao(
  p_codigo_perfil text, p_versao integer, p_nome text, p_descricao text, p_requisitos jsonb, p_justificativa text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_codigo text := upper(btrim(coalesce(p_codigo_perfil, '')));
  v_just   text := btrim(coalesce(p_justificativa, ''));
  v_req    jsonb := coalesce(p_requisitos, '{}'::jsonb);
  v_atual  public.cena_processo_perfis%ROWTYPE;
  v_ultima integer;
  v_id     uuid;
BEGIN
  PERFORM public.cena_processo_perfil_exigir_admin();
  IF v_codigo !~ '^[A-Z][A-Z0-9_]{2,62}$' THEN
    RAISE EXCEPTION 'perfil de processo: código inválido' USING ERRCODE = '22023';
  END IF;
  IF v_codigo = 'BASE_PROJETOS' THEN
    RAISE EXCEPTION 'perfil de processo: BASE_PROJETOS representa o fluxo atual do ERP e não recebe nova versão'
      USING ERRCODE = '22023';
  END IF;
  IF p_versao IS NULL OR p_versao < 1 THEN
    RAISE EXCEPTION 'perfil de processo: versão obrigatória' USING ERRCODE = '22023';
  END IF;
  IF btrim(coalesce(p_nome, '')) = '' OR btrim(coalesce(p_descricao, '')) = '' THEN
    RAISE EXCEPTION 'perfil de processo: nome e descrição obrigatórios' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_req) <> 'object' THEN
    RAISE EXCEPTION 'perfil de processo: requisitos devem ser objeto JSON' USING ERRCODE = '22023';
  END IF;
  IF v_just = '' THEN
    RAISE EXCEPTION 'perfil de processo: justificativa obrigatória' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('cena_processo_perfis|' || v_codigo, 0));
  SELECT * INTO v_atual FROM public.cena_processo_perfis WHERE codigo_perfil = v_codigo AND versao = p_versao;
  IF FOUND THEN
    IF v_atual.requisitos = v_req AND v_atual.nome = btrim(p_nome) AND v_atual.descricao = btrim(p_descricao) THEN
      RETURN v_atual.id;
    END IF;
    RAISE EXCEPTION 'perfil de processo: % v% já existe com outro conteúdo; crie a próxima versão', v_codigo, p_versao
      USING ERRCODE = '23505';
  END IF;
  SELECT max(versao) INTO v_ultima FROM public.cena_processo_perfis WHERE codigo_perfil = v_codigo;
  IF p_versao <> coalesce(v_ultima, 0) + 1 THEN
    RAISE EXCEPTION 'perfil de processo: próxima versão de % é %', v_codigo, coalesce(v_ultima, 0) + 1
      USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.cena_processo_perfis
    (codigo_perfil, versao, nome, descricao, requisitos, justificativa, criado_por_auth, atualizado_por_auth)
  VALUES
    (v_codigo, p_versao, btrim(p_nome), btrim(p_descricao), v_req, v_just, auth.uid(), auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Campos administrativos: nome, descrição, ativo (NULL = mantém). Requisitos não passam por aqui.
CREATE OR REPLACE FUNCTION public.cena_processo_perfil_administrar(
  p_codigo_perfil text, p_versao integer, p_nome text, p_descricao text, p_ativo boolean, p_justificativa text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_just  text := btrim(coalesce(p_justificativa, ''));
  v_atual public.cena_processo_perfis%ROWTYPE;
  v_nome  text;
  v_desc  text;
  v_ativo boolean;
BEGIN
  PERFORM public.cena_processo_perfil_exigir_admin();
  IF v_just = '' THEN
    RAISE EXCEPTION 'perfil de processo: justificativa obrigatória' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_atual FROM public.cena_processo_perfis
   WHERE codigo_perfil = p_codigo_perfil AND versao = p_versao FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'perfil de processo %: versão % inexistente', p_codigo_perfil, p_versao USING ERRCODE = '22023';
  END IF;
  v_nome := coalesce(nullif(btrim(p_nome), ''), v_atual.nome);
  v_desc := coalesce(nullif(btrim(p_descricao), ''), v_atual.descricao);
  v_ativo := coalesce(p_ativo, v_atual.ativo);
  IF v_atual.codigo_perfil = 'BASE_PROJETOS' AND v_ativo IS NOT TRUE THEN
    RAISE EXCEPTION 'perfil de processo: BASE_PROJETOS não é desativado' USING ERRCODE = '22023';
  END IF;
  IF v_nome = v_atual.nome AND v_desc = v_atual.descricao AND v_ativo = v_atual.ativo THEN
    RETURN FALSE;
  END IF;
  UPDATE public.cena_processo_perfis
     SET nome = v_nome, descricao = v_desc, ativo = v_ativo, justificativa = v_just,
         atualizado_em = now(), atualizado_por_auth = auth.uid()
   WHERE id = v_atual.id;
  RETURN TRUE;
END;
$$;

-- ── 12. RLS e grants ─────────────────────────────────────────────────────
ALTER TABLE public.cena_processo_perfis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cena_processo_perfis FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cena_processo_perfis_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cena_processo_perfis_eventos FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cena_contrato_processo_perfil ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cena_contrato_processo_perfil FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sot_projeto_processo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sot_projeto_processo FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sot_projeto_processo_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sot_projeto_processo_eventos FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.cena_processo_perfis FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.cena_processo_perfis_eventos FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.cena_contrato_processo_perfil FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.sot_projeto_processo FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.sot_projeto_processo_eventos FROM PUBLIC, anon, authenticated, service_role;
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role',
                 pg_get_serial_sequence('public.cena_processo_perfis_eventos', 'id'));
  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role',
                 pg_get_serial_sequence('public.sot_projeto_processo_eventos', 'id'));
END $$;
GRANT SELECT ON TABLE public.cena_processo_perfis TO authenticated, service_role;
GRANT SELECT ON TABLE public.cena_processo_perfis_eventos TO authenticated, service_role;
GRANT SELECT ON TABLE public.cena_contrato_processo_perfil TO authenticated, service_role;
GRANT SELECT ON TABLE public.sot_projeto_processo TO authenticated, service_role;
GRANT SELECT ON TABLE public.sot_projeto_processo_eventos TO authenticated, service_role;

-- Recria somente as policies desta migration; policies criadas por migrations futuras não são tocadas.
DROP POLICY IF EXISTS cena_processo_perfis_select_erp ON public.cena_processo_perfis;
CREATE POLICY cena_processo_perfis_select_erp ON public.cena_processo_perfis
  FOR SELECT TO authenticated USING ((SELECT public.cena_usuario_erp_ativo()));
DROP POLICY IF EXISTS cena_processo_perfis_eventos_select_admin ON public.cena_processo_perfis_eventos;
CREATE POLICY cena_processo_perfis_eventos_select_admin ON public.cena_processo_perfis_eventos
  FOR SELECT TO authenticated USING ((SELECT public.cena_usuarios_pode_administrar()));
DROP POLICY IF EXISTS cena_contrato_processo_perfil_select_erp ON public.cena_contrato_processo_perfil;
CREATE POLICY cena_contrato_processo_perfil_select_erp ON public.cena_contrato_processo_perfil
  FOR SELECT TO authenticated USING ((SELECT public.cena_usuario_erp_ativo()));
DROP POLICY IF EXISTS sot_projeto_processo_select_erp ON public.sot_projeto_processo;
CREATE POLICY sot_projeto_processo_select_erp ON public.sot_projeto_processo
  FOR SELECT TO authenticated USING ((SELECT public.cena_usuario_erp_ativo()));
DROP POLICY IF EXISTS sot_projeto_processo_eventos_select_admin ON public.sot_projeto_processo_eventos;
CREATE POLICY sot_projeto_processo_eventos_select_admin ON public.sot_projeto_processo_eventos
  FOR SELECT TO authenticated USING ((SELECT public.cena_usuarios_pode_administrar()));

REVOKE ALL ON FUNCTION public.sot_projeto_processo_contexto(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sot_projeto_processo_contrato_uuid(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sot_projeto_processo_sugestao(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cena_processo_perfis_proteger() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cena_processo_perfis_auditar() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cena_contrato_processo_perfil_proteger() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sot_projeto_processo_proteger() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sot_projeto_processo_auditar() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cena_processo_historico_imutavel() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cena_processo_perfil_exigir(text, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cena_processo_exigir_sessao() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sot_projeto_processo_autorizar(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sot_projeto_processo_gravar(uuid, text, text, integer, text, text, text, integer, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cena_processo_perfil_exigir_admin() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cena_projeto_processo_efetivo(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.cena_projeto_processo_congelar(uuid, text, integer, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.cena_projeto_processo_alterar(uuid, text, integer, text, integer, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.cena_contrato_processo_perfil_definir(uuid, text, integer, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.cena_contrato_processo_perfil_revogar(uuid, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.cena_processo_perfil_criar_versao(text, integer, text, text, jsonb, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.cena_processo_perfil_administrar(text, integer, text, text, boolean, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cena_projeto_processo_efetivo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cena_projeto_processo_congelar(uuid, text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cena_projeto_processo_alterar(uuid, text, integer, text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cena_contrato_processo_perfil_definir(uuid, text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cena_contrato_processo_perfil_revogar(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cena_processo_perfil_criar_versao(text, integer, text, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cena_processo_perfil_administrar(text, integer, text, text, boolean, text) TO authenticated;

-- ── 13. Perfil semeado ───────────────────────────────────────────────────
-- Só BASE_PROJETOS v1 (fluxo atual, sem requisitos novos), para congelamento explícito no base.
-- Nenhum contrato mapeado: a relação contrato → perfil depende de decisão do gestor.
INSERT INTO public.cena_processo_perfis (codigo_perfil, versao, nome, descricao, requisitos, justificativa)
VALUES ('BASE_PROJETOS', 1, 'Base de projetos',
        'Fluxo atual do ERP, sem requisitos novos. Mesmo comportamento de projeto sem processo congelado.',
        '{}'::jsonb, 'Perfil base semeado pela Etapa 1.2')
ON CONFLICT (codigo_perfil, versao) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Validação
-- SELECT codigo_perfil, versao, ativo, requisitos FROM public.cena_processo_perfis ORDER BY 1, 2;  -- BASE_PROJETOS 1
-- SELECT count(*) FROM public.cena_contrato_processo_perfil;   -- 0 (sem seed de contrato)
-- SELECT count(*) FROM public.sot_projeto_processo;            -- 0 (sem backfill)
-- SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c
--   WHERE c.oid IN ('public.cena_processo_perfis'::regclass, 'public.cena_processo_perfis_eventos'::regclass,
--                   'public.cena_contrato_processo_perfil'::regclass, 'public.sot_projeto_processo'::regclass,
--                   'public.sot_projeto_processo_eventos'::regclass);
-- SELECT tablename, policyname, cmd, roles FROM pg_policies
--   WHERE tablename IN ('cena_processo_perfis', 'cena_processo_perfis_eventos', 'cena_contrato_processo_perfil',
--                       'sot_projeto_processo', 'sot_projeto_processo_eventos');

-- Para desfazer (nenhuma outra tabela depende destas nesta etapa)
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.cena_processo_perfil_administrar(text, integer, text, text, boolean, text);
-- DROP FUNCTION IF EXISTS public.cena_processo_perfil_criar_versao(text, integer, text, text, jsonb, text);
-- DROP FUNCTION IF EXISTS public.cena_processo_perfil_exigir_admin();
-- DROP FUNCTION IF EXISTS public.cena_contrato_processo_perfil_revogar(uuid, text);
-- DROP FUNCTION IF EXISTS public.cena_contrato_processo_perfil_definir(uuid, text, integer, text);
-- DROP FUNCTION IF EXISTS public.cena_projeto_processo_alterar(uuid, text, integer, text, integer, text);
-- DROP FUNCTION IF EXISTS public.cena_projeto_processo_congelar(uuid, text, integer, text);
-- DROP FUNCTION IF EXISTS public.cena_projeto_processo_efetivo(uuid);
-- DROP FUNCTION IF EXISTS public.sot_projeto_processo_gravar(uuid, text, text, integer, text, text, text, integer, jsonb);
-- DROP FUNCTION IF EXISTS public.sot_projeto_processo_autorizar(uuid);
-- DROP FUNCTION IF EXISTS public.cena_processo_exigir_sessao();
-- DROP FUNCTION IF EXISTS public.cena_processo_perfil_exigir(text, integer);
-- DROP TABLE IF EXISTS public.sot_projeto_processo_eventos;
-- DROP TABLE IF EXISTS public.sot_projeto_processo;
-- DROP TABLE IF EXISTS public.cena_contrato_processo_perfil;
-- DROP TABLE IF EXISTS public.cena_processo_perfis_eventos;
-- DROP TABLE IF EXISTS public.cena_processo_perfis;
-- DROP FUNCTION IF EXISTS public.cena_processo_historico_imutavel();
-- DROP FUNCTION IF EXISTS public.sot_projeto_processo_auditar();
-- DROP FUNCTION IF EXISTS public.sot_projeto_processo_proteger();
-- DROP FUNCTION IF EXISTS public.cena_contrato_processo_perfil_proteger();
-- DROP FUNCTION IF EXISTS public.cena_processo_perfis_auditar();
-- DROP FUNCTION IF EXISTS public.cena_processo_perfis_proteger();
-- DROP FUNCTION IF EXISTS public.sot_projeto_processo_sugestao(text);
-- DROP FUNCTION IF EXISTS public.sot_projeto_processo_contrato_uuid(text);
-- DROP FUNCTION IF EXISTS public.sot_projeto_processo_contexto(uuid);
-- NOTIFY pgrst, 'reload schema';
-- COMMIT;
