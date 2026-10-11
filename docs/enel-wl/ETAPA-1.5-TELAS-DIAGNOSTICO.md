# Etapa 1.5 — Telas da estrutura nova (WL oficial) · Diagnóstico técnico

**Status:** diagnóstico apenas. **Nada implementado.** Sem alteração em `index.html`, migrations, Edge, `sw.js` ou SQL de escrita.
**Branch:** `enel-etapa15-telas` (de `main` `0c9607e`, 8.1.216 + 1.4). **Data:** 11/10/2026.
**Fontes:** leitura do `index.html` (números de linha atuais desta branch), `modules/projetos/*`, `prog-projetos-shell.js`; consultas **somente leitura** em produção.

---

## 0. Ponto de partida

| Item | Estado |
|---|---|
| Banco | 1.4 aplicada e homologada (V1–V9). `sot_wl` + colunas `wl_id/lms_linha_id/ctg/ft/kit` + gatilho de proteção + `fn_proj_lms_aplicar_estrutura_nova` |
| Projeto estruturado real | **TESTE 1 — das123** (contrato TMA OESTE): `ESTRUTURADO`, 12 WLs, 16 atividades, 92 materiais de instalação, 92 de retirada (descritivos) |
| Front em produção | 8.1.216: aba "📥 LMS" (envio só em `LEGADO_SEM_WL`) e "LMS — Confirmação"; reconhece `ESTRUTURA_PENDENTE`. **Nenhuma tela lê `wl_id`, `ft`, `kit`, `ctg` ou `sot_wl`** |
| Comportamento hoje no TESTE 1 — das123 | linhas aparecem nas abas Atividades/Materiais como legadas; lançar operacional funciona; **editar/excluir falha em silêncio** (banco recusa, tela não mostra) |

## 1. Acesso a dados que as telas precisam

| Dado | Quem lê | Consequência |
|---|---|---|
| `sot_lms_estado_wl(projeto)` | só `authenticated` com `PROJ_IMPORTAR_LMS` (admin, gestor, coordenador, escritório, administrativo) | supervisor/equipe e `anon` não conseguem o estado → selo precisa de fallback |
| `sot_wl` (código/ordem da WL) | `authenticated` (todos); **não** `anon` | `anon` (login MD5/sessão não restaurada) vê "WL" sem código |
| `sot_atividades/sot_materiais` (inclui as colunas novas) | todos (política "Acesso total"); `sotAbrirProjeto` já faz `select *` | `wl_id/ft/kit/ctg` já chegam à tela sem mudar a busca |
| `fn_proj_lms_aplicar_estrutura_nova` | `authenticated` com `PROJ_CONFIRMAR_LMS` | botão "Aplicar estrutura" só para esse grupo |

## 2. Mapa do front por item do escopo (linhas do `index.html` nesta branch)

### 2.1 Botão "Aplicar estrutura" (aba 📥 LMS)
- `projLmsUpSituacao` (~38829) já lê autorização, estado e RASCUNHOS; `projLmsUpRender` monta a aba. Hoje, em `ESTRUTURA_PENDENTE`, mostra só o bloqueio de envio.
- Encaixe: em `ESTRUTURA_PENDENTE`, card "Estrutura pendente" + botão **Aplicar estrutura** (visível com `cena_pode('PROJ_CONFIRMAR_LMS')`; o banco decide). `confirm()` com resumo; chama `fn_proj_lms_aplicar_estrutura_nova`; traduz recusas (`PROJETO_COM_LEGADO (atividades X, materiais Y)`, `LINHA_NAO_CLASSIFICADA`, `LINHAS_REPETIDAS_NA_CHAVE`, `SEM_PERMISSAO`); no sucesso recarrega o projeto (`sotAbrirProjeto`).

