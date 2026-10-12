# Etapa 1.5b — WL no campo, na medição, nos seletores e nos cards · Diagnóstico técnico

**Status:** diagnóstico apenas. **Nada implementado.** Sem migration, `index.html`, `sw.js`, Edge, `APP_VERSAO` ou SQL de escrita.
**Branch:** `enel-etapa15b` (de `main` `e45ba32`, 8.1.217). **Data:** 12/10/2026.
**Fontes:** leitura do `index.html` (linhas desta branch), `modules/projetos/*`, `prog-projetos-shell.js`; consultas **somente leitura** em produção.

---

## 0. Ponto de partida

| Item | Estado |
|---|---|
| Produção | 8.1.217: selo no detalhe, WL/FT/KIT e 🔒 nas abas Atividades/Materiais, edição só de campos livres, bloqueio de inclusão, busca de material por `mat_id`, aviso na aba Plano |
| Ficou para a 1.5b (decisão do dono) | botão **"Aplicar estrutura"** (precisa de fonte de dados para achar a ORIGINAL pendente); selo nos **cards** da lista |
| Projetos ENEL reais com movimentação | **nenhum** (confirmado pelo dono em 11/10); referência estruturada = TESTE 1 — das123 |
| Auxiliares da 1.5a | bloco "ETAPA 1.5a" (`sotWlLinhaEstruturada`, `sotWlRotuloLinha/Html`, `sotWlOrdenarLinhas`, `sotWlCabecalhoGrupo`, `sotMatBuscarLinha`, `sotMatAcharLocal`); `sotWlCodigo` usa `_sotWlCtx` (carregado só no detalhe do projeto) |

## 1. Lançamento do campo — fluxo atual

| Peça | Onde | Situação |
|---|---|---|
| Criação ("Lançar Atividade do Campo") | `dbAbrirLancamentoAtividades` (~44679) → `dbConfirmarLancamento` (~44813) → `sbInsert('sot_lancamentos_campo')` (~44862) | **Nenhuma tela chama** a função. O seletor usa o catálogo global `servicos` (não as atividades do projeto); `_dbSessao` não tem `projeto_id` nem `ordem_id`; a ordem do Diário (`ordens_diario`) não liga a projeto. A importação "CÓDIGO ; QTD" casa por código no catálogo. Lista de conferência (`dbMostrarLancamentos`) aponta para elementos que não existem |
| Validação técnica | botão "⏳ Campo" no detalhe (~40887) → `sotRenderValidacoesCampo` (~44878) → `sotRenderListaValidacoes` (~44896) → `sotValidarLancamento` (~44934) | Acessível. Busca pendentes **de todos os projetos** (sem filtro); mostra os que têm o mesmo **código** de alguma atividade do projeto; ao aprovar soma `qtd_executada/qtd_viabilizada` na **primeira** atividade com aquele código (em projeto com WL pode ser a WL errada). Criação automática de atividade já bloqueada em projeto com WL (1.5a) |
| Tabela `sot_lancamentos_campo` | banco | **0 linhas**; colunas: tipo, codigo, descricao, qtd, qtd_aprovada, unidade, obs, servico_id, equipe_id, ordem_id, encarregado_*, data, status_validacao, obs_validacao, validado_*, criado_em, deleted_at. **Sem** projeto, atividade ou WL |
| Execução de campo que de fato acontece | PLPT diário: `plptLancarAtividade`/`plptConfirmarAtividade` (~29724/29787) e `plptLancarMaterial`/`plptConfirmarMaterial` (~29829/29897); detalhe SOT: `sotLancarExecucaoAtividade`/`sotLancarViabilidadeAtividade` (~45036/44990) | **Por id da linha** (corretos). Falta só mostrar a WL nos cabeçalhos dos modais |

## 2. Como o lançamento do campo deve vincular projeto, atividade e WL

- **Na criação:** o lançamento nasce **de uma atividade do projeto** (não do catálogo): grava `projeto_id`, `atividade_id` (id da linha) e `wl_id` (da própria atividade). O seletor lista as atividades do projeto com rótulo `código — descrição · WL x · FT · KIT`. Importação por código: aceita só código **único** no projeto; ambíguo (mais de uma linha/WL) → pede escolha ou recusa.
- **Na validação:** filtra **pelo projeto** (`projeto_id=eq.X`); aprova somando na **atividade do lançamento** (`atividade_id`), nunca pela primeira com o mesmo código; lançamento antigo sem `atividade_id` só por código **único** e legado.
- **No banco (consistência):** `wl_id` é derivado da atividade (gatilho preenche/confere) e a atividade precisa ser do mesmo projeto do lançamento — a tela não decide isso sozinha.
- **Decisão necessária (F1):** o fluxo de criação está **sem uso** (nenhuma tela o chama). Ou se **reativa** com o vínculo acima, ou se **aposenta** (a execução real já é por id no PLPT/SOT) e se corrige só a validação.

