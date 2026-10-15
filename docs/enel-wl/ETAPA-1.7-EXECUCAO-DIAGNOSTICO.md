# Etapa 1.7 — Execução por projeto, equipe e data: diagnóstico

> Status: **diagnóstico para revisão**. Nada foi implementado. Nenhuma escrita no banco.
> Base: `main` 6add0dd (8.1.221), branch `enel-etapa17`. Leituras do banco em 14/10/2026 (somente SELECT).
> Referência: `FASE1-PLANO-TECNICO.md` §1.7.

## 1. Objetivo da etapa (plano técnico)

- `prog_proj_execucoes` = projeto + equipe + data (via `composicao_dia_id`), sem `wl_id`.
- `prog_proj_execucao_itens` = WL + atividade da execução, com `qtd_programada`. "WL inteira" expande para uma linha por atividade ativa.
- Views `vw_proj_saldo_atividade` e `vw_proj_execucao_situacao`.
- **Decisão obrigatória antes da migration:** fonte única da quantidade executada em projeto ESTRUTURADO.

## 2. Estado atual — números do banco

| Item | Quantidade |
|---|---|
| `composicao_dia` (total) | 9198 |
| `composicao_dia` com `projeto_ids` | 38 (05/01 a 10/07) |
| `prog_projetos_agenda` | 3 (1 AGUARDANDO_EQUIPE, 2 ALOCADO) |
| `plpt_prog_dia` / `plpt_prog_projetos` | 6 / 6 |
| `plpt_sessoes` | 7 |
| `plpt_lancamentos` | 0 |
| `sot_lancamentos_campo` | 0 |
| `execucoes_obra` | 3 |
| `sot_atividades_historico` / `sot_materiais_historico` | 5 / 0 |
| Atividades com `qtd_executada > 0` | 7 (nenhuma com WL) |
| Projetos com WL (`sot_wl`) | 2 (DFdfSDF e ETD VARGINHA) |

Conclusão: execução por dia/equipe praticamente não é registrada hoje, e **nenhuma quantidade executada existe em projeto com WL**. A 1.7 não precisa migrar dados de execução.

`composicao_dia` tem `id uuid` e único `(equipe_id, data)` — **incluindo linhas com `deleted_at`** — então o `id` da composição de uma equipe num dia é estável (reativar reaproveita a linha). Isso sustenta o `composicao_dia_id` do plano.

## 3. Como a programação liga equipe, data e projeto hoje

- **Única ligação equipe + data + projeto: `composicao_dia.projeto_ids`** (texto JSON com uuids).
  - Incluir/retirar projeto: `progProjetoCoreAlterarProjetosEquipe` (index.html ~82242), chamada pela fila (`ppFilaColocarNaEquipe` ~83977), pelo modal `ppEqSelecionarProjetos` (~85077) e por `ppEqRemoverProjeto` (~85131).
  - Auto Escalar (`progProjetoCorePersistirComposicao` ~82298) junta projetos do filtro; `confirmada:false`.
  - Confirmar "PROGRAMADO" (`progProjetoCoreSalvarEquipe` ~82328) grava `confirmada:true`; não mexe em projetos.
- **Agenda** (`prog_projetos_agenda`): data prevista sem equipe; vira ALOCADO por espelho de `composicao_dia` (`progAgendaSincronizarAlocacao`). Não programa nada sozinha.
- **Programação PLPT** (`plpt_prog_dia` + `plpt_prog_projetos`): tela separada, com funções duplicadas no index (~104580 e ~105273). Regrava projetos com DELETE + INSERT.
- **Atividade, material ou WL na programação: nenhuma referência.** A programação é só "projeto inteiro".

## 4. O que o campo vê (Diário de Bordo)

- Projetos do dia: primeiro `plpt_prog_dia` (últimos 3 dias); **só se não houver**, `composicao_dia.projeto_ids` (~25808–25932; `renderDiarioPlpt` ~26343).
  → Um projeto programado pela tela de Projetos **não aparece** no diário se a equipe tiver `plpt_prog_dia` no período.
- Atividades/materiais: **todas** as linhas do projeto (`_plptRenderProjetoDetalhe` ~28625), sem filtro por execução, equipe ou dia. WL só ordena e rotula (`plptWlCarregar`).

## 5. Quem grava quantidade executada/aplicada hoje

