# Etapa 1.4 — WL oficial, unicidade e proteção estrutural · Diagnóstico técnico

**Status:** diagnóstico apenas. **Decisões D1–D13 aprovadas pelo dono em 11/10/2026** (ver §6). **Nada implementado.** Sem migration, sem `sot_wl`, sem alteração em `sot_materiais`/`sot_atividades`, sem Edge, sem `index.html`, sem SQL de escrita.
**Branch:** `enel-etapa14-wl` (de `main` `5550fd0`, 8.1.215). **Data:** 11/10/2026.
**Fontes:** consultas **somente leitura** no banco de produção (`qxexyghcennllrmjqafg`), leitura do código (`index.html`, migrations 1.1–1.3, parser LMS) e `docs/enel-wl/FASE1-PLANO-TECNICO.md` §1.4.

---

## 0. Ponto de partida

| Item | Estado em produção |
|---|---|
| Etapa 1.3 (LMS ORIGINAL, confirmação, telas) | publicada (8.1.214 / 8.1.215) |
| `sot_wl` | **não existe** |
| Colunas `wl_id`, `lms_linha_id`, `ctg`, `ft`, `kit` em `sot_atividades`/`sot_materiais` | **não existem** |
| Importações LMS | 2, ambas `CONFIRMADA`, 0 RASCUNHO |
| Caso real "confirmada sem estrutura" | **TESTE 1 — das123** (projeto `a501fa80…`, contrato TMA OESTE, cliente ISA CTEEP): importação `e7f463ea…` `ESTRUTURA_NOVA`, confirmada em 11/10 17:22 por admin, perfil `BASE_PROJETOS v1` congelado (origem `LMS_ORIGINAL_ESTRUTURA_NOVA`), estado derivado `ESTRUTURADO`, **0 WL**, 1 material legado (código `123`, qtd 5, de 22/05), 0 atividades. Não aparece em `composicao_dia` nem em `prog_projetos_agenda`. |
| Outro caso | TESTE 1 — DFdfSDF: `CONCILIACAO` (estado `EM_CONCILIACAO`) — fora do escopo da 1.4 (é 1.6) |

---

## 1. Estrutura real das tabelas-alvo (lida do banco)

### `sot_atividades` — 14.164 linhas, 1.361 projetos, 4,4 MB
- Colunas: `id uuid` (default `gen_random_uuid()`), `projeto_id uuid` (nulo permitido), `codigo text`, `descricao text NOT NULL`, `unidade`, `qtd_prevista numeric(14,3)`, `valor_unitario numeric(14,4)`, `valor_total numeric(14,2)` (**coluna gerada** `GENERATED ALWAYS AS (qtd_prevista * valor_unitario) STORED` — não pode ser gravada), `qtd_executada`, `qtd_medida`, `qtd_faturada` (14,3), `qtd_viabilizada numeric`, `ordem_exec`, `etapa`, `status` (default `'pendente'`), `observacoes`, `obs_viabilidade`, `obs_execucao`, `servico_id text`, `criado_em`, `deleted_at`, `somente_descritivo bool NOT NULL`.
- Constraints: PK; **`sot_atividades_projeto_codigo_unique UNIQUE (projeto_id, codigo)`** (constraint, não parcial, inclui excluídas); FK `projeto_id → sot_projetos(id) ON DELETE CASCADE`; CHECK `sot_atividades_descritivo_sem_operacao`.
- Índices: PK, `idx_sot_atividades_projeto`, o único acima. **Sem gatilhos.**
- Dados: 0 excluídas logicamente (exclusão de atividade é **sempre física** no front, §3), 3 descritivas, 0 sem código, 0 códigos com espaço/zero à esquerda, **0 grupos que só diferem por normalização**, 0 duplicados.