## 3. Medição — WL derivada de `atividade_id` (sem coluna nova em `sot_med_itens`)

| Onde | Hoje | Mudança |
|---|---|---|
| `sotRenderMedicaoBody` (~40227), linha do item (~40261) | código + descrição | rótulo `WL · FT · KIT` buscando a atividade por `item.atividade_id`; opcional agrupar por WL (ordem da `sot_wl`) |
| `sotAdicionarItensMedicao` (~40440), `<select>` (~40448) | `código — descrição` (linhas de mesmo código **idênticas**) | acrescentar `· WL x · FT · KIT`; opcional `<optgroup>` por WL |
| `sotSugerirItensMedicao` (~40377) | já deduplica e calcula "já medido" por `atividade_id` (correto por linha) | só rótulo; **filtrar excluídas** (`deleted_at`) — já está na tarefa separada de atividades excluídas |
`sot_med_itens.atividade_id` (texto) já liga o item à linha → WL derivada, **sem migration**. Retrato da WL no item só seria necessário se a estrutura pudesse ser reaplicada trocando linhas (não é o caso hoje: linha de WL não é apagada).

## 4. Seletores de material que precisam mostrar WL/FT/KIT

| Tela | Onde | WL disponível? | Observação |
|---|---|---|---|
| Aba **Reserva** (SOT) | `sotRenderTabReserva` (~45879), linhas ~45947–46001 | Sim (`_sotWlCtx`) | rótulo sob o código; se ordenar por WL, reordenar `window._sotReservaItensMats` (ids usam o índice) |
| Envio da requisição | `sotEnviarRequisicao` (~46064), JSON do item (~46075) | Sim | gravar `wl_id/ft/kit` no JSON do item (já tem `mat_id`) — sem migration |
| Modal de adicional na reserva | `sotAbrirModalAdicionalReserva` (~45565) | Sim | rótulo sob o código |
| PLPT "Nova reserva" (aba Campo) | `plptBuildAbaCampo` (~27430–27475) | **Não** | lê o global `sot_materiais_proj` (do detalhe SOT) → vazio/defasado no diário (bug: deveria usar `pj._materiais`) |
| PLPT diário Materiais / Baixa / modal de lançamento | ~28729–28845, `plptLancarMaterial` (~29862) | **Não** | `pj._materiais` já traz `wl_id/ft/kit`; falta carregar `sot_wl` do projeto (`pj._wls`) e o rótulo aceitar esse mapa. Telas usam índice → ordenar o próprio array |
| PLPT "Confirmar aplicação" / mapa de retirados | ~27389–27415; `plptMateriaisRetiradosMap` (~27191) | via `mat_id` | mapa chaveia por `mat_id` **e** código → retirado numa WL acende todas as linhas do código; em linha estruturada, chavear só por `mat_id` |
| Nova requisição (`sol_materiais`) | `nrmAtualizarMateriais` (~62715) | só se o projeto estiver carregado | grava só `descricao/codigo_sap` (perde `mat_id` e WL) → anexar rótulo à descrição ou coluna nova (decisão F6) |
| De Para | `sotGerarDeParaSOT` (~41091) → `plptGerarDePara` (~29480) | Sim no detalhe | acrescentar coluna WL na tabela e no texto copiado |

## 5. Telas que ainda casam por código (migrar para id da linha)

| Onde | Como casa | Risco em projeto com WL | Correção |
|---|---|---|---|
| `sotValidarLancamento` (~44934) | primeira atividade com o código | soma na WL errada | `atividade_id` (§2) |
| `sotRenderListaValidacoes` (~44896) | lançamentos de **qualquer projeto** com o mesmo código | lançamento alheio aparece | filtro por `projeto_id` (§2) |
| Enriquecimento de **adicionais** em `sotAbrirProjeto` (~39856) | `codigo_sap`/descrição | adicional de uma linha vai para a primeira do código | `sot_adicionais` sem id da linha → tarefa separada do adicional PLPT (já em andamento) |
| `sotLiberarRequisicoesAdicional` (~45663) | descrição/código | libera itens de linhas irmãs | casar por `mat_id`/`adicional_id` |
| `plptMateriaisRetiradosMap`/`plptMatRetiradoQtd` (~27191/27247) | `mat_id` **e** código | aviso "não retirado" some indevidamente | só `mat_id` em linha estruturada |
| Importação "CÓDIGO ; QTD" do lançamento (~44826) | catálogo por código | — (fluxo sem uso) | conforme F1 |
Já migrados na 1.5a: aplicação PLPT, entregue (Kanban/almoxarifado), enriquecimento de requisições, baixa, fallback da edição de material.

