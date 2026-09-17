# ROADMAP MESTRE --- ERP CENA

**Atualizado em:** 17/09/2026  
**Versão atual do sistema:** `8.1.059` (17/09/2026, build `20260917-1652`)  
**Arquivo oficial:** `ROADMAP_CENA.md` na raiz do ERP (não gravar cópia `*_ATUALIZADO` nesta pasta).

**Objetivo:** fonte única de verdade para desenvolvimento, testes e
homologação do ERP CENA.

## Status

-   🔴 NÃO INICIADO
-   🔵 PRÓXIMA FASE
-   🟡 EM DESENVOLVIMENTO
-   🟠 HOMOLOGAÇÃO
-   🟢 CONCLUÍDO
-   ⏸ PAUSADO

> **REGRA CRÍTICA:** CONCLUÍDO significa implementado, testado pelo
> usuário e homologado. Código criado pelo Cursor, sozinho, não encerra
> uma fase.

> **MANUTENÇÃO:** a cada versão (`APP_VERSAO` em `index.html`) ou melhoria
> relevante, atualizar este arquivo: status da fase, prioridade e
> **§16 Histórico** (versão, data, resumo).

# 1. RH --- Base

  Código        Fase                                  Status
  ------------- ------------------------------------- ----------------
  RH-0A/RH-0B   Estrutura inicial RH                  🟢 CONCLUÍDO
  BEN-1/2       Benefícios VT/VR até fase 2C          🟢 CONCLUÍDO
  IA-2/3/4      Entrada Inteligente / IA documental   🟢 CONCLUÍDO
  IA-5A         Aplicação controlada CNH              🟢 CONCLUÍDO
  IA-5B         ASO + NR/Treinamentos                 🟢 CONCLUÍDO
  DOC-SESMT     Orquestração Dossiê↔SESMT↔Evolução    🟠 HOMOLOGAÇÃO
  RH-DOC-NOM    Nomenclatura oficial dos documentos   🟠 HOMOLOGAÇÃO
  RH-DOC-UX     Validar / Resumo / Evolução / Fila IA 🟠 HOMOLOGAÇÃO

# 2. RH --- Cargos e Requisitos

  -------------------------------------------------------------------------------------
  Código            Fase              Status            Escopo
  ----------------- ----------------- ----------------- -------------------------------
  RH-1A             Cadastro Mestre   🟢 CONCLUÍDO      Cargo, Objeto da Função e
                    de Cargos                           Atividades/Responsabilidades;
                                                        SQL
                                                        `sql_rh_cadastro_mestre_cargos_fase1a.sql`
                                                        (manual)

  RH-1A.1           Importação        🟢 CONCLUÍDO      220 cargos da planilha +
                    controlada de                       complemento 7 cargos;
                    descrições                          UPDATE por nome + INSERT
                                                        só se não existir; SQL
                                                        `sql_rh_cadastro_mestre_cargos_fase1a1_import.sql`
                                                        e
                                                        `sql_rh_cadastro_mestre_cargos_fase1a1b_complemento.sql`

  RH-1B             Matriz de         🟢 CONCLUÍDO      CNH, NRs, treinamentos, ASO,
                    Requisitos por                      documentos, jornada/regime,
                    Cargo                               cargo de confiança e testes de
                                                        aptidão aplicáveis;
                                                        SQL
                                                        `sql_rh_matriz_requisitos_cargo_fase1b.sql`
                                                        + RLS
                                                        `sql_rh_matriz_requisitos_cargo_fase1b_rls.sql`

  RH-1C             Prontidão         🟢 CONCLUÍDO      Consome matriz RH-1B
                    Integrada do                        aprovada; Pronto /
                    Colaborador                         Bloqueado / Atenção /
                                                        Sem matriz / Sem cargo /
                                                        Inativo. Sem SESMT
                                                        automático nem campo.
                                                        SQL opcional
                                                        `sql_rh_prontidao_integrada_fase_1c.sql`;
                                                        persistência `cargo_id`
                                                        homologada (8.1.017)
  -------------------------------------------------------------------------------------

**Regra:** `[[OBJETO_DA_FUNÇÃO]]` deve vir do Cadastro Mestre aprovado
do cargo, nunca de texto genérico.

# 3. Recrutamento e Seleção

Fluxo-alvo:

