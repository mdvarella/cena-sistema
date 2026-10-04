# Jornada de Projetos — auditoria

**Data:** 04/10/2026  
**Base:** `feature/jornada-projetos` em `4ae5f80` (ERP 8.1.199)  
**Escopo:** arquitetura e mapeamento. Nenhuma migration, nenhuma alteração de código, nenhum dado gravado.  
**Fontes:** `index.html`, `prog-projetos-shell.js`, `supabase/migrations` e leitura do Supabase (`qxexyghcennllrmjqafg`) em 04/10/2026.

A Jornada é uma camada de orquestração sobre Projetos de Obras. Projetos de Obras continua sendo o módulo mestre. A Jornada não substitui cadastro, atividades, materiais, programação, campo, medição nem faturamento.

---

## A. Arquitetura atual

O ERP é um monólito modular: a regra de Projetos de Obras vive em `index.html`. Fora dele, só o casco da página de programação (`prog-projetos-shell.js`) e o módulo `modules/frotas/pedagios/`.

Dois níveis de tela:

| Nível | Onde | Função |
|---|---|---|
| Lista por contrato | `#pg-obras-projetos`, menu Operacional → Projetos de Obras | `showPage('obras-projetos')` → `projMostrarTab` → `coAbrirContrato` |
| Detalhe do projeto | `#co-proj-lista` ou `#sot-lista-projetos` | `sotAbrirProjeto` → `sotRenderDetalhe` |

Abas reais do detalhe (`sotMostrarTab`): Atividades, Materiais, Reservar Materiais, Resumo, Plano de Execução, Documentos, Adicional, Medições, Campo. Dados do projeto e Histórico são cards do cabeçalho, não abas.

Programação de Projetos é outra página: `#pg-programacao-projetos`, `progProjInit`, motor `progProjetoCore*`. Ela usa a tabela `equipes`. A Programação TMA (`progTma*`, `equipes_disp`, `programacao-equipes`) é outro fluxo. A Jornada não entra nela.

Não existe hoje um resolvedor de processo. A decisão está espalhada em `isContratoPLPT`, `isContratoObras`, `contratoTemFluxoProjeto`, `familia`, `CONTRATOS_UUID_MAP` e `_isContratoEquatorial`.

---

## B. Mapa das 19 etapas de referência

A lista abaixo é a referência de negócio, não uma cronologia universal. A coluna "Onde está hoje" diz o que o código já faz.

| # | Etapa de referência | Onde está hoje | Dado que prova |
|---|---|---|---|
| 1 | Cadastro do projeto | `sotSalvarProjeto` → `sot_projetos` | linha do projeto |
| 2 | Importação do croqui | `sotModalProjeto`, `sotAnalisarCroquiIA` | `croqui_url` |
| 3 | Importação de materiais e MO | `sotImportarAtividades`, `sotImportarMateriais` | `sot_atividades`, `sot_materiais` |
| 4 | Programação da viabilidade | status SOT `Em viabilidade` / PLPT `VIABILIDADE PROGRAMA` | `sot_projetos.status` |
| 5 | Solicitações do cliente | status `Aguardando cliente`; adicionais `sot_adicionais` | status + adicionais |
| 6 | Regularização dos ajustes | aprovação de adicional (`plptAprovarAdicional`); PLPT `CORREÇÃO CONSTRUTIVA` | status do adicional |
| 7 | Programação da execução | `plpt_prog_dia` + `plpt_prog_projetos`; quadro `progProjetoCore*` | linha de programação |
| 8 | Descrição das atividades | `sot_atividades.descricao` | atividades |
| 9 | Requisição de materiais | aba Reservar → `sotEnviarRequisicao` → `plpt_requisicoes_materiais` | requisição |
| 10 | Programação da equipe/data | mesma programação do item 7 (`composicao_dia` + `plpt_prog_projetos`) | equipe + data |
| 11 | Equipe inicia a atividade | diário `plpt_sessoes` / `plpt_lancamentos`; `qtd_executada` | lançamento ou quantidade |
| 12 | Relatório e baixas de campo | `sotAnalisarRelatorio`; `campo_baixas_materiais`; `mov_sap` | baixa / relatório |
| 13 | Aprovação para medição | `sot_atividades.qtd_medida`; status `Em medição` | quantidades |
| 14 | Sugestão de itens da medição | `sotSugerirItensMedicao` | itens sugeridos na hora |
| 15 | Conferência técnica (materiais, retornos, CENA, SAP) | saldos em `sot_materiais` e `alm_movimentos` | **não há status de conferência** |
| 16 | Medição parcial enviada | `sot_medicoes` status `em_aprovacao` | medição |
| 17 | Medição validada | status `aprovado` | medição |
| 18 | Boletim recebido | status PLPT `AGUARDANDO BOLETIM` | **não há campo de boletim** |
| 19 | NF emitida | `sotRegistrarNF` → status `nf_emitida`, campos `nfs`, `data_nf`, `valor_nf` | medição |

