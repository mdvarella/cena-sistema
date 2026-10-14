# Etapa 1.6 — Conciliação de projeto com legado × LMS ORIGINAL · Diagnóstico técnico

**Status:** diagnóstico apenas. **Nada implementado.** Sem migration, `index.html`, `sw.js`, Edge, `APP_VERSAO` ou SQL de escrita.
**Branch:** `enel-etapa16` (de `main` `8267015`, 8.1.219). **Data:** 12/10/2026.
**Fontes:** migrations `20261009193000_proj_lms_origem`, `20261010120000_proj_lms_confirmacao`, `20261011200000_proj_wl_estrutura`, `20261012100000_proj_lms_leitura_wl`; `docs/enel-wl/*`; `index.html`; consultas **somente leitura** em produção.

---

## 0. Ponto de partida

| Item | Estado |
|---|---|
| Produção | 8.1.219: LMS ORIGINAL (envio, confirmação), estrutura nova aplicável pela tela, WL nas telas, medição, seletores, PLPT e Jornada |
| Modo CONCILIACAO hoje | só grava `status=CONFIRMADA`, `modo`, autoria e evento. **Nada concilia.** `conciliacao_aplicada_em/_por_auth` existem e **nunca são preenchidas** (`confirmacao.sql:76`) |
| Regra de estado | `sot_lms_estado_wl_calc`: CONCILIACAO com `conciliacao_aplicada_em` nulo = `EM_CONCILIACAO`; preenchido = `ESTRUTURADO` (já pronto, não precisa mudar) |
| Permissão | `PROJ_CONCILIAR_LMS` **já existe** (`20261007190000_cena_permissoes_acao.sql:481`; admin, gestor, coordenador, escritório, administrativo) e **nenhuma função usa** |
| Plano original (§1.6 `FASE1-PLANO-TECNICO.md:145-152`) | tabela `sot_lms_conciliacao` com decisões VINCULAR / CRIAR_NOVO / NAO_INCORPORAR / MANTER_LEGADO / REJEITAR; **"um para um; nunca divide"**; "conciliar não altera quantidade" |
| Tela de confirmação | mostra sempre os dois botões (ESTRUTURA_NOVA e CONCILIACAO); não força conciliação por existir legado. `PROJETO_COM_LEGADO` só aparece ao aplicar estrutura nova |

## 1. Projetos afetados (produção, leitura)

| Projeto | Estado | Legado ativo | Movimento |
|---|---|---|---|
| **ETD VARGINHA** (DAC/S.SUL.25.00106) | EM_CONCILIACAO (12/10 09:20) | 7 atividades, 29 materiais | 1 medição **aprovada** (parcial 1, teste) com 2 itens ligados por `atividade_id` |
| TESTE 1 — DFdfSDF | EM_CONCILIACAO (11/10) | **0** | nenhum |
| Outros ENEL legados com itens, **sem LMS** | LEGADO_SEM_WL | 4 projetos | 1 com medição |

Dono confirmou (11/10): não há projeto ENEL legítimo com movimentação; ETD VARGINHA e TESTE 1 são testes.

## 2. ETD VARGINHA — legado × LMS (110 linhas, 6 WLs)

**Achado principal: o legado é a soma do LMS por código.** Todos os 36 itens antigos casam com o LMS pelo código normalizado e a quantidade antiga é exatamente a soma das linhas do LMS daquele código. Nenhuma linha do LMS fica sem item antigo.

| Classe | Itens | Exemplo |
|---|---|---|
| 1 item antigo = 1 linha do LMS, mesma quantidade | **2** materiais | 986363 (WL 6, FT I, 1) |
| 1 item antigo = soma de várias linhas (várias WLs) | **7** atividades, **27** materiais | I-8000656 = WL 5 (1) + WL 6 (1) = 2; 325071 = 6 linhas em 4 WLs = 12 |
| Quantidade diferente | 0 | — |
| Item antigo sem linha no LMS / linha do LMS sem item | 0 / 0 | — |

Outros achados:
- **O importador antigo soma retirada com instalação** no mesmo material. Ex.: 321638 SELA = 14 instalação (FT I) + 14 retirada (FT R) = **28 operacionais** no legado. Na estrutura do LMS seriam 14 operacionais + 14 só descritivos. O legado superestima material a requisitar.
- 2 materiais antigos têm a **descrição trocada pelo KIT** e estão como só descritivos (325070 "M-0325070", 348165 "K-ASQ04ES"); no LMS são materiais normais com descrição real.
- **Movimento:** todas as quantidades viabilizadas/executadas/aplicadas/entregues = 0; nenhuma requisição, adicional, histórico ou lançamento de campo. **Única exceção:** medição parcial 1 **aprovada** (corte 05/10, R$ 7.795,44) com I-8000656 medido 16 e R-8000656 medido 20 — previsto 2 cada (dado de teste).