**Vaga → Candidato → QR Code → Ficha Digital → Questionários/Testes →
Entrevistas → Validações Internas → Decisão Humana → Aprovado para
Admissão**

  ------------------------------------------------------------------------------
  Código            Fase              Status            Escopo
  ----------------- ----------------- ----------------- ------------------------
  RH-SEL-1A         Vagas / Processos 🟠 HOMOLOGAÇÃO    Cargo oficial, filial/local,
                    Seletivos                           projeto/contrato,
                                                        gestor, quantidade,
                                                        requisitos (matriz RH-1B)
                                                        e candidatos;
                                                        SQL
                                                        `sql_rh_selecao_vagas_fase1a.sql`
                                                        +
                                                        `sql_rh_selecao_vagas_fase_sel1a.sql`

  RH-SEL-1B         Portal do         🟢 CONCLUÍDO      Acesso externo seguro
                    Candidato + QR                      por token/hash, convite
                    Code                                individual, QR local;
                                                        SQL
                                                        `sql_rh_selecao_portal_convites_fase_sel1b.sql`
                                                        + Edge
                                                        `rh-candidato-convite-admin`
                                                        /
                                                        `rh-candidato-portal`

  RH-SEL-1C         Identificação     🟢 CONCLUÍDO      Identificação mínima
                    rápida do                           (vaga/cargo/nome/tel/
                    Candidato                           e-mail + CPF);
                                                        SQL
                                                        `sql_rh_selecao_identificacao_candidato_fase_sel1c.sql`;
                                                        Edge portal ampliada;
                                                        sem ficha documental /
                                                        admissão

  RH-SEL-1D         Banco de Questões 🟢 CONCLUÍDO      Catálogo versionado por
                    e Testes por                        cargo_id + perfil da
                    Cargo                               matriz; seed Eletricista
                                                        LVII; gabarito via RPC;
                                                        aplicação no portal do
                                                        candidato homologada;
                                                        SQL
                                                        `sql_rh_selecao_testes_fase_sel1d.sql`
                                                        +
                                                        `sql_rh_seed_testes_eletricista_lv_sel1d.sql`

  RH-SEL-1D2        Cargo ↔ Teste +   🟠 HOMOLOGAÇÃO    Vínculo operacional no
                    snapshot na vaga                    cargo (reusa `rh_testes`);
                    + filtro gestor                     vaga herda snapshot
                                                        (`rh_vaga_testes`);
                                                        complementar só na vaga;
                                                        portal lê snapshot;
                                                        `#rh-sel-gestor` só
                                                        Gestores/Gerentes ativos;
                                                        SQL
                                                        `sql_rh_selecao_cargo_teste_vaga_fase_sel1d2.sql`
                                                        (manual; não aplicado)

  RH-SEL-1E         Entrevistas e     🟢 CONCLUÍDO      Agenda RH / Técnica-Gestor,
                    Avaliações                          parecer humano, testes
                                                        como apoio; SQL
                                                        `sql_rh_selecao_entrevistas_fase_sel1e.sql`;
                                                        homologado pelo usuário;
                                                        sem aprovação automática /
                                                        admissão

  RH-SEL-1F         Integridade,      🟢 CONCLUÍDO      HC/PC/AC/PT; histórico CENA
                    Histórico CENA e                    por CPF; registro manual
                    Conflitos                           AC/PT; sem scraping/score/
                                                        aprovação; SQL
                                                        `sql_rh_selecao_integridade_fase_sel1f.sql`;
                                                        homologado pelo usuário

  RH-SEL-1G         Resultado e       🟢 CONCLUÍDO      Decisão humana; aprovação
                    Aprovação para                      p/ admissão; não seleção;
                    Admissão                            encaminhamento a
                                                        `rh-contratacao`; SQL
                                                        `sql_rh_selecao_resultado_fase_sel1g.sql`;
                                                        homologado pelo usuário;
                                                        sem criar colaborador

  RH-SEL-1H         Trilha de testes  🟠 HOMOLOGAÇÃO    Eletricista I/II/III:
                    Eletricista                         4 blocos (técnico,
                                                        segurança eliminatória,
                                                        prático, comportamental);
                                                        candidato ou colaborador;
                                                        SQL
                                                        `sql_rh_trilha_testes_eletricista_fase_sel1h.sql`
                                                        +
                                                        `sql_rh_seed_trilha_testes_eletricista_i_ii_iii.sql`;
                                                        sem criar colaborador /
                                                        sem IIII

  RH-SEL-1H2        Trilhas por       🟡 EM DESENVOLVIMENTO
                    cargo / família                     SQL preparado, **não
                                                        aplicado**: ALTER
                                                        `sql_rh_trilha_testes_familias_fase_sel1h2_alter.sql`
                                                        + seed
                                                        `sql_rh_trilha_testes_familias_fase_sel1h2_seed.sql`
                                                        + rollback
                                                        `sql_rh_trilha_testes_familias_fase_sel1h2_ROLLBACK.sql`;
                                                        plano
                                                        `sql_rh_trilha_testes_familias_fase_sel1h2_PLANO.md`.
                                                        Sem `index.html`, sem
                                                        deploy. 4 blocos
                                                        canônicos; liderança →
                                                        família 4; trilhas novas
                                                        `EM_REVISAO_RH` /
                                                        `ativo=false`
  ------------------------------------------------------------------------------

## Portal / QR Code

O QR Code deve usar token seguro e temporário. Não expor CPF ou IDs
internos na URL.

O candidato deve poder: 1. Identificar-se. 2. Preencher a ficha. 3.
Responder questionários. 4. Fazer testes vinculados ao cargo pretendido.
5. Enviar a candidatura. 6. Receber confirmação de conclusão.

## Testes

Os testes devem ser configuráveis por cargo/família funcional e possuir
critérios próprios. O resultado automático pode classificar: - 🟢
ATINGIU OS CRITÉRIOS - 🟡 REVISÃO RH/GESTOR - 🔴 NÃO ATINGIU OS
CRITÉRIOS

**A nota/teste não deve contratar ou reprovar automaticamente. A decisão
final é humana.**

## RH-SEL-1F --- Validações internas

Painel interno resumido previsto:

  -----------------------------------------------------------------------
  Indicador                           Significado
  ----------------------------------- -----------------------------------
  HC - n                              Histórico CENA / quantidade de
                                      vínculos ou ocorrências
                                      configuradas

  PC - n                              Possíveis correspondências de
                                      parentesco/conflito a revisar

  AC - n                              Indicador resumido da consulta de
                                      antecedentes conforme fonte e regra
                                      aplicável

  PT - n                              Quantidade de processos
                                      trabalhistas localizados pela fonte
                                      consultada
  -----------------------------------------------------------------------

### Regras para AC/PT

-   Exibição resumida na tela padrão.
-   Não usar AC/PT como score automático de aprovação/reprovação.
-   Não criar regra como `PT >= X → REPROVAR`.
-   Resultado exige interpretação/revisão humana.
-   Detalhamento, quando disponível e permitido, somente com permissão
    específica.
-   Registrar fonte, data/hora, usuário, status da consulta e auditoria
    de acesso.
-   Diferenciar processo localizado de condenação/antecedente
    efetivamente caracterizado.
-   Implementação da fonte externa somente após análise técnica,
    jurídica, LGPD e termos de uso.

### Histórico CENA