### `sot_materiais` — 1.641 linhas (1.362 excluídas logicamente), 10 projetos, 0,96 MB
- Colunas: `id`, `projeto_id`, `codigo_sap text`, `descricao text NOT NULL`, `unidade`, `qtd_projetada numeric(14,3)`, `qtd_viabilizada`, `qtd_requisitada`, `qtd_entregue`, `qtd_aplicada`, `qtd_devolvida`, `qtd_processada_sap` (14,3), `observacao`, `criado_em`, `deleted_at`, `somente_descritivo bool NOT NULL`. **Sem coluna de "atualizado em".**
- Constraints: PK; FK `projeto_id → sot_projetos(id) ON DELETE CASCADE`; CHECK `sot_materiais_descritivo_sem_operacao`. **Nenhuma unicidade de código.**
- Gatilho: `trg_sot_materiais_bloqueia_binario` (BEFORE INSERT/UPDATE OF `codigo_sap, descricao, unidade, observacao`).
- Dados: **22 grupos ativos com o mesmo código no mesmo projeto** (44 linhas, 1 projeto — a regra legada permite); 5 grupos com códigos-lixo binários (sobras da importação binária já corrigida, 1 projeto).
- Referenciada por `sot_materiais_historico.material_id` (FK `ON DELETE SET NULL`).

### Comum às duas
- RLS **habilitado, sem FORCE**, política única `"Acesso total"` (`USING true / WITH CHECK true`) para **`anon` e `authenticated`**; GRANT `SELECT, INSERT, UPDATE, DELETE` para `anon`, `authenticated` e `service_role`.
- Nenhuma view, função de banco, publicação realtime ou RPC escreve nelas (busca em `pg_proc`/`pg_publication_tables`/`view_table_usage`).
- `fn_proj_codigo_norm` e `fn_proj_texto_norm` (1.3) já existem e são `IMMUTABLE` → podem ir em índice.

---

## 2. Dados reais do LMS (importação `e7f463ea…`, Modelo LMS.xlsx real)

| Medida | Valor |
|---|---|
| Linhas | 200 (12 WLs, 0 sem WL, 0 sem código, 0 sem descrição, 0 sem UMD, 0 Plan zero) |
| Serviços (`^[IR]-`, KIT `S-…`) | 16 linhas, 12 códigos distintos, todos com `valor_ups_item` |
| Materiais (numéricos, SAP 6 dígitos) | 184 linhas: **92 FT=I (instalação) + 92 FT=R (retirada)**, 86 códigos distintos |
| Indefinidos | 0 |
| Duplicidade `WL + código + FT` | **36** (recusaria a LMS real) |
| Duplicidade `WL + código + FT + KIT` | **0** → confirma o ajuste do KIT proposto no plano |
| Mesmo código de serviço em WLs diferentes | 4 → **a constraint atual `UNIQUE (projeto_id, codigo)` bloquearia** a criação das atividades por WL |
| Quantidades | 0,004 a 552; nenhuma com mais de 3 casas (cabe em `numeric(14,3)`) |
| Casamento com catálogos | 0/12 serviços em `servicos_contrato` (1.184 ativos); 0/86 materiais em `catalogo_materiais` (só 4 itens) |
| Códigos do LMS já usados no legado | 48 linhas de `sot_materiais` (outros projetos) com códigos SAP presentes neste LMS |

Atenção: **a regra "numérico = material" vale para o LMS ENEL, não para o ERP em geral** — `servicos_contrato` e a maioria das `sot_atividades` têm códigos de serviço numéricos de 10 dígitos (`5022000235`). A classificação na aplicação deve usar o padrão do LMS (§4.5), nunca o catálogo.

---

## 3. Pontos do front que gravam em `sot_atividades` / `sot_materiais`

36 pontos, **todos em `index.html`** (nenhum em módulos, shells, `functions/` ou Edge). Nenhum usa `sbUpsert`, `on_conflict`, `merge-duplicates` ou nome de constraint → **trocar a constraint única por índice parcial não quebra gravação por upsert**.

