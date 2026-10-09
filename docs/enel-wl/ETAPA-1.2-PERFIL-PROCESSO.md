# Fase 1 LMS/WL - Etapa 1.2 (perfil de processo por contrato e projeto)

Implementada e testada localmente em 09/10/2026. **Migration não aplicada no Supabase.** Nenhuma tela usa estas funções ainda: zero mudança de comportamento no ERP.

- Migration: `supabase/migrations/20261009173000_proj_perfil_processo.sql`
- Testes: `tests/proj-perfil-processo-sql.test.mjs` (PGlite, com os helpers reais de `20261004190000`, a função real `cena_prog_pode_programar_projetos` de `20261004200000` e a migration real da Etapa 1.1)
- Depende da Etapa 1.1 (`20261007190000_cena_permissoes_acao.sql`, já aplicada e homologada): usa `cena_pode` e a ação `PROJ_ALTERAR_PERFIL_PROCESSO`. Nenhuma ação ou permissão nova.

## Quatro coisas separadas

| Conceito | Onde fica | Efeito |
|---|---|---|
| Catálogo de perfis disponíveis | `cena_processo_perfis` (+ `cena_processo_perfis_eventos`) | Lista versionada de processos. Não liga nada a projeto nem a contrato. |
| Perfil sugerido pelo contrato | `cena_contrato_processo_perfil` | Só orienta congelamentos futuros. **Nunca congela projeto** e não retroage. |
| Processo congelado do projeto | `sot_projeto_processo` | Fonte oficial do processo do projeto. Uma linha no máximo por projeto. |
| Histórico | `sot_projeto_processo_eventos` | Append-only. Um evento por congelamento/alteração. |

## Objetos

| Objeto | Papel |
|---|---|
| `cena_processo_perfis` | `id`, `codigo_perfil`, `versao`, `nome`, `descricao`, `requisitos jsonb`, `ativo`, `justificativa`, `criado_em`, `criado_por_auth`, `atualizado_em`, `atualizado_por_auth`. `UNIQUE (codigo_perfil, versao)`. |
| `cena_processo_perfis_eventos` | Histórico do catálogo (CRIAR, ATIVAR, DESATIVAR, ALTERAR_TEXTO) com antes/depois, justificativa, `auth.uid()` e `usuarios_sistema.id`. Imutável. |
| `cena_contrato_processo_perfil` | Sugestão: `contrato_id uuid` FK `contratos(id)`, perfil/versão FK do catálogo, justificativa, autor, revogação. Uma sugestão vigente por contrato (índice único parcial). Linha revogada é definitiva; as linhas são o histórico. |
| `sot_projeto_processo` | `projeto_id uuid` (`UNIQUE`), perfil/versão FK do catálogo, `origem_congelamento` (`GESTOR` ou `LMS_ORIGINAL_ESTRUTURA_NOVA`), justificativa, `metadados`, `congelado_*` (vigente) e `criado_*` (primeiro congelamento). |
| `sot_projeto_processo_eventos` | `CONGELAR` (anterior = `BASE_PROJETOS` derivado, sem versão) ou `ALTERAR` (anterior = versão congelada), contrato do projeto no momento, sugestão vigente no momento (em `metadados.sugestao_contrato`), justificativa, autor. Imutável. |
| `cena_projeto_processo_efetivo(projeto_id)` | Leitura. Ver abaixo. |
| `cena_projeto_processo_congelar(projeto_id, perfil, versao, justificativa)` | Congelamento explícito (também é o caminho BASE_PROJETOS derivado → outro perfil). |
| `cena_projeto_processo_alterar(projeto_id, perfil_atual, versao_atual, perfil, versao, justificativa)` | Troca de processo já congelado, com concorrência otimista. |
| `cena_contrato_processo_perfil_definir / _revogar` | Sugestão por contrato. |
| `cena_processo_perfil_criar_versao / _administrar` | Catálogo. |