| # | Função | Origem | Campo | Modo | Histórico (dia/equipe) |
|---|---|---|---|---|---|
| A1 | `plptConfirmarAtividade` | Diário | `qtd_viabilizada`, `qtd_executada` | **Absoluto** (input pré-preenchido com acumulado) | Só texto em `plpt_sessoes.eventos` |
| A2 | `plptConfirmarViabilidade` | Diário | `qtd_viabilizada` | Absoluto | — |
| A3 | `plptMarcarViabilidadeProjeto` | Diário | `qtd_viabilizada` = previsto se 0 | Absoluto | — |
| A4 | `sotValidarLancamento` | SOT, validação de `sot_lancamentos_campo` | `qtd_executada`/`qtd_viabilizada` | **Soma**; casa por `atividade_id` ou código (recusa ambíguo com WL); pode criar atividade | Na própria tabela de lançamentos (0 linhas) |
| A5 | `sotLancarExecucaoAtividade` | SOT detalhe | `qtd_executada`, `status` | **Soma** | `sot_atividades_historico` com data, **sem equipe** |
| A6 | `sotLancarViabilidadeAtividade` | SOT detalhe | `qtd_viabilizada` | Soma | — |
| M1 | `plptConfirmarMaterial` | Diário | `qtd_viabilizada`, `qtd_aplicada` | Absoluto | Texto em eventos |
| M2 | `plptSalvarBaixa` | Diário | `qtd_aplicada`/`qtd_viabilizada` | Absoluto | — |
| M3 | `plptConfirmarAplicacaoDevolucao` | Diário (requisição) | `qtd_aplicada` | Soma | JSON da requisição |
| M4 | `sotLancarAplicacaoMaterial` | SOT | `qtd_aplicada` | Soma | — |
| M5 | `sotLancarViabilidadeMaterial` | SOT | `qtd_viabilizada` | Absoluto | — |
| M6 | `_abrirBaixaModal` | SOT "Baixa" | `qtd_aplicada`, `qtd_devolvida` | Soma | `sot_materiais_historico`, sem dia/equipe |
| M7–M9 | baixa / almoxarifado | | `qtd_entregue` | Absoluto/Soma | — |
| M10 | `plptAprovarAdicional` | Adicional | `qtd_viabilizada` | Soma ou INSERT | — |

Medição grava em `sot_med_itens.qtd_medida` (usa `qtd_executada` só como valor inicial). Importações só inserem com zero. **Nenhum trigger/RPC grava execução** — tudo é PATCH direto do front.

### Riscos

- **R1 — absoluto × soma na mesma coluna.** A1 (absoluto) pode apagar o que A4/A5 somaram entre a abertura do modal e o salvar.
- **R2 — sem rastreio.** Nenhum caminho grava atividade + quantidade + equipe + dia juntos. Não dá para saber quem executou o quê, quando.
- **R3 — diário não chega à execução nova.** Pela regra de precedência (§4), uma execução ligada a `composicao_dia_id` não aparece no campo quando há `plpt_prog_dia`.
- **R4 — escrita direta sem validação no banco.** Nada impede `qtd_executada` negativa, em atividade apagada ou de outra WL.

## 6. Proposta

### 6.1 Fonte única da quantidade executada (decisão obrigatória)

| Opção | Como funciona | Prós | Contras |
|---|---|---|---|
| **E1 — manter `sot_atividades.qtd_executada` como fonte** e só adicionar histórico | Caminhos atuais continuam; 1.7 só cria programação (itens) | Menor mudança | R1/R2/R4 continuam; saldo por execução impossível |
| **E2 — livro-razão por execução (recomendado)** | Nova tabela append-only `prog_proj_execucao_lancamentos` (item da execução, qtd, tipo LANCAMENTO/ESTORNO, por_auth, em). Em projeto ESTRUTURADO, `sot_atividades.qtd_executada` passa a ser **derivada** (soma do razão), gravada só por função DEFINER | Rastreio por equipe/dia; sem sobrescrita; saldo por atividade e por execução; estorno auditável | Exige bloquear A1/A4/A5 em ESTRUTURADO e adaptar o diário |
| E3 — `qtd_executada` direto no item da execução | Campo editável em `prog_proj_execucao_itens` | Simples | Volta ao problema absoluto × soma; sem estorno |

