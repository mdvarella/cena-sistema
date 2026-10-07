-- Primeira carga controlada — fornecedores ERP CENA -> public.fornecedores. SOMENTE LEITURA.
-- Rodar no SQL Editor do Supabase, um bloco por vez, na ordem do roteiro abaixo.
--
-- Roteiro:
--   0. tmp-fix/forn-erp-sync-prereq.sql (todas as linhas ok = true)
--   1. guardar as policies atuais (consulta no topo de 20261006185900_fornecedores_sem_acesso_anon.sql),
--      aplicar 20261006185900_fornecedores_sem_acesso_anon.sql e depois
--      supabase/migrations/20261006190000_fornecedores_erp_sync.sql
--   2. secrets da Edge (painel > Edge Functions > Secrets): ERP_CENABR_TOKEN, ERP_SYNC_CRON_SECRET (>= 32 caracteres)
--   3. supabase functions deploy erp-fornecedores-sync --no-verify-jwt
--   4. SIMULAÇÃO: logado no sistema como admin/diretoria/gestor/administrativo, no console do navegador:
--        erpSincronizarFornecedores('simulacao')
--      depois rodar os blocos A e B
--   5. revisar os conflitos (bloco B) antes da carga real
--   6. CARGA REAL: no console, erpSincronizarFornecedores('completa'); depois blocos A, C e D
--   7. Vault (SQL Editor): select vault.create_secret('<url da Edge>', 'erp_sync_edge_url');
--                          select vault.create_secret('<mesmo valor de ERP_SYNC_CRON_SECRET>', 'erp_sync_cron_secret');
--   8. aplicar supabase/migrations/20261006190100_fornecedores_erp_sync_cron.sql; no dia seguinte, bloco E

-- ── A. Últimas execuções ────────────────────────────────────────────────
select iniciado_em, finalizado_em, modo, disparo, status, paginas, lidos, inseridos, atualizados,
       inalterados, vinculados, inativados, conflitos, ignorados, watermark_anterior, watermark_novo, erro,
       resumo->>'total_erp' as total_erp, resumo->>'ids_unicos' as ids_unicos
from public.erp_sync_execucoes
where recurso = 'suppliers'
order by iniciado_em desc
limit 10;

-- ── B. Conflitos da última simulação (resumo) com o fornecedor local envolvido ──
with ult as (
  select resumo from public.erp_sync_execucoes
  where recurso = 'suppliers' and modo = 'SIMULACAO' and status <> 'EM_EXECUCAO'
  order by iniciado_em desc limit 1
), c as (
  select (x->>'erp_id')::int as erp_id, x->>'motivo' as motivo, x->>'fornecedor_id' as fornecedor_id
  from ult, jsonb_array_elements(coalesce(ult.resumo->'conflitos', '[]'::jsonb)) x
)
select c.motivo, c.erp_id, c.fornecedor_id, f.razao_social as local_razao, f.cnpj_cpf as local_cnpj, f.status as local_status
from c left join public.fornecedores f on f.id::text = c.fornecedor_id
order by c.motivo, c.erp_id;

-- Conflitos gravados pela carga real e ainda abertos
select k.motivo, k.erp_id, e.razao_social as erp_razao, e.cnpj_cpf as erp_cnpj,
       k.fornecedor_id, f.razao_social as local_razao, f.cnpj_cpf as local_cnpj, k.criado_em
from public.erp_sync_conflitos k
left join public.fornecedores e on e.erp_id = k.erp_id
left join public.fornecedores f on f.id::text = k.fornecedor_id
where k.recurso = 'suppliers' and k.resolvido_em is null
order by k.motivo, k.erp_id;

-- ── C. Conferência depois da carga real ─────────────────────────────────
select
  count(*) filter (where origem = 'ERP')                                   as com_erp_id,
  count(*) filter (where origem = 'MANUAL' and deleted_at is null)         as manuais_ativos_sem_vinculo,
  count(*) filter (where origem = 'ERP' and erp_ausente_desde is not null) as ausentes_no_erp,
  count(*) filter (where origem = 'ERP' and status = 'Inativo')            as erp_inativos,
  count(*) filter (where origem = 'ERP' and erp_hash is null)              as erp_sem_hash,
  count(distinct erp_id)                                                   as erp_ids_distintos
from public.fornecedores;

-- Manuais que ficaram sem vínculo mas têm CPF/CNPJ igual a um registro do ERP (devem estar em conflitos)
select m.id, m.razao_social, m.cnpj_cpf, e.erp_id, e.razao_social as erp_razao
from public.fornecedores m
join public.fornecedores e
  on e.origem = 'ERP'
 and regexp_replace(coalesce(e.cnpj_cpf, ''), '\D', '', 'g') = regexp_replace(coalesce(m.cnpj_cpf, ''), '\D', '', 'g')
where m.origem = 'MANUAL' and m.deleted_at is null
  and length(regexp_replace(coalesce(m.cnpj_cpf, ''), '\D', '', 'g')) in (11, 14)
order by m.razao_social;

-- ── D. Referências continuam íntegras (nenhum fornecedor apagado) ────────
select count(*) filter (where deleted_at is not null) as apagados_logicos, count(*) as total
from public.fornecedores;

-- ── E. Cron ─────────────────────────────────────────────────────────────
select jobid, jobname, schedule, active from cron.job where jobname = 'erp-fornecedores-sync-diario';
select status, return_message, start_time, end_time
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'erp-fornecedores-sync-diario')
order by start_time desc
limit 5;
-- Resposta HTTP da última chamada do cron (pg_net guarda por algumas horas)
select id, status_code, left(content::text, 500) as corpo, created
from net._http_response
order by created desc
limit 5;