Funções internas (sem `EXECUTE` para ninguém): `sot_projeto_processo_contexto`, `sot_projeto_processo_contrato_uuid`, `sot_projeto_processo_sugestao`, `cena_processo_perfil_exigir`, `cena_processo_exigir_sessao`, `sot_projeto_processo_autorizar`, `sot_projeto_processo_gravar`, `cena_processo_perfil_exigir_admin` e as 6 funções de gatilho. Total: 5 tabelas, 21 funções, 12 gatilhos, 5 policies.

## BASE_PROJETOS

- Projeto **sem linha** em `sot_projeto_processo` = BASE_PROJETOS **derivado**: é o fluxo atual do ERP. Os ~1.400 projetos existentes ficam assim. **Sem backfill.**
- O catálogo semeia só `BASE_PROJETOS v1` (requisitos `{}`), para quem quiser congelar explicitamente no base. BASE_PROJETOS não recebe nova versão e não é desativado.
- Derivado e congelado são distinguíveis na leitura: derivado volta com `congelado = false`, `perfil_versao = NULL`, `origem = 'SEM_REGISTRO_BASE_PROJETOS'`; congelado explícito volta com `congelado = true`, `perfil_versao = 1`, `origem = 'GESTOR'`.

## Leitura: efetivo ≠ sugerido

`cena_projeto_processo_efetivo(projeto_id)` devolve uma linha:

| Coluna | Significado |
|---|---|
| `congelado` | `true` = há processo congelado; `false` = BASE_PROJETOS derivado |
| `perfil_codigo`, `perfil_versao`, `origem`, `congelado_em`, `requisitos` | Perfil **efetivo** (o que vale para o projeto) |
| `sugerido_perfil_codigo`, `sugerido_perfil_versao` | Sugestão vigente do contrato do projeto. **Informativa**: nunca vira efetivo sozinha |

Exige usuário ERP ativo (`cena_usuario_erp_ativo()`). Projeto inexistente → nenhuma linha.

## Imutabilidade do catálogo (no banco, por gatilho)

| Campos | Regra |
|---|---|
| `id`, `codigo_perfil`, `versao`, `requisitos`, `criado_em`, `criado_por_auth` | **Imutáveis sempre.** Mudou o processo = nova versão (`cena_processo_perfil_criar_versao`, versão = última + 1). |
| `nome`, `descricao`, `ativo` | **Administrativos**: só por `cena_processo_perfil_administrar`, com justificativa e evento no histórico. |
| `justificativa`, `atualizado_em`, `atualizado_por_auth` | Preenchidos pela RPC a cada mudança administrativa. |

- A regra é mais forte que "versão usada": `requisitos` não muda nem em versão ainda não usada, então não existe janela entre "não usada" e "usada".
- Versão inativa não entra em congelamento nem em sugestão nova; projeto já congelado nela continua nela.
- Versão de perfil não é apagada (DELETE e TRUNCATE recusados).

## Congelamento e alteração

- **Sugestão nunca congela.** Nada na migration cria linha em `sot_projeto_processo` a partir da sugestão.
- Congelar: `cena_projeto_processo_congelar`. Só projeto sem processo. Repetir o mesmo perfil/versão devolve `SEM_MUDANCA` (duplo clique, duas abas, requisição repetida). Outro perfil em projeto já congelado é recusado: "use `cena_projeto_processo_alterar`".
- Alterar: `cena_projeto_processo_alterar`. Só projeto congelado. Exige o perfil/versão **que o usuário estava vendo**; se mudou no meio tempo, recusa com "o processo do projeto mudou (agora X vN); recarregue". Mesmo perfil/versão → `SEM_MUDANCA`.
- As duas exigem justificativa, perfil/versão existentes e ativos, projeto existente e não excluído (`deleted_at`, se a coluna existir), e `cena_pode('PROJ_ALTERAR_PERFIL_PROCESSO', contrato do projeto)`.
- Todo INSERT/UPDATE em `sot_projeto_processo` gera evento por gatilho, mesmo que uma função futura grave por outro caminho.
- **Etapa 1.3 (não ligada agora):** a confirmação da LMS ORIGINAL em `ESTRUTURA_NOVA` chamará a função interna `sot_projeto_processo_gravar` com origem `LMS_ORIGINAL_ESTRUTURA_NOVA`. A origem já existe no CHECK; nada a chama hoje.