| Grupo | Onde (função) | Operação | Campos |
|---|---|---|---|
| PLPT diário/viabilidade/baixa/adicional | `plptMarcarViabilidadeProjeto`, `plptConfirmarAplicacaoDevolucao`, `plptSalvarBaixa`, `plptAprovarAdicional`, `plptConfirmarViabilidade/Atividade/Material` | UPDATE (+ INSERT de material adicional) | operacionais (viabilizada, aplicada, executada, observações); adicional insere material novo |
| Almoxarifado / controle de material | `_coSalvarPlptRequisicao`, `_coSalvarStatusMaterial`, `sotLancarBaixaMaterial`, `_abrirBaixaModal` | UPDATE | operacionais (entregue, aplicada, devolvida) |
| Lançamentos do projeto | `sotLancarViabilidade/Aplicacao/Execucao…` | UPDATE | operacionais + `status` |
| Validação do campo | `sotValidarLancamento` | INSERT atividade automática + UPDATE | estruturais no INSERT; operacionais no UPDATE. **Casa a atividade só pelo código** |
| Criação manual | `sotAbrirNovaAtividade`, `sotAbrirNovoMaterial` | INSERT | estruturais |
| Importações | `_sotLancarPendentes`/`_sotGravarListaProjeto` (IA, lista LMS antiga, "Importar Materiais"), `sotConfirmarImportacao` (lista colada) | INSERT; **UPDATE somando `qtd_projetada`/`qtd_prevista`** de linha existente | estruturais |
| Edição | `sotEditarAtividade`, `sotEditarMaterial` | UPDATE **regravando todos os campos editáveis** (código, descrição, unidade, quantidade + operacionais) | estruturais |
| Exclusão | lixeira da aba Atividades, `sotExcluirDescritivo`, `sotEditarAtividade`, `sotEditarMaterial` | **atividade: DELETE físico sempre**; material: soft-delete (`deleted_at`) com **fallback para DELETE físico** se o PATCH falhar | — |
| Legado "Novo Projeto de Obra" | `npProcessarLista` | INSERT (provavelmente morto: lê a lista depois de fechar o modal) | — |

Detalhes que importam para a 1.4:
- `sbDelete` (`index.html:8283`): soft-delete só para tabelas em `_SOFT_DELETE_TABLES` (inclui `sot_materiais`, **não** `sot_atividades`); se o PATCH falhar por qualquer motivo, faz **DELETE físico**.
- `sbUpdate` envia só o payload, mas as telas de edição mandam todos os campos estruturais mesmo sem mudança → a proteção precisa comparar `OLD × NEW` (`IS DISTINCT FROM`), não "coluna presente".
- Muitos `sbUpdate` são "dispara e esquece" (erro só no console) e a tela remove a linha antes da resposta → recusas do banco ficam invisíveis até recarregar.
- Nenhum INSERT do front preenche `wl_id`/`lms_linha_id` (colunas ainda não existem).

Bug encontrado (fora do escopo, registrado como tarefa separada): em `sotValidarLancamento`, quando a atividade é criada automaticamente, o `sbUpdate` da quantidade roda com o id local `'sa…'` antes do INSERT voltar e é ignorado — a quantidade aprovada não chega ao banco.

---

## 4. Proposta técnica (desenho — nada criado)

### 4.1 `sot_wl` (nova)
```
sot_wl (
  id               uuid PK default gen_random_uuid(),
  projeto_id       uuid NOT NULL,                 -- sem FK física (padrão LMS/1.2); validado pela função
  codigo           text NOT NULL,                 -- WL como veio (ex.: '1', '12')
  codigo_norm      text GENERATED ALWAYS AS (fn_proj_texto_norm(codigo)) STORED,
  origem           text NOT NULL CHECK (origem IN ('LMS','MANUAL')),
  importacao_id    uuid REFERENCES sot_lms_importacoes(id),   -- obrigatório se origem = LMS
  ordem            integer NOT NULL,
  criado_em        timestamptz NOT NULL default now(),
  criado_por_auth  uuid NOT NULL,
  cancelada_em     timestamptz, cancelada_por_auth uuid, motivo_cancelamento text
)
UNIQUE (projeto_id, codigo_norm) WHERE cancelada_em IS NULL
CHECK (origem <> 'LMS' OR importacao_id IS NOT NULL)
```
- RLS **ENABLE + FORCE**; política só de `SELECT` para `authenticated` (WL não é dado sensível e as telas precisam ler); **nenhum** INSERT/UPDATE/DELETE para `anon`/`authenticated`; gravação só por função `SECURITY DEFINER`.
- Gatilho de imutabilidade: sem DELETE físico; UPDATE só nos campos de cancelamento, via função.
- `MANUAL` fica previsto no CHECK, mas a função de cadastro manual é etapa posterior (fora da 1.4).

### 4.2 Colunas novas em `sot_atividades` e `sot_materiais`
Todas nulas, sem default (`ADD COLUMN IF NOT EXISTS`, sem reescrever a tabela):
- `wl_id uuid REFERENCES sot_wl(id) ON DELETE RESTRICT`
- `lms_linha_id uuid REFERENCES sot_lms_linhas(id) ON DELETE RESTRICT`
- `ctg text`, `ft text`, `kit text`

