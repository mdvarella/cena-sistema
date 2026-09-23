-- sql_portaria_acesso_infra_1c.sql
-- PORT-AUTO-SYS-1C — pontos de acesso + dispositivos + 4 câmeras lógicas.
-- Aditivo / idempotente.
-- NÃO executar pelo ERP. Aplicar manualmente no SQL Editor do Supabase após aprovação.
-- Sem hardware, IP, RTSP, MQTT, senha ou comando de portão.
--
-- base_id = filiais.id (UUID confirmado no schema real).
-- portaria_id = portaria_configs.id (UUID, opcional) — portaria física na filial.
-- NÃO presume texto. NÃO altera filiais / portaria_configs / frotas_veiculos.
-- NOTA 1D: bloqueio operacional do veículo = situação cadastral (frotas_veiculos)
--   + frotas_portaria_bloqueios. NÃO concentrar isso em fn_tag_resolver.
--
-- GATE 22/09/2026 — portaria ativa por filial (schema real):
--   O ERP PERMITE várias portaria_configs.status='Ativo' na mesma filial
--   (tipos Principal/Administrativa/Fundos etc.). CENA02 (CAMACAM) tem 2 ativas:
--   CAMACAM 01 (Administrativa) e CAMPOS VERGUEIRA 01 (Principal).
--   NÃO usar LIMIT 1. portaria_id só é preenchido se existir EXATAMENTE 1 ativa.
--   Se 0 ou N>1: portaria_id fica NULL (associação explícita depois; sem chute).
--
-- Códigos de dispositivo: prefixo estável + '_' + filial.codigo sanitizado
--   (somente [A-Za-z0-9], caixa original). Ex. CENA01 → LEITOR_TAG_SAIDA_CENA01
--   CENA 09 → LEITOR_TAG_SAIDA_CENA09. NÃO usa nome da filial.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.cena_acesso_infra_usuario_sessao()
RETURNS public.usuarios_sistema
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_us public.usuarios_sistema%ROWTYPE;
  v_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_us
  FROM public.usuarios_sistema us
  WHERE us.auth_user_id = auth.uid()
    AND us.ativo IS TRUE
    AND us.deleted_at IS NULL
  LIMIT 1;
  IF v_us.id IS NOT NULL THEN
    RETURN v_us;
  END IF;
  v_email := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  IF v_email = '' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_us
  FROM public.usuarios_sistema us
  WHERE lower(btrim(us.email)) = v_email
    AND us.ativo IS TRUE
    AND us.deleted_at IS NULL
  ORDER BY CASE WHEN us.auth_user_id = auth.uid() THEN 0 WHEN us.auth_user_id IS NULL THEN 1 ELSE 2 END
  LIMIT 1;
  RETURN v_us;
END;
$$;

CREATE OR REPLACE FUNCTION public.cena_acesso_infra_pode_cadastrar()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_us public.usuarios_sistema%ROWTYPE;
BEGIN
  v_us := public.cena_acesso_infra_usuario_sessao();
  RETURN v_us.id IS NOT NULL
    AND lower(btrim(coalesce(v_us.perfil, ''))) IN ('admin','diretoria','gestor','coordenador');
END;
$$;