**Recomendação: E2**, valendo **só para projeto ESTRUTURADO**. Legado (LEGADO_SEM_WL e EM_CONCILIACAO) segue como hoje, sem mudança.
Como hoje não existe nenhuma execução em projeto com WL, não há saldo a migrar.

### 6.2 Tabelas (ajustes sobre o plano)

- `prog_proj_execucoes` — como no plano. Adicionar `status` calculado na view (PROGRAMADA / EM_EXECUCAO / CONCLUIDA / CANCELADA), sem coluna.
- `prog_proj_execucao_itens` — como no plano (`qtd_programada` opcional; NULL = "sem meta do dia").
- `prog_proj_execucao_lancamentos` — **nova (E2)**: `item_id` FK, `atividade_id` (cópia), `qtd numeric` (> 0), `tipo` (LANCAMENTO / ESTORNO com `estorna_id` e motivo), `data_execucao`, `por_auth`, `em`. Append-only, RLS FORCE, sem grants diretos (mesmo padrão de `sot_lms_conciliacao`).
- Funções DEFINER: criar/cancelar execução, definir itens (expande WL inteira), lançar, estornar. Todas validam: projeto ESTRUTURADO; WL do projeto; atividade viva do projeto com o mesmo `wl_id`; composição existente e não apagada.
- Views do plano: saldo por atividade = previsto − Σ razão; situação por execução.

### 6.3 Materiais

Fora da 1.7. Material aplicado (M1–M10) continua como está; o vínculo material × execução fica para a 1.8 (fluxo SAP, já previsto com "vínculo opcional projeto/WL/execução").

## 7. Decisões para aprovação

| # | Decisão | Proposta |
|---|---|---|
| **D1** | Fonte única da quantidade executada em ESTRUTURADO | **E2** — razão por execução; `sot_atividades.qtd_executada` derivada, só por função |
| D2 | Abrangência | Execução com itens **só em ESTRUTURADO**. Legado e EM_CONCILIACAO: programação continua "projeto inteiro", sem itens ("Sem WL") |
| D3 | Caminhos antigos em ESTRUTURADO (A1, A4, A5) | Bloquear com mensagem orientando o novo lançamento; A2/A3/A6 (viabilidade) seguem |
| D4 | Diário de Bordo | Para projeto ESTRUTURADO, mostrar os itens da execução do dia (WL → atividades programadas) e lançar via função. Corrigir a precedência: incluir também os projetos de `composicao_dia` mesmo quando houver `plpt_prog_dia` (união, sem duplicar) |
| D5 | Quando a execução nasce | Ao incluir projeto ESTRUTURADO numa equipe/dia na Programação de Projetos (cria cabeçalho); itens definidos em seguida (WL inteira ou atividades). Retirar o projeto cancela a execução (com motivo), nunca apaga |
| D6 | Execução sem confirmar a equipe | Permitida (rascunho), seguindo `composicao_dia.confirmada`; lançamento só em dia ≤ hoje |
| D7 | Permissões | Programar itens: `cena_prog_pode_programar_projetos()`. Lançar/estornar: nova permissão `PROJ_LANCAR_EXECUCAO` (encarregado/campo), estorno só para gestão |
| D8 | `sot_lancamentos_campo` (0 linhas) | Não usar na 1.7; fica legado |
| D9 | Materiais | Fora da 1.7 (vão para a 1.8) |

## 8. Fatiamento sugerido

1. **1.7a — banco:** migration idempotente (3 tabelas, funções, views, RLS), testes PGlite. Sem tela.
2. **1.7b — Programação de Projetos:** escolher WL/atividades ao programar projeto ESTRUTURADO; card mostra o que foi programado.
3. **1.7c — Diário de Bordo:** itens da execução do dia + lançamento/estorno via função; correção da precedência (D4).
4. **1.7d — travas:** bloqueio de A1/A4/A5 em ESTRUTURADO; Jornada lendo a situação da execução.

Cada fatia com branch própria, aprovação antes de commit e, no caso da 1.7a, antes de aplicar no banco.

## 9. Fora do escopo / não tocado

- TMA, Programação PLPT (só leitura da precedência no diário, em D4), Frotas/Portaria, Almoxarifado.
- ETD VARGINHA continua EM_CONCILIACAO (H1 pendente) — fica "Sem WL" na programação até ser conciliado.