Itens 7 e 10 são a mesma programação no sistema. Itens 15 e 18 não têm registro próprio.

---

## C. Fluxo atual real

Há dois vocabulários de status gravados na **mesma** coluna `sot_projetos.status`.

**SOT** (`SOT_STATUS_LIST`): Recebido, Em análise, Em viabilidade, Viabilizado apto, Viabilizado não apto, Aguardando cliente, Aguardando material, Programado, Em execução, Executado, Em medição, Medido, Faturado, Cancelado.

**PLPT** (`PLPT_ESTEIRA`), usado quando `isContratoPLPT` ou o status atual já é um status PLPT:

| Fase da esteira | Status |
|---|---|
| Projeto | PROJETO, FALTA VIABILIZAR, VIABILIDADE PROGRAMA, EM VIABILIDADE, APTO, DEV PROJ, CRIAR PEP, NÃO APTA, EXPURGO |
| Planejamento | LIBERAR MATERIAL, APTA PARA PROGRAMAR, PLANEJADA, REPLANEJAR, CONCLUIDA, CORREÇÃO CONSTRUTIVA |
| Execução | AGUARDANDO INÍCIO, EM EXECUÇÃO, EXECUTADO, PARALISADA, AGUARDANDO MATERIAL |
| Medição | AS BUILT, EM MEDIÇÃO, MEDIÇÃO ENVIADA, CORREÇÃO DE MEDIÇÃO, AGUARDANDO BOLETIM, OBRA FATURADA |
| Faturamento | AGUARDANDO FATURA, FATURA EMITIDA, FATURADO, CANCELADO |

`sotAlterarStatus` escolhe a esteira PLPT ou a lista SOT. AS BUILT é um status da fase Medição da esteira PLPT e também um tipo de documento (`As-built` em `SOT_TIPOS_DOC`). Não existe tabela `as_built`.

**O que o banco mostra em 04/10/2026:** a esteira PLPT quase não é usada. Dos 1.357 projetos do contrato PLPT TERESINA, 1.352 estão com status `Recebido` (vocabulário SOT). Só 1 está em `VIABILIDADE PROGRAMA`. A Jornada não pode tratar `sot_projetos.status` como a etapa real do PLPT.

Medição tem o próprio ciclo, independente do status do projeto: `rascunho` → `em_aprovacao` → `aprovado` → `emissao_liberada` → `nf_emitida`.

---

## D. Estruturas existentes

DDL de criação dessas tabelas não está nas migrations do repositório. O que segue é coluna real (information_schema ou uso no código) e papel.

### `sot_projetos`

Papel: mestre do projeto. Chave `id`. Liga ao contrato por `contrato_id` (texto). Campos úteis à Jornada: `cliente_id`, `cliente`, `codigo_cliente`, `nome`, `status`, `croqui_url`, `plano_execucao`, `valor_previsto`, `valor_viabilizado`, `valor_executado`, `valor_medido`, `valor_faturado`, `data_recebimento`, `prazo_previsto`, `relatorio_obras`.

Não existem colunas `processo`, `modalidade`, `percentual`, `perfil_processo_id`, `perfil_processo_versao` nem `ciclo_execucao_id`. O percentual da tela é calculado na hora: valor executado das atividades dividido pelo valor previsto (`#sot-pct-exec`).

