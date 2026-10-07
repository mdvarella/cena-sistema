-- Pré-requisitos da sincronização de fornecedores ERP -> Supabase. SOMENTE LEITURA.
-- Rode cada bloco separadamente no SQL Editor (ele mostra só o último resultado).

-- BLOCO A — Colunas de fornecedores (tipo do id, NOT NULL sem default, colunas já existentes)
select ordinal_position, column_name, data_type, udt_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'fornecedores'
order by ordinal_position;

-- BLOCO B — Tudo o que a migration confere antes de aplicar (cada linha deve vir ok = true)
select 'fornecedores existe' as item, to_regclass('public.fornecedores') is not null as ok, '' as detalhe
union all
select 'colunas obrigatórias (id, razao_social, cnpj_cpf, tipo, contato, telefone, email, status, deleted_at)',
       count(*) = 9, string_agg(column_name, ', ')
from information_schema.columns
where table_schema = 'public' and table_name = 'fornecedores'
  and column_name in ('id','razao_social','cnpj_cpf','tipo','contato','telefone','email','status','deleted_at')
union all
select 'id tem default (insert sem id)',
       bool_and(column_default is not null), max(column_default)
from information_schema.columns
where table_schema = 'public' and table_name = 'fornecedores' and column_name = 'id'
union all
select 'nenhuma outra coluna NOT NULL sem default',
       count(*) = 0, coalesce(string_agg(column_name, ', '), '')
from information_schema.columns
where table_schema = 'public' and table_name = 'fornecedores'
  and is_nullable = 'NO' and column_default is null
  and column_name not in ('id','razao_social','cnpj_cpf','tipo','contato','telefone','email','status','deleted_at',
                          'nome_fantasia','cidade','estado')
union all
select 'cena_usuario_perfil_sessao() existe (migration 20261004190000)',
       to_regprocedure('public.cena_usuario_perfil_sessao()') is not null, ''
union all
select 'service_role ignora RLS (rolbypassrls)',
       coalesce((select rolbypassrls from pg_roles where rolname = 'service_role'), false), ''
union all
select 'service_role pode SELECT/INSERT/UPDATE em fornecedores',
       has_table_privilege('service_role', 'public.fornecedores', 'SELECT')
       and has_table_privilege('service_role', 'public.fornecedores', 'INSERT')
       and has_table_privilege('service_role', 'public.fornecedores', 'UPDATE'), ''
union all
select 'pg_cron instalado', exists (select 1 from pg_extension where extname = 'pg_cron'),
       coalesce((select 'disponível: ' || default_version from pg_available_extensions where name = 'pg_cron'), 'indisponível')
union all
select 'pg_net instalado', exists (select 1 from pg_extension where extname = 'pg_net'),
       coalesce((select 'disponível: ' || default_version from pg_available_extensions where name = 'pg_net'), 'indisponível')
union all
select 'vault instalado', exists (select 1 from pg_extension where extname = 'supabase_vault'), '';

-- BLOCO C — Gatilhos, policies e CNPJ repetido (só dígitos) em fornecedores
select 'trigger' as tipo, trigger_name as nome, action_timing || ' ' || event_manipulation as detalhe
from information_schema.triggers
where event_object_schema = 'public' and event_object_table = 'fornecedores'
union all
select 'policy', policyname, cmd || ' roles=' || array_to_string(roles, ',')
from pg_policies where schemaname = 'public' and tablename = 'fornecedores'
union all
select 'rls', 'fornecedores', case when relrowsecurity then 'ON' else 'OFF' end
from pg_class where oid = 'public.fornecedores'::regclass
union all
select 'cnpj repetido (só dígitos)', d, count(*)::text
from (select regexp_replace(coalesce(cnpj_cpf, ''), '\D', '', 'g') as d
      from public.fornecedores where deleted_at is null) x
where length(d) in (11, 14)
group by d having count(*) > 1
order by 1, 2;