CREATE OR REPLACE FUNCTION public.cena_acesso_infra_pode_ler()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_us public.usuarios_sistema%ROWTYPE;
BEGIN
  v_us := public.cena_acesso_infra_usuario_sessao();
  RETURN v_us.id IS NOT NULL
    AND lower(btrim(coalesce(v_us.perfil, ''))) IN (
      'admin','diretoria','gestor','coordenador','supervisor','supervisor_tma','portaria','escritorio'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.cena_acesso_infra_audit(
  p_acao text,
  p_descricao text,
  p_dados_extra jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_us public.usuarios_sistema%ROWTYPE;
BEGIN
  IF p_acao IS NULL OR btrim(p_acao) = '' THEN
    RAISE EXCEPTION 'Auditoria acesso: ação obrigatória'
      USING ERRCODE = '22023', HINT = 'ACESSO_AUDIT_ACAO';
  END IF;
  v_us := public.cena_acesso_infra_usuario_sessao();
  INSERT INTO public.audit_log (
    acao, modulo, descricao, usuario_id, usuario_nome, usuario_perfil,
    dados_extra, data_hora, sessao_id
  ) VALUES (
    p_acao, 'frotas', coalesce(p_descricao, p_acao),
    coalesce(v_us.id::text, auth.uid()::text, ''),
    coalesce(v_us.nome, ''),
    coalesce(v_us.perfil, ''),
    jsonb_strip_nulls(coalesce(p_dados_extra, '{}'::jsonb)),
    now(), 'trg:acesso-infra'
  );
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- Pontos de acesso
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.portaria_pontos_acesso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL,
  nome text NOT NULL,
  base_id uuid REFERENCES public.filiais(id),
  portaria_id uuid REFERENCES public.portaria_configs(id),
  tipo text NOT NULL,
  sentido text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.portaria_pontos_acesso IS
  'Pontos lógicos de portão. base_id = filiais.id. Sem hardware.';
COMMENT ON COLUMN public.portaria_pontos_acesso.codigo IS
  'Código estável para o CENA Access Gateway (ex. PORTAO_VEICULOS_SAIDA). Único por base.';

ALTER TABLE public.portaria_pontos_acesso
  DROP CONSTRAINT IF EXISTS portaria_pontos_tipo_chk;
ALTER TABLE public.portaria_pontos_acesso
  ADD CONSTRAINT portaria_pontos_tipo_chk CHECK (tipo IN ('VEICULAR','PEDESTRE'));

ALTER TABLE public.portaria_pontos_acesso
  DROP CONSTRAINT IF EXISTS portaria_pontos_sentido_chk;
ALTER TABLE public.portaria_pontos_acesso
  ADD CONSTRAINT portaria_pontos_sentido_chk CHECK (sentido IN ('ENTRADA','SAIDA','BIDIRECIONAL'));

ALTER TABLE public.portaria_pontos_acesso
  DROP CONSTRAINT IF EXISTS portaria_pontos_codigo_chk;
ALTER TABLE public.portaria_pontos_acesso
  ADD CONSTRAINT portaria_pontos_codigo_chk CHECK (btrim(codigo) <> '');

CREATE UNIQUE INDEX IF NOT EXISTS uq_portaria_pontos_base_codigo
  ON public.portaria_pontos_acesso (base_id, codigo);

CREATE INDEX IF NOT EXISTS idx_portaria_pontos_base
  ON public.portaria_pontos_acesso (base_id, ativo);

-- ══════════════════════════════════════════════════════════════
-- Dispositivos lógicos
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.portaria_dispositivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL,
  nome text NOT NULL,
  tipo text NOT NULL,
  base_id uuid REFERENCES public.filiais(id),
  portaria_id uuid REFERENCES public.portaria_configs(id),
  ponto_acesso_id uuid REFERENCES public.portaria_pontos_acesso(id),
  sentido text,
  funcao text,
  identificador_hardware text,
  ativo boolean NOT NULL DEFAULT true,
  status_comunicacao text NOT NULL DEFAULT 'SIMULADO',
  ultima_comunicacao timestamptz,
  configuracao jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.portaria_dispositivos IS
  'Dispositivos lógicos (leitor, câmera, controlador, sensor). status inicial SIMULADO. Sem IP/RTSP/MQTT.';
COMMENT ON COLUMN public.portaria_dispositivos.identificador_hardware IS
  'Identificador opaco/lógico. NÃO é IP, senha, RTSP ou serial.';
COMMENT ON COLUMN public.portaria_dispositivos.configuracao IS
  'JSON administrativo. NÃO guardar senha, broker ou URL de câmera.';

ALTER TABLE public.portaria_dispositivos
  DROP CONSTRAINT IF EXISTS portaria_disp_tipo_chk;
ALTER TABLE public.portaria_dispositivos
  ADD CONSTRAINT portaria_disp_tipo_chk
  CHECK (tipo IN ('LEITOR_RFID','LEITOR_TAG','CAMERA','CONTROLADOR_PORTAO','SENSOR_PORTAO'));

ALTER TABLE public.portaria_dispositivos
  DROP CONSTRAINT IF EXISTS portaria_disp_status_chk;
ALTER TABLE public.portaria_dispositivos
  ADD CONSTRAINT portaria_disp_status_chk
  CHECK (status_comunicacao IN ('SIMULADO','ONLINE','OFFLINE','ERRO'));

ALTER TABLE public.portaria_dispositivos
  DROP CONSTRAINT IF EXISTS portaria_disp_sentido_chk;
ALTER TABLE public.portaria_dispositivos
  ADD CONSTRAINT portaria_disp_sentido_chk
  CHECK (sentido IS NULL OR sentido IN ('ENTRADA','SAIDA','BIDIRECIONAL'));

ALTER TABLE public.portaria_dispositivos
  DROP CONSTRAINT IF EXISTS portaria_disp_codigo_chk;
ALTER TABLE public.portaria_dispositivos
  ADD CONSTRAINT portaria_disp_codigo_chk CHECK (btrim(codigo) <> '');

CREATE UNIQUE INDEX IF NOT EXISTS uq_portaria_disp_codigo
  ON public.portaria_dispositivos (codigo);

CREATE INDEX IF NOT EXISTS idx_portaria_disp_ponto
  ON public.portaria_dispositivos (ponto_acesso_id, tipo);

CREATE INDEX IF NOT EXISTS idx_portaria_disp_base
  ON public.portaria_dispositivos (base_id, ativo);

-- ══════════════════════════════════════════════════════════════
-- Triggers atualizado_em + auditoria
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.portaria_acesso_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.atualizado_em := now();
  ELSE
    NEW.atualizado_em := coalesce(NEW.atualizado_em, now());
    NEW.criado_em := coalesce(NEW.criado_em, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_portaria_pontos_before ON public.portaria_pontos_acesso;
CREATE TRIGGER trg_portaria_pontos_before
BEFORE INSERT OR UPDATE ON public.portaria_pontos_acesso
FOR EACH ROW EXECUTE FUNCTION public.portaria_acesso_before_write();

DROP TRIGGER IF EXISTS trg_portaria_disp_before ON public.portaria_dispositivos;
CREATE TRIGGER trg_portaria_disp_before
BEFORE INSERT OR UPDATE ON public.portaria_dispositivos
FOR EACH ROW EXECUTE FUNCTION public.portaria_acesso_before_write();

CREATE OR REPLACE FUNCTION public.portaria_acesso_after_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_acao text;
  v_desc text;
  v_extra jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_acao := CASE WHEN TG_TABLE_NAME = 'portaria_pontos_acesso' THEN 'PONTO_ACESSO_CRIADO' ELSE 'DISPOSITIVO_CRIADO' END;
    v_desc := format('Criou %s %s', TG_TABLE_NAME, coalesce(NEW.codigo, NEW.id::text));
    v_extra := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    v_acao := CASE WHEN TG_TABLE_NAME = 'portaria_pontos_acesso' THEN 'PONTO_ACESSO_ALTERADO' ELSE 'DISPOSITIVO_ALTERADO' END;
    v_desc := format('Alterou %s %s', TG_TABLE_NAME, coalesce(NEW.codigo, NEW.id::text));
    v_extra := jsonb_build_object('antes', to_jsonb(OLD), 'depois', to_jsonb(NEW));
  ELSE
    v_acao := CASE WHEN TG_TABLE_NAME = 'portaria_pontos_acesso' THEN 'PONTO_ACESSO_EXCLUIDO' ELSE 'DISPOSITIVO_EXCLUIDO' END;
    v_desc := format('Excluiu %s %s', TG_TABLE_NAME, coalesce(OLD.codigo, OLD.id::text));
    v_extra := to_jsonb(OLD);
  END IF;
  PERFORM public.cena_acesso_infra_audit(v_acao, v_desc, v_extra);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_portaria_pontos_audit ON public.portaria_pontos_acesso;
CREATE TRIGGER trg_portaria_pontos_audit
AFTER INSERT OR UPDATE OR DELETE ON public.portaria_pontos_acesso
FOR EACH ROW EXECUTE FUNCTION public.portaria_acesso_after_audit();

DROP TRIGGER IF EXISTS trg_portaria_disp_audit ON public.portaria_dispositivos;
CREATE TRIGGER trg_portaria_disp_audit
AFTER INSERT OR UPDATE OR DELETE ON public.portaria_dispositivos
FOR EACH ROW EXECUTE FUNCTION public.portaria_acesso_after_audit();

-- ══════════════════════════════════════════════════════════════
-- RLS
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.portaria_pontos_acesso ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portaria_pontos_acesso FORCE ROW LEVEL SECURITY;
ALTER TABLE public.portaria_dispositivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portaria_dispositivos FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.portaria_pontos_acesso FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.portaria_dispositivos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.portaria_pontos_acesso TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.portaria_dispositivos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.portaria_pontos_acesso TO authenticated;
GRANT ALL ON TABLE public.portaria_pontos_acesso TO service_role;
GRANT ALL ON TABLE public.portaria_dispositivos TO service_role;

DROP POLICY IF EXISTS portaria_pontos_select ON public.portaria_pontos_acesso;
CREATE POLICY portaria_pontos_select ON public.portaria_pontos_acesso
  FOR SELECT TO authenticated
  USING (public.cena_acesso_infra_pode_ler());

DROP POLICY IF EXISTS portaria_pontos_write ON public.portaria_pontos_acesso;
CREATE POLICY portaria_pontos_write ON public.portaria_pontos_acesso
  FOR ALL TO authenticated
  USING (public.cena_acesso_infra_pode_cadastrar())
  WITH CHECK (public.cena_acesso_infra_pode_cadastrar());

DROP POLICY IF EXISTS portaria_disp_select ON public.portaria_dispositivos;
CREATE POLICY portaria_disp_select ON public.portaria_dispositivos
  FOR SELECT TO authenticated
  USING (public.cena_acesso_infra_pode_ler());

DROP POLICY IF EXISTS portaria_disp_write ON public.portaria_dispositivos;
CREATE POLICY portaria_disp_write ON public.portaria_dispositivos
  FOR ALL TO authenticated
  USING (public.cena_acesso_infra_pode_cadastrar())
  WITH CHECK (public.cena_acesso_infra_pode_cadastrar());

REVOKE ALL ON FUNCTION public.cena_acesso_infra_usuario_sessao() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cena_acesso_infra_audit(text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portaria_acesso_after_audit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cena_acesso_infra_pode_cadastrar() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cena_acesso_infra_pode_ler() TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- Seeds lógicos por filial (sem hardware)
-- ══════════════════════════════════════════════════════════════

INSERT INTO public.portaria_pontos_acesso (codigo, nome, base_id, portaria_id, tipo, sentido, ativo)
SELECT x.codigo, x.nome, f.id, pc.id, x.tipo, x.sentido, true
FROM public.filiais f
LEFT JOIN (
  SELECT filial_id, (array_agg(id))[1] AS id
  FROM public.portaria_configs
  WHERE coalesce(status, 'Ativo') = 'Ativo'
  GROUP BY filial_id
  HAVING count(*) = 1
) pc ON pc.filial_id = f.id
CROSS JOIN (VALUES
  ('PORTAO_VEICULOS_SAIDA',    'Portão veículos — saída',    'VEICULAR', 'SAIDA'),
  ('PORTAO_VEICULOS_ENTRADA',  'Portão veículos — entrada',  'VEICULAR', 'ENTRADA'),
  ('PORTAO_PEDESTRES_ENTRADA', 'Portão pedestres — entrada', 'PEDESTRE', 'ENTRADA'),
  ('PORTAO_PEDESTRES_SAIDA',   'Portão pedestres — saída',   'PEDESTRE', 'SAIDA')
) AS x(codigo, nome, tipo, sentido)
ON CONFLICT (base_id, codigo) DO NOTHING;

INSERT INTO public.portaria_dispositivos (
  codigo, nome, tipo, base_id, portaria_id, ponto_acesso_id, sentido, funcao,
  identificador_hardware, ativo, status_comunicacao, configuracao
)
SELECT
  d.codigo_pref || '_' || coalesce(nullif(regexp_replace(btrim(f.codigo), '[^A-Za-z0-9]', '', 'g'), ''), substr(replace(f.id::text,'-',''),1,8)),
  d.nome,
  d.tipo,
  f.id,
  p.portaria_id,
  p.id,
  d.sentido,
  d.funcao,
  d.codigo_pref || '_' || coalesce(nullif(regexp_replace(btrim(f.codigo), '[^A-Za-z0-9]', '', 'g'), ''), 'BASE'),
  true,
  'SIMULADO',
  jsonb_build_object('origem', 'SEED_1C', 'simulado', true, 'sem_hardware', true)
FROM public.filiais f
CROSS JOIN (VALUES
  ('LEITOR_TAG_SAIDA',        'Leitor TAG — saída veicular',     'LEITOR_TAG',         'PORTAO_VEICULOS_SAIDA',    'SAIDA',   'LEITURA_TAG_SAIDA'),
  ('LEITOR_RFID_SAIDA',       'Leitor RFID — saída veicular',    'LEITOR_RFID',        'PORTAO_VEICULOS_SAIDA',    'SAIDA',   'LEITURA_RFID_SAIDA'),
  ('CTRL_PORTAO_SAIDA',       'Controlador — portão saída',      'CONTROLADOR_PORTAO', 'PORTAO_VEICULOS_SAIDA',    'SAIDA',   'COMANDO_PORTAO_SAIDA'),
  ('SENSOR_PORTAO_SAIDA',     'Sensor — portão saída',           'SENSOR_PORTAO',      'PORTAO_VEICULOS_SAIDA',    'SAIDA',   'ESTADO_PORTAO_SAIDA'),
  ('CAM01',                   'Câmera 01 — saída',              'CAMERA',             'PORTAO_VEICULOS_SAIDA',    'SAIDA',   'EVIDENCIA_SAIDA'),
  ('CAM02',                   'Câmera 02 — saída',              'CAMERA',             'PORTAO_VEICULOS_SAIDA',    'SAIDA',   'EVIDENCIA_SAIDA'),
  ('LEITOR_TAG_ENTRADA',      'Leitor TAG — entrada veicular',   'LEITOR_TAG',         'PORTAO_VEICULOS_ENTRADA',  'ENTRADA', 'LEITURA_TAG_ENTRADA'),
  ('LEITOR_RFID_ENTRADA',     'Leitor RFID — entrada veicular',  'LEITOR_RFID',        'PORTAO_VEICULOS_ENTRADA',  'ENTRADA', 'LEITURA_RFID_ENTRADA'),
  ('CTRL_PORTAO_ENTRADA',     'Controlador — portão entrada',    'CONTROLADOR_PORTAO', 'PORTAO_VEICULOS_ENTRADA',  'ENTRADA', 'COMANDO_PORTAO_ENTRADA'),
  ('SENSOR_PORTAO_ENTRADA',   'Sensor — portão entrada',         'SENSOR_PORTAO',      'PORTAO_VEICULOS_ENTRADA',  'ENTRADA', 'ESTADO_PORTAO_ENTRADA'),
  ('CAM03',                   'Câmera 03 — entrada',            'CAMERA',             'PORTAO_VEICULOS_ENTRADA',  'ENTRADA', 'EVIDENCIA_ENTRADA'),
  ('CAM04',                   'Câmera 04 — entrada',            'CAMERA',             'PORTAO_VEICULOS_ENTRADA',  'ENTRADA', 'EVIDENCIA_ENTRADA'),
  ('LEITOR_RFID_PED_ENTRADA', 'Leitor RFID — pedestre entrada',  'LEITOR_RFID',        'PORTAO_PEDESTRES_ENTRADA', 'ENTRADA', 'LEITURA_RFID_PEDESTRE_ENTRADA'),
  ('LEITOR_RFID_PED_SAIDA',   'Leitor RFID — pedestre saída',    'LEITOR_RFID',        'PORTAO_PEDESTRES_SAIDA',   'SAIDA',   'LEITURA_RFID_PEDESTRE_SAIDA')
) AS d(codigo_pref, nome, tipo, ponto_codigo, sentido, funcao)
JOIN public.portaria_pontos_acesso p
  ON p.base_id = f.id AND p.codigo = d.ponto_codigo
ON CONFLICT (codigo) DO NOTHING;