### `sot_atividades`

Papel: mão de obra / serviços do projeto. Chave `projeto_id`. Quantidades `qtd_prevista`, `qtd_viabilizada`, `qtd_executada`, `qtd_medida`, `qtd_faturada`. Status vistos no código: `pendente`, `em_execucao`, `executada`, `executada_parcial`, `cancelada`, `divergente`. Sem equipe e sem data de execução na linha; a data fica no diário e na programação.

### `sot_materiais`

Papel: lista de materiais do projeto. Chave `projeto_id`. Quantidades projetada, viabilizada, requisitada, entregue, aplicada, devolvida e `qtd_processada_sap`. Sem status próprio. Amarração com requisição por código SAP / descrição, não por `atividade_id`.

### `sot_documentos`

Papel: anexos. Chave `projeto_id`. Campo `tipo` (inclui `As-built` e `Documento de medição`). Sem gate de aprovação.

### `sot_adicionais`

Papel: pedido extra de material ou atividade. Chave `projeto_id`. Status vistos: `pendente`, `aprovado`. A tela de adicionais do SOT chama as mesmas funções `plptSalvarAdicional` / `plptAprovarAdicional`. Não há workflow separado de adicional ENEL.

### `sot_projetos_historico`

Papel: troca de status. Campos `projeto_id`, `status_anterior`, `status_novo`, observação, usuário, `criado_em`. É o histórico cronológico de status, não das 19 etapas.

### `sot_medicoes` e `sot_med_itens`

Papel: parcial de medição. Medição: `projeto_id`, `numero`, `status`, datas (`data_corte`, `data_envio`, `data_aprovacao`, `data_emissao`, `data_nf`), `nfs`, `valor_nf`, `valor_total`. Item: `medicao_id`, `projeto_id`, `atividade_id`, quantidades e valores. Não há `ciclo_execucao_id` nem campo de boletim.

### `plpt_prog_dia` e `plpt_prog_projetos`

Papel: programação do dia. Dia: `equipe_id`, `contrato_id`, `data`, encarregado, veículo, status `programado`. Projeto do dia: `prog_dia_id`, `projeto_id`, `ordem`, status `pendente`. Liga projeto + equipe + data.

### `plpt_requisicoes_materiais`

Papel: requisição da equipe no dia. Campos `projeto_id`, `equipe_id`, `data`, `status`, `itens` (JSON). Status vistos: Aguardando aprovação, Adicional pendente de aprovação, Aprovada, Separação, Aguardando confirmação almox, Em campo, Devolvida, Aguardando devolução, Aplicação confirmada, Reprovada, Excluída. Sem `atividade_id`.

### `composicao_dia`

Papel: quem está na equipe naquele dia. Campo `projeto_ids` (JSON) aponta projetos. Usada pela Programação de Projetos e pela portaria. A Jornada só lê. Não grava e não usa `equipes_disp`.

### Diário e baixas

| Tabela | Papel | Liga a |
|---|---|---|
| `plpt_sessoes` | turno da equipe (login, almoço, logout, km) | equipe + data |
| `plpt_sessoes_dia` | sessão ligada ao dia programado | `prog_dia_id` |
| `plpt_lancamentos` | etapa lançada no diário | `projeto_id`, equipe, data |
| `execucoes_obra` | ponte ao encerrar ordem, `origem = 'PLPT'` | `projeto_id`, data, `status_exec` |
| `campo_baixas_materiais` | baixa confirmada | equipe, data, material; `mov_sap_id` |
| `mov_sap` | movimento SAP, pode ter `projeto_id` | projeto, equipe, baixa |
| `alm_movimentos` | saldo SAP por contrato, cruzado por `codigo_sap` | contrato, não atividade |

### `PLPT_ESTEIRA`

Objeto JavaScript, não tabela. Os status persistem em `sot_projetos.status`.

### `projetos_obra`

Legado de contratos sem fluxo SOT. Fora do desenho da Jornada na Fase 1.

---

## E. Mapa Cliente → Contrato → Processo