CHECKs:
- `wl_id IS NULL OR fn_proj_codigo_norm(<codigo>) IS NOT NULL` (`codigo` / `codigo_sap`);
- `(wl_id IS NULL) = (lms_linha_id IS NULL)` nesta etapa (só existe origem LMS);
- índice único `(lms_linha_id) WHERE lms_linha_id IS NOT NULL AND deleted_at IS NULL` (uma linha do LMS vira no máximo uma linha ativa).

### 4.3 Unicidade
- **Atividades sem WL — mesma regra de hoje, como índice parcial:** `DROP CONSTRAINT sot_atividades_projeto_codigo_unique` + `CREATE UNIQUE INDEX sot_atividades_projeto_codigo_legado_uidx ON sot_atividades (projeto_id, codigo) WHERE wl_id IS NULL`. Mesmas colunas, código cru, inclui excluídas (como hoje). Seguro: 0 duplicados hoje e nenhum upsert/`on_conflict` no front (§3). Feito na mesma transação, depois de reler a definição no banco (pré-condição que aborta se a definição tiver mudado).
- **Atividades com WL:** `UNIQUE (projeto_id, wl_id, fn_proj_codigo_norm(codigo), coalesce(fn_proj_texto_norm(ft),''), coalesce(fn_proj_texto_norm(kit),'')) WHERE wl_id IS NOT NULL AND deleted_at IS NULL`.
- **Materiais com WL:** idem com `codigo_sap`. Materiais sem WL continuam sem unicidade (os 22 grupos duplicados legados seguem intocados).
- Validado contra o LMS real: 0 colisões com KIT; sem KIT, 36.

### 4.4 Proteção estrutural (gatilho)
`fn_proj_protege_linha_estruturada()` — `BEFORE INSERT OR UPDATE OR DELETE` nas duas tabelas, `SECURITY INVOKER`, age **só** quando `current_user IN ('anon','authenticated')` (dentro de função `SECURITY DEFINER` o `current_user` é o dono e passa).
- Linha estruturada = `wl_id IS NOT NULL OR lms_linha_id IS NOT NULL` (no OLD).
- **INSERT:** recusa se `wl_id`, `lms_linha_id`, `ctg`, `ft` ou `kit` vier preenchido.
- **UPDATE de linha legada:** recusa se tentar preencher qualquer um desses cinco campos.
- **UPDATE de linha estruturada:** recusa se mudar campo estrutural (`IS DISTINCT FROM`) ou `deleted_at`. Estruturais: atividades = `projeto_id, codigo, descricao, unidade, qtd_prevista, somente_descritivo, wl_id, lms_linha_id, ctg, ft, kit, deleted_at`; materiais = `projeto_id, codigo_sap, descricao, unidade, qtd_projetada, somente_descritivo, wl_id, lms_linha_id, ctg, ft, kit, deleted_at`. Operacionais continuam livres (lista do plano §1.4).
- **DELETE de linha estruturada:** recusado. Cobre também o fallback físico do `sbDelete` e a cascata de exclusão física de projeto (ver risco R4).
- Linhas legadas: **nenhuma** proteção nova (comportamento idêntico ao de hoje).

### 4.5 Aplicação da estrutura — `sot_lms_aplicar_estrutura_nova(p_importacao_id uuid)` (pública, `authenticated`)
`SECURITY DEFINER`, `search_path` fixo, uma transação, advisory lock por projeto + `FOR UPDATE` na importação, idempotente.
1. Autoriza (ver D9) e exige: importação `ORIGINAL`, `CONFIRMADA`, `modo = ESTRUTURA_NOVA`, ainda não aplicada; projeto existente e não excluído.
2. Exige projeto sem linhas legadas ativas (ver D7) — senão recusa `PROJETO_COM_LEGADO` listando quantas.
3. Cria uma `sot_wl` por WL distinta (`origem = LMS`, `ordem` pela ordem numérica do WL).
4. Para cada linha do LMS (ordem do arquivo), classifica pelo padrão do LMS ENEL:
   - `^[IR]-` → **atividade**: `codigo = codigo_raw`, `descricao`, `unidade = umd_raw`, `qtd_prevista = qtd_plan`, `valor_unitario` (D6), `servico_id` (catálogo do contrato, se casar; senão nulo), `ordem_exec`, `wl_id`, `lms_linha_id`, `ctg`, `ft`, `kit`;
   - `^[0-9]+$` → **material**: `codigo_sap = codigo_raw`, `descricao`, `unidade`, `qtd_projetada = qtd_plan`, `somente_descritivo` (D4 para FT=R), `wl_id`, `lms_linha_id`, `ctg`, `ft`, `kit`;
   - outro padrão → recusa a aplicação inteira (`LINHA_NAO_CLASSIFICADA`, com as linhas).
