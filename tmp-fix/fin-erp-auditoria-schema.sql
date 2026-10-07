-- Auditoria SOMENTE LEITURA para a integração Financeiro <-> ERP CENA.
-- Rode cada bloco separadamente no SQL Editor (ele mostra só o último resultado).
-- Antes de rodar, aumente o limite de linhas do SQL Editor (padrão = 100).

-- BLOCO 1 — Colunas das tabelas envolvidas
select table_name, ordinal_position, column_name, data_type, udt_name,
       is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('lancamentos','financeiro_faturamentos','fornecedores',
                     'contratos','categorias','subcategorias','verbas')
order by table_name, ordinal_position;

-- BLOCO 2 — Constraints (PK, FK, UNIQUE, CHECK)
select tc.table_name, tc.constraint_name, tc.constraint_type,
       pg_get_constraintdef(c.oid) as definicao
from information_schema.table_constraints tc
join pg_constraint c on c.conname = tc.constraint_name
join pg_class r on r.oid = c.conrelid and r.relname = tc.table_name
join pg_namespace n on n.oid = r.relnamespace and n.nspname = 'public'
where tc.table_schema = 'public'
  and tc.table_name in ('lancamentos','financeiro_faturamentos','fornecedores','contratos')
order by tc.table_name, tc.constraint_type, tc.constraint_name;

-- BLOCO 3 — Índices, triggers, RLS e policies
select 'indice' as tipo, tablename as tabela, indexname as nome, indexdef as definicao
from pg_indexes
where schemaname = 'public'
  and tablename in ('lancamentos','financeiro_faturamentos','fornecedores','contratos')
union all
select 'trigger', event_object_table, trigger_name,
       action_timing || ' ' || event_manipulation || ' ' || action_statement
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table in ('lancamentos','financeiro_faturamentos','fornecedores','contratos')
union all
select 'rls', c.relname, case when c.relrowsecurity then 'RLS ON' else 'RLS OFF' end,
       case when c.relforcerowsecurity then 'FORCE' else '' end
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('lancamentos','financeiro_faturamentos','fornecedores','contratos')
union all
select 'policy', tablename, policyname,
       cmd || ' roles=' || array_to_string(roles, ',') ||
       ' using=' || coalesce(qual,'') || ' check=' || coalesce(with_check,'')
from pg_policies
where schemaname = 'public'
  and tablename in ('lancamentos','financeiro_faturamentos','fornecedores','contratos')
order by 1, 2, 3;

-- BLOCO 4 — Perfil dos dados atuais (contagens, sem dados pessoais)
select 'lancamentos' as tabela, 'total' as metrica, count(*)::text as valor from public.lancamentos
union all select 'lancamentos', 'ativos (deleted_at null)', count(*)::text from public.lancamentos where deleted_at is null
union all select 'lancamentos', 'status=' || coalesce(status,'(null)'), count(*)::text from public.lancamentos where deleted_at is null group by status
union all select 'lancamentos', 'sem contrato_id', count(*)::text from public.lancamentos where deleted_at is null and contrato_id is null
union all select 'lancamentos', 'sem fornecedor_id', count(*)::text from public.lancamentos where deleted_at is null and fornecedor_id is null
union all select 'lancamentos', 'sem documento_fiscal', count(*)::text from public.lancamentos where deleted_at is null and coalesce(btrim(documento_fiscal),'') = ''
union all select 'lancamentos', 'min data_emissao', min(data_emissao)::text from public.lancamentos where deleted_at is null
union all select 'lancamentos', 'max data_emissao', max(data_emissao)::text from public.lancamentos where deleted_at is null
union all select 'financeiro_faturamentos', 'total', count(*)::text from public.financeiro_faturamentos
union all select 'financeiro_faturamentos', 'ativos (deleted_at null)', count(*)::text from public.financeiro_faturamentos where deleted_at is null
union all select 'financeiro_faturamentos', 'status=' || coalesce(status,'(null)'), count(*)::text from public.financeiro_faturamentos where deleted_at is null group by status
union all select 'financeiro_faturamentos', 'tipo=' || coalesce(tipo,'(null)'), count(*)::text from public.financeiro_faturamentos where deleted_at is null group by tipo
union all select 'financeiro_faturamentos', 'origem_api=true', count(*)::text from public.financeiro_faturamentos where deleted_at is null and origem_api is true
union all select 'financeiro_faturamentos', 'sem nfe', count(*)::text from public.financeiro_faturamentos where deleted_at is null and coalesce(btrim(nfe),'') = ''
union all select 'financeiro_faturamentos', 'nfe repetida (grupos)', count(*)::text from (
  select nfe from public.financeiro_faturamentos
  where deleted_at is null and coalesce(btrim(nfe),'') <> ''
  group by nfe having count(*) > 1) d
union all select 'financeiro_faturamentos', 'min data_emissao', min(data_emissao)::text from public.financeiro_faturamentos where deleted_at is null
union all select 'financeiro_faturamentos', 'max data_emissao', max(data_emissao)::text from public.financeiro_faturamentos where deleted_at is null
union all select 'fornecedores', 'total ativos', count(*)::text from public.fornecedores where deleted_at is null
union all select 'fornecedores', 'cnpj_cpf repetido (grupos)', count(*)::text from (
  select cnpj_cpf from public.fornecedores
  where deleted_at is null and coalesce(btrim(cnpj_cpf),'') <> ''
  group by cnpj_cpf having count(*) > 1) d
order by 1, 2;