Lido em `contratos` (campo texto `cliente`, sem FK para `clientes`) cruzado com `sot_projetos` ativos.

| Código | Contrato | Cliente no cadastro | Projetos ativos | Processo no código hoje |
|---|---|---|---|---|
| PLPT | PLPT TERESINA | EQUATORIAL | 1.357 | esteira `PLPT_ESTEIRA` via `isContratoPLPT` |
| 4600003971 | RDSE | ENEL | 8 | status SOT |
| 4600003872 | RDSC | ENEL | 1 | status SOT |
| 4600004484 | RDSE NOVO | ENEL | 0 | status SOT (aba própria) |
| 4600004482 | RDSC NOVO | ENEL | 0 | status SOT (aba própria) |
| 4600004206 | SOT OBRAS | ENEL | 3 | status SOT |
| 4600003478 | ETD | ENEL | 0 | fluxo projeto por código |
| 4600003913 | BT0 | ENEL | 0 | lista de obras |
| 4600003817 | OUTFIT | ENEL | 0 | lista de obras |
| 4600004043 | AUTOMAÇÃO CT | ENEL | 0 | lista de obras |
| 4600004208 | TMA OESTE | ENEL | 1 | fluxo de OS, fora da Jornada |
| CW35964 | COMGAS CAMPINAS | COMGAS | 0 | aba de obras; sem projeto SOT |
| 46300010125 | CTEEP ROÇADA | ISA CTEEP | 0 | aba de obras; sem projeto SOT |
| 1 | OBRAS PARTICULARES | VARIADOS | 0 | lista de obras |

PLPT não é ENEL. No cadastro, PLPT TERESINA está com cliente EQUATORIAL. RDSE, RDSC, RDSE NOVO e RDSC NOVO estão com cliente ENEL.

Sinais reais no PLPT (1.357 projetos): 1.356 com atividade, 4 com `croqui_url`, 0 com plano de execução, 2 com quantidade executada, 2 com material, 0 requisições, 5 programações, 0 medições. O acervo está na etapa de lista importada. O status `Recebido` não descreve isso sozinho.

No RDSE há 3 medições em 2 projetos. O projeto `DAC/S.SUL.22.00031` tem a parcial 1 com NF emitida em 28/05/2026 e a parcial 2 em rascunho, e o projeto continua `Em execução`. Esse é o caso real de "NF não encerra a obra".

---

## F. Matriz de processos

Valores: COMUM, ESPECÍFICA, MUDA ORDEM, MUDA NOME, MUDA GATE, NÃO APLICÁVEL, A VALIDAR.

| Etapa | BASE | EQUATORIAL / PLPT | ENEL / RDSE | ENEL / RDSC | COMGÁS | CTEEP |
|---|---|---|---|---|---|---|
| Cadastro | COMUM | COMUM | COMUM | COMUM | A VALIDAR | A VALIDAR |
| Croqui | COMUM | COMUM (quase sem uso no acervo) | COMUM | A VALIDAR | A VALIDAR | A VALIDAR |
| Materiais e MO | COMUM | COMUM | COMUM | A VALIDAR | A VALIDAR | A VALIDAR |
| Viabilidade | COMUM | MUDA NOME (`FALTA VIABILIZAR`, `VIABILIDADE PROGRAMA`, `EM VIABILIDADE`, `APTO`) | COMUM (`Em viabilidade`) | A VALIDAR | A VALIDAR | A VALIDAR |
| Ajuste do cliente | COMUM | ESPECÍFICA no discurso de negócio (AS BUILT); no código o adicional é o mesmo `plpt*` | COMUM (adicional `sot_adicionais`) | A VALIDAR | A VALIDAR | A VALIDAR |
| Programação | COMUM | COMUM (`plpt_prog_*`) | COMUM | A VALIDAR | A VALIDAR | A VALIDAR |
| Requisição | COMUM | COMUM | COMUM | A VALIDAR | A VALIDAR | A VALIDAR |
| Campo / diário | COMUM | COMUM (diário PLPT é o diário de projetos) | COMUM | A VALIDAR | A VALIDAR | A VALIDAR |
| Conferência técnica | A VALIDAR | A VALIDAR | A VALIDAR | A VALIDAR | A VALIDAR | A VALIDAR |
| AS BUILT | NÃO APLICÁVEL | ESPECÍFICA (status da esteira + tipo de documento) | A VALIDAR | A VALIDAR | A VALIDAR | A VALIDAR |
| Medição parcial | COMUM | MUDA NOME (`EM MEDIÇÃO`, `MEDIÇÃO ENVIADA`, `CORREÇÃO DE MEDIÇÃO`) | COMUM (`sot_medicoes`; é o único com parcial no banco) | A VALIDAR | A VALIDAR | A VALIDAR |
| Boletim | A VALIDAR | MUDA NOME (`AGUARDANDO BOLETIM`, sem campo) | A VALIDAR (sem campo) | A VALIDAR | A VALIDAR | A VALIDAR |
| NF | COMUM | MUDA NOME (`AGUARDANDO FATURA`, `FATURA EMITIDA`, `FATURADO`) | COMUM (`nf_emitida`) | A VALIDAR | A VALIDAR | A VALIDAR |
| Encerramento | A VALIDAR | ESPECÍFICA no nome (`OBRA FATURADA` na fase Medição e `FATURADO` na fase Faturamento) | A VALIDAR (`Faturado` da lista SOT não distingue parcial de obra fechada) | A VALIDAR | A VALIDAR | A VALIDAR |