5. Marca a importação como aplicada (`estrutura_aplicada_em`, `estrutura_aplicada_por_auth` — D8) e grava evento `ESTRUTURA_APLICADA` (contagens de WL/atividades/materiais).
6. Devolve resumo. Não toca programação, estoque, `composicao_dia`, TMA, medição.

### 4.6 Estado "confirmada e ainda não aplicada" (caso TESTE 1 — das123)
Hoje `sot_lms_estado_wl_calc` devolve `ESTRUTURADO` para qualquer ORIGINAL `ESTRUTURA_NOVA` confirmada, mesmo sem WL. Proposta (D8):
- colunas `estrutura_aplicada_em`, `estrutura_aplicada_por_auth` em `sot_lms_importacoes` (aditivas; entram na whitelist da trava `sot_lms_importacoes_proteger`, só via função marcada);
- novo estado derivado **`ESTRUTURA_PENDENTE`** = ORIGINAL `ESTRUTURA_NOVA` confirmada e `estrutura_aplicada_em IS NULL`; `ESTRUTURADO` passa a exigir aplicação;
- evento `ESTRUTURA_APLICADA` no CHECK de `sot_lms_importacao_eventos`;
- front: só um rótulo novo no mapa de estados (fica para a 1.5).

### 4.7 Permissões
- Aplicar: ver D9. Nenhuma tabela nova com grant de escrita para `anon`/`authenticated`.
- `sot_wl`: `SELECT` para `authenticated`; nada para `anon`.

### 4.8 Testes (PGlite, padrão 1.3)
- Positivos: aplicar o fixture real (12 WLs, 16 atividades, 184 materiais), idempotência, estado `ESTRUTURA_PENDENTE → ESTRUTURADO`, linhas legadas de outros projetos intactas.
- Negativos: sem permissão, não confirmada, `CONCILIACAO`, já aplicada, projeto com legado, linha não classificada, segundo projeto.
- Proteção (papéis `anon`/`authenticated`): editar estrutural recusado; operacional aceito; edição que regrava o mesmo valor aceita; soft-delete e DELETE físico recusados; INSERT com `wl_id` recusado; legado sem mudança nenhuma.
- Regressão dos fluxos do §3 sobre linhas legadas (PLPT, almoxarifado, `_sotLancarPendentes`, `sotConfirmarImportacao`, edição, `sbDelete` soft+físico).
- Unicidade: legado igual ao de hoje (inclusive duplicado recusado), WL com/sem KIT.
- Mutação (sabotagens detectáveis), como na 1.3.

### 4.9 Rollback
Bloco transacional que aborta se houver `sot_wl` ou linha estruturada; remove gatilho, função, índices novos, colunas e `sot_wl`, e **recria a constraint original** `UNIQUE (projeto_id, codigo)` com o mesmo nome.

---

## 5. Riscos