## Autorização

- Usuário: `auth.uid()` → `usuarios_sistema.auth_user_id` pelos helpers existentes. Sem e-mail, sem parâmetro do frontend.
- Projeto: `cena_pode('PROJ_ALTERAR_PERFIL_PROCESSO', contrato)`. Projeto sem contrato → regra global. `contrato_id` texto que não é UUID de `contratos` → **recusa** (nunca cai para a regra global).
- Sugestão: `cena_pode(..., contrato_id)`; contrato não ativo → `FALSE` (regra da 1.1).
- Catálogo: só regra **global** de `PROJ_ALTERAR_PERFIL_PROCESSO` (`cena_pode(..., NULL)`). Regra só de contrato não administra o catálogo, porque o catálogo vale para todos os contratos.
- Matriz atual da 1.1: `PROJ_ALTERAR_PERFIL_PROCESSO` global para `admin` e `gestor`.

## Segurança

- RLS `ENABLE` + `FORCE` nas 5 tabelas, desde a criação. Mesma precondição da 1.1: aplicar como dono com BYPASSRLS (Supabase: `postgres`).
- `REVOKE ALL` de `PUBLIC`, `anon`, `authenticated`, `service_role` (tabelas e sequências). `GRANT SELECT` só para `authenticated` e `service_role`. Nenhuma policy de escrita.
- Policies (só SELECT, `TO authenticated`): catálogo, sugestão e processo → `cena_usuario_erp_ativo()`; os dois históricos → `cena_usuarios_pode_administrar()`.
- Escrita direta recusada por gatilho para `anon`/`authenticated` mesmo que um GRANT apareça depois. Gravação em `sot_projeto_processo` exige `auth.uid()`: SQL Editor sem sessão não consegue fazer backfill por engano. Autoria (`*_por_auth`) tem de ser o usuário da sessão.
- `SECURITY DEFINER` só onde lê tabela com RLS FORCE ou grava; todas com `SET search_path = public, pg_temp`. Gatilhos de proteção são `SECURITY INVOKER`.
- Históricos: UPDATE, DELETE e TRUNCATE recusados.
- Migration em `BEGIN; … COMMIT;` explícito: qualquer falha desfaz a Etapa 1.2 inteira. Recria só as próprias 5 policies. Reaplicável.

## Concorrência e idempotência

- `UNIQUE (projeto_id)`: o banco garante no máximo um processo atual por projeto, mesmo com duas conexões.
- `pg_advisory_xact_lock` por projeto + `SELECT … FOR UPDATE` serializam congelar/alterar do mesmo projeto. O mesmo vale por contrato (sugestão) e por código de perfil (nova versão).
- Repetições idempotentes: congelar igual → `SEM_MUDANCA`; definir a mesma sugestão → mesmo `id`; criar a mesma versão com o mesmo conteúdo → mesmo `id`; administrar sem mudança → `false`.
- **VALIDAÇÃO REMOTA AINDA NECESSÁRIA:** o PGlite tem uma conexão só. Os testes provam a `UNIQUE`, o lock e as repetições em sequência; duas transações simultâneas reais só no Postgres do Supabase.

## Sem FK para `sot_projetos`

- Há fluxo legado que apaga projeto fisicamente; uma FK bloquearia essa exclusão (RESTRICT) ou apagaria o histórico (CASCADE). As duas mudariam o comportamento atual.
- `sot_projetos` não é alterada (nem coluna, nem gatilho, nem constraint). A existência do projeto é validada dentro das funções.
- `sot_projetos.contrato_id` é texto legado e `contratos.id` é uuid: a conversão é feita por `sot_projeto_processo_contrato_uuid`, que valida o formato e a existência em `contratos` antes de converter. Nunca levanta erro; texto inválido → `NULL` → recusa na autorização.

