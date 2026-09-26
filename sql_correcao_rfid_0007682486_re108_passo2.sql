-- sql_correcao_rfid_0007682486_re108_passo2.sql
-- O passo 1 abortou: o banco ainda tem
--   CHECK status IN ('ATIVO','BLOQUEADO','SUBSTITUIDO')
-- (sql_colaborador_credenciais_rfid_descadastro.sql NÃO estava aplicado).
-- A transação deu ROLLBACK — a linha continua como estava.
--
-- Registro já localizado (1):
--   credencial_id  = 3bf767fe-a6dd-4a9c-b6f3-3324ee17c1f4
--   colaborador_id = b98950e8-c7bb-4136-a51d-fc23fbc27627
--   uid            = 0007682486
--
-- Este script:
--   1) libera o status DESCADASTRADO no check (e o índice único parcial, senão o UID continua ocupado);
--   2) descadastra SOMENTE esse id + RFID;
--   3) grava audit_log CORRECAO_CREDENCIAL_RFID.
-- Não apaga histórico. Não altera outro colaborador.

-- 0) Conferência (1 linha; se não for, NÃO continue)
SELECT cc.id, cc.colaborador_id, c.re, cc.uid, cc.uid_normalizado, cc.status
FROM public.colaborador_credenciais cc
JOIN public.colaboradores c ON c.id = cc.colaborador_id
WHERE cc.id = '3bf767fe-a6dd-4a9c-b6f3-3324ee17c1f4'
  AND cc.tipo = 'RFID'
  AND public.cena_rfid_normalizar_uid(cc.uid_normalizado)
      = public.cena_rfid_normalizar_uid('0007682486')
  AND regexp_replace(coalesce(c.re, ''), '[^0-9]', '', 'g') IN ('108', '000108');

-- 1) Schema mínimo (idempotente) — mesmo recorte do 8.1.121
ALTER TABLE public.colaborador_credenciais
  DROP CONSTRAINT IF EXISTS colaborador_credenciais_status_chk;
ALTER TABLE public.colaborador_credenciais
  ADD CONSTRAINT colaborador_credenciais_status_chk
  CHECK (status IN ('ATIVO','BLOQUEADO','SUBSTITUIDO','DESCADASTRADO'));

DROP INDEX IF EXISTS public.uq_cred_tipo_uid_norm;
DROP INDEX IF EXISTS public.uq_cred_tipo_uid_norm_ocupado;
CREATE UNIQUE INDEX uq_cred_tipo_uid_norm_ocupado
  ON public.colaborador_credenciais (tipo, uid_normalizado)
  WHERE status IN ('ATIVO','BLOQUEADO','SUBSTITUIDO');

-- 2) Correção fail-closed
BEGIN;

DO $$
DECLARE
  v_id uuid := '3bf767fe-a6dd-4a9c-b6f3-3324ee17c1f4';
  v_colab uuid;
  v_re text;
  v_uid text;
  v_status text;
  v_n int;
  v_upd int;
BEGIN
  SELECT cc.colaborador_id, c.re, cc.uid_normalizado, cc.status
    INTO v_colab, v_re, v_uid, v_status
  FROM public.colaborador_credenciais cc
  JOIN public.colaboradores c ON c.id = cc.colaborador_id
  WHERE cc.id = v_id
    AND cc.tipo = 'RFID'
    AND public.cena_rfid_normalizar_uid(cc.uid_normalizado)
        = public.cena_rfid_normalizar_uid('0007682486')
    AND regexp_replace(coalesce(c.re, ''), '[^0-9]', '', 'g') IN ('108', '000108')
  FOR UPDATE OF cc;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'PARAR: esperava 1 linha do id+RFID+RE 108; encontrados %', v_n;
  END IF;
  IF v_status = 'DESCADASTRADO' THEN
    RAISE EXCEPTION 'PARAR: já DESCADASTRADO. Nenhuma alteração.';
  END IF;

  UPDATE public.colaborador_credenciais
  SET status = 'DESCADASTRADO',
      bloqueado_em = now(),
      bloqueado_por = coalesce(current_user, 'sql-editor'),
      motivo_bloqueio = 'Crachá RFID cadastrado na pessoa errada.'
  WHERE id = v_id
    AND tipo = 'RFID'
    AND public.cena_rfid_normalizar_uid(uid_normalizado)
        = public.cena_rfid_normalizar_uid('0007682486');

  GET DIAGNOSTICS v_upd = ROW_COUNT;
  IF v_upd <> 1 THEN
    RAISE EXCEPTION 'PARAR: UPDATE afetou % linhas. Rollback.', v_upd;
  END IF;

  INSERT INTO public.audit_log (
    acao, modulo, descricao,
    usuario_id, usuario_nome, usuario_perfil,
    dados_extra, data_hora, sessao_id
  ) VALUES (
    'CORRECAO_CREDENCIAL_RFID',
    'rh',
    'Crachá RFID cadastrado na pessoa errada. RE 108 / 0007682486 descadastrado.',
    '',
    coalesce(current_user, 'sql-editor'),
    '',
    jsonb_build_object(
      're', '108',
      'rfid', '0007682486',
      'uid_normalizado', v_uid,
      'credencial_id', v_id,
      'colaborador_id', v_colab,
      'colaborador_re', v_re,
      'status_anterior', v_status,
      'status_novo', 'DESCADASTRADO',
      'motivo', 'Crachá RFID cadastrado na pessoa errada.',
      'registros_afetados', 1
    ),
    now(),
    'sql:correcao_rfid_0007682486_re108'
  );
END $$;

COMMIT;

-- 3) Validação
SELECT count(*) AS re108_uid_ativo
FROM public.colaborador_credenciais cc
JOIN public.colaboradores c ON c.id = cc.colaborador_id
WHERE cc.tipo = 'RFID' AND cc.status = 'ATIVO'
  AND public.cena_rfid_normalizar_uid(cc.uid_normalizado)
      = public.cena_rfid_normalizar_uid('0007682486')
  AND regexp_replace(coalesce(c.re, ''), '[^0-9]', '', 'g') IN ('108', '000108');

SELECT cc.id, cc.colaborador_id, c.re, cc.status, cc.uid_normalizado, cc.motivo_bloqueio
FROM public.colaborador_credenciais cc
JOIN public.colaboradores c ON c.id = cc.colaborador_id
WHERE cc.id = '3bf767fe-a6dd-4a9c-b6f3-3324ee17c1f4';

SELECT cc.id, cc.uid_normalizado, cc.status
FROM public.colaborador_credenciais cc
JOIN public.colaboradores c ON c.id = cc.colaborador_id
WHERE cc.tipo = 'RFID'
  AND regexp_replace(coalesce(c.re, ''), '[^0-9]', '', 'g') IN ('108', '000108')
ORDER BY cc.criado_em;

SELECT acao, descricao, data_hora, dados_extra
FROM public.audit_log
WHERE acao = 'CORRECAO_CREDENCIAL_RFID'
  AND sessao_id = 'sql:correcao_rfid_0007682486_re108'
ORDER BY data_hora DESC
LIMIT 3;