Preferencialmente localizar por CPF e apresentar vínculos anteriores,
períodos, cargos e dados históricos autorizados. Preservar histórico
documental e de treinamentos sem assumir validade atual.

### Possível parentesco

Sobrenome isolado não confirma parentesco. O sistema pode identificar
possíveis correspondências usando filiação e sobrenomes, mas deve marcar
como **REVISAR** e exigir confirmação humana.

# 4. Admissão

**Somente candidato aprovado na Seleção deve avançar para o Processo de
Admissão.**

  Código   Fase                                  Status
  -------- ------------------------------------- -----------------
  RH-2A    Admissão Inteligente (Contratação)    🟠 HOMOLOGAÇÃO
  RH-2B    Cronograma + responsáveis + Gates     🟢 CONCLUÍDO
  RH-2C    Gerador de documentos por Templates   🟠 HOMOLOGAÇÃO
  RH-2D    Assinatura + Dossiê / DocuSign + Kits 🟠 HOMOLOGAÇÃO
  RH-2E    Promoção / Alteração Contratual       🔴 NÃO INICIADO

Roteiro-base: 1. Candidato aprovado 2. Pré-cadastro admissional
reaproveitando dados da seleção 3. Documentação 4. Cargo e requisitos 5.
ASO 6. NRs/treinamentos 7. Benefícios 8. Contrato e termos 9.
Assinaturas 10. Entregas iniciais 11. Gates: Documental, Médico,
Segurança, Contratual e Operacional 12. Admissão concluída / liberado

# 5. Documentos e Contratos

  Código   Item                                  Status
  -------- ------------------------------------- -----------------
  DOC-1    Contrato Individual unificado         🟠 HOMOLOGAÇÃO
  DOC-2    Termo Aditivo                         🟠 MODELO VISUAL (RH-2E)
  DOC-3    Termo de Investimento em Formação     🟡 PLANEJADO
  DOC-4    Acordo Compensação/Prorrogação        🟠 HOMOLOGAÇÃO (bloqueado)
  DOC-5    Vale-Transporte optante/não optante   🟠 HOMOLOGAÇÃO (bloqueado)
  DOC-6    Normas Atestados/Afastamentos         🟠 HOMOLOGAÇÃO
  DOC-7    Imagem e Voz                          🟠 HOMOLOGAÇÃO (bloqueado)
  DOC-8    Privacidade/LGPD                      🟠 HOMOLOGAÇÃO
  DOC-9    Cadastro de Modelos Documentais       🟠 HOMOLOGAÇÃO
  DOC-10   QR/Validação autenticidade            🔴 NÃO INICIADO
  DOC-11   Versionamento documental imutável     🟠 HOMOLOGAÇÃO

# 6. SESMT

  Código    Item                                      Status
  --------- ----------------------------------------- -----------------
  SESMT-1   ASO via Entrada Inteligente               🟢 CONCLUÍDO
  SESMT-2   NR/Treinamentos via Entrada Inteligente   🟢 CONCLUÍDO
  SESMT-3   Prontuário Médico Ocupacional protegido   🔴 NÃO INICIADO
  SESMT-4   Requisitos automáticos por cargo          🔴 NÃO INICIADO
  SESMT-5   Alertas de validade/prontidão             🔴 NÃO INICIADO

# 7. Benefícios

  Código   Item                           Status
  -------- ------------------------------ -----------------
  BEN-3    Conta-corrente                 🟡 PARCIAL
  BEN-4    Pré-carga/Conciliação Ticket   🟡 PARCIAL
  BEN-5    API Ticket/Edenred             🔴 NÃO INICIADO
  BEN-6    Roteirização VT                🔴 NÃO INICIADO
  BEN-7    Moovit                         🔴 NÃO INICIADO
  BEN-8    PJ sem VT/VR                   🟠 HOMOLOGAÇÃO

# 8. Almoxarifado / Ativos

  Código   Item                                 Status
  -------- ------------------------------------ -----------------
  ALM-CORR-1 Correção item processado + aprovação gestor  🟠 HOMOLOGAÇÃO
  ALM-1A   Correção/estorno movimentações       🔴 NÃO INICIADO
  ALM-1B   Entregas múltiplas                   🔴 NÃO INICIADO
  ALM-1C   Devolução múltipla por colaborador   🔴 NÃO INICIADO
  ALM-1D   Requisição obrigatória               🔴 NÃO INICIADO
  ALM-1E   Material aplicado/retorno campo      🔴 NÃO INICIADO
  ALM-REL  Relatórios estoque / requisição      🟠 HOMOLOGAÇÃO
  ATV-1A   Inventário de Ativos                 🔴 NÃO INICIADO
  ATV-1B   Movimentação de ativos               🔴 NÃO INICIADO
  ATV-1C   Inventário físico                    🔴 NÃO INICIADO

# 9. Frotas

  Código          Item                              Status
  --------------- --------------------------------- -----------------
  FRO-1A          Manutenção --- Controle           🔴 NÃO INICIADO
  FRO-1B          Workflow manutenção               🔴 NÃO INICIADO
  FRO-1C          Alertas 5/10/15 dias              🔴 NÃO INICIADO
  FRO-2A          API Sem Parar                     🔴 NÃO INICIADO
  FRO-PORT-AUTH   Portaria — Autorizados            🟠 HOMOLOGAÇÃO

  FRO-PORT-AUTH: cadastro (foto pessoa/veículo, RG, CPF, setor, dados do
  veículo) por usuário não-portaria; tablet só libera entrada/saída.
  SQL `sql_portaria_autorizados.sql` (manual).

# 10. Programação

  Código    Item                      Status
  --------- ------------------------- --------------
  PROG-1A   Programação de Projetos   ⏸ PAUSADO
  PROG-1B   Legado PLPT               ⏸ PAUSADO
  PROG-2A   Folguista                 🟡 PLANEJADO
  PROG-2B   Composição equipe         🟡 PLANEJADO
  PROG-2C   Categorias D/AD           🟡 PLANEJADO

