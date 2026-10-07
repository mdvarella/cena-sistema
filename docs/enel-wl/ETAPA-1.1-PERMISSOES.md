# Fase 1 LMS/WL — Etapa 1.1 (permissões por ação)

Implementada e testada localmente em 07/10/2026. **Migration não aplicada no Supabase.** Nenhuma tela usa estas funções ainda.

- Migration: `supabase/migrations/20261007190000_cena_permissoes_acao.sql`
- Testes: `tests/cena-permissoes-acao-sql.test.mjs` (PGlite, com os helpers reais de `20261004190000` e a função real de `20261004200000`)

## Objetos

| Objeto | Papel |
|---|---|
| `cena_acoes` | Catálogo de ações (`codigo` PK, `modulo`, `descricao`, `ativo`, `criado_em`). |
| `cena_permissoes_acao` | Regra perfil + ação + contrato opcional (`contrato_id uuid` FK `contratos`). Uma regra viva por chave (índices únicos parciais). Revogação = `deleted_at`, definitiva. |
| `cena_permissoes_acao_eventos` | Histórico gravado por gatilho no banco: operação, perfil, ação, contrato, valor anterior, valor novo, motivo, `auth.uid()`, `usuarios_sistema.id`, data/hora. Imutável (UPDATE, DELETE e TRUNCATE recusados). |
| `cena_pode(p_acao text, p_contrato_id uuid DEFAULT NULL)` | `STABLE`, `SECURITY DEFINER`, `search_path = public, pg_temp`. Só `authenticated` executa. |
| `cena_permissao_acao_conceder / _negar / _revogar` | Únicas portas de escrita. Exigem `cena_usuarios_pode_administrar()` (admin, gestor) e motivo. |
| `cena_contrato_ativo(uuid)` | Interna. Contrato existe e `status = 'Ativo'` (e `deleted_at` vazio, se a coluna existir). |

## Regras

- Usuário: `auth.uid()` → `usuarios_sistema.auth_user_id`, ativo, não excluído, via `cena_usuario_perfil_sessao()` (helper existente). Sem fallback por e-mail.
- Precedência: regra viva do contrato > regra viva global > `FALSE`.
- Contrato informado e não ativo (inexistente, Cancelado, Encerrado, Suspenso, Em negociação) → `FALSE`, mesmo com regra global. "Excluir contrato" no ERP grava `status = 'Cancelado'`.
- Qualquer erro dentro de `cena_pode` → `FALSE`.
- Sem sessão (SQL Editor, migration, `service_role`) → `FALSE`; `service_role` nem tem `EXECUTE`.
- `PROJ_PROGRAMAR`: a migration lê `cena_prog_pode_programar_projetos()` no banco e só semeia se a lista for exatamente `admin, diretoria, gestor, coordenador, supervisor, administrativo, escritorio`. Diferente → a migration inteira falha.
- Gestor não altera regras dos perfis `admin` e `diretoria` (mesmo critério do gatilho de `usuarios_sistema`).
- Reaplicar a migration não sobrescreve ação existente nem recria regra que já existiu (mesmo revogada).

## Auditoria dos logs anon

Sem acesso aos logs da API do Supabase a partir daqui: exige o painel ou um token de gestão, que não foi pedido. Consulta sugerida para o Log Explorer (fonte `edge_logs`; não executada, conferir nomes dos campos no painel):

```sql
select
  regexp_extract(request.path, '^/rest/v1/([^?/]+)') as recurso,
  request.method,
  authorization_payload.role as papel,
  count(*) as chamadas,
  min(timestamp) as primeira,
  max(timestamp) as ultima
from edge_logs
cross join unnest(metadata) as metadata
cross join unnest(metadata.request) as request
cross join unnest(request.sb) as sb
cross join unnest(sb.jwt) as jwt
cross join unnest(jwt.authorization) as auth
cross join unnest(auth.payload) as authorization_payload
where request.path like '/rest/v1/%'
group by recurso, request.method, papel
order by chamadas desc
limit 200
```