COMGÁS e CTEEP têm contrato e aba, e zero projetos em `sot_projetos`. SESMT de COMGÁS e de ENEL é outro módulo (`comgas_*`, `enel_*`) e não entra na Jornada.

---

## G. Perfil BASE_PROJETOS

Macrofases comuns, derivadas de dados, não de um status copiado:

| Macrofase | Concluída quando |
|---|---|
| Preparação | projeto existe; croqui e lista são sinais, não trava (o acervo tem lista sem croqui) |
| Viabilidade | `qtd_viabilizada` preenchida ou status de viabilidade |
| Planejamento | atividade com descrição e, quando houver, material |
| Programação | linha em `plpt_prog_projetos` ou `composicao_dia.projeto_ids` |
| Materiais | requisição existente, ou explícito "sem requisição" |
| Campo | `qtd_executada > 0` ou lançamento no diário |
| Conferência | A VALIDAR — sem status próprio |
| Medição | existe `sot_medicoes` |
| Faturamento | medição `nf_emitida` (da parcial, não do projeto) |
| Encerramento | A VALIDAR — não inferir só pela NF |

Status de etapa na UI: não iniciada, em andamento, aguardando terceiro, concluída, pendência, bloqueada, não aplicável. Na Fase 1 saem do cálculo. "Aguardando terceiro" só quando o status atual for `Aguardando cliente` ou `AGUARDANDO BOLETIM`. Conferência fica "não aplicável" até o negócio definir o gate.

---

## H. EQUATORIAL_PLPT

Identidade comprovada: `contratos.cliente = EQUATORIAL` e código ou nome do contrato contém `PLPT`. UUID conhecido: `430df4d5-6d0a-459f-ae82-92546ff9e57f` (PLPT TERESINA). A identidade da Fase 1 usa o cadastro do contrato carregado em memória. O UUID fica como conferência, não como única chave.

O que a esteira acrescenta em relação ao BASE, já escrito em `PLPT_ESTEIRA`:

- nomes próprios de viabilidade, planejamento e medição;
- AS BUILT como etapa de medição, não como adicional ENEL;
- boletim como status `AGUARDANDO BOLETIM`, sem documento de boletim;
- dois nomes de fim (`OBRA FATURADA` e `FATURADO`) cuja diferença está A VALIDAR.

Limite: 1.352 projetos PLPT estão em `Recebido`. O perfil PLPT mostra os nomes da esteira quando o status atual for um status PLPT. Nos demais, mostra as macrofases do BASE calculadas pelos dados, com o rótulo do perfil EQUATORIAL_PLPT.

---

## I. ENEL