### 2.2 Selos de estado
- Detalhe: `sotRenderDetalhe` (40519), pílula de status em 40537 → selo ao lado. Estado buscado em `sotAbrirProjeto` (39581, `Promise.all` 39588–39595) e guardado em `p._estadoWl`.
- Card da lista: `sotRenderCardProjeto` (39514), cabeçalho 39548–39555. Exigiria uma chamada por card (ou RPC em lote = migration) → **fica fora da 1.5a**.
- Fallback sem permissão/`anon`: derivar das linhas carregadas — alguma linha com `wl_id` → "Estruturado (WL)"; senão sem selo.
- "WL do croqui (IA)": único gravador é `sotSalvarPlanoExecucao` (41989 → `sbUpdate('sot_projetos', {plano_execucao, wl_distribuicao})` 42002); leitura em `sotParsePlanoExecucao` 41929, `sotPlanoContarWls` 42017, `sotRenderTabPlano` 45402, `sotIniciarAnaliseWL` 41261. Encaixe: aviso fixo na aba Plano — "planejamento visual (IA), não é a WL oficial" — e, em projeto estruturado, contagem das WLs oficiais.

### 2.3 WL visível e bloqueio de edição/exclusão em linha com WL
- **Atividades:** `_sotRenderTabAtividadesOper` (40887); linhas 40920–40971; ações 40962–40970: "▶ Lançar" (operacional, mantém), "✎" `sotEditarAtividade`, "🗑" **inline** (filtra local → `sbDelete` → re-render, sem checar resultado).
- **Materiais:** `_sotRenderTabMateriaisOper` (40987); linhas 41025–41077; "▶ Lançar" (mantém), "✎" `sotEditarMaterial` (exclusão fica dentro do modal).
- **Descritivos:** `sotRenderBlocoDescritivo` (41093) — retiradas FT=R aparecem aqui com 🗑 `sotExcluirDescritivo` (41118).
- **Edição:** `sotEditarAtividade` (44093) muda o objeto local **antes** e grava estruturais sem checar resultado; `sotEditarMaterial` (46113) mostra erro e logo depois "✅ Material atualizado" (contraditório); exclusão do material sempre mostra "✅ Material excluído".
- **Wrappers:** `sbUpdate` (8318) devolve `true/false` e guarda o erro em `window._sbLastUpdateErr`; **`sbDelete` (8283) não devolve nada** (não dá para saber se falhou); em `sot_materiais` a recusa do PATCH cai no DELETE físico (também recusado) → 2 requisições.
- Encaixe: coluna WL (+FT/KIT) e agrupamento por WL nas duas abas (ordem da `sot_wl`); em linha com WL, ✎/🗑 viram 🔒 e o modal abre só com campos livres; nos descritivos de retirada, 🔒 no lugar de 🗑.

### 2.4 Retirada fora de entrega — buscas por código (observação D4 da 1.4)
O CHECK do banco já impede quantidade operacional em material descritivo; o risco é a **escrita falhar em silêncio** ou cair na **linha errada** (mesmo código em instalação e retirada, ou em várias WLs).

| # | Onde | Como casa hoje | Risco | Correção |
|---|---|---|---|---|
| 1 | `plptConfirmarAplicacaoDevolucao` 27549 | `projeto + codigo_sap` (ou descrição), `limit 1`, sem filtro | linha de retirada → CHECK (erro engolido) ou linha errada | casar por `it.mat_id` (id da linha); fallback com `somente_descritivo=is.false&deleted_at=is.null`, `limit 2`, abortar se ambíguo |
| 3 | `_coSalvarPlptRequisicao` 37028 (Kanban → Entregue) | idem | idem | idem |
| 4 | `_coSalvarStatusMaterial` 37086 | `projeto + codigo_sap`, `limit 1` | idem; **e** para item vindo do PLPT soma `qtd_entregue` aqui e de novo em `_coSalvarPlptRequisicao` (37110) | pular o bloco quando `m._from_plpt`; filtros/ambiguidade |
| 6 | `sotAbrirProjeto` 39637–39667 (memória) | `codigo_sap` ou descrição | requisitado/entregue de várias linhas empilham na primeira | `m.id === it.mat_id` primeiro |
| 7 | `sotLancarBaixaMaterial` 45990 | soma requisições por código | `qtd_entregue` inflado | filtrar `it.mat_id === m.id` |

