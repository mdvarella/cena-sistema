-- ETAPA 1.3 (ENEL/LMS/WL) — Recebimento seguro do LMS original
-- Fonte LMS imutável: sot_lms_importacoes (um arquivo recebido) + sot_lms_linhas (uma linha por linha do XLSX, A:N)
-- + sot_lms_importacao_eventos (append-only). Bucket privado proj-lms com o arquivo original em <projeto_id>/<sha256>.xlsx.
-- Quem recebe é a Edge Function proj-lms-receber:
--   1. autoriza com o JWT do usuário (sot_lms_autorizar_recebimento → auth.uid() + cena_pode('PROJ_IMPORTAR_LMS', contrato));
--   2. grava com service_role por sot_lms_importacao_registrar (única porta de escrita; o browser não chega nela).
-- Upload + parse = RASCUNHO/ORIGINAL. Não confirma, não congela perfil de processo, não cria WL, não toca
-- sot_materiais/sot_atividades, estoque, programação nem TMA. Sem FK para sot_projetos (exclusão física legada).
-- Bucket nesta mesma migration: o padrão do repositório (20260927223000) cria bucket junto com o que o usa.
-- Transação explícita (também no SQL Editor): qualquer falha desfaz a Etapa 1.3 inteira.

BEGIN;

-- ── 0. Pré-condições (falha inteira, nada é aplicado) ────────────────────
DO $$
BEGIN
  IF NOT coalesce((SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user), false) THEN
    RAISE EXCEPTION 'Rode como dono com BYPASSRLS: as funções SECURITY DEFINER leem tabelas com RLS FORCE';
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'auth.uid() não existe';
  END IF;
  IF to_regprocedure('public.cena_usuario_perfil_sessao()') IS NULL
     OR to_regprocedure('public.cena_usuario_id_sessao()') IS NULL THEN
    RAISE EXCEPTION 'aplique antes 20261004190000_seguranca_usuarios_sistema.sql (helpers de sessão)';
  END IF;
  IF to_regprocedure('public.cena_pode(text, uuid)') IS NULL OR to_regclass('public.cena_acoes') IS NULL THEN
    RAISE EXCEPTION 'aplique antes 20261007190000_cena_permissoes_acao.sql (cena_pode)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cena_acoes WHERE codigo = 'PROJ_IMPORTAR_LMS' AND ativo IS TRUE) THEN
    RAISE EXCEPTION 'ação PROJ_IMPORTAR_LMS ausente ou inativa em cena_acoes';
  END IF;
  IF to_regprocedure('public.sot_projeto_processo_contexto(uuid)') IS NULL
     OR to_regprocedure('public.sot_projeto_processo_contrato_uuid(text)') IS NULL THEN
    RAISE EXCEPTION 'aplique antes 20261009173000_proj_perfil_processo.sql (contexto do projeto)';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'usuarios_sistema'
        AND column_name IN ('id', 'auth_user_id', 'ativo', 'deleted_at')) <> 4 THEN
    RAISE EXCEPTION 'usuarios_sistema sem id/auth_user_id/ativo/deleted_at';
  END IF;
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE EXCEPTION 'storage.buckets não existe (Storage do Supabase)';
  END IF;
END $$;