## Independência de LMS/WL

- Nada na migration reage a LMS, conciliação ou estrutura WL. Não há gatilho em `sot_projetos` nem em tabela futura.
- Teste L: uma coluna de estrutura WL simulada é marcada como `ESTRUTURADO` em projetos legados e congelados; o perfil efetivo, as linhas e o histórico ficam idênticos.
- Teste K: trocar ou revogar a sugestão do contrato não muda projetos já congelados, e projeto novo do contrato continua sem congelamento.

## Jornada / PLPT (decisão pendente)

O resolver do frontend (`modules/projetos/jornada/jornada-resolver.js`) escolhe hoje EQUATORIAL_PLPT (cliente EQUATORIAL + PLPT no código/nome) e BASE_PROJETOS para o resto, dinamicamente. Esta etapa não muda isso. Quando a Jornada passar a ler o perfil do banco: `congelado = false` deve manter o resolver atual (inclusive PLPT), e só `congelado = true` passa a usar o perfil congelado.

## Auditoria de contratos (sem seed)

Fonte: `PROGRAMACAO-PROJETOS-JORNADA-AUDITORIA.md` (bloco E, 06/10/2026) e `ETAPA-1.0-PREPARACAO.md` (seção C). Nenhuma associação contrato → perfil foi semeada: não há perfil ENEL no catálogo e nenhuma associação tem decisão registrada do gestor.

| Contrato | Código | Cliente | Projetos ativos | Classificação |
|---|---|---|---|---|
| RDSE | 4600003971 | ENEL | 8 (10 no doc 1.0) | **CANDIDATO** (onde aparecem LMS da concessionária) |
| RDSE NOVO | 4600004484 | ENEL | 0 | **CANDIDATO** (sucessor do RDSE) |
| RDSC | 4600003872 | ENEL | 1 | INDETERMINADO (auditoria marca quase tudo "A VALIDAR") |
| RDSC NOVO | 4600004482 | ENEL | 0 | INDETERMINADO |
| SOT OBRAS | 4600004206 | ENEL | 3 | INDETERMINADO |
| ETD | 4600003478 | ENEL | 0 | INDETERMINADO (fluxo por código) |
| BT0 | 4600003913 | ENEL | 0 | INDETERMINADO (lista de obras) |
| OUTFIT | 4600003817 | ENEL | 0 | INDETERMINADO (lista de obras) |
| AUTOMAÇÃO CT | 4600004043 | ENEL | 0 | INDETERMINADO (lista de obras) |
| PLPT TERESINA | PLPT | EQUATORIAL | 1.357 | INDETERMINADO (Jornada própria no frontend; fora da ENEL/WL) |
| COMGAS CAMPINAS | CW35964 | COMGAS | 0 | INDETERMINADO |
| CTEEP ROÇADA | 46300010125 | ISA CTEEP | 0 | INDETERMINADO |
| OBRAS PARTICULARES | 1 | VARIADOS | 0 | INDETERMINADO |
| TMA OESTE | 4600004208 | ENEL | 1 | **EXCLUÍDO** (regra absoluta TMA) |

- **CONFIRMADO: nenhum.**
- `DMP/A.OES.nn.nnnnn` é o formato do código de projeto no Modelo LMS (célula D1), não um contrato. INDETERMINADO até o gestor indicar a qual contrato esses projetos pertencem.

Consulta somente leitura (não executada) para a decisão do gestor. Compara `contrato_id` como texto (sem CAST do legado) e procura o padrão DMP/A.OES em qualquer coluna, sem supor nome de coluna:

```sql
SELECT c.id, c.codigo, c.nome, c.cliente, c.status,
       count(sp.id) FILTER (WHERE to_jsonb(sp)->>'deleted_at' IS NULL)                                   AS projetos_ativos,
       count(sp.id) FILTER (WHERE to_jsonb(sp)::text ILIKE '%DMP/%' OR to_jsonb(sp)::text ILIKE '%A.OES%') AS projetos_padrao_lms
FROM public.contratos c
LEFT JOIN public.sot_projetos sp ON btrim(sp.contrato_id::text) = c.id::text
GROUP BY c.id, c.codigo, c.nome, c.cliente, c.status
ORDER BY projetos_ativos DESC, c.codigo;

-- Projetos com contrato_id que não corresponde a nenhum contratos.id (seriam recusados pela autorização)
SELECT count(*) AS projetos_contrato_nao_identificado
FROM public.sot_projetos sp
WHERE nullif(btrim(sp.contrato_id::text), '') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.contratos c WHERE c.id::text = btrim(sp.contrato_id::text));
```

Depois da decisão, o cadastro é feito pela RPC (sessão de admin/gestor no app, nunca SQL solto): criar o perfil ENEL com `cena_processo_perfil_criar_versao` e sugerir com `cena_contrato_processo_perfil_definir`.

## Testes (`tests/proj-perfil-processo-sql.test.mjs`, 271 verificações)

| Cenário | Verifica |
|---|---|
| A | anon: sem SELECT, sem EXECUTE, sem escrita |
| B | authenticated sem usuário ERP: nada lê, nada grava |
| C | projeto legado = BASE_PROJETOS derivado, sem linha nem evento |
| D | sugestão do contrato aparece em `sugerido_*` e não congela |
| E | congelamento explícito grava linha + evento CONGELAR com anterior BASE_PROJETOS |
| F | congelamento repetido = SEM_MUDANCA; outro perfil recusado |
| G | alteração com justificativa, evento ALTERAR com anterior/novo |
| H | sem permissão (perfis sem regra, gestor negado no contrato) e entradas inválidas (justificativa vazia/nula, perfil/versão/projeto inexistente ou nulo); nada gravado |
| I | versão usada: requisitos, código e versão imutáveis; sem DELETE; inativa não congela |
| J | nova versão: sequência, idempotência, conflito de conteúdo, BASE_PROJETOS bloqueado |
| K | trocar/revogar sugestão não mexe em congelados |
| L | estrutura WL simulada não muda perfil nem histórico |
| M | UNIQUE por projeto, aba desatualizada recusada, lock |

Também: escrita direta e funções internas bloqueadas, escopo por contrato (gestor negado no contrato, coordenador concedido no contrato congela mas não administra catálogo), contrato texto inválido recusado, histórico imutável, visibilidade por RLS, tabelas legadas/1.1/TMA idênticas antes e depois, reaplicação, rollback com falha injetada em 5 pontos, precondições.

Mutações conferidas (migration alterada só em memória): remover `cena_pode`, a `UNIQUE`, a imutabilidade de requisitos, a recusa de recongelar, a concorrência otimista, a separação efetivo/sugerido, a exigência de regra global no catálogo, a validação do contrato texto e a imutabilidade do histórico → todas derrubam o teste. Justificativa obrigatória tem três camadas (RPC, função interna, CHECK); remover uma não basta.

## Decisões pendentes

1. Quais contratos sugerem o perfil ENEL (CANDIDATO: RDSE, RDSE NOVO) e quais requisitos a v1 desse perfil terá.
2. A quem pertencem os projetos `DMP/A.OES`.
3. Leitura dos históricos: hoje só `admin`/`gestor` (`cena_usuarios_pode_administrar`). Ampliar exige decisão.
4. Na Etapa 1.3: congelamento automático na confirmação da LMS ORIGINAL em `ESTRUTURA_NOVA` (já previsto pela origem `LMS_ORIGINAL_ESTRUTURA_NOVA`).
5. Jornada lendo o perfil do banco (ver seção Jornada/PLPT).

## Aplicação (quando aprovada)

SQL Editor do Supabase (role `postgres`), arquivo inteiro. Validação e "para desfazer" estão no fim da migration. Esperado logo após aplicar: catálogo com `BASE_PROJETOS v1`; `cena_contrato_processo_perfil` e `sot_projeto_processo` vazias; RLS e FORCE em 5 tabelas; 5 policies SELECT.