## 6. Botão "Aplicar estrutura" e selo nos cards (pendências da 1.5a)

- **Aplicar estrutura:** o front não lê `sot_lms_importacoes`. Proposta: RPC de leitura **`sot_lms_original_do_projeto(projeto)`** → `{importacao_id, status, modo, estado, estrutura_aplicada_em, arquivo, qtd_linhas, pode_aplicar}` (autorização `sot_lms_autorizar` **ou** `sot_lms_autorizar_confirmacao`; `pode_aplicar` só com `PROJ_CONFIRMAR_LMS`). Botão na aba 📥 LMS em `ESTRUTURA_PENDENTE`, com `confirm()`, chamada a `fn_proj_lms_aplicar_estrutura_nova` e recarga do projeto. Jornada: em projeto estruturado/pendente, não sugerir "Importar lista" (`jornada-actions.js:33`) — sugerir "Aplicar estrutura" quando pendente.
- **Selo nos cards:** listas `sotRenderProjetos` (~39683) e `coRenderProjetos` (~36641) mostram centenas de cards (≈1.400 projetos). Um selo por card exigiria uma chamada por projeto → proposta de RPC em lote **`sot_lms_estado_wl_lote(projeto_ids uuid[])`** → `{projeto_id: estado}` só dos projetos que o usuário pode ler (teto 500); placeholder no cabeçalho do card (~39783) preenchido depois de renderizar. Sem permissão: fallback por `sot_wl` (só "Estruturado (WL)").

## 7. Riscos de segurança registrados (não corrigidos aqui)

| Tabela | Situação | Consequência |
|---|---|---|
| `sot_projetos`, `sot_atividades`, `sot_materiais` | RLS sem FORCE, política "Acesso total" para **anon e authenticated**; grants inclusive **TRUNCATE** | qualquer chamada com a chave anônima lê e escreve (a proteção de WL da 1.4 cobre só linhas estruturadas) |
| `sot_lancamentos_campo` | "Acesso total" para anon/authenticated; grants completos | lançamento falso ou apagado sem login real |
| `sot_medicoes`, `sot_med_itens` | política `allow_all` para PUBLIC | medição alterável sem autenticação |
| Dependência do `anon` | login MD5 legado e sessão não restaurada usam a chave anônima | fechar o `anon` sem migrar esses usuários quebra telas |
Tratamento: **Frente S** do plano (fechar `anon` por tabela, medindo uso nos logs antes). Fora da 1.5b. Achado relacionado já registrado: `anon` não edita texto de material por causa do gatilho anti-binário (tarefa separada).

## 8. Proposta de migration mínima (1.5b) — desenho, nada criado

Arquivo único `supabase/migrations/2026101XXXXXXX_proj_wl_campo_leitura.sql`, transação explícita, idempotente, com rollback:
1. **`sot_lancamentos_campo`** (0 linhas; só se F1 = reativar):
   - `ADD COLUMN IF NOT EXISTS projeto_id uuid REFERENCES sot_projetos(id) ON DELETE CASCADE`, `atividade_id uuid REFERENCES sot_atividades(id) ON DELETE SET NULL`, `wl_id uuid REFERENCES sot_wl(id) ON DELETE RESTRICT` (nulas);
   - gatilho `BEFORE INSERT OR UPDATE`: com `atividade_id`, exige atividade **do mesmo projeto** e **preenche `wl_id` da atividade** (o cliente não escolhe a WL); `wl_id` sem `atividade_id` recusado;
   - índice `(projeto_id, status_validacao)`; política/grants **inalterados** (risco do §7 continua registrado).
2. **`sot_lms_original_do_projeto(uuid)`** — `SECURITY DEFINER`, só leitura, `authenticated`.
3. **`sot_lms_estado_wl_lote(uuid[])`** — `SECURITY DEFINER`, só leitura, `authenticated`, reusa `sot_lms_estado_wl_calc` (regra canônica, sem duplicar).
Sem coluna nova em `sot_med_itens` (WL derivada da atividade). Sem tocar TMA, programação, estoque.