| # | Risco | Mitigação |
|---|---|---|
| R1 | Trocar `UNIQUE (projeto_id, codigo)` por índice parcial | mesma regra para `wl_id IS NULL`; 0 duplicados; nenhum upsert no front; pré-condição relê a definição; rollback recria com o mesmo nome |
| R2 | `anon` tem escrita total nessas tabelas hoje (política `Acesso total`) | o gatilho cobre `anon` igual a `authenticated`; fechar o `anon` é a Frente S (fora da 1.4) |
| R3 | Telas de edição regravam todos os campos | comparação `IS DISTINCT FROM`; regravar o mesmo valor passa |
| R4 | Exclusão física de projeto (`ON DELETE CASCADE`) com linhas estruturadas será **recusada** pelo gatilho na cascata | comportamento desejado (protege a estrutura), mas muda o que a tela de excluir projeto faz para projetos ESTRUTURADOS — documentar e tratar na 1.5 |
| R5 | Recusas do banco são silenciosas em várias telas (dispara e esquece; remoção local antes da resposta) | só afeta linhas estruturadas (nenhuma hoje); a 1.5 bloqueia esses botões em linha com WL e mostra o selo |
| R6 | `sotValidarLancamento` e outras buscas casam atividade **só por código**; em projeto ESTRUTURADO o mesmo serviço pode existir em várias WLs | só soma operacional, mas pode cair na WL errada → tratar na 1.5/1.7 (lançamento com WL); até lá, sinalizar ambiguidade |
| R7 | `sotConfirmarImportacao` soma em `qtd_prevista`/`qtd_projetada` de linha existente | em linha estruturada vira recusa (já degrada com aviso); importador antigo deve ser bloqueado em projeto ESTRUTURADO (plano §1.5) |
| R8 | Estado `ESTRUTURADO` hoje não garante WL | D8 (`ESTRUTURA_PENDENTE`) |
| R9 | Valor unitário das atividades: LMS e catálogo não casam neste arquivo | D6 |
| R10 | Materiais de retirada (FT=R) metade do LMS: se entrarem como operacionais, aparecem em requisição/almoxarifado | D4 |

---

## 6. Decisões para aprovação

| # | Decisão | Recomendação |
|---|---|---|
| D1 | Incluir KIT na chave de unicidade com WL | **Sim** (0 colisões com KIT, 36 sem) |
| D2 | Substituir a constraint única de atividades por índice parcial `WHERE wl_id IS NULL` (mesma regra) | **Sim** |
| D3 | Classificação na aplicação: `^[IR]-` = atividade, numérico = material, outro = recusa | **Sim** |
| D4 | Materiais FT=R (retirada): (a) criar como `somente_descritivo` (ficam na WL, fora de requisição/almox); (b) criar operacionais; (c) não criar | **(a)** |
| D5 | Serviços FT=R (`R-…`): atividade normal | **Sim** (retirada é serviço executado) |
| D6 | `valor_unitario` da atividade: (a) `valor_ups_item` do LMS; (b) catálogo do contrato; (c) 0 | **(a)**, com `servico_id` do catálogo quando casar |
| D7 | Projeto com linhas legadas ativas: (a) recusar aplicar (usar CONCILIACAO); (b) aplicar e conviver | **(a)** — no TESTE 1 — das123, excluir antes o material legado de teste (`123`) |
| D8 | Estado `ESTRUTURA_PENDENTE` + colunas `estrutura_aplicada_*` + evento `ESTRUTURA_APLICADA` | **Sim** |
| D9 | Permissão para aplicar: (a) `PROJ_CONFIRMAR_LMS`; (b) `PROJ_EDITAR_WL` | **(a)** — mesmo grupo que confirma (admin, gestor, coordenador, escritório) |
| D10 | Gatilho de proteção como em §4.4 (inclui DELETE e cascata de projeto) | **Sim** |
| D11 | `sot_wl.projeto_id` sem FK física | **Sim** (padrão LMS; a exclusão de projeto estruturado já fica bloqueada por R4) |
| D12 | `sot_wl` legível por `authenticated` (SELECT), escrita só por função | **Sim** |
| D13 | Aplicação separada da confirmação (botão próprio na 1.5), não automática | **Sim** — mantém a decisão humana em dois passos |

**Todas aprovadas como recomendado (11/10/2026).** Observações obrigatórias do dono para a implementação:
1. **D7:** no TESTE 1 — das123, o material legado de teste "123" é tratado/removido por **ação explícita**, nunca automaticamente pela migration ou pela função.
2. **D4:** materiais FT=R ficam claramente marcados como descritivos e **não podem** entrar em requisição, reserva, entrega, almoxarifado ou baixa de estoque.
3. **D10:** o gatilho **não pode** bloquear campos operacionais permitidos (executado, medido, requisitado e demais controles operacionais existentes).

---

## 7. Próximo passo (após aprovação das decisões)
1. Migration aditiva da 1.4 + testes PGlite (positivos, negativos, proteção, regressão, mutação) + rollback. Eu preparo e confiro; **o dono aplica**.
2. Aplicar a estrutura no TESTE 1 — das123 como homologação (depois de remover o material legado de teste, se D7 = a).
3. Etapa 1.5: telas (botão "Aplicar estrutura", selos "Sem WL / Projeto legado", bloqueio de edição em linha com WL, importador antigo bloqueado em projeto ESTRUTURADO).