-- ── 1. Normalização (semântica congelada; mudou a regra = nova função com outro nome) ──
-- Mesma regra de textoNorm/codigoNorm em supabase/functions/_shared/lms-parser.ts (o registro confere a paridade).
-- trim de espaço, tab, CR, LF e NBSP; maiúsculas só em a-z (translate: não depende de locale/collation).
CREATE OR REPLACE FUNCTION public.fn_proj_texto_norm(p_valor text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT nullif(translate(btrim(p_valor, E' \t\r\n\u00A0'), 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'), '')
$$;
COMMENT ON FUNCTION public.fn_proj_texto_norm(text) IS
  'Etapa 1.3: trim (espaço, tab, CR, LF, NBSP) + maiúsculas ASCII; vazio → NULL. Semântica congelada.';

-- 1. trim; 2. maiúsculas; 3. só dígitos → sem zeros à esquerda; 4. só zeros → "0"; 5. só espaço → NULL.
CREATE OR REPLACE FUNCTION public.fn_proj_codigo_norm(p_codigo text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE WHEN t ~ '^[0-9]+$' THEN coalesce(nullif(ltrim(t, '0'), ''), '0') ELSE t END
  FROM (SELECT public.fn_proj_texto_norm(p_codigo) AS t) n
$$;
COMMENT ON FUNCTION public.fn_proj_codigo_norm(text) IS
  'Etapa 1.3: código LMS normalizado (" 000123 " → "123", "000000" → "0", "   " → NULL). Semântica congelada.';

-- Célula A:N guardada em linha_raw: {"t": tipo SheetJS, "v": valor, "w"?: texto formatado}.
CREATE OR REPLACE FUNCTION public.sot_lms_linha_raw_valida(p_raw jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT jsonb_typeof(p_raw) = 'object'
     AND NOT EXISTS (SELECT 1 FROM jsonb_each(p_raw) e
                     WHERE e.key !~ '^[A-N]$'
                        OR jsonb_typeof(e.value) <> 'object'
                        OR NOT (e.value ? 't' AND e.value ? 'v')
                        OR e.value->>'t' NOT IN ('s', 'n', 'b', 'e'))
$$;

-- ── 2. Importação (um arquivo LMS recebido) ──────────────────────────────
-- Sem FK para sot_projetos. Idempotência: projeto + SHA-256 dos bytes originais (nunca o nome do arquivo).
-- status/tipo só aceitam RASCUNHO/ORIGINAL nesta etapa; confirmação e revisões ampliam o CHECK nas próximas.
CREATE TABLE IF NOT EXISTS public.sot_lms_importacoes (
  id                        uuid PRIMARY KEY,
  projeto_id                uuid NOT NULL,
  contrato_id_projeto       text,
  tipo_importacao           text NOT NULL,
  status                    text NOT NULL,
  hash_sha256               text NOT NULL,
  arquivo_nome_original     text NOT NULL,
  arquivo_tamanho           bigint NOT NULL,
  mime_informado            text,
  mime_validado             text NOT NULL,
  storage_bucket            text NOT NULL,
  storage_path              text NOT NULL,
  parser_version            text NOT NULL,
  worksheet                 text NOT NULL,
  projeto_identificacao_raw text,
  qtd_linhas                integer NOT NULL,
  qtd_wls_distintas         integer NOT NULL,
  resumo                    jsonb NOT NULL,
  criado_em                 timestamptz NOT NULL DEFAULT now(),
  criado_por_auth           uuid NOT NULL,
  criado_por_usuario_id     text,
  CONSTRAINT sot_lms_importacoes_projeto_hash_key UNIQUE (projeto_id, hash_sha256),
  CONSTRAINT sot_lms_importacoes_storage_key UNIQUE (storage_bucket, storage_path),
  CONSTRAINT sot_lms_importacoes_tipo_chk CHECK (tipo_importacao IN ('ORIGINAL')),
  CONSTRAINT sot_lms_importacoes_status_chk CHECK (status IN ('RASCUNHO')),
  CONSTRAINT sot_lms_importacoes_hash_chk CHECK (hash_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT sot_lms_importacoes_nome_chk CHECK (btrim(arquivo_nome_original) <> '' AND length(arquivo_nome_original) <= 200
                                                 AND arquivo_nome_original ~* '\.xlsx$' AND arquivo_nome_original !~ '[/\\]'),
  CONSTRAINT sot_lms_importacoes_tamanho_chk CHECK (arquivo_tamanho > 0 AND arquivo_tamanho <= 12582912),
  CONSTRAINT sot_lms_importacoes_mime_chk CHECK (
    mime_validado = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    AND (mime_informado IS NULL OR length(mime_informado) <= 200)),
  CONSTRAINT sot_lms_importacoes_storage_chk CHECK (
    storage_bucket = 'proj-lms' AND storage_path = projeto_id::text || '/' || hash_sha256 || '.xlsx'),
  CONSTRAINT sot_lms_importacoes_parser_chk CHECK (parser_version ~ '^[0-9]{1,6}$'),
  CONSTRAINT sot_lms_importacoes_worksheet_chk CHECK (btrim(worksheet) <> '' AND length(worksheet) <= 100),
  CONSTRAINT sot_lms_importacoes_ident_chk CHECK (projeto_identificacao_raw IS NULL OR length(projeto_identificacao_raw) <= 2000),
  CONSTRAINT sot_lms_importacoes_qtd_chk CHECK (qtd_linhas BETWEEN 1 AND 5000 AND qtd_wls_distintas BETWEEN 0 AND qtd_linhas),
  CONSTRAINT sot_lms_importacoes_resumo_chk CHECK (jsonb_typeof(resumo) = 'object' AND octet_length(resumo::text) <= 262144)
);
CREATE INDEX IF NOT EXISTS sot_lms_importacoes_projeto_idx ON public.sot_lms_importacoes (projeto_id, criado_em DESC);
COMMENT ON TABLE public.sot_lms_importacoes IS
  'Etapa 1.3: arquivo LMS recebido (RASCUNHO/ORIGINAL). Original em Storage privado proj-lms. Sem FK para sot_projetos.';
COMMENT ON COLUMN public.sot_lms_importacoes.hash_sha256 IS 'SHA-256 dos bytes originais do XLSX (nunca de JSON/parse).';
COMMENT ON COLUMN public.sot_lms_importacoes.contrato_id_projeto IS 'Texto de sot_projetos.contrato_id no recebimento (registro, não autoriza).';

-- ── 3. Linhas (uma por linha do XLSX; nada agregado) ─────────────────────
-- Única unicidade: (importacao_id, linha_excel) e a ordem. Nunca por código/WL/FT/KIT.
-- Quant. Plan → qtd_plan. Quant. Real → lms_qtd_real_informada (informação do LMS; não é execução nem medição).
-- *_norm são calculados pelo banco a partir do *_raw (o raw nunca se perde).
CREATE TABLE IF NOT EXISTS public.sot_lms_linhas (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  importacao_id          uuid NOT NULL REFERENCES public.sot_lms_importacoes (id),
  linha_excel            integer NOT NULL,
  ordem                  integer NOT NULL,
  linha_raw              jsonb NOT NULL,
  wl_raw                 text,
  wl_norm                text GENERATED ALWAYS AS (public.fn_proj_texto_norm(wl_raw)) STORED,
  ctg_raw                text,
  ctg_norm               text GENERATED ALWAYS AS (public.fn_proj_texto_norm(ctg_raw)) STORED,
  ft_raw                 text,
  ft_norm                text GENERATED ALWAYS AS (public.fn_proj_texto_norm(ft_raw)) STORED,
  codigo_raw             text,
  codigo_norm            text GENERATED ALWAYS AS (public.fn_proj_codigo_norm(codigo_raw)) STORED,
  kit_raw                text,
  kit_norm               text GENERATED ALWAYS AS (public.fn_proj_texto_norm(kit_raw)) STORED,
  umd_raw                text,
  umd_norm               text GENERATED ALWAYS AS (public.fn_proj_texto_norm(umd_raw)) STORED,
  descricao_raw          text,
  qtd_plan_raw           text,
  qtd_plan               numeric,
  qtd_real_raw           text,
  lms_qtd_real_informada numeric,
  valor_ups_item_raw     text,
  valor_ups_item         numeric,
  valor_final_raw        text,
  valor_final            numeric,
  valor_final_plan_raw   text,
  valor_final_plan       numeric,
  estorno_raw            text,
  adicionais_raw         text,
  alertas                text[] NOT NULL DEFAULT '{}',
  criado_em              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sot_lms_linhas_linha_key UNIQUE (importacao_id, linha_excel),
  CONSTRAINT sot_lms_linhas_ordem_key UNIQUE (importacao_id, ordem),
  CONSTRAINT sot_lms_linhas_linha_chk CHECK (linha_excel >= 4 AND ordem >= 1),
  CONSTRAINT sot_lms_linhas_raw_chk CHECK (public.sot_lms_linha_raw_valida(linha_raw) AND octet_length(linha_raw::text) <= 65536),
  CONSTRAINT sot_lms_linhas_alertas_chk CHECK (cardinality(alertas) <= 50)
);
COMMENT ON TABLE public.sot_lms_linhas IS
  'Etapa 1.3: linhas do LMS original, uma por linha do XLSX (A:N). Imutáveis. Sem agregação nem deduplicação.';
COMMENT ON COLUMN public.sot_lms_linhas.lms_qtd_real_informada IS
  'Quant. Real como veio no LMS. Não é execução, medição nem quantidade programada; nunca substitui qtd_plan.';
COMMENT ON COLUMN public.sot_lms_linhas.alertas IS 'Diagnóstico do parser (não corrige nem exclui a linha).';

CREATE TABLE IF NOT EXISTS public.sot_lms_importacao_eventos (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  importacao_id  uuid NOT NULL REFERENCES public.sot_lms_importacoes (id),
  tipo_evento    text NOT NULL,
  por_auth       uuid NOT NULL,
  por_usuario_id text,
  detalhe        jsonb NOT NULL DEFAULT '{}'::jsonb,
  registrado_em  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sot_lms_importacao_eventos_tipo_chk CHECK (tipo_evento IN ('CRIADA', 'REENVIO')),
  CONSTRAINT sot_lms_importacao_eventos_detalhe_chk CHECK (jsonb_typeof(detalhe) = 'object')
);
CREATE INDEX IF NOT EXISTS sot_lms_importacao_eventos_imp_idx ON public.sot_lms_importacao_eventos (importacao_id, id);
COMMENT ON TABLE public.sot_lms_importacao_eventos IS 'Etapa 1.3: histórico append-only dos recebimentos (CRIADA, REENVIO).';

-- ── 4. Imutabilidade (vale para todos os papéis, inclusive dono e service_role) ──
-- INSERT só dentro de sot_lms_importacao_registrar (marca local da transação com o id da importação).
CREATE OR REPLACE FUNCTION public.sot_lms_exigir_registro()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id text := to_jsonb(NEW)->>(CASE WHEN TG_TABLE_NAME = 'sot_lms_importacoes' THEN 'id' ELSE 'importacao_id' END);
BEGIN
  IF coalesce(current_setting('cena.lms_registrando', true), '') IS DISTINCT FROM v_id THEN
    RAISE EXCEPTION '%: gravação só por sot_lms_importacao_registrar', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- Importação: conteúdo nunca muda. Status administrativo só por função futura que marque a transação
-- (cena.lms_status_autorizado = id); nesta etapa nenhuma função faz isso e o CHECK só aceita RASCUNHO.
CREATE OR REPLACE FUNCTION public.sot_lms_importacoes_proteger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'sot_lms_importacoes: fonte LMS não é apagada' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION 'sot_lms_importacoes: fonte LMS não é reescrita' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND coalesce(current_setting('cena.lms_status_autorizado', true), '') IS DISTINCT FROM OLD.id::text THEN
    RAISE EXCEPTION 'sot_lms_importacoes: status só por função controlada' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sot_lms_imutavel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION '%: fonte LMS não é alterada nem apagada', TG_TABLE_NAME USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_sot_lms_importacoes_registro ON public.sot_lms_importacoes;
CREATE TRIGGER trg_sot_lms_importacoes_registro BEFORE INSERT ON public.sot_lms_importacoes
  FOR EACH ROW EXECUTE FUNCTION public.sot_lms_exigir_registro();
DROP TRIGGER IF EXISTS trg_sot_lms_importacoes_proteger ON public.sot_lms_importacoes;
CREATE TRIGGER trg_sot_lms_importacoes_proteger BEFORE UPDATE OR DELETE ON public.sot_lms_importacoes
  FOR EACH ROW EXECUTE FUNCTION public.sot_lms_importacoes_proteger();
DROP TRIGGER IF EXISTS trg_sot_lms_importacoes_sem_truncate ON public.sot_lms_importacoes;
CREATE TRIGGER trg_sot_lms_importacoes_sem_truncate BEFORE TRUNCATE ON public.sot_lms_importacoes
  FOR EACH STATEMENT EXECUTE FUNCTION public.sot_lms_imutavel();

DROP TRIGGER IF EXISTS trg_sot_lms_linhas_registro ON public.sot_lms_linhas;
CREATE TRIGGER trg_sot_lms_linhas_registro BEFORE INSERT ON public.sot_lms_linhas
  FOR EACH ROW EXECUTE FUNCTION public.sot_lms_exigir_registro();
DROP TRIGGER IF EXISTS trg_sot_lms_linhas_imutavel ON public.sot_lms_linhas;
CREATE TRIGGER trg_sot_lms_linhas_imutavel BEFORE UPDATE OR DELETE ON public.sot_lms_linhas
  FOR EACH ROW EXECUTE FUNCTION public.sot_lms_imutavel();
DROP TRIGGER IF EXISTS trg_sot_lms_linhas_sem_truncate ON public.sot_lms_linhas;
CREATE TRIGGER trg_sot_lms_linhas_sem_truncate BEFORE TRUNCATE ON public.sot_lms_linhas
  FOR EACH STATEMENT EXECUTE FUNCTION public.sot_lms_imutavel();

DROP TRIGGER IF EXISTS trg_sot_lms_importacao_eventos_imutavel ON public.sot_lms_importacao_eventos;
CREATE TRIGGER trg_sot_lms_importacao_eventos_imutavel BEFORE UPDATE OR DELETE ON public.sot_lms_importacao_eventos
  FOR EACH ROW EXECUTE FUNCTION public.sot_lms_imutavel();
DROP TRIGGER IF EXISTS trg_sot_lms_importacao_eventos_sem_truncate ON public.sot_lms_importacao_eventos;
CREATE TRIGGER trg_sot_lms_importacao_eventos_sem_truncate BEFORE TRUNCATE ON public.sot_lms_importacao_eventos
  FOR EACH STATEMENT EXECUTE FUNCTION public.sot_lms_imutavel();

-- ── 5. Autorização (contexto do usuário: auth.uid()) ─────────────────────
-- Mesma regra da Etapa 1.2: projeto existe e não está excluído; sem contrato → regra global de cena_pode;
-- contrato em texto que não é contratos.id → recusa (nunca cai para a global).
CREATE OR REPLACE FUNCTION public.sot_lms_autorizar(p_projeto_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existe   boolean;
  v_excluido boolean;
  v_contrato text;
  v_ctr      uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 'SEM_SESSAO';
  END IF;
  IF public.cena_usuario_perfil_sessao() IS NULL THEN
    RETURN 'USUARIO_ERP_INATIVO';
  END IF;
  IF p_projeto_id IS NULL THEN
    RETURN 'PROJETO_INEXISTENTE';
  END IF;
  SELECT true, c.o_excluido, c.o_contrato INTO v_existe, v_excluido, v_contrato
  FROM public.sot_projeto_processo_contexto(p_projeto_id) c;
  IF v_existe IS NULL THEN
    RETURN 'PROJETO_INEXISTENTE';
  END IF;
  IF v_excluido THEN
    RETURN 'PROJETO_EXCLUIDO';
  END IF;
  IF v_contrato IS NOT NULL THEN
    v_ctr := public.sot_projeto_processo_contrato_uuid(v_contrato);
    IF v_ctr IS NULL THEN
      RETURN 'CONTRATO_NAO_IDENTIFICADO';
    END IF;
  END IF;
  IF NOT coalesce(public.cena_pode('PROJ_IMPORTAR_LMS', v_ctr), false) THEN
    RETURN 'SEM_PERMISSAO';
  END IF;
  RETURN 'OK';
END;
$$;

-- Chamada pela Edge com o JWT do usuário, antes de receber os bytes. Não devolve dados do projeto.
CREATE OR REPLACE FUNCTION public.sot_lms_autorizar_recebimento(p_projeto_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_motivo text := public.sot_lms_autorizar(p_projeto_id);
BEGIN
  RETURN jsonb_build_object('permitido', v_motivo = 'OK', 'motivo', v_motivo);
END;
$$;

-- ── 6. Registro (somente service_role, depois da autorização do usuário) ──
-- Célula guardada × campo gravado: o raw tem que ser o valor da célula e o número tem que vir da própria coluna
-- (Quant. Plan só de H, Quant. Real só de I). Texto pt-BR ("6,132") é convertido pelo parser.
CREATE OR REPLACE FUNCTION public.sot_lms_celula_confere(p_celula jsonb, p_raw text, p_numero numeric, p_numerica boolean)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE
    WHEN p_celula IS NULL THEN p_raw IS NULL AND p_numero IS NULL
    WHEN p_celula->>'t' = 'n' THEN
      CASE WHEN jsonb_typeof(p_celula->'v') = 'number'
                AND p_raw ~ '^[+-]?([0-9]+[.]?[0-9]*|[.][0-9]+)([eE][+-]?[0-9]+)?$'
           THEN p_raw::numeric = (p_celula->>'v')::numeric
                AND (NOT p_numerica OR p_numero = (p_celula->>'v')::numeric)
           ELSE false END
    WHEN p_celula->>'t' = 'b' THEN
      p_raw = CASE WHEN p_celula->>'v' = 'true' THEN 'TRUE' ELSE 'FALSE' END AND p_numero IS NULL
    WHEN p_celula->>'t' = 'e' THEN p_raw = p_celula->>'v' AND p_numero IS NULL
    ELSE p_raw = p_celula->>'v' AND (p_numerica OR p_numero IS NULL)
  END
$$;

CREATE OR REPLACE FUNCTION public.sot_lms_linha_confere(l public.sot_lms_linhas)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(
        public.sot_lms_celula_confere(l.linha_raw->'A', l.wl_raw, NULL, false)
    AND public.sot_lms_celula_confere(l.linha_raw->'B', l.ctg_raw, NULL, false)
    AND public.sot_lms_celula_confere(l.linha_raw->'C', l.ft_raw, NULL, false)
    AND public.sot_lms_celula_confere(l.linha_raw->'D', l.codigo_raw, NULL, false)
    AND public.sot_lms_celula_confere(l.linha_raw->'E', l.kit_raw, NULL, false)
    AND public.sot_lms_celula_confere(l.linha_raw->'F', l.umd_raw, NULL, false)
    AND public.sot_lms_celula_confere(l.linha_raw->'G', l.descricao_raw, NULL, false)
    AND public.sot_lms_celula_confere(l.linha_raw->'H', l.qtd_plan_raw, l.qtd_plan, true)
    AND public.sot_lms_celula_confere(l.linha_raw->'I', l.qtd_real_raw, l.lms_qtd_real_informada, true)
    AND public.sot_lms_celula_confere(l.linha_raw->'J', l.valor_ups_item_raw, l.valor_ups_item, true)
    AND public.sot_lms_celula_confere(l.linha_raw->'K', l.valor_final_raw, l.valor_final, true)
    AND public.sot_lms_celula_confere(l.linha_raw->'L', l.valor_final_plan_raw, l.valor_final_plan, true)
    AND public.sot_lms_celula_confere(l.linha_raw->'M', l.estorno_raw, NULL, false)
    AND public.sot_lms_celula_confere(l.linha_raw->'N', l.adicionais_raw, NULL, false), false)
$$;

-- p_auth = auth.uid() que a Edge obteve do JWT (getUser) e já autorizou com o cliente do usuário.
-- Aqui só se revalida o que não depende de sessão: usuário ERP ativo, projeto existente/não excluído, contrato resolvível.
-- Mesmo projeto + mesmo hash = devolve a importação existente (REENVIO), sem novas linhas.
-- Tudo ou nada: qualquer divergência desfaz a importação inteira (a Edge então remove o objeto que acabou de gravar).
CREATE OR REPLACE FUNCTION public.sot_lms_importacao_registrar(
  p_auth uuid, p_projeto_id uuid, p_importacao jsonb, p_linhas jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hash     text := p_importacao->>'hash_sha256';
  v_usuario  text;
  v_existe   boolean;
  v_excluido boolean;
  v_contrato text;
  v_atual    public.sot_lms_importacoes%ROWTYPE;
  v_id       uuid := gen_random_uuid();
  v_qtd      integer;
  v_n        integer;
BEGIN
  IF p_auth IS NULL OR p_projeto_id IS NULL OR p_importacao IS NULL OR jsonb_typeof(p_importacao) <> 'object' THEN
    RAISE EXCEPTION 'LMS: parâmetros obrigatórios ausentes' USING ERRCODE = '22023';
  END IF;
  IF v_hash IS NULL OR v_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'LMS: hash inválido' USING ERRCODE = '22023';
  END IF;
  SELECT us.id::text INTO v_usuario FROM public.usuarios_sistema us
  WHERE us.auth_user_id = p_auth AND us.ativo IS TRUE AND us.deleted_at IS NULL
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'LMS: usuário ERP inexistente ou inativo' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('sot_lms_importacao|' || p_projeto_id::text || '|' || v_hash, 0));

  SELECT true, c.o_excluido, c.o_contrato INTO v_existe, v_excluido, v_contrato
  FROM public.sot_projeto_processo_contexto(p_projeto_id) c;
  IF v_existe IS NULL THEN
    RAISE EXCEPTION 'LMS: projeto inexistente' USING ERRCODE = 'P0002';
  END IF;
  IF v_excluido THEN
    RAISE EXCEPTION 'LMS: projeto excluído' USING ERRCODE = '42501';
  END IF;
  IF v_contrato IS NOT NULL AND public.sot_projeto_processo_contrato_uuid(v_contrato) IS NULL THEN
    RAISE EXCEPTION 'LMS: contrato do projeto não identificado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_atual FROM public.sot_lms_importacoes WHERE projeto_id = p_projeto_id AND hash_sha256 = v_hash;
  IF FOUND THEN
    INSERT INTO public.sot_lms_importacao_eventos (importacao_id, tipo_evento, por_auth, por_usuario_id, detalhe)
    VALUES (v_atual.id, 'REENVIO', p_auth, v_usuario,
            jsonb_build_object('parser_version', p_importacao->>'parser_version'));
    RETURN jsonb_build_object(
      'importacao_id', v_atual.id, 'reenvio', true, 'status', v_atual.status, 'tipo_importacao', v_atual.tipo_importacao,
      'hash_sha256', v_atual.hash_sha256, 'arquivo_nome_original', v_atual.arquivo_nome_original,
      'arquivo_tamanho', v_atual.arquivo_tamanho, 'parser_version', v_atual.parser_version,
      'worksheet', v_atual.worksheet, 'projeto_identificacao_raw', v_atual.projeto_identificacao_raw,
      'qtd_linhas', v_atual.qtd_linhas, 'qtd_wls_distintas', v_atual.qtd_wls_distintas,
      'resumo', v_atual.resumo, 'criado_em', v_atual.criado_em);
  END IF;

  IF p_linhas IS NULL OR jsonb_typeof(p_linhas) <> 'array' THEN
    RAISE EXCEPTION 'LMS: linhas ausentes' USING ERRCODE = '22023';
  END IF;
  v_qtd := (p_importacao->>'qtd_linhas')::integer;
  IF v_qtd IS NULL OR v_qtd <> jsonb_array_length(p_linhas) THEN
    RAISE EXCEPTION 'LMS: quantidade de linhas não confere' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_linhas) AS x(codigo_raw text, codigo_norm text)
             WHERE x.codigo_norm IS DISTINCT FROM public.fn_proj_codigo_norm(x.codigo_raw)) THEN
    RAISE EXCEPTION 'LMS: normalização de código divergente entre parser e banco' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('cena.lms_registrando', v_id::text, true);
  INSERT INTO public.sot_lms_importacoes (
    id, projeto_id, contrato_id_projeto, tipo_importacao, status, hash_sha256, arquivo_nome_original, arquivo_tamanho,
    mime_informado, mime_validado, storage_bucket, storage_path, parser_version, worksheet, projeto_identificacao_raw,
    qtd_linhas, qtd_wls_distintas, resumo, criado_por_auth, criado_por_usuario_id)
  VALUES (
    v_id, p_projeto_id, v_contrato, 'ORIGINAL', 'RASCUNHO', v_hash, p_importacao->>'arquivo_nome_original',
    (p_importacao->>'arquivo_tamanho')::bigint, nullif(p_importacao->>'mime_informado', ''), p_importacao->>'mime_validado',
    'proj-lms', p_projeto_id::text || '/' || v_hash || '.xlsx', p_importacao->>'parser_version', p_importacao->>'worksheet',
    p_importacao->>'projeto_identificacao_raw', v_qtd, (p_importacao->>'qtd_wls_distintas')::integer,
    p_importacao->'resumo', p_auth, v_usuario);

  INSERT INTO public.sot_lms_linhas (
    importacao_id, linha_excel, ordem, linha_raw, wl_raw, ctg_raw, ft_raw, codigo_raw, kit_raw, umd_raw, descricao_raw,
    qtd_plan_raw, qtd_plan, qtd_real_raw, lms_qtd_real_informada, valor_ups_item_raw, valor_ups_item,
    valor_final_raw, valor_final, valor_final_plan_raw, valor_final_plan, estorno_raw, adicionais_raw, alertas)
  SELECT v_id, x.linha_excel, x.ordem, x.linha_raw, x.wl_raw, x.ctg_raw, x.ft_raw, x.codigo_raw, x.kit_raw, x.umd_raw,
         x.descricao_raw, x.qtd_plan_raw, x.qtd_plan, x.qtd_real_raw, x.lms_qtd_real_informada, x.valor_ups_item_raw,
         x.valor_ups_item, x.valor_final_raw, x.valor_final, x.valor_final_plan_raw, x.valor_final_plan, x.estorno_raw,
         x.adicionais_raw,
         ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(x.alertas) = 'array' THEN x.alertas ELSE '[]'::jsonb END))
  FROM jsonb_to_recordset(p_linhas) AS x(
    linha_excel integer, ordem integer, linha_raw jsonb, wl_raw text, ctg_raw text, ft_raw text, codigo_raw text,
    kit_raw text, umd_raw text, descricao_raw text, qtd_plan_raw text, qtd_plan numeric, qtd_real_raw text,
    lms_qtd_real_informada numeric, valor_ups_item_raw text, valor_ups_item numeric, valor_final_raw text,
    valor_final numeric, valor_final_plan_raw text, valor_final_plan numeric, estorno_raw text, adicionais_raw text,
    alertas jsonb);

  -- ordem 1..n na mesma sequência de linha_excel
  SELECT count(*) INTO v_n FROM (
    SELECT l.ordem, row_number() OVER (ORDER BY l.linha_excel) AS rn
    FROM public.sot_lms_linhas l WHERE l.importacao_id = v_id) s
  WHERE s.ordem = s.rn;
  IF v_n <> v_qtd THEN
    RAISE EXCEPTION 'LMS: ordem das linhas não confere com a linha do Excel' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT l.wl_norm) FROM public.sot_lms_linhas l WHERE l.importacao_id = v_id)
     <> (p_importacao->>'qtd_wls_distintas')::integer THEN
    RAISE EXCEPTION 'LMS: quantidade de WLs distintas não confere' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sot_lms_linhas l WHERE l.importacao_id = v_id AND NOT public.sot_lms_linha_confere(l)) THEN
    RAISE EXCEPTION 'LMS: campo gravado diferente da célula original' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('cena.lms_registrando', '', true);

  INSERT INTO public.sot_lms_importacao_eventos (importacao_id, tipo_evento, por_auth, por_usuario_id, detalhe)
  VALUES (v_id, 'CRIADA', p_auth, v_usuario, jsonb_build_object('qtd_linhas', v_qtd, 'parser_version', p_importacao->>'parser_version'));

  RETURN jsonb_build_object(
    'importacao_id', v_id, 'reenvio', false, 'status', 'RASCUNHO', 'tipo_importacao', 'ORIGINAL',
    'hash_sha256', v_hash, 'arquivo_nome_original', p_importacao->>'arquivo_nome_original',
    'arquivo_tamanho', (p_importacao->>'arquivo_tamanho')::bigint, 'parser_version', p_importacao->>'parser_version',
    'worksheet', p_importacao->>'worksheet', 'projeto_identificacao_raw', p_importacao->>'projeto_identificacao_raw',
    'qtd_linhas', v_qtd, 'qtd_wls_distintas', (p_importacao->>'qtd_wls_distintas')::integer,
    'resumo', p_importacao->'resumo', 'criado_em', now());
END;
$$;

-- ── 7. Leitura paginada (mesma autorização do recebimento) ───────────────
CREATE OR REPLACE FUNCTION public.sot_lms_importacao_consultar(p_importacao_id uuid, p_offset integer DEFAULT 0, p_limite integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_imp    public.sot_lms_importacoes%ROWTYPE;
  v_motivo text;
  v_off    integer := greatest(coalesce(p_offset, 0), 0);
  v_lim    integer := least(greatest(coalesce(p_limite, 100), 1), 500);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'LMS: sem sessão' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_imp FROM public.sot_lms_importacoes WHERE id = p_importacao_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'LMS: importação inexistente' USING ERRCODE = 'P0002';
  END IF;
  v_motivo := public.sot_lms_autorizar(v_imp.projeto_id);
  IF v_motivo <> 'OK' THEN
    RAISE EXCEPTION 'LMS: acesso negado (%)', v_motivo USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'importacao', jsonb_build_object(
      'id', v_imp.id, 'projeto_id', v_imp.projeto_id, 'tipo_importacao', v_imp.tipo_importacao, 'status', v_imp.status,
      'hash_sha256', v_imp.hash_sha256, 'arquivo_nome_original', v_imp.arquivo_nome_original,
      'arquivo_tamanho', v_imp.arquivo_tamanho, 'parser_version', v_imp.parser_version, 'worksheet', v_imp.worksheet,
      'projeto_identificacao_raw', v_imp.projeto_identificacao_raw, 'qtd_linhas', v_imp.qtd_linhas,
      'qtd_wls_distintas', v_imp.qtd_wls_distintas, 'resumo', v_imp.resumo, 'criado_em', v_imp.criado_em),
    'offset', v_off, 'limite', v_lim,
    'linhas', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'linha_excel', l.linha_excel, 'ordem', l.ordem, 'wl_raw', l.wl_raw, 'ctg_raw', l.ctg_raw, 'ft_raw', l.ft_raw,
        'codigo_raw', l.codigo_raw, 'codigo_norm', l.codigo_norm, 'kit_raw', l.kit_raw, 'umd_raw', l.umd_raw,
        'descricao_raw', l.descricao_raw, 'qtd_plan_raw', l.qtd_plan_raw, 'qtd_plan', l.qtd_plan,
        'qtd_real_raw', l.qtd_real_raw, 'lms_qtd_real_informada', l.lms_qtd_real_informada,
        'valor_ups_item_raw', l.valor_ups_item_raw, 'valor_ups_item', l.valor_ups_item,
        'valor_final_raw', l.valor_final_raw, 'valor_final', l.valor_final,
        'valor_final_plan_raw', l.valor_final_plan_raw, 'valor_final_plan', l.valor_final_plan,
        'estorno_raw', l.estorno_raw, 'adicionais_raw', l.adicionais_raw, 'alertas', to_jsonb(l.alertas)) ORDER BY l.ordem)
      FROM (SELECT * FROM public.sot_lms_linhas WHERE importacao_id = v_imp.id ORDER BY ordem OFFSET v_off LIMIT v_lim) l
    ), '[]'::jsonb));