> **RESTRIÇÃO CRÍTICA:** não alterar Programação de Equipes TMA ao
> trabalhar em Programação de Projetos.

# 11. Integrações

  Código         Item             Status
  -------------- ---------------- -----------------
  INT-PONTO-1    Relógio/Nexus    🟡 PARCIAL
  INT-ASS-1      DocuSign         🔴 NÃO INICIADO
  INT-MOV-1      Moovit           🔴 NÃO INICIADO
  INT-SEM-1      Sem Parar        🔴 NÃO INICIADO
  INT-TICKET-1   Ticket/Edenred   🔴 NÃO INICIADO

# 12. Desligamento

  Código   Item                      Status
  -------- ------------------------- -----------------
  RH-3A    Roteiro de Desligamento   🔴 NÃO INICIADO
  RH-3B    Devoluções                🔴 NÃO INICIADO
  RH-3C    Bloqueio de acessos       🔴 NÃO INICIADO
  RH-3D    Documentação/Dossiê       🔴 NÃO INICIADO
  RH-3E    Gate de encerramento      🔴 NÃO INICIADO

# 13. Arquitetura / Desenvolvimento

  Código   Item                               Status
  -------- ---------------------------------- -------------
  DEV-1    Modularização index.html           ⏸ PAUSADO
  DEV-2    Git/GitHub seguro                  ⏸ PAUSADO
  DEV-3    Cursor Cloud ↔ GitHub ↔ OneDrive   🟡 PARCIAL
  DEV-4    Permissões/ACL                     🟡 CONTÍNUO
  DEV-5    Auditoria transversal              🟡 CONTÍNUO
  DEV-6    Roadmap vivo (`ROADMAP_CENA.md`)   🟡 CONTÍNUO

# 14. Prioridade Atual Revisada

1.  🟠 **DOC-SESMT / P1-A.4 --- CENA atual do vínculo documental** (homologar RE 240: modal lê treinamento_id do documento_final_id)
2.  🟠 **DOC-SESMT / P1-A.3 --- Escrita protegida sem fallback anon** (homologar vínculo `rh_sesmt_documento_vinculos` com JWT authenticated; AUTH-1 separado)
3.  🟠 **ALM-CORR-1 --- Corrigir item processado com aprovação do gestor** (homologar; SQL manual `sql_alm_correcao_item_solicitacoes.sql`; **não executar** RE 107 / RE 1978 automaticamente)
4.  🟠 **DOC-SESMT / P1-A.2 --- IA-5B documento_final_id (ASO certo)** (homologar RE 240)
5.  🟠 **DOC-SESMT / P1-A.1 --- Subtipo ASO + Integrar SESMT** (homologar; SQL pontual `sql_p1a1_corrigir_aso_periodico_re240.sql` + vínculo `sql_rh_sesmt_documento_vinculos.sql`)
6.  🟠 **RH-2D --- Assinatura + Dossiê / DocuSign + Kits** (homologar)
7.  🟠 **RH-SEL-1D2 --- Cargo ↔ Teste + snapshot na vaga + filtro gestor** (homologar; SQL manual)
8.  🟠 **RH-SEL-1H --- Trilha testes Eletricista I/II/III** (homologar; SQL manual)
9.  🟡 **RH-SEL-1H2 --- Trilhas por cargo/família** (SQL para revisão; **não aplicar** sem aprovação)
10. 🟠 **RH-2C --- Documentos / Templates** (homologar se pendente)
11. 🟠 **RH-2A --- Admissão Inteligente** (homologar se pendente)
12. RH-2E --- Promoção/Alteração Contratual *(não iniciar)*

> **Parada:** DOC-SESMT/P1-A + RH-2D em HOMOLOGAÇÃO. Não iniciar RH-2E sem autorização. SQL de vínculo **não** aplicar sem aprovação.

# 15. Procedimento por fase

1.  Auditar código e banco existentes.
2.  Confirmar dependências.
3.  Não criar estrutura paralela se já houver estrutura oficial.
4.  Fazer alterações pequenas, aditivas e rastreáveis.
5.  Preferir SQL aditivo/idempotente; evitar DROP e mudanças de IDs.
6.  Preservar histórico e integrações.
7.  Testar.
8.  Mover para HOMOLOGAÇÃO.
9.  Somente após aprovação do usuário marcar CONCLUÍDO.
10. Registrar versão, data e resumo neste Roadmap.

# 16. Histórico