Uso real: 13 requisições PLPT (última em junho/2026), **todas com `mat_id`** → casar pelo id não perde histórico.
Listas que alimentam requisição/reserva/entrega (`sot_materiais_proj`, aba Reserva, diário PLPT, De Para, seletor de nova requisição) **já excluem descritivos**; nenhuma mostra WL (linhas de mesmo código parecem iguais).

### 2.5 Importador antigo e inserções em projeto estruturado
O gatilho **não bloqueia INSERT legado** (só INSERT com campo de WL) e a unicidade legada vale só `WHERE wl_id IS NULL` → em projeto estruturado, a tela pode criar **linha legada duplicada** do mesmo código. Pontos de bloqueio (projeto com WL ou `ESTRUTURA_PENDENTE`):

| Ponto | Onde |
|---|---|
| Lista/IA/LMS antigo + "Importar materiais" | `_sotLancarPendentes` 43317 (comum a `sotSalvarProjeto` e `sotProcessarImportacaoMat`); esconder a área `sot-lista-drop` em `sotModalProjeto` 42220 |
| "Importar lista colada" (insere **e soma** quantidade em linha existente) | `sotConfirmarImportacao` 45072; botão 40894 |
| "+ Atividade" / "+ Material" | `sotAbrirNovaAtividade` 43452, `sotAbrirNovoMaterial` 43723; botões 40658/40660/40893/40991/41081 |
| Atividade criada automaticamente na validação do campo | `sotValidarLancamento` 44651 |
| Material adicional aprovado (INSERT) | `plptAprovarAdicional` 29291 |
Em `EM_CONCILIACAO` o legado **continua** (plano §1.6) → sem bloqueio.
"De Para" e "🤖 Analisar relatório" não gravam (`sarImportarAtividades` é stub) → sem bloqueio.
Nenhuma tela apaga `sot_projetos` (a proteção de cascata da 1.4 não tem efeito visível hoje).

### 2.6 Lançamento do campo com WL
`sot_lancamentos_campo` **nunca foi usada** (0 linhas), não tem `projeto_id` e a validação lista pendentes de **todos** os projetos (44601). Medição (`sotSugerirItensMedicao` 40145 / `sotAdicionarItensMedicao` 40208) liga por `atividade_id` (correto), mas não mostra WL e inclui atividades excluídas. → **fica para a 1.5b** (precisa de migration para projeto/atividade no lançamento).

## 3. Achados fora do escopo (bugs do fluxo atual, independentes da WL)

