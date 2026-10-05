-- AUDITORIA SOMENTE LEITURA — contas Auth criadas nos últimos 30 dias (só totais, sem e-mail)
-- origem pela metadata: erp_usuario_id = criada pelo upgrade MD5 -> Auth no navegador (auth.signUp)
-- origem pela auditoria do Auth: quem executou o cadastro (a própria conta = signup público; outro ator = admin/service_role)
WITH recentes AS (
  SELECT u.id, u.created_at,
         (u.raw_user_meta_data ? 'erp_usuario_id') AS meta_upgrade,
         CASE WHEN split_part(lower(trim(u.email)), '@', 1) ~ '^[0-9]+$'
              THEN coalesce(nullif(regexp_replace(split_part(lower(trim(u.email)), '@', 1), '^0+', ''), ''), '0')
                   || '@' || split_part(lower(trim(u.email)), '@', 2)
              ELSE lower(trim(u.email)) END AS email_norm
  FROM auth.users u
  WHERE u.created_at > now() - interval '30 days'
),
erp AS (
  SELECT us.auth_user_id, (us.ativo AND us.deleted_at IS NULL) AS ativo,
         CASE WHEN split_part(lower(trim(us.email)), '@', 1) ~ '^[0-9]+$'
              THEN coalesce(nullif(regexp_replace(split_part(lower(trim(us.email)), '@', 1), '^0+', ''), ''), '0')
                   || '@' || split_part(lower(trim(us.email)), '@', 2)
              ELSE lower(trim(us.email)) END AS email_norm
  FROM public.usuarios_sistema us
),
aud AS (
  SELECT r.id,
         bool_or(a.payload->>'actor_id' = r.id::text)                                  AS por_ela_mesma,
         bool_or(coalesce(a.payload->>'actor_id', '') <> r.id::text)                    AS por_outro_ator
  FROM recentes r
  JOIN auth.audit_log_entries a
    ON a.payload->>'action' IN ('user_signedup', 'user_invited')
   AND (a.payload->>'actor_id' = r.id::text OR a.payload->'traits'->>'user_id' = r.id::text)
  GROUP BY r.id
)
SELECT
  CASE
    WHEN EXISTS (SELECT 1 FROM erp e WHERE e.auth_user_id = r.id AND e.ativo)      THEN '1 vinculada a ERP ativo'
    WHEN EXISTS (SELECT 1 FROM erp e WHERE e.auth_user_id = r.id)                  THEN '2 vinculada a ERP inativo/excluido'
    WHEN EXISTS (SELECT 1 FROM erp e WHERE e.email_norm = r.email_norm
                                       AND e.auth_user_id IS NOT NULL)            THEN '3 duplicada (ERP ligado a outra conta)'
    WHEN EXISTS (SELECT 1 FROM erp e WHERE e.email_norm = r.email_norm)           THEN '4 ERP com o e-mail, sem vinculo'
    ELSE '5 sem cadastro ERP'
  END AS vinculo,
  CASE
    WHEN r.meta_upgrade                                THEN 'upgrade MD5 no navegador (signUp)'
    WHEN a.por_ela_mesma                               THEN 'auditoria: signup publico (a propria conta)'
    WHEN a.por_outro_ator                              THEN 'auditoria: criada por admin/service_role'
    ELSE 'origem nao identificada'
  END AS origem,
  count(*) AS total
FROM recentes r
LEFT JOIN aud a ON a.id = r.id
GROUP BY 1, 2
ORDER BY 1, 2;