## 9. Testes PGlite necessários (migration)
- Estáticos: transação, idempotência, rollback, sem GRANT para anon/PUBLIC nas RPCs, `SECURITY DEFINER` com `search_path`, só leitura nas RPCs.
- `sot_lancamentos_campo`: atividade de outro projeto recusada; `wl_id` preenchido pela atividade (cliente mandando WL diferente é sobrescrito/recusado); `wl_id` sem atividade recusado; atividade legada → `wl_id` nulo; exclusão do projeto em cascata; colunas nulas não quebram INSERT legado (paridade antes × depois como anon e authenticated).
- `sot_lms_original_do_projeto`: matriz de permissão (gestor, administrativo, supervisor, anon, inativo), projeto sem ORIGINAL → nulo, `pode_aplicar` só com `PROJ_CONFIRMAR_LMS`, campos sensíveis (storage) **não** expostos.
- `sot_lms_estado_wl_lote`: só projetos legíveis aparecem; teto; estados corretos (legado, conciliação, pendente, estruturado); mesma regra de `sot_lms_estado_wl_calc`.
- Mutação: remover a checagem de projeto da atividade; deixar o cliente escolher a WL; RPC expondo projeto sem permissão.

## 10. Testes de UI necessários
- Botão "Aplicar estrutura": visível só em `ESTRUTURA_PENDENTE` com permissão; `confirm()`; sucesso recarrega; recusas traduzidas (`PROJETO_COM_LEGADO`, `LINHA_NAO_CLASSIFICADA`, `LINHAS_REPETIDAS_NA_CHAVE`, `SEM_PERMISSAO`); nunca chama sem confirmação.
- Selo nos cards: uma chamada em lote por lista; placeholder preenchido; sem permissão → fallback; legado sem selo verde.
- Lançamento do campo (se reativado): seletor só com atividades do projeto e rótulo WL; grava `projeto_id/atividade_id`; importação por código recusa ambíguo; validação filtra por projeto e soma na atividade do lançamento.
- Medição: rótulo WL nas linhas e no `<select>`; itens de mesmo código distinguíveis.
- Seletores: rótulo WL na Reserva, adicional, De Para e PLPT diário (com `sot_wl` do projeto carregado); JSON da requisição com `wl_id/ft/kit`; mapa de retirados por `mat_id` em linha estruturada.
- Jornada: não sugere "Importar lista" em projeto estruturado/pendente.
- Paridade: projeto legado sem nenhuma diferença visual/funcional.

## 11. Fora de escopo
- Conciliação (1.6), revisões do LMS (SUBSTITUTIVA etc.), status DESCARTADA.
- Fechar `anon` / Frente S (só registrado no §7).
- Coluna nova em `sot_med_itens` (WL derivada) e em `sol_materiais` (salvo decisão F6).
- Paginação dos cards; Programação de Projetos (não lista linhas — nada a fazer); TMA.
- Correções já em tarefas separadas: adicional PLPT, atividades excluídas, reserva PLPT/plano.

## 12. Decisões para aprovação

| # | Decisão | Recomendação |
|---|---|---|
| F1 | Lançamento do campo: **reativar** com projeto/atividade/WL (migration §8.1) ou **aposentar** a criação e só corrigir a validação | **Aposentar a criação** agora (sem uso; execução real já é por id no PLPT/SOT) e corrigir a validação por projeto; reativar só se houver demanda — sem migration em `sot_lancamentos_campo` por enquanto |
| F2 | RPC `sot_lms_original_do_projeto` + botão "Aplicar estrutura" | **Sim** (prioridade da 1.5b) |
| F3 | RPC em lote `sot_lms_estado_wl_lote` + selo nos cards | **Sim** |
| F4 | Medição com WL derivada de `atividade_id`, sem coluna nova | **Sim** |
| F5 | Rótulo WL nos seletores (Reserva, adicional, De Para, PLPT diário com `sot_wl` carregado) + `wl_id/ft/kit` no JSON da requisição | **Sim** |
| F6 | Nova requisição (`sol_materiais`): rótulo WL na descrição (sem migration) ou coluna nova | **Rótulo na descrição** por ora |
| F7 | Mapa de retirados e liberação de adicional por `mat_id` em linha estruturada | **Sim** |
| F8 | Jornada sem sugerir "Importar lista" em projeto estruturado/pendente | **Sim** |
| F9 | Entrega em duas partes: **1.5b-1** (migration de leitura F2/F3 + botão + cards) e **1.5b-2** (medição, seletores, PLPT diário, validação, Jornada — só `index.html`) | **Sim** |
