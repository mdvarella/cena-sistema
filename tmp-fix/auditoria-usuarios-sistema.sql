-- AUDITORIA SOMENTE LEITURA — usuarios_sistema / Auth / RLS (rodar no SQL Editor; não altera nada)

-- 1. RLS, dono e se o dono ignora RLS
SELECT c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS dono,
       r.rolsuper, r.rolbypassrls
FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
WHERE c.oid = 'public.usuarios_sistema'::regclass;

-- 2. Policies
SELECT policyname, permissive, cmd, roles, qual, with_check
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'usuarios_sistema';

-- 3. Grants
SELECT r.rolname,
       has_table_privilege(r.rolname, 'public.usuarios_sistema', 'SELECT')   AS sel,
       has_table_privilege(r.rolname, 'public.usuarios_sistema', 'INSERT')   AS ins,
       has_table_privilege(r.rolname, 'public.usuarios_sistema', 'UPDATE')   AS upd,
       has_table_privilege(r.rolname, 'public.usuarios_sistema', 'DELETE')   AS del,
       has_table_privilege(r.rolname, 'public.usuarios_sistema', 'TRUNCATE') AS trunc
FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated', 'service_role');

-- 4. PK, unique, FK, check
SELECT conname, contype, pg_get_constraintdef(oid) AS definicao
FROM pg_constraint WHERE conrelid = 'public.usuarios_sistema'::regclass ORDER BY contype, conname;

-- 5. FKs de outras tabelas apontando para usuarios_sistema
SELECT conrelid::regclass AS tabela, conname, pg_get_constraintdef(oid) AS definicao
FROM pg_constraint WHERE confrelid = 'public.usuarios_sistema'::regclass;

-- 6. Índices
SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'usuarios_sistema';

-- 7. Triggers em usuarios_sistema e em auth.users (cadastro automático ao criar conta?)
SELECT tgrelid::regclass AS tabela, tgname, pg_get_triggerdef(oid) AS definicao
FROM pg_trigger
WHERE NOT tgisinternal AND tgrelid IN ('public.usuarios_sistema'::regclass, 'auth.users'::regclass);

-- 8. Funções que leem usuarios_sistema (autorização) — usa e-mail? SECURITY DEFINER? search_path?
SELECT p.oid::regprocedure AS funcao,
       p.prosecdef AS security_definer,
       p.proconfig AS config,
       p.prosrc ILIKE '%auth_user_id%' AS usa_auth_user_id,
       (p.prosrc ILIKE '%jwt%email%' OR p.prosrc ILIKE '%.email%') AS usa_email,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_executa
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'auth') AND p.prosrc ILIKE '%usuarios_sistema%'
ORDER BY 1;

-- 9. Policies de OUTRAS tabelas que consultam usuarios_sistema
SELECT schemaname, tablename, policyname, roles, cmd
FROM pg_policies
WHERE tablename <> 'usuarios_sistema'
  AND (coalesce(qual, '') || coalesce(with_check, '')) ILIKE '%usuarios_sistema%';

-- 10. Views sobre usuarios_sistema (rodam como dono, fora da RLS) e quem lê
SELECT DISTINCT v.oid::regclass AS view,
       has_table_privilege('anon', v.oid, 'SELECT') AS anon_le,
       has_table_privilege('authenticated', v.oid, 'SELECT') AS auth_le
FROM pg_depend d JOIN pg_rewrite rw ON rw.oid = d.objid JOIN pg_class v ON v.oid = rw.ev_class
WHERE d.refobjid = 'public.usuarios_sistema'::regclass AND v.oid <> d.refobjid;

-- 11. Contas Auth sem cadastro ERP e cadastros ERP apontando para conta inexistente (só contagem)
SELECT
  (SELECT count(*) FROM auth.users u
    WHERE NOT EXISTS (SELECT 1 FROM public.usuarios_sistema us WHERE us.auth_user_id = u.id)) AS auth_sem_cadastro_erp,
  (SELECT count(*) FROM public.usuarios_sistema us
    WHERE us.auth_user_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = us.auth_user_id)) AS erp_com_auth_inexistente,
  (SELECT count(*) FROM auth.users u WHERE u.created_at > now() - interval '30 days') AS auth_criadas_30d;