END;
$$;

-- ── 8. RLS e grants ──────────────────────────────────────────────────────
-- FORCE em todas: nem o dono lê/grava fora das funções sem BYPASSRLS. Sem policies: authenticated não lê as tabelas
-- direto (leitura só por sot_lms_importacao_consultar, com a mesma autorização do recebimento).
ALTER TABLE public.sot_lms_importacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sot_lms_importacoes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sot_lms_linhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sot_lms_linhas FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sot_lms_importacao_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sot_lms_importacao_eventos FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.sot_lms_importacoes FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.sot_lms_linhas FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.sot_lms_importacao_eventos FROM PUBLIC, anon, authenticated, service_role;
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role',
                 pg_get_serial_sequence('public.sot_lms_importacao_eventos', 'id'));
END $$;
-- A Edge consulta se a importação já existe antes de compensar uma falha (não remover objeto de outra requisição).
GRANT SELECT ON TABLE public.sot_lms_importacoes TO service_role;

REVOKE ALL ON FUNCTION public.fn_proj_texto_norm(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_proj_codigo_norm(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sot_lms_linha_raw_valida(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_proj_texto_norm(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_proj_codigo_norm(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sot_lms_linha_raw_valida(jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.sot_lms_exigir_registro() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sot_lms_importacoes_proteger() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sot_lms_imutavel() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sot_lms_autorizar(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sot_lms_celula_confere(jsonb, text, numeric, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sot_lms_linha_confere(public.sot_lms_linhas) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sot_lms_autorizar_recebimento(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.sot_lms_importacao_registrar(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sot_lms_importacao_consultar(uuid, integer, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.sot_lms_autorizar_recebimento(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sot_lms_importacao_registrar(uuid, uuid, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.sot_lms_importacao_consultar(uuid, integer, integer) TO authenticated;

-- ── 9. Storage privado ───────────────────────────────────────────────────
-- Sem policy em storage.objects para proj-lms: browser (anon/authenticated) não lê, não lista e não grava.
-- Só a Edge (service_role) grava. Sem URL pública; signed URL não implementada nesta etapa.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('proj-lms', 'proj-lms', false, 12582912,
        ARRAY['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Validação
-- SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'proj-lms';  -- public = false
-- SELECT policyname, cmd, roles, qual, with_check FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects';
--   -- nenhuma policy pode valer para proj-lms (policies sem filtro de bucket_id liberariam o bucket novo)
-- SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c
--   WHERE c.oid IN ('public.sot_lms_importacoes'::regclass, 'public.sot_lms_linhas'::regclass,
--                   'public.sot_lms_importacao_eventos'::regclass);                                  -- t, t
-- SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
--   WHERE table_name IN ('sot_lms_importacoes', 'sot_lms_linhas', 'sot_lms_importacao_eventos');   -- só service_role SELECT em importacoes
-- SELECT public.fn_proj_codigo_norm(' 000123 '), public.fn_proj_codigo_norm('000000'), public.fn_proj_codigo_norm('   ');  -- 123, 0, NULL
-- SELECT count(*) FROM public.sot_lms_importacoes;  -- 0

-- Para desfazer (nenhuma outra tabela depende destas nesta etapa; o bucket só sai vazio)
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.sot_lms_importacao_consultar(uuid, integer, integer);
-- DROP FUNCTION IF EXISTS public.sot_lms_importacao_registrar(uuid, uuid, jsonb, jsonb);
-- DROP FUNCTION IF EXISTS public.sot_lms_autorizar_recebimento(uuid);
-- DROP FUNCTION IF EXISTS public.sot_lms_autorizar(uuid);
-- DROP FUNCTION IF EXISTS public.sot_lms_linha_confere(public.sot_lms_linhas);
-- DROP TABLE IF EXISTS public.sot_lms_importacao_eventos;
-- DROP TABLE IF EXISTS public.sot_lms_linhas;
-- DROP TABLE IF EXISTS public.sot_lms_importacoes;
-- DROP FUNCTION IF EXISTS public.sot_lms_celula_confere(jsonb, text, numeric, boolean);
-- DROP FUNCTION IF EXISTS public.sot_lms_imutavel();
-- DROP FUNCTION IF EXISTS public.sot_lms_importacoes_proteger();
-- DROP FUNCTION IF EXISTS public.sot_lms_exigir_registro();
-- DROP FUNCTION IF EXISTS public.sot_lms_linha_raw_valida(jsonb);
-- DROP FUNCTION IF EXISTS public.fn_proj_codigo_norm(text);
-- DROP FUNCTION IF EXISTS public.fn_proj_texto_norm(text);
-- DELETE FROM storage.buckets WHERE id = 'proj-lms';  -- falha se houver objetos (remover pelo painel antes)
-- NOTIFY pgrst, 'reload schema';
-- COMMIT;