Contratos com cliente ENEL e aba de obra: RDSE, RDSC, RDSE NOVO, RDSC NOVO, SOT OBRAS, ETD, BT0, OUTFIT, AUTOMAÇÃO CT. TMA OESTE também é cliente ENEL e fica de fora (fluxo de OS).

O que está comprovado:

- usam `sot_projetos` e a lista `SOT_STATUS_LIST`;
- RDSE tem medição parcial de verdade, inclusive NF com o projeto ainda em execução;
- adicionais, requisição e diário reutilizam funções com prefixo `plpt*`, sem regra ENEL separada no código de obra;
- não há `if (cliente === 'ENEL')` no fluxo de obra.

O que fica A VALIDAR COM NEGÓCIO, e por isso a Fase 1 não cria `ENEL_RDSE`, `ENEL_RDSC` nem `ENEL_RDSE_NOVO`:

- adicionais e ajustes de projeto próprios;
- SAP como gate;
- documentos e aprovações diferentes do BASE;
- boletim;
- regra de encerramento da obra.

Esses contratos recebem `BASE_PROJETOS`. A tela mostra o cliente e o nome do contrato lidos do cadastro, e um aviso de que o processo específico está por validar.

---

## J. COMGÁS

Contrato COMGAS CAMPINAS, cliente COMGAS, zero projetos SOT. Existe aba, família visual `comgas` e módulo SESMT próprio. Não há esteira, boletim, medição nem documento de obra específico no código de Projetos.

Fase 1: `BASE_PROJETOS` quando surgir um projeto nesse contrato. Processo COMGÁS de obra: A VALIDAR COM NEGÓCIO. Não copiar fluxo ENEL nem PLPT.

---

## K. CTEEP

Contrato CTEEP ROÇADA, cliente ISA CTEEP, zero projetos SOT. Aba e família visual `cteep`. Croqui IA reconhece o cliente pelo cadastro (`ISA CTEEP` / `CTEEP`). Sem esteira própria.

Fase 1: `BASE_PROJETOS`. Processo CTEEP: A VALIDAR COM NEGÓCIO.

---

## L. Ciclo de execução

O modelo pedido (vários ciclos, cada um com programação, campo, parcial e NF) não tem tabela.

Dá para aproximar com o que existe:

- cada linha de `plpt_prog_projetos` é uma ida à programação;
- cada `sot_medicoes.numero` é uma parcial;
- o diário liga execução a `projeto_id` + data + equipe.

Não dá para afirmar que a programação N gerou a parcial N. Não há chave entre as duas. A Fase 1 lista as programações e as parciais em separado, sem numerar "Ciclo 01". Criar `ciclo_execucao_id` é gap de migration, fora desta fase.

---

## M. Múltiplas medições

Comprovado no RDSE: o mesmo projeto tem a parcial 1 em `nf_emitida` e a parcial 2 em `rascunho`, com `sot_projetos.status = Em execução`.

A Jornada mostra duas coisas distintas:

- situação do projeto (macrofases e percentual);
- situação de cada parcial (`sot_medicoes.status`, número, NF).

NF emitida atualiza a parcial. Não muda sozinha o projeto para concluído.

---

## N. Conclusão do projeto

Não há regra única no código que diga "obra 100% concluída". `Faturado` e `OBRA FATURADA` são status manuais. O percentual é financeiro (executado / previsto das atividades) e não olha devolução, adicional, conferência nem boletim.

Sinais que existem e a Fase 1 pode mostrar, sem concluir a obra:

- atividades com `qtd_executada` contra `qtd_prevista`;
- atividades com `qtd_medida` e `qtd_faturada`;
- materiais com aplicada, devolvida e processada no SAP;
- parciais e quais têm NF;
- status manual atual.

Regra de "100% concluída": A VALIDAR COM NEGÓCIO. A Fase 1 não grava encerramento.

---

## O. Gaps que a Fase 1 resolve sem banco

- Perfil do projeto, calculado na hora a partir do contrato já carregado.
- Macrofases e próxima ação, calculadas de tabelas que o detalhe já busca.
- Aba Jornada no detalhe, como primeira aba, sem tirar as outras.
- Deep link para programação de projetos, reserva, medição, documentos e campo.
- Lista de parciais ao lado do status do projeto.
- Percentual já calculado hoje em `sotRenderDetalhe`.
- Aviso "processo específico a validar" para quem não for BASE nem EQUATORIAL_PLPT.

