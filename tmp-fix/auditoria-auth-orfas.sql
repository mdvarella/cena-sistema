-- AUDITORIA SOMENTE LEITURA — contas Auth sem cadastro ERP ligado (rodar cada bloco separadamente:
-- selecione o bloco e clique Run; o SQL Editor só mostra o resultado do último comando executado)

-- A. Totais
SELECT
  (SELECT count(*) FROM auth.users)                                                        AS auth_total,
  (SELECT count(*) FROM public.usuarios_sistema)                                           AS erp_total,
  (SELECT count(*) FROM public.usuarios_sistema WHERE ativo AND deleted_at IS NULL)        AS erp_ativos,
  (SELECT count(*) FROM public.usuarios_sistema WHERE auth_user_id IS NOT NULL)            AS erp_vinculados,
  (SELECT count(*) FROM public.usuarios_sistema
    WHERE ativo AND deleted_at IS NULL AND auth_user_id IS NULL)                           AS erp_ativos_sem_vinculo;

-- B. Contas Auth sem vínculo, por categoria (e-mail RE comparado sem zeros à esquerda)
WITH erp AS (
  SELECT us.auth_user_id,
         (us.ativo AND us.deleted_at IS NULL) AS ativo,
         CASE WHEN split_part(lower(trim(us.email)), '@', 1) ~ '^[0-9]+$'
              THEN coalesce(nullif(regexp_replace(split_part(lower(trim(us.email)), '@', 1), '^0+', ''), ''), '0')
                   || '@' || split_part(lower(trim(us.email)), '@', 2)
              ELSE lower(trim(us.email)) END AS email_norm
  FROM public.usuarios_sistema us
  WHERE us.email IS NOT NULL
),
orfas AS (
  SELECT u.id, u.created_at, u.last_sign_in_at, u.email_confirmed_at,
         (u.raw_user_meta_data ? 'erp_usuario_id') AS meta_erp,
         CASE WHEN split_part(lower(trim(u.email)), '@', 1) ~ '^[0-9]+$'
              THEN coalesce(nullif(regexp_replace(split_part(lower(trim(u.email)), '@', 1), '^0+', ''), ''), '0')
                   || '@' || split_part(lower(trim(u.email)), '@', 2)
              ELSE lower(trim(u.email)) END AS email_norm
  FROM auth.users u
  WHERE NOT EXISTS (SELECT 1 FROM public.usuarios_sistema us WHERE us.auth_user_id = u.id)
),
cls AS (
  SELECT o.*,
    CASE
      WHEN EXISTS (SELECT 1 FROM erp e WHERE e.email_norm = o.email_norm AND e.auth_user_id IS NULL AND e.ativo)
        THEN '1 cadastro ERP ATIVO sem vinculo'
      WHEN EXISTS (SELECT 1 FROM erp e WHERE e.email_norm = o.email_norm AND e.auth_user_id IS NULL)
        THEN '2 cadastro ERP inativo/excluido sem vinculo'
      WHEN EXISTS (SELECT 1 FROM erp e WHERE e.email_norm = o.email_norm)
        THEN '3 cadastro ERP ja ligado a OUTRA conta Auth'
      ELSE '4 nenhum cadastro ERP com esse e-mail'
    END AS categoria
  FROM orfas o
)
SELECT categoria,
       count(*)                                                           AS total,
       count(*) FILTER (WHERE email_confirmed_at IS NOT NULL)             AS email_confirmado,
       count(*) FILTER (WHERE last_sign_in_at IS NULL)                    AS nunca_entrou,
       count(*) FILTER (WHERE last_sign_in_at > now() - interval '30 days') AS entrou_30d,
       count(*) FILTER (WHERE created_at > now() - interval '30 days')    AS criada_30d,
       count(*) FILTER (WHERE meta_erp)                                   AS com_meta_erp_usuario_id,
       min(created_at)::date                                              AS mais_antiga,
       max(created_at)::date                                              AS mais_recente
FROM cls
GROUP BY categoria
ORDER BY categoria;

-- C. Contas Auth criadas nos últimos 30 dias sem cadastro ERP ligado (para você conferir quem são;
--    não precisa colar e-mails no chat — basta dizer se reconhece todas)
SELECT u.email, u.created_at, u.last_sign_in_at, u.email_confirmed_at IS NOT NULL AS confirmado,
       u.raw_app_meta_data->>'provider' AS provider,
       u.raw_user_meta_data ? 'erp_usuario_id' AS criada_pelo_upgrade_erp
FROM auth.users u
WHERE u.created_at > now() - interval '30 days'
  AND NOT EXISTS (SELECT 1 FROM public.usuarios_sistema us WHERE us.auth_user_id = u.id)
ORDER BY u.created_at DESC;