| Data       | Versão  | Alteração |
| ---------- | ------- | --------- |
| 17/09/2026 | 8.1.059 | Limpeza: removido botão "📦 Almox." da barra superior que apontava para app Netlify desativado (404); Almoxarifado permanece na sidebar. Removido CSS órfão `#form-alm`. |
| 17/09/2026 | 8.1.058 | Limpeza: módulo Sugestões de Melhorias estava duplicado no `index.html` (2 cópias idênticas; a 2ª vencia por hoisting, a 1ª era código morto). Removidas 356 linhas da cópia morta. Sem mudança de comportamento. |
| 17/09/2026 | 8.1.057 | P1-A.4: botão Confirmar integração… falhava em silêncio (`item` indefinido na validação). HOMOLOGAÇÃO. |
| 16/09/2026 | 8.1.056 | P1-A.4: CENA atual no modal IA-5B lê o treinamento do vínculo (documento_final_id → treinamento_id); não pega outro ASO. HOMOLOGAÇÃO. Sem SQL, sem deploy. |
| 16/09/2026 | 8.1.055 | P1-A.3: requireAuth em sbInsert/sbUpdate; vínculo SESMT só com JWT authenticated; IA-5B não marca INTEGRADO se vínculo falhar. HOMOLOGAÇÃO. |
| 16/09/2026 | 8.1.054 | ALM-CORR-1: solicitação sem estoque; aprovação só pelo auth_user_id do gestor; preview/revalidação/compensação. SQL manual. HOMOLOGAÇÃO. |
| 16/09/2026 | 8.1.053 | RH Cadastro de Cargos: lista só ativos; Ver inativos / Ver ativos para alternar. HOMOLOGAÇÃO. |
| 16/09/2026 | 8.1.052 | P1-A.2: IA-5B usa documento_final_id; não herda ASO de 2021 no periódico RE 240; validade ambígua não vira data. HOMOLOGAÇÃO. |
| 16/09/2026 | 8.1.051 | P1-A.1: subtipo ASO canônico (não assume Admissional); dedupe por subtipo+vínculo; corrige título via reintegração; SQL manual RE 240. HOMOLOGAÇÃO. |
| 16/09/2026 | 8.1.050 | P1-A: SALVO ASO/NR/CERT → Integrar SESMT (sem reupload); orquestrador + IA-5B; enrich Dossiê; dedupe. HOMOLOGAÇÃO. |
| 16/09/2026 | 8.1.049 | Sidebar: Programação de Equipes (ex-Projetos); atalho Gestão de Ponto no menu RH. HOMOLOGAÇÃO. |
| 16/09/2026 | 8.1.048 | Portaria KM: última KM = último registro; aviso saída sem retorno; ajuste revalida retorno≥saída. HOMOLOGAÇÃO. |
| 15/09/2026 | 8.1.047 | DOC-SESMT: orquestrador Dossiê↔SESMT↔Evolução; Salvar e integrar; vínculo SQL manual; diagnóstico Evolução. HOMOLOGAÇÃO. |
| 15/09/2026 | 8.1.046 | Performance SESMT Evolução/Treinamentos: paginação + desmonte DOM ao sair; sem render hidden. HOMOLOGAÇÃO. |
| 15/09/2026 | 8.1.045 | IA-5B: normalização central de datas ASO/treinamentos (período ≠ validade; bloqueio de ambígua). HOMOLOGAÇÃO. |
| 15/09/2026 | 8.1.044 | RH-2A etapa 2: Entrada Inteligente embutida na Contratação (lote + matriz + conferência; vínculo candidato/vaga/processo). SQL manual `sql_rh_contratacao_entrada_ia_etapa2.sql`. HOMOLOGAÇÃO. |
| 15/09/2026 | 8.1.043 | SESMT Evolução: consulta sob demanda (busca/filtro, ficha individual, Ver todos documentos, refresh pós-IA). HOMOLOGAÇÃO. |
| 15/09/2026 | 8.1.042 | RH-SEL-1D2: corrige + Vincular teste no cargo (formulário não abria). HOMOLOGAÇÃO. |
| 15/09/2026 | 8.1.041 | RH-SEL-1D2: vínculo Cargo↔Teste (Banco), snapshot na vaga, complementar só na vaga, gestor só Gestor/Gerente ativo. SQL manual. HOMOLOGAÇÃO. |
| 15/09/2026 | 8.1.040 | RH-1B: modal do cargo / Requisitos da matriz mostra o nome do cargo em edição no topo. |
| 15/09/2026 | 8.1.039 | Almoxarifado Relatórios 1 e 2: filtrar e classificar por data, status, solicitante, contrato e itens. HOMOLOGAÇÃO. |
| 15/09/2026 | 8.1.038 | RH-1B Matriz: Documento e Treinamento na inclusão só listam itens ainda não associados ao cargo. |
| 15/09/2026 | 8.1.037 | Almoxarifado: Relatório 1 (status do estoque no período) em Requisição; Relatório 2 (movimentação por requisição) em Estoque. HOMOLOGAÇÃO. |
| 15/09/2026 | 8.1.036 | SESMT: curso com validade Não Vence; exceção N/A de curso da trilha por colaborador (Trilhas + Evolução). Reusa `aptidao_na.cursos`. HOMOLOGAÇÃO. |
| 15/09/2026 | —       | RH-SEL-1H2: revisão final do SQL (unique por status, rollback por inativação, RPC bloqueia APTO_*, validação SELECT-only). Sem aplicar banco, sem `index.html`, sem deploy. |
| 15/09/2026 | —       | RH-SEL-1H2: SQL ALTER+seed+rollback preparado (4 blocos, liderança→família 4, trilhas novas EM_REVISAO_RH). Sem aplicar banco, sem `index.html`, sem deploy. |
| 14/09/2026 | 8.1.035 | RH-2A: kit Documentos da admissão (todos os cargos) sem NRs/treinamentos/apontamentos; Mudança de Função só na promoção. HOMOLOGAÇÃO. |
| 14/09/2026 | 8.1.034 | RH-SEL-1H Trilha Eletricista I/II/III (4 blocos, segurança eliminatória, candidato ou colaborador). SQL 1H + seed. Sem criar colaborador / sem IIII. HOMOLOGAÇÃO. |
| 14/09/2026 | —       | RH-1B: replicou matriz ativa do ELETRICISTA I → II, III e IIII (SQL `sql_rh_replicar_matriz_eletricista_i_para_ii_iii_iiii.sql`). Destinos `EM_CONFIGURACAO`. Sem `index.html`, sem `rh_testes`/kits. |
| 13/09/2026 | 8.1.033 | RH-2D: bucket privado cena-rh-assinados + signed URL curta no Dossiê; cena-docs intocado. HOMOLOGAÇÃO. Sem RH-2E. |
| 13/09/2026 | 8.1.032 | RH-2D: envelope-completed fecha sozinho (PDF, certificado, hash, Dossiê); recipient-completed só parcial. HOMOLOGAÇÃO. Sem RH-2E. |
| 13/09/2026 | 8.1.031 | RH-2D: DocuSign (Edge) + kits Contratação/Desligamento + documentos eventuais; assinatura manual preservada; HOMOLOGAÇÃO. Sem RH-2E. |
| 07/09/2026 | —       | Criação do Roadmap Mestre. |
| 07/09/2026 | —       | IA-5B reconhecida; RH-1A como próxima fase. |
| 07/09/2026 | —       | Processo dividido em Seleção e Admissão. |
| 07/09/2026 | —       | Portal do Candidato (QR), ficha digital e testes por cargo. |
| 07/09/2026 | —       | Entrevistas e decisão humana antes da admissão. |
| 07/09/2026 | —       | RH-SEL-1F: Histórico CENA, parentesco/conflito, AC/PT (sem reprovação automática). |
| 07/09/2026 | 7.9.950–7.9.959 | Nomenclatura, fila IA, Validar/Resumo, Evolução SESMT (ver log do sistema). |
| 07/09/2026 | —       | Conteúdo de `ROADMAP_CENA_ATUALIZADO.md` incorporado neste arquivo oficial. |
| 07/09/2026 | 7.9.960 | RH-1A: objeto_funcao + descricao_atividades_responsabilidades no cadastro oficial `cargos`; acesso RH → mesmo cadastro; SQL manual fase1a. Sem importação. HOMOLOGAÇÃO. |
| 08/09/2026 | 7.9.961 | RH-1A.1: 220 cargos da planilha — UPDATE descrições por nome, INSERT só se não existir; sem renomear/duplicar/alterar colaboradores. SQL fase1a1 + JSON. HOMOLOGAÇÃO. |
| 08/09/2026 | 7.9.962 | RH-1A.1b: 7 cargos complementares (Supervisor, Coordenador, Assist. Adm. Pleno, Eng. Segurança, Téc. Segurança Jr, Eletricista LVII, Superv. Almox Jr). SQL fase1a1b. |
| 08/09/2026 | 7.9.962 | Usuário homologou RH-1A / RH-1A.1 / RH-1A.1b → CONCLUÍDO. Próxima fase: RH-1B Matriz de Requisitos por Cargo. |
| 08/09/2026 | 7.9.963 | RH-1B Matriz de Requisitos por cargo_id (CNH/NR/cursos/docs/ASO/regime/testes). SQL fase1b. Sem prontidão. HOMOLOGAÇÃO. |
| 08/09/2026 | 7.9.964 | Portaria: tablet só equipe completa+programada; liberação não volta à Saída; Retorno/Registros no dia local (BRT). |
| 08/09/2026 | 7.9.965 | Portaria: EON324 visível no dia local; EJN105/EIN333 saem da fila após liberar; rascunho continua oculto. |
| 08/09/2026 | 7.9.966 | Portaria: busca EON324 nos Registros pelo código; aviso se placa liberada ≠ programada. |
| 08/09/2026 | 7.9.967 | Portaria: bloqueia KM saída < último da placa e KM retorno < KM saída. |
| 08/09/2026 | 7.9.968 | Portaria: ajuste manual de KM só Frotas/admin, com justificativa e histórico. |
| 08/09/2026 | 7.9.969 | Ponto/VT-VR: Abono Curso (Nexus, aba afastamentos) separado de falta/atestado; sem vale automático. |
| 08/09/2026 | 7.9.970 | RH-1B: patch RLS/GRANT nas tabelas da matriz (401/42501). SQL sql_rh_matriz_requisitos_cargo_fase1b_rls.sql. HOMOLOGAÇÃO. |
| 08/09/2026 | 7.9.971 | Usuário homologou RH-1B → CONCLUÍDO. RH-SEL-1A Vagas/Processos Seletivos (cargo_id, local, contrato, gestor, qtd, matriz, candidatos). Sem portal/QR/ficha/testes/admissão. HOMOLOGAÇÃO. |
| 08/09/2026 | 7.9.972 | RH-SEL-1A alinhado à spec: tipo/datas/qtd planejada×preenchida, RH responsável, matriz só leitura, ABERTA exige matriz aprovada. SQL fase_sel1a. Sem ficha/portal. HOMOLOGAÇÃO. |
| 09/09/2026 | 7.9.973 | Portaria: remove HTML duplicado Frotas/Portaria (travava “Carregando…”); timeout de módulo + fallback na busca de veículos programados. |
| 09/09/2026 | 7.9.974 | Portaria: corrige `dataComp is not defined` em chipEquipe (lista de equipes/veículos quebrava). |
| 09/09/2026 | 7.9.975 | Frotas: não consulta mais `frotas_motorista_condutas` na abertura (sumiu 404 na Portaria); SQL opcional `sql_frotas_motorista_condutas.sql`. |
| 09/09/2026 | 7.9.976 | RH Benefícios Pré-carga: competência na aba, colunas Comp. VT/VR, Histórico importações + Revisar; empty-state com passo a passo. |
| 09/09/2026 | 7.9.977 | RH Benefícios importação: Buscar/Revisar por nome (sem id); legenda Reg./Conciliação/Tratamento/Motivo × Tipo arquivo (recarga Ticket). |
| 09/09/2026 | 7.9.978 | RH-1B: Importar do SESMT (trilha + docs checklist Evolução) na matriz do cargo; vaga continua só leitura. |
| 09/09/2026 | 7.9.979 | Portaria: ampliar foto da saída em overlay (corrige tela/aba branca com window.open + base64). |
| 09/09/2026 | 7.9.980 | RH Benefícios: modelo Excel importação VR/VT + Baixar modelo; detecção de cabeçalho em relatórios Ticket. |
| 09/09/2026 | 7.9.981 | RH Benefícios importação: auto-vínculo por nome único; Ignorar demitido/não cad. (revisado); ações em lote. |
| 09/09/2026 | 7.9.982 | RH Contratação: kit abre câmera real (getUserMedia); Arquivo segue para PDF/galeria. |
| 09/09/2026 | 7.9.983 | RH-SEL-1D banco de testes (TECNICO/SEGURANCA/SITUACIONAL) por cargo_id; gabarito em RPC; seed ELETRICISTA LVII. Sem portal/admissão. HOMOLOGAÇÃO. |
| 10/09/2026 | 7.9.984 | RH: tela branca — JS quebrado (return solto após rhSelBloco). |
| 10/09/2026 | 7.9.985 | RH Vagas: lista não some mais com rascunhos (filtro `ativo` no servidor + ordem `created_at` quebrava o fetch). |
| 10/09/2026 | 7.9.985 | Usuário confirmou: vagas em rascunho aparecem na lista. RH-SEL-1A segue 🟠 HOMOLOGAÇÃO (fase não encerrada). |
| 10/09/2026 | 7.9.986 | RH-SEL-1B Portal Candidato: convite individual (hash), QR local, `#candidato=`, Edge admin/portal; sem ficha/testes/admissão. 🟠 HOMOLOGAÇÃO. |
| 10/09/2026 | 7.9.987 | RH-SEL-1B: evita travar login em “Validando convite…” (hash incompleto / timeout / botão voltar ao ERP). |
| 10/09/2026 | 7.9.988 | RH-SEL-1B: login não é mais escondido antes da validação OK (corrige tela presa). |
| 10/09/2026 | 7.9.989 | RH Benefícios: VT R$ 7,50 unitário nos pisos do PLPT Teresina (botão + SQL). |
| 10/09/2026 | 7.9.990 | RH-SEL-1B: WhatsApp/e-mail assistidos no convite (mensagem pré-formatada + cargo da vaga). |
| 10/09/2026 | 7.9.991 | RH-SEL-1B: QR local embutido (não depende só de vendor/ no serve :8888). |
| 10/09/2026 | 7.9.992 | RH-SEL-1B: portal sem login; link ?candidato= (WhatsApp); ficha/testes ficam para 1C/1D. |
| 10/09/2026 | 7.9.993 | RH-SEL-1C identificação rápida (CPF) no portal + aplicação RH-SEL-1D ao candidato; sem ficha/docs/admissão. 🟠 HOMOLOGAÇÃO. |
| 10/09/2026 | 7.9.994 | Portal: evita “Teste 1 de 0”; resolve testes por nome do cargo; mensagem se seed/1D ausente. |
| 10/09/2026 | 7.9.995 | Portal: retomada sem CPF deixa claro “dados já confirmados”; SQL diag/reset homologação 1C. |
| 10/09/2026 | 7.9.996 | Usuário homologou RH-SEL-1B/1C/1D (portal + CPF + testes). 🟢 CONCLUÍDO. Sem 1E/docs/admissão. |
| 10/09/2026 | 7.9.997 | RH-SEL-1E entrevistas humanas (agenda RH/Técnica, parecer, sem aprovação automática). 🟠 HOMOLOGAÇÃO. |
| 10/09/2026 | 7.9.998 | RH-SEL-1E: corrige bloqueio de agendar quando testes já concluídos e status ainda Identificado. |
| 10/09/2026 | 7.9.999 | RH-SEL-1E: corrige ordem dos args do sbUpdate (status/entrevistas não gravavam). |
| 10/09/2026 | 8.0.001 | RH-SEL-1E 🟢 CONCLUÍDO (usuário). RH-SEL-1F Integridade HC/PC/AC/PT — histórico CENA por CPF, registro/revisão auditável, sem scraping/score/admissão. 🟠 HOMOLOGAÇÃO. |
| 10/09/2026 | 8.0.002 | RH-SEL-1F 🟢 CONCLUÍDO (usuário). RH-SEL-1G resultado humano + encaminhamento a Contratação/Promoção existente; sem colaborador/RE/RH-2A. 🟠 HOMOLOGAÇÃO. |
| 10/09/2026 | 8.1.001 | RH-SEL-1G 🟢 CONCLUÍDO (usuário). RH-2A Admissão Inteligente: docs→etapa 2 + IA Entrada Inteligente, atividade→3, remun→4, conferência/efetivar→5; sem templates/promoção automática. 🟠 HOMOLOGAÇÃO. |
| 10/09/2026 | 8.1.002 | RH-2A: docs/dados da Entrada Inteligente no processo de contratação até efetivação (sem colaborador/dossiê obrigatório); kit + Salvar no processo; migração ao dossiê na admissão. 🟠 HOMOLOGAÇÃO. |
| 11/09/2026 | 8.1.003 | RH-2A: preview/Ver no kit do processo; Ler/Processar com IA reaproveita arquivo já salvo (sem novo upload); Validado sem linha apagada. 🟠 HOMOLOGAÇÃO. |
| 11/09/2026 | 8.1.004 | RH-2A: realoca arquivo do kit para o tipo classificado (CNH não fica no Comprovante); CNH com arquivo não fica “Não se aplica”; Corrigir tipos do kit. 🟠 HOMOLOGAÇÃO. |
| 11/09/2026 | 8.1.005 | RH-2A: IA na Contratação sem exigir colaborador; destinos = dados admissionais do processo; sem falso alerta “contexto tinha colaborador”. 🟠 HOMOLOGAÇÃO. |
| 11/09/2026 | SQL | Unifica cargo Eletricista LVII → ELETRICISTA DE LINHA VIVA II (canônico ativo); seed SEL-1D aponta ao canônico. |
| 11/09/2026 | 8.1.006 | FRO-PORT-AUTH: aba Autorizados na Portaria — cadastro (fotos + RG/CPF/setor/veículo) só fora do perfil portaria; tablet libera entrada/saída. SQL `sql_portaria_autorizados.sql`. 🟠 HOMOLOGAÇÃO. |
| 11/09/2026 | 8.1.007 | FRO-PORT-AUTH: carga em massa 17 autorizados (cruza frota/colaborador; placa externa não cria veículo na empresa). SQL `sql_portaria_autorizados_carga_massa_20260911.sql`. 🟠 HOMOLOGAÇÃO. |
| 11/09/2026 | 8.1.008 | RH-2A: conferência — tokens [[ADICIONAIS]]/[[BENEFICIOS]] derivados da Remuneração; órgão emissor do RG editável na etapa 2. 🟠 HOMOLOGAÇÃO. |
| 11/09/2026 | 8.1.009 | RH-2A: conferência lista os docs do kit que bloqueiam; IA↔kit com matching tolerante; arquivo já no kit não conta como pendência. 🟠 HOMOLOGAÇÃO. |
| 11/09/2026 | 8.1.010 | RH-2A: Efetivar admissão não abria modal (openModal inexistente) — passa a usar setModal. 🟠 HOMOLOGAÇÃO. |
| 11/09/2026 | 8.1.011 | RH-2A: efetivar — remove `filial_id` do PATCH em colaboradores (PGRST204); base permanece no processo. 🟠 HOMOLOGAÇÃO. |
| 11/09/2026 | 8.1.012 | RH-2C Documentos/Templates: modelos HTML versionados, tokens canônicos, prévia/geração/snapshot/hash, aprovação p/ assinatura; SQL `sql_rh_documentos_templates_fase_2c.sql`. Sem assinatura (2D) nem promoção (2E). 🟠 HOMOLOGAÇÃO. |
| 11/09/2026 | 8.1.013 | Home: corrige `treinamentos is not defined` em `renderHomeDashSesmt` (dashboard quebrava no login). |
| 11/09/2026 | 8.1.014 | RH-2D: assinatura humana (presencial/papel/interna) + arquivo no Dossiê. Sem DocuSign. SQL sql_rh_assinatura_dossie_fase_2d.sql. HOMOLOGAÇÃO. |
| 11/09/2026 | 8.1.015 | RH/Ponto/Portaria: tela branca — `)` extra em rhDocAbrirEditorModelo derrubava o script (gpInit/filiais). |
| 12/09/2026 | 8.1.016 | RH-1C: Prontidão Integrada consome Matriz RH-1B aprovada (cargo, docs, CNH, ASO, NRs, treinamentos, vínculo). Sem score/IA/campo. HOMOLOGAÇÃO. |
| 12/09/2026 | 8.1.017 | RH-1C: Cadastro de Colaboradores persiste `cargo_id` (select por ID do Cargo Mestre); fallback não remove o vínculo em silêncio. |
| 12/09/2026 | 8.1.017 | Usuário homologou RH-1C → 🟢 CONCLUÍDO (Prontidão Integrada + persistência cargo_id). |
| 12/09/2026 | 8.1.018 | RH-1B Matriz: nível/momento editáveis nas linhas gravadas (antes só o select de inclusão voltava a Obrigatório). |
| 12/09/2026 | 8.1.019 | RH-1B: “Salvar matriz” passa a gravar CNH/NR/docs/níveis (antes só regime); rodapé na aba Requisitos salva a matriz. |
| 12/09/2026 | 8.1.020 | RH-1B: corrige sumiço da CNH ao salvar (snapshot do form + reload do banco; aviso se Exige CNH sem categoria). |
| 12/09/2026 | 8.1.021 | RH-1B: “Não se aplica” na inclusão aplica às linhas já gravadas; aviso se nível sem item; rascunho dos selects. |
| 12/09/2026 | 8.1.022 | RH-SEL: botão Corrigir CPF no Detalhe do candidato (rh_vaga_candidatos). |
| 12/09/2026 | 8.1.023 | RH-2A etapa 3: sem perguntar tipo/posse de CNH (Entrada Inteligente); só “vai dirigir?”; Sim/Não sem sobrepor a linha de baixo. 🟠 HOMOLOGAÇÃO. |
| 12/09/2026 | 8.1.024 | RH-2A etapa 5: empregadora cadastrável na Conferência + aba Empregadora; labels em negrito e campos em azul claro nos formulários. 🟠 HOMOLOGAÇÃO. |
| 12/09/2026 | 8.1.025 | RH-2C: importar .dc.html/HTML preservando layout e cores; prévia isolada do CSS do ERP; mapeia {{placeholders}} para tokens. 🟠 HOMOLOGAÇÃO. |
| 12/09/2026 | 8.1.026 | RH-2C: Contrato Individual (Claude Design) no motor de templates — HTML/CSS A4, tokens canônicos, prévia sem Georgia/800px, sanitização, rascunho CTR-CLT-CENA. Sem publicar, sem RH-2E. 🟠 HOMOLOGAÇÃO. |
| 12/09/2026 | 8.1.027 | RH-2C: CPF/RG/CNPJ completos no contrato; preenchimento manual de admissão, experiência, validade e assinatura antes de gerar. 🟠 HOMOLOGAÇÃO. |
| 12/09/2026 | 8.1.028 | RH-2C: 401/42501 em rh_contratacao_eventos — policy RLS do 2C só restava em service_role; patch `sql_rh_documentos_templates_fase_2c_rls.sql`. 🟠 HOMOLOGAÇÃO. |
| 13/09/2026 | 8.1.029 | RH-2C DOC-2: biblioteca CENA (Ficha, Normas, Imagem, VT, Jornada, LGPD) em HTML A4; Experiência bloqueada por fonte; Aditivo visual aguarda RH-2E. 🟠 HOMOLOGAÇÃO. |
| 13/09/2026 | 8.1.030 | Programação: mínimo 2 integrantes (Fiorino/Moto/Cesto/demais) para salvar/programar; Salvar todas também bloqueia. |

------------------------------------------------------------------------

**Nota:** o Roadmap é a referência de planejamento. Código e banco são a
referência do que efetivamente existe. Em caso de divergência, auditar
antes de mudar o status.