---

## P. Gaps que exigem migration (não fazer agora)

| Gap | Por quê |
|---|---|
| `perfil_processo_id` e `perfil_processo_versao` no projeto ou no contrato | hoje o perfil é inferido; versão de processo não tem onde morar |
| `ciclo_execucao_id` ligando programação, diário, requisição e medição | sem isso o ciclo é uma lista, não um agrupamento |
| `atividade_id` na requisição | a requisição é do projeto, não da atividade |
| campo de boletim do cliente (número, data, anexo) | só existe o status `AGUARDANDO BOLETIM` |
| status de conferência técnica | não há coluna nem tabela |
| vínculo explícito medição ↔ ciclo | a parcial só aponta `projeto_id` |
| cliente do contrato como FK | `contratos.cliente` é texto livre |

Nada disso entra na Fase 1.

---

## Q. Riscos

- Tratar `sot_projetos.status` como verdade no PLPT esconde 1.352 projetos parados em `Recebido`. A Jornada calcula por dados e usa o status só como rótulo.
- `_isContratoEquatorial` considera os códigos `RDSE` e `RDSC` como Equatorial (lista `_EQTL_CONTRATO_CODIGOS`). A Jornada não usa essa função.
- `CONTRATOS_UUID_MAP` tem comentário trocado (`4600003478` no comentário de fluxo fala em TMA; no banco esse código é ETD, e o TMA é `4600004208`). A Jornada não copia esse mapa.
- `contratoUUID` aceita substring (`indexOf`). Um resolvedor novo não faz isso.
- Adicional ENEL e AS BUILT PLPT passam pelas mesmas funções `plpt*`. Reaproveitar esse fluxo como se fosse o processo PLPT misturaria os dois. A VALIDAR antes de qualquer ação automática de AS BUILT.
- Deep link de programação hoje não tem função pronta com `contrato_id` + `projeto_id` + data. Dá para montar com `#pp-cont`, `#pp-data`, `_pp.projetoIds` e `progProjMudarContrato`, sem chamar TMA.
- `showPage('obras-projetos')` abre a aba TMA por padrão. A Jornada, a partir do detalhe já aberto, não depende disso.
- Croqui não é gate real no acervo (4 de 1.357). Travar a próxima ação em "importar croqui" esconderia o resto. Croqui entra como pendência, não como bloqueio, até o negócio confirmar.

---

## R. Arquivos propostos

Novos, no padrão de `modules/frotas/pedagios/`:

| Arquivo | Responsabilidade |
|---|---|
| `modules/projetos/jornada/jornada-profiles.js` | definição de `BASE_PROJETOS` e `EQUATORIAL_PLPT` (fases, nomes, gates, versão lógica `v1` em constante) |
| `modules/projetos/jornada/jornada-resolver.js` | `jornadaResolverPerfil(projeto, contrato)` |
| `modules/projetos/jornada/jornada-state.js` | lê os arrays já carregados e devolve macrofases, percentual, parciais, pendências |
| `modules/projetos/jornada/jornada-actions.js` | `jornadaObterProximaAcao` e a navegação |
| `modules/projetos/jornada/jornada-ui.js` | HTML da aba |
| `modules/projetos/jornada/jornada.js` | `jornadaRender(projeto)`, único ponto chamado pelo detalhe |

Toque mínimo em arquivo existente:

| Arquivo | Toque |
|---|---|
| `index.html` | cinco `<script src="modules/projetos/jornada/...?v=">`; um botão de aba "Jornada" em `sotRenderDetalhe`; um ramo em `sotMostrarTab` |
| `sw.js` | incluir os seis arquivos no precache, no mesmo padrão de `prog-projetos-shell.js` |
| `tests/jornada-resolver.test.js` | perfil a partir de contrato fixture |
| `tests/jornada-state.test.js` | macrofase, parcial com NF e projeto ainda aberto, próxima ação |