| Achado | Onde | Sugestão |
|---|---|---|
| `catalog_id` recebe o id da linha `sot_materiais` → aprovar adicional nunca casa e **sempre insere duplicado**; `'null'` vira filtro inválido; adicional de atividade grava em materiais | `sotPersistirRequisicaoMateriais` 45333, `plptAprovarAdicional` 28899/29337 | tarefa separada |
| Dupla contagem de `qtd_entregue` (item PLPT) | `_coSalvarStatusMaterial` 37086 + 37110 | junto com 2.4 (#4) ou tarefa separada |
| `sot_atividades` carregada **sem** `deleted_at=is.null` (excluídas aparecem, viram viáveis e vão para medição) | 28614, 39589, 45570 | tarefa separada (pequena) |
| Mensagens de sucesso falsas | `sotSalvarPlanoExecucao` 41989, `sotEditarMaterial` 46113, exclusão de material 46199 | junto com 2.3 onde tocar; resto separado |
| Tela "Reservar Materiais" do PLPT lê variável global inexistente (`sot_materiais`) → sempre vazia | `plptAbrirReservaMateriais` 27575 | tarefa separada |
| Validação do campo sem filtro de projeto | 44601 | 1.5b |

## 4. Proposta: 1.5 em duas entregas

**1.5a — segurança e visibilidade da estrutura (recomendada agora; só `index.html` + testes; release 8.1.217)**
1. Botão **Aplicar estrutura** na aba 📥 LMS (2.1).
2. **Selo** de estado no detalhe do projeto, com fallback derivado (2.2); aviso "WL do croqui (IA)" na aba Plano.
3. **WL visível** (coluna WL/FT/KIT + agrupamento por WL) nas abas Atividades e Materiais; **🔒** e modal só com campos livres em linha com WL; recusas do banco mostradas (2.3).
4. **Buscas por id da linha** nos 5 pontos de 2.4 (retirada nunca recebe entrega; nada cai na linha errada).
5. **Bloqueio de inserções/importadores** em projeto com WL ou `ESTRUTURA_PENDENTE` (2.5).
6. `sbDelete` passa a **devolver `true/false`** (aditivo: hoje ninguém usa o retorno) para as telas detectarem recusa.

**1.5b — campo e medição com WL (depois; inclui migration)**
- `sot_lancamentos_campo` com `projeto_id`/`atividade_id`/`wl_id`; validação por projeto e por atividade; medição e seletores mostrando WL; card da lista com selo (RPC em lote).

## 5. Decisões para aprovação

| # | Decisão | Recomendação |
|---|---|---|
| E1 | Dividir em 1.5a (agora, sem migration) e 1.5b (depois) | **Sim** |
| E2 | Selo só no detalhe do projeto na 1.5a; cards na 1.5b | **Sim** |
| E3 | Sem `PROJ_IMPORTAR_LMS`/`anon`: selo derivado das linhas ("Estruturado (WL)" se houver linha com WL) | **Sim** |
| E4 | Linha com WL: ✎/🗑 → 🔒; modal de atividade edita só etapa, valor unitário, ordem, observações, serviço; de material só observação e adicional | **Sim** |
| E5 | Bloquear inserções/importadores em projeto com WL **ou** `ESTRUTURA_PENDENTE`; `EM_CONCILIACAO` segue liberado | **Sim** |
| E6 | Buscas de material por `mat_id` com fallback filtrado e aborto se ambíguo (5 pontos de 2.4), incluindo a correção da dupla contagem (#4) | **Sim** |
| E7 | `sbDelete` devolver `true/false` (wrapper global, mudança aditiva) | **Sim** |
| E8 | Botão "Aplicar estrutura" só para `PROJ_CONFIRMAR_LMS` (global), com `confirm()` e recarga do projeto | **Sim** |
| E9 | Aba Plano: aviso fixo "WL do croqui (IA) — não é a WL oficial" + contagem oficial | **Sim** |
| E10 | Achados do §3 como tarefas separadas (exceto o que a 1.5a já toca) | **Sim** |

## 6. Testes previstos (1.5a)
- `tests/proj-wl-telas-ui.test.js` (padrão vm): botão aplicar (visível/oculto, confirm, sucesso recarrega, recusas traduzidas); selo e fallback; coluna/agrupamento WL; 🔒 e modal com campos livres; payload de edição sem campos estruturais em linha WL; bloqueio dos 6 pontos de inserção; buscas por `mat_id` (retirada ignorada, ambíguo aborta, dupla contagem removida); `sbDelete` devolvendo boolean; legado inalterado (paridade dos fluxos sem WL).
- Regressão: suíte completa, `proj-lms-*`, `alm-req-*`, `prog-*`, `jornada-*`.

## 7. Próximo passo
Aprovar E1–E10 → implementar a 1.5a localmente na `enel-etapa15-telas` → testes → revisão → commit/preview → homologação no TESTE 1 — das123 → release 8.1.217.
