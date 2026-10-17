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

## 10. Decisões aprovadas (15/10/2026)

> Aprovadas pelo dono após revisão de D1–D9. Substituem as propostas das §6–§8 onde houver diferença.
> Leituras complementares (somente SELECT, 15/10): TESTE 1 (ESTRUTURADO) tem 1 atividade **sem WL** com `qtd_executada = 1`; as 7 atividades com execução no banco não têm WL; os três caminhos antigos (A1, A4, A5) **não verificam o retorno** de `sbUpdate` (A5 grava histórico e A4 marca o lançamento como aprovado mesmo se o PATCH falhar).

### 10.1 Diretrizes gerais

1. Execução por **lançamentos individuais** (equipe, dia, usuário, atividade exata, WL, histórico, estorno).
2. Quantidade executada consolidada de atividade estruturada com **uma única fonte oficial, controlada pelo banco**.
3. Projeto legado preserva o funcionamento atual.
4. **Medição não é fonte** da quantidade executada.
5. **Materiais fora da 1.7** (ficam para a 1.8).
6. A ativação do novo lançamento exige **bloqueio simultâneo** dos caminhos antigos para atividades estruturadas, sem janela para duplicidade ou sobrescrita.

### 10.2 Decisões

**D1 — Fonte única (aprovada).** Razão append-only de lançamentos por item de execução (`LANCAMENTO`, `ESTORNO` com referência ao original e motivo; `SALDO_INICIAL` reservado — ver D9). `sot_atividades.qtd_executada` de atividade estruturada passa a ser **cópia derivada** (Σ razão), gravada só pela função DEFINER. Telas que leem o campo (Jornada, medição, SOT) seguem funcionando. Medição não entra na conta.

**D2 — Abrangência (aprovada).** "Atividade estruturada" = projeto ESTRUTURADO **e** `sot_atividades.wl_id IS NOT NULL` **e** atividade viva. Atividade sem WL em projeto ESTRUTURADO (caso TESTE 1) e projetos LEGADO_SEM_WL / EM_CONCILIACAO seguem o fluxo atual, sem mudança.

**D3 — Bloqueio dos caminhos antigos (aprovada).** Duas camadas, ativadas juntas:
- Banco: gatilho em `sot_atividades` recusa alteração de `qtd_executada` de atividade estruturada fora da função oficial (e INSERT já com execução ≠ 0 em projeto ESTRUTURADO com WL); gatilho em `sot_atividades_historico` recusa linha de atividade estruturada.
- Telas: A1, A4 e A5 detectam atividade estruturada **antes** de gravar e orientam para o novo lançamento; nenhum falso sucesso. Viabilidade e status continuam liberados.

**D4 — Diário de Bordo (aprovada).** Em projeto ESTRUTURADO mostra os itens da execução da equipe no dia (WL → atividades, meta e saldo) e lança/estorna pela função. Lista de projetos do dia passa a ser a **união** de `plpt_prog_dia` e `composicao_dia`, sem duplicar; teste de paridade garante lista idêntica para quem não tem programação pela tela de Projetos. Lançamento exige conexão (fila offline fica para depois).

**D5 — Ciclo de vida (aprovada com ajustes).**
- Uma equipe pode trabalhar em **várias WLs no mesmo dia** (vários itens na mesma execução).
- Uma WL pode receber **várias equipes em dias diferentes** (várias execuções do mesmo projeto; saldo por atividade soma todas).
- Cada lançamento identifica **atividade, WL, equipe, data de execução, quantidade, usuário (auth), momento do registro e origem** (`DIARIO`, `SOT`, `SALDO_INICIAL`).
- Alterações na programação **não apagam histórico**: nada de DELETE físico; item ou execução com lançamentos não pode ser cancelado (só sem lançamentos líquidos e com motivo); retirar o projeto da equipe com execução lançada é recusado com mensagem.
- Execução nasce ao incluir projeto ESTRUTURADO numa equipe/dia; itens definidos em seguida (WL inteira expande por atividade). Lançar fora do programado exige antes incluir o item (ação auditada).

**D6 — Datas (aprovada com ajustes).**
- Retroativo até **7 dias** (data de execução ≥ hoje − 7).
- Acima de 7 dias: somente gestão, com **justificativa obrigatória** gravada no lançamento.
- **Data de execução futura proibida.**
- Lançar exige composição confirmada; execução em rascunho é permitida para programar.

