-- ETAPA 1.3 (ENEL/LMS/WL) — Listagem dos RASCUNHOS para a tela de Confirmação Humana
-- Motivo: a 1.3 tirou de authenticated toda leitura direta de sot_lms_importacoes (RLS FORCE, sem policies) e a única
-- leitura existente (sot_lms_importacao_consultar) exige o id da importação. A tela precisa LISTAR os RASCUNHOS.
-- Somente leitura: não grava nada, não altera tabela/CHECK/trava/migration anterior, não cria WL, não toca
-- sot_materiais/sot_atividades/estoque/programação/TMA.
-- Visibilidade por linha (nunca por e-mail): o usuário vê o RASCUNHO se pode ler o LMS do projeto
-- (sot_lms_autorizar → PROJ_IMPORTAR_LMS) OU pode confirmá-lo (sot_lms_autorizar_confirmacao → PROJ_CONFIRMAR_LMS).
-- pode_confirmar é só informativo para a tela; a autorização final continua em sot_lms_confirmar.
-- Transação explícita: qualquer falha desfaz a etapa inteira.

BEGIN;

-- ── 0. Pré-condições (falha inteira, nada é aplicado) ────────────────────
DO $$
BEGIN
  IF NOT coalesce((SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user), false) THEN
    RAISE EXCEPTION 'Rode como dono com BYPASSRLS: a função SECURITY DEFINER lê tabela com RLS FORCE';
  END IF;
  IF to_regclass('public.sot_lms_importacoes') IS NULL
     OR to_regprocedure('public.sot_lms_autorizar(uuid)') IS NULL THEN
    RAISE EXCEPTION 'aplique antes 20261009193000_proj_lms_origem.sql (Etapa 1.3)';
  END IF;
  IF to_regprocedure('public.sot_lms_autorizar_confirmacao(uuid)') IS NULL
     OR to_regprocedure('public.sot_lms_confirmar(uuid, text, text)') IS NULL THEN
    RAISE EXCEPTION 'aplique antes 20261010120000_proj_lms_confirmacao.sql (Etapa 1.3 Confirmação)';
  END IF;
END $$;

-- ── 1. RPC de leitura ────────────────────────────────────────────────────
-- Sem parâmetros vindos do cliente. Devolve jsonb (array), mais recentes primeiro, teto de 500 linhas.
-- Nome/código do projeto lidos via to_jsonb (sot_projetos não tem FK nem colunas garantidas para o LMS).
CREATE OR REPLACE FUNCTION public.sot_lms_rascunhos_listar()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'LMS rascunhos: sem sessão' USING ERRCODE = '42501';
  END IF;
  IF public.cena_usuario_perfil_sessao() IS NULL THEN
    RAISE EXCEPTION 'LMS rascunhos: USUARIO_ERP_INATIVO' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(x.item ORDER BY x.criado_em DESC, x.id), '[]'::jsonb) INTO v_res
  FROM (
    SELECT i.id, i.criado_em,
           jsonb_build_object(
             'id', i.id, 'projeto_id', i.projeto_id,
             'projeto_nome', to_jsonb(sp)->>'nome', 'projeto_codigo', to_jsonb(sp)->>'codigo_cliente',
             'tipo_importacao', i.tipo_importacao, 'status', i.status, 'hash_sha256', i.hash_sha256,
             'arquivo_nome_original', i.arquivo_nome_original, 'qtd_linhas', i.qtd_linhas,
             'qtd_wls_distintas', i.qtd_wls_distintas, 'criado_em', i.criado_em,
             'pode_confirmar', a.conf = 'OK') AS item
    FROM public.sot_lms_importacoes i
    CROSS JOIN LATERAL (SELECT public.sot_lms_autorizar(i.projeto_id) AS ler,
                               public.sot_lms_autorizar_confirmacao(i.projeto_id) AS conf) a
    LEFT JOIN public.sot_projetos sp ON sp.id = i.projeto_id
    WHERE i.status = 'RASCUNHO'
      AND (a.ler = 'OK' OR a.conf = 'OK')
    ORDER BY i.criado_em DESC, i.id
    LIMIT 500
  ) x;

  RETURN v_res;
END;
$$;

-- ── 2. Grants ────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.sot_lms_rascunhos_listar() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.sot_lms_rascunhos_listar() TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Validação
-- SELECT proname, prosecdef, proconfig FROM pg_proc WHERE proname = 'sot_lms_rascunhos_listar';
-- SELECT grantee, privilege_type FROM information_schema.role_routine_grants
--   WHERE routine_name = 'sot_lms_rascunhos_listar';  -- só authenticated EXECUTE

-- Para desfazer — remove só esta função (nenhum dado é afetado).
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.sot_lms_rascunhos_listar();
-- NOTIFY pgrst, 'reload schema';
-- COMMIT;
