-- sql_correcao_rfid_0007682486_re108.sql
-- Correção cadastral: crachá 0007682486 associado indevidamente ao RE 108.
-- NÃO apaga histórico. NÃO deleta por colaborador_id/RE.
-- Padrão CENA: status DESCADASTRADO (libera o UID; mantém a linha).
--
-- Rodar no SQL Editor do Supabase (role que escreve em colaborador_credenciais + audit_log).
-- 1) Execute o bloco LOCALIZAR e leia o resultado.
-- 2) Só então execute o bloco CORRIGIR (ele ABORTA sozinho se count <> 1).

-- ══════════════════════════════════════════════════════════════
-- 1) LOCALIZAR — somente leitura
-- ══════════════════════════════════════════════════════════════
-- Tabela real: public.colaborador_credenciais (cadastro mestre RFID).
-- Colunas de tempo no schema: criado_em / atualizado_em (não created_at).

WITH alvo AS (
  SELECT
    cc.id,
    cc.colaborador_id,
    c.re,
    c.nome AS colaborador_nome,
    cc.tipo,
    cc.uid,
    cc.uid_normalizado,
    cc.status,
    cc.emitido_em,
    cc.ativado_em,
    cc.bloqueado_em,
    cc.bloqueado_por,
    cc.motivo_bloqueio,
    cc.substitui_credencial_id,
    cc.origem_leitura,
    cc.criado_por,
    cc.criado_em,
    cc.atualizado_em
  FROM public.colaborador_credenciais cc
  JOIN public.colaboradores c ON c.id = cc.colaborador_id
  WHERE cc.tipo = 'RFID'
    AND public.cena_rfid_normalizar_uid(cc.uid_normalizado)
        = public.cena_rfid_normalizar_uid('0007682486')
    AND regexp_replace(coalesce(c.re, ''), '[^0-9]', '', 'g')
        IN ('108', '000108')
)
SELECT * FROM alvo;

-- Deve retornar EXATAMENTE 1 linha. Se 0 ou >1: NÃO rode o bloco 3.

-- Demais crachás do RE 108 (devem permanecer iguais depois):
SELECT
  cc.id, cc.uid, cc.uid_normalizado, cc.status, cc.criado_em, cc.atualizado_em
FROM public.colaborador_credenciais cc
JOIN public.colaboradores c ON c.id = cc.colaborador_id
WHERE cc.tipo = 'RFID'
  AND regexp_replace(coalesce(c.re, ''), '[^0-9]', '', 'g') IN ('108', '000108')
ORDER BY cc.criado_em;

-- ══════════════════════════════════════════════════════════════
-- 2) REFERÊNCIAS — somente leitura (não apagar)
-- ══════════════════════════════════════════════════════════════
-- FKs para colaborador_credenciais (histórico operacional NÃO deve ser deletado):
SELECT
  tc.table_schema,
  tc.table_name,
  kcu.column_name,
  rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
 AND tc.table_schema = kcu.table_schema
JOIN information_schema.referential_constraints rc
  ON rc.constraint_name = tc.constraint_name
 AND rc.constraint_schema = tc.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = rc.unique_constraint_name
 AND ccu.constraint_schema = rc.unique_constraint_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND ccu.table_schema = 'public'
  AND ccu.table_name = 'colaborador_credenciais';

-- Eventos/auditoria que apenas CITAM o UID (não são a associação cadastral):
SELECT 'audit_log' AS origem, count(*)::int AS qtd
FROM public.audit_log
WHERE dados_extra::text ILIKE '%0007682486%'
   OR descricao ILIKE '%0007682486%';

-- ══════════════════════════════════════════════════════════════
-- 3) CORRIGIR — transação fail-closed
-- ══════════════════════════════════════════════════════════════
BEGIN;

DO $$
DECLARE
  v_id uuid;
  v_colab uuid;
  v_re text;
  v_uid text;
  v_status text;
  v_n int;
  v_upd int;
BEGIN
  SELECT cc.id, cc.colaborador_id, c.re, cc.uid_normalizado, cc.status
    INTO v_id, v_colab, v_re, v_uid, v_status
  FROM public.colaborador_credenciais cc
  JOIN public.colaboradores c ON c.id = cc.colaborador_id
  WHERE cc.tipo = 'RFID'
    AND public.cena_rfid_normalizar_uid(cc.uid_normalizado)
        = public.cena_rfid_normalizar_uid('0007682486')
    AND regexp_replace(coalesce(c.re, ''), '[^0-9]', '', 'g') IN ('108', '000108')
  FOR UPDATE OF cc;

  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n <> 1 THEN
    RAISE EXCEPTION 'PARAR: esperava 1 credencial RE 108 + RFID 0007682486; encontrados %', v_n;
  END IF;

  IF v_status = 'DESCADASTRADO' THEN
    RAISE EXCEPTION 'PARAR: credencial % já está DESCADASTRADO. Nenhuma alteração.', v_id;
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
    RAISE EXCEPTION 'PARAR: UPDATE afetou % linhas (esperado 1). Rollback.', v_upd;
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

-- ══════════════════════════════════════════════════════════════
-- 4) VALIDAÇÃO — somente leitura
-- ══════════════════════════════════════════════════════════════

-- 4.1 RE 108 não tem 0007682486 ATIVO
SELECT count(*) AS re108_uid_ativo
FROM public.colaborador_credenciais cc
JOIN public.colaboradores c ON c.id = cc.colaborador_id
WHERE cc.tipo = 'RFID'
  AND cc.status = 'ATIVO'
  AND public.cena_rfid_normalizar_uid(cc.uid_normalizado)
      = public.cena_rfid_normalizar_uid('0007682486')
  AND regexp_replace(coalesce(c.re, ''), '[^0-9]', '', 'g') IN ('108', '000108');
-- esperado: 0

-- 4.2 UID sem associação ocupada (ATIVO/BLOQUEADO/SUBSTITUIDO)
SELECT cc.id, cc.colaborador_id, c.re, cc.status, cc.uid_normalizado
FROM public.colaborador_credenciais cc
JOIN public.colaboradores c ON c.id = cc.colaborador_id
WHERE cc.tipo = 'RFID'
  AND public.cena_rfid_normalizar_uid(cc.uid_normalizado)
      = public.cena_rfid_normalizar_uid('0007682486');
-- esperado: 1 linha DESCADASTRADO (histórico preservado)

-- 4.3 Outros crachás do RE 108
SELECT cc.id, cc.uid_normalizado, cc.status
FROM public.colaborador_credenciais cc
JOIN public.colaboradores c ON c.id = cc.colaborador_id
WHERE cc.tipo = 'RFID'
  AND regexp_replace(coalesce(c.re, ''), '[^0-9]', '', 'g') IN ('108', '000108')
ORDER BY cc.criado_em;

-- 4.4 Auditoria desta correção
SELECT acao, descricao, usuario_nome, data_hora, dados_extra
FROM public.audit_log
WHERE acao = 'CORRECAO_CREDENCIAL_RFID'
  AND sessao_id = 'sql:correcao_rfid_0007682486_re108'
ORDER BY data_hora DESC
LIMIT 3;