Sem migration, sem RLS, sem mudança em `progTma*`, `equipes_disp`, medição, status ou dados.

---

## S. Plano de implementação

Fase 1 só depois de aprovação. Versão do ERP só sobe quando o código entrar (`APP_VERSAO`, `SW_VERSION`, `?v=` e changelog). Esta auditoria não muda versão.

Ordem sugerida:

1. Perfis e resolvedor, com teste, sem tela.
2. Estado derivado e próxima ação, com teste no caso RDSE da NF (parcial emitida e projeto aberto) e no caso PLPT `Recebido` com atividades.
3. Aba no detalhe e deep links.
4. Homologação num projeto PLPT e num projeto RDSE já existentes, só leitura de tela.

Fora desta fase: esconder "Projetos de Obras" do menu, virar a Jornada a porta de entrada, perfis ENEL/COMGÁS/CTEEP, tabela de ciclo, boletim, conferência técnica, gravação de perfil/versão.

---

## Proposta da Fase 1 (aguardando aprovação)

**Nome:** Módulo Jornada de Projetos — Fase 1.

**Perfis:** `BASE_PROJETOS` v1 e `EQUATORIAL_PLPT` v1. ENEL, COMGÁS e CTEEP ficam no BASE, com aviso "A VALIDAR COM NEGÓCIO".

**Resolvedor, nesta ordem:**

1. configuração específica do contrato — não existe coluna; fica no código como ponto futuro, sem efeito agora;
2. contrato carregado em memória cujo `cliente` normalizado é `EQUATORIAL` e cujo código ou nome tem `PLPT` como palavra → `EQUATORIAL_PLPT`;
3. qualquer outro projeto SOT → `BASE_PROJETOS`.

Sem `indexOf` genérico. Sem `_isContratoEquatorial`. Sem UUID como única chave.

**Estado:** funções puras sobre o projeto e as listas que `sotAbrirProjeto` já trouxe (`sot_atividades`, `sot_materiais`, `sot_medicoes`, `sot_adicionais`, programação e requisições se já estiverem em memória; se a programação não vier no detalhe, a Fase 1 busca `plpt_prog_projetos` daquele `projeto_id`, leitura).

**Próxima ação** (`jornadaObterProximaAcao`), primeira que couber:

| Situação | id | Para onde vai |
|---|---|---|
| sem atividade | `importar_lista` | `sotImportarAtividades` |
| sem programação e sem execução | `programar_execucao` | Programação de Projetos com contrato, projeto e data de hoje |
| execução sem requisição e com material previsto | `criar_requisicao` | `sotMostrarTab('reserva')` |
| quantidade executada ainda não medida | `criar_parcial` | `sotMostrarTab('medicao')` |
| parcial em rascunho ou em aprovação | `avancar_medicao` | aba Medições |
| parcial aprovada sem NF | `emitir_nf` | `sotRegistrarNF` se a tela já oferecer; senão a aba Medições |
| NF emitida e ainda há quantidade prevista sem executar | `continuar_execucao` | Programação de Projetos |
| status `Aguardando cliente` ou `AGUARDANDO BOLETIM` | `aguardar_terceiro` | nenhuma tela; a ação fica informativa |
| status PLPT exatamente anterior a AS BUILT | `criar_as_built` | aba Documentos, tipo As-built, **sem** mudar status sozinho |

Cada ação devolve `id`, `label`, `responsavel`, `estado`, `origem`, `destino`, `bloqueios`. Croqui ausente é pendência, não a próxima ação obrigatória.

**Aba:** primeira em `sotRenderDetalhe`, rótulo "Jornada". As abas atuais permanecem. Projetos de Obras permanece no menu.

**Testes:** resolver (Equatorial+PLPT, ENEL+RDSE, COMGAS, CTEEP, TMA não entra) e estado (NF não conclui; PLPT Recebido com atividade não fica "não iniciado" na preparação).

**Rollback:** apagar `modules/projetos/jornada/` e reverter o trecho da aba em `index.html` e o precache em `sw.js`.

**Não entra:** migration, TMA, regra financeira, gravação de status, conclusão automática, perfis ENEL/COMGÁS/CTEEP.