**D7 — Permissões (aprovada com ajustes).**
- Criar `PROJ_LANCAR_EXECUCAO` e `PROJ_ESTORNAR_EXECUCAO` (autorizações separadas). Programar itens usa `cena_prog_pode_programar_projetos()`. Tabelas novas com RLS FORCE e sem escrita direta.
- **Compatibilidade com a autenticação do Diário — verificação feita (somente SELECT, 15/10):**

  | Perfil | Usuários ativos | Com conta Auth | Login Auth nos últimos 30 dias | Sessão Auth renovada nos últimos 30 dias |
  |---|---|---|---|---|
  | encarregado | 81 | 81 | 0 | 0 |
  | equipe | 693 | 692 | 0 | 0 |
  | supervisor | 23 | 23 | 2 | 1 |
  | gestor | 11 | 11 | 5 | 5 |

  Conclusão: quase todos têm conta Auth, mas **o campo não está entrando por Auth** (cai no login MD5 legado, `_sbAuthToken = null`, index.html ~81907/81938). Funções que exigem `auth.uid()` **não funcionariam hoje no Diário**. **Bloqueio para a 1.7c** (não para a 1.7a/1.7b): antes da 1.7c é preciso decidir entre (a) migrar o login dos encarregados para Auth (recomendado, alinhado ao plano de endurecimento) ou (b) lançar inicialmente só pelo SOT (escritório) e levar o Diário para depois. Nunca aceitar lançamento anônimo.

**D8 — `sot_lancamentos_campo` (aprovada).** Fica legado (0 linhas); validação recusa atividade estruturada; legado sem mudança.

**D9 — Saldo inicial (aprovada conceitualmente).**
- Execução existente em atividade que vier a ganhar WL vira lançamento `SALDO_INICIAL` (sem equipe, origem identificada).
- **Nesta etapa `fn_proj_lms_aplicar_conciliacao` NÃO é alterada.** Hoje não há caso real (nenhuma atividade com WL tem execução; ETD VARGINHA sem execução).
- Integração futura (documentada, não implementada): ao aplicar conciliação com o interruptor ligado, para cada atividade que recebe `wl_id` com `qtd_executada ≠ 0`, gravar `SALDO_INICIAL` na mesma transação. Testes previstos: (1) atividade com execução recebe WL → razão = valor anterior, campo inalterado; (2) atividade sem execução → nenhum lançamento; (3) reaplicação idempotente não duplica; (4) estorno de `SALDO_INICIAL` só com `PROJ_ESTORNAR_EXECUCAO`.
- **Salvaguarda até lá:** a ativação (1.7d) e a conferência de consistência recusam ligar o interruptor se existir atividade estruturada com `qtd_executada` diferente da soma do razão.

### 10.3 Transição aprovada (1.7a → 1.7d)

| Fatia | Conteúdo | Em produção |
|---|---|---|
| 1.7a — banco | Tabelas, funções, views, RLS, permissões novas, interruptor geral (**desligado**) e gatilhos de proteção criados mas inertes com o interruptor desligado. Testes PGlite cobrindo ligado e desligado. | Nada visível; ninguém chama as funções novas. |
| 1.7b — Programação de Projetos | Escolher WL/atividades ao programar projeto ESTRUTURADO. Grava só programação. | Pode publicar sozinha. |
| 1.7c — Diário e SOT | Lançamento/estorno pelo novo fluxo + guardas de tela (D3), tudo atrás do interruptor. Depende da decisão de autenticação (D7). | Publicada com o interruptor desligado = comportamento atual. |
| 1.7d — ativação | Pré-requisitos: versão mínima publicada, permissões concedidas, consistência (campo = Σ razão para toda atividade estruturada). Liga o interruptor **numa única operação no banco** (trava + novo fluxo). Jornada passa a ler a situação da execução. | Corte instantâneo; reverter = desligar (lançamentos preservados). |

### 10.4 Condições obrigatórias

1. Nunca dois caminhos simultâneos de escrita em quantidade executada estruturada.
2. A trava do banco não é ligada enquanto telas puderem apresentar falso sucesso.
3. Ativação exige versão mínima, permissões e consistência de dados (verificados pela função de ativação, que recusa se faltar algo).
4. Projeto legado opera como antes.
5. Materiais ficam para a 1.8.
6. Medição não é fonte da quantidade executada.
7. **Fail-closed** para atividades estruturadas quando houver inconsistência entre versão e proteção:
   - interruptor ausente/ilegível no banco → gatilho trata como **ligado** (recusa caminho antigo) e a função nova recusa (nada grava) até correção;
   - tela não consegue ler o interruptor, ou versão da tela abaixo da mínima com interruptor ligado → tela **não oferece nenhum** lançamento de executado em atividade estruturada (nem antigo, nem novo) e mostra "atualize o sistema";
   - legado nunca é afetado pelo fail-closed.