**Consequência:** a regra do plano ("um para um; nunca divide") só conciliaria 2 dos 36 itens. Os outros 34 ficariam como legado para sempre e o projeto nunca teria WL de verdade. **A regra do plano não serve para o legado real** — precisa de decisão (G1).

## 3. O que a conciliação precisa preservar

| Referência | Liga por | Risco ao trocar o item antigo |
|---|---|---|
| `sot_med_itens.atividade_id` | **id** | medição (inclusive aprovada) perde o vínculo/rótulo |
| `plpt_requisicoes_materiais.itens[].mat_id` | **id** (JSON) | requisição aponta para material inexistente |
| `sot_adicionais.catalog_id` | id do material na reserva SOT (semântica mista) | adicional órfão |
| `sot_atividades_historico` / `sot_materiais_historico` | **id** | histórico órfão |
| `sot_lancamentos_campo` | código (0 linhas) | — |
| `prog_projetos_agenda` | só projeto | — |

Nenhuma FK física aponta para `sot_atividades.id`/`sot_materiais.id` (vínculos só no front, por texto/JSON) → **o banco não impede apagar um item com movimento; a função tem de checar.**

Travas atuais que a conciliação respeita: linha legada pode receber `deleted_at` (não muda os campos de WL); campos de WL só por função SECURITY DEFINER; `sot_lms_linhas` imutável; um `lms_linha_id` vira no máximo uma linha ativa.

## 4. Estratégias possíveis

| | Como funciona | ETD VARGINHA | Risco |
|---|---|---|---|
| **A. Vínculo 1:1 (plano original)** | liga item antigo a uma linha do LMS; nunca divide; legado continua | concilia 2 de 36 | projeto nunca fica estruturado; pouco valor |
| **B. Substituição controlada** (recomendada para v1) | quando **cada código bate** (soma do LMS = quantidade antiga, mesma unidade) e **não há movimento**: cria a estrutura do LMS (igual à estrutura nova) e **retira** os itens antigos (`deleted_at` + registro de conciliação com o retrato de cada item e as linhas do LMS que o substituíram) | 36 de 36 batem; **bloqueada só pela medição de teste** | nenhum dado com movimento é tocado; total por código não muda (só é dividido por WL e separa retirada) |
| C. Alocação manual por WL | usuário distribui quantidades e movimento do item antigo entre as WLs | — | tela complexa; erro humano; só quando houver projeto real com movimento |

## 5. Proposta (v1 = estratégia B)

**Prévia (só leitura):** RPC `sot_lms_conciliacao_previa(importacao)` → por código: item(ns) antigo(s), linhas do LMS por WL/FT/KIT, quantidades, situação (`BATE`, `QTD_DIFERENTE`, `UNIDADE_DIFERENTE`, `SO_NO_LEGADO`, `SO_NO_LMS`, `COM_MOVIMENTO` com o motivo: medição, requisição, adicional, quantidades) e `pode_aplicar`.

**Aplicar (atômica):** `fn_proj_lms_aplicar_conciliacao(importacao)`:
1. autoriza, trava (mesmo advisory lock da confirmação), revalida tudo (a prévia não é confiável sozinha);
2. recusa com motivo se: não é ORIGINAL+CONFIRMADA+CONCILIACAO, já aplicada (`JA_APLICADA`), já tem WL, algum código não bate, algum item antigo tem movimento, mesmas recusas de linha da estrutura nova (`LINHA_NAO_CLASSIFICADA`, `LINHAS_REPETIDAS_NA_CHAVE`, `LINHA_SEM_WL_OU_DESCRICAO`);
3. cria WLs, atividades e materiais **com a mesma regra** da estrutura nova (retirada FT=R de material = só descritivo);
4. marca cada item antigo com `deleted_at` (sem apagar) e grava em `sot_lms_conciliacao` uma linha por item antigo: tipo, id, retrato (código, descrição, unidade, quantidades), ids das linhas do LMS/itens novos, decisão `SUBSTITUIDO`;
5. preenche `conciliacao_aplicada_em/_por_auth` (estado passa a ESTRUTURADO pela regra canônica) e evento `CONCILIACAO_APLICADA`.

**Tela (aba 📥 LMS, estado EM_CONCILIACAO):** relatório da prévia (agrupado por código, com o que bate e o que bloqueia) e botão **"Aplicar conciliação"** só quando `pode_aplicar` e com a permissão; `confirm()` explicando que os itens antigos serão substituídos pela estrutura do LMS.

**TESTE 1 — DFdfSDF** (0 itens antigos): conciliação = estrutura do LMS, sem retirar nada.

**ETD VARGINHA:** prévia mostra 36 códigos `BATE` e 2 atividades `COM_MOVIMENTO` (medição de teste) → aplicar fica bloqueado até o dono decidir sobre a medição (G4).

## 6. Fora de escopo da v1

- Dividir/transferir **movimento** do item antigo para as WLs (estratégia C) — só com projeto real que precise.
- Conciliação parcial (código que não bate fica legado ao lado da WL).
- Revisões do LMS (SUBSTITUTIVA/COMPLEMENTAR), status DESCARTADA.
- Os 4 projetos ENEL legados sem LMS (precisam enviar e confirmar o LMS antes).
- Corrigir o importador antigo (soma de retirada) — registrar como tarefa separada.

## 7. Testes necessários

- **PGlite (migration):** prévia só leitura (nada grava); matriz de permissão; cada situação da prévia; aplicar: tudo ou nada, recusas com motivo, estrutura idêntica à da estrutura nova para o mesmo LMS, itens antigos com `deleted_at` (nunca apagados), registro de conciliação completo, estado ESTRUTURADO, `JA_APLICADA` na segunda vez; item com movimento (medição, requisição JSON, adicional, quantidade) bloqueia; projeto sem legado; mutações (remover checagem de movimento, de batimento, de lock).
- **UI:** relatório e botão só em EM_CONCILIACAO com `pode_aplicar`; migration ausente com mensagem clara; `confirm()`; recusas traduzidas; recarga e selo; legado/estrutura nova sem diferença.

## 8. Decisões para aprovação

| # | Decisão | Recomendação |
|---|---|---|
| G1 | Estratégia da v1 | **B — substituição controlada** (muda a regra "nunca divide" do plano: o total por código não muda, só é distribuído pelas WLs do LMS) |
| G2 | Critério de "bate" | código normalizado + unidade iguais e **soma exata** (sem tolerância); qualquer diferença bloqueia |
| G3 | Movimento | v1 **bloqueia** qualquer item antigo com quantidade operacional > 0, medição, requisição ou adicional; mostra o motivo |
| G4 | Medição de teste do ETD VARGINHA | dono decide: **excluir a medição de teste** por ação explícita (fora da migration, como o material "123" da 1.4) **ou** deixar o projeto em conciliação até a v2 |
| G5 | Itens antigos | `deleted_at` + registro em `sot_lms_conciliacao` com retrato; **nunca DELETE** |
| G6 | Permissão para aplicar | `PROJ_CONCILIAR_LMS` (já existe; inclui **administrativo**) **ou** `PROJ_CONFIRMAR_LMS` (sem administrativo, igual à estrutura nova). Recomendo **`PROJ_CONFIRMAR_LMS`** por coerência, deixando `PROJ_CONCILIAR_LMS` para a v2 |
| G7 | Reuso da regra de criação | extrair a criação da estrutura para função interna usada pela estrutura nova **e** pela conciliação (uma regra só), com teste de paridade da estrutura nova |
| G8 | Entrega | **1.6a** migration (tabela + prévia + aplicar) com testes PGlite; **1.6b** tela + testes; publicação só depois de testar no TESTE 1 — DFdfSDF |
| G9 | Importador antigo soma retirada com instalação | registrar como **tarefa separada** (afeta projetos legados fora do LMS) |

## 9. Decisões aprovadas pelo dono (12/10/2026)

- **G1** aprovada: a regra "um para um / nunca divide" do plano é substituída pela **substituição controlada por soma de código/unidade**; o total por código não muda, o sistema distribui nas WLs conforme o LMS.
- **G2** aprovada: código e unidade iguais, soma exata; qualquer diferença bloqueia.
- **G3** aprovada: item antigo com movimento bloqueia na v1, com o motivo na prévia.
- **G4 ajustada:** a medição de teste do ETD VARGINHA **não é excluída automaticamente**. Antes de qualquer conciliação desse projeto, preparar uma **ação explícita separada** (exclusão/estorno da medição de teste) para autorização do dono. Até lá o ETD VARGINHA **permanece EM_CONCILIACAO**.
- **G5** aprovada: itens antigos marcados como excluídos/inativos e substituição registrada; nunca apagados fisicamente.
- **G6** aprovada: aplicar exige **`PROJ_CONFIRMAR_LMS`** (igual à estrutura nova). `PROJ_CONCILIAR_LMS` fica registrada para refinamento futuro de permissão; nenhum perfil novo é aberto agora.
- **G7** aprovada: uma regra de criação compartilhada com a estrutura nova, com teste de paridade.
- **G8** aprovada: **1.6a** = migration (tabela + prévia + aplicar) com testes PGlite; **1.6b** = tela. Primeiro teste seguro no **TESTE 1 — DFdfSDF** (sem itens antigos).
- **G9** aprovada como **tarefa separada**; não entra na 1.6a.
