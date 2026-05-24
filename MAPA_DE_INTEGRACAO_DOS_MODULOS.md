# MAPA DE INTEGRAÇÃO DOS MÓDULOS — CENA ERP
**Versão:** 7.5.0 | **Data:** 23/05/2026  
**Propósito:** Guia para modularização segura do sistema sem quebrar integrações existentes.

---

## 1. VISÃO GERAL DO SISTEMA

O CENA ERP é um arquivo único (`index.html`, ~2,9 MB) com ~78 páginas/painéis, ~1.200 funções e ~80 tabelas no banco Supabase. Ele foi construído de forma incremental e hoje tem módulos que dependem diretamente de variáveis globais uns dos outros.

**A separação precisa acontecer em camadas, não de uma vez.**

---

## 2. MÓDULOS PRINCIPAIS

| # | Módulo | Prefixo de funções | Páginas principais |
|---|--------|-------------------|-------------------|
| 1 | **Core / Auth** | `sbFetch`, `sbInsert`, `sbUpdate`, `showPage`, `carregarDados` | pg-login, pg-dashboard |
| 2 | **Programação TMA** | `progRender`, `progSalvar`, `progProj`, `_progStatus` | pg-tma, pg-programacao-equipes |
| 3 | **Programação PLPT** | `plptProg`, `plptRender`, `plptDiario` | pg-plpt-programacao |
| 4 | **Diário de Bordo (Campo)** | `renderDiario`, `dbAbrir`, `_continuarComSessao` | pg-diario, pg-campo |
| 5 | **Projetos / SOT / Obras** | `sotRender`, `sotAbrir`, `coRender`, `coAbrir` | pg-contrato-obras, pg-obras-projetos |
| 6 | **Materiais / Almoxarifado** | `almRender`, `plptAbrir`, `sol_materiais` | pg-obras-sap, pg-sesmt-alm |
| 7 | **Frotas / Portaria** | `frtAbrir`, `frtPortaria`, `portRender`, `pneusRender` | pg-frotas-* |
| 8 | **Financeiro / Medição** | `finRender`, `finSincro`, `medicoes` | pg-lancamentos, pg-obras-medicao |
| 9 | **SESMT / RH** | `sesmtRender`, `plrRender`, `plrCalc` | pg-sesmt-*, pg-plr |
| 10 | **Contratos / Cadastros** | `renderContratos`, `popularFiltros` | pg-contratos, pg-cadastros |
| 11 | **Relatórios / Dashboard** | `renderHome`, `renderDash`, `ppRender` | pg-dashboard, pg-relatorios |
| 12 | **ENEL / Comgás** | `enelRender`, `comgasRender` | pg-enel-*, pg-comgas-* |

---

## 3. O QUE CADA MÓDULO PRODUZ E CONSOME

### 3.1 Core / Auth
**Produz:**
- Sessão autenticada do usuário (`usuarioLogado`)
- Funções compartilhadas: `sbFetch`, `sbInsert`, `sbUpdate`, `progShowToast`, `setModal`, `escHtml`, `fmtD`, `parseJsonField`
- Carregamento inicial de dados base: `colaboradores`, `contratos`, `equipes`, `filiais`, `veiculos`

**Consome:**
- Banco Supabase (auth + RLS)
- `APP_VERSAO` (controle de versão)

---

### 3.2 Programação TMA
**Produz:**
- `composicao_dia[]` — quem está em qual equipe em qual dia
- `_progStatus{}` — status de cada colaborador (disponível, falta, folga, férias)
- `sessoes_disp[]` — sessões de trabalho abertas/fechadas por equipe
- `turnos_abertos[]` — turnos ativos no momento

**Consome:**
- `colaboradores[]` — lista de quem pode ser escalado
- `equipes[]` / `equipes_disp[]` — equipes disponíveis
- `contratos[]` — para filtrar por contrato
- `frt_veiculos[]` — veículos disponíveis por dia (`prog_veiculos_dia`)
- Status SESMT: aptidão, EPIs, treinamentos obrigatórios (via `perfis_extra`)

---

### 3.3 Programação PLPT
**Produz:**
- `plpt_prog_dia` — programação diária PLPT (equipe + data + contrato)
- `plpt_prog_projetos` — projetos vinculados a cada prog_dia
- `plpt_requisicoes_materiais` — requisições de material criadas pela equipe

**Consome:**
- `composicao_dia[]` — para confirmar composição da equipe
- `sot_projetos[]` — para listar projetos disponíveis na programação
- `equipes[]` — para identificar equipe
- `catalogo_materiais[]` — para criar requisições

---

### 3.4 Diário de Bordo (Campo)
**Produz:**
- `plpt_sessoes` — registro de turno (login, logout, eventos, cronômetro)
- `ordens_diario` — atividades executadas (O.S., etapas, quantidades)
- `plpt_requisicoes_materiais` com status atualizado (Em campo, Devolvida)
- `prod_diaria[]` — produção registrada por equipe/dia

**Consome:**
- `plpt_prog_dia` — para saber o que foi programado para hoje
- `plpt_prog_projetos` — projetos da programação
- `sot_projetos[]` — detalhe do projeto (atividades, materiais, etapas)
- `sot_atividades[]` — atividades disponíveis para apontar
- `composicao_dia[]` — membros da equipe hoje
- `plpt_requisicoes_materiais` — materiais separados/entregues
- `sessoes_disp[]` / `plpt_sessoes` — sessão aberta anterior

---

### 3.5 Projetos / SOT / Obras
**Produz:**
- `sot_projetos[]` — cadastro de projetos (obra, cliente, contrato, datas)
- `sot_atividades[]` — atividades planejadas por projeto (qtd, valor, tipo)
- `sot_materiais_proj[]` — materiais planejados por projeto
- `sot_adicionais` — materiais/atividades adicionais solicitados em campo
- `sot_historico` — histórico de status do projeto

**Consome:**
- `contratos[]` — projeto pertence a um contrato
- `colaboradores[]` — encarregado, responsável, supervisor do projeto
- `plpt_requisicoes_materiais` — para calcular Req. e Entr. nas colunas de material
- `ordens_diario` — para calcular produção executada vs planejada
- `medicoes[]` — para calcular financeiro executado

---

### 3.6 Materiais / Almoxarifado
**Produz:**
- `alm_movimentos[]` — entradas e saídas do almoxarifado
- `sol_materiais[]` — solicitações de material aprovadas
- `mov_sap[]` — movimentações integradas ao SAP

**Consome:**
- `plpt_requisicoes_materiais` — para processar entregas ao campo
- `sot_materiais_proj[]` — para atualizar qtd_entregue, qtd_aplicada
- `catalogo_materiais[]` — catálogo de itens
- `contratos[]` — almoxarifado por contrato/filial

---

### 3.7 Frotas / Portaria
**Produz:**
- `frt_veiculos[]` — cadastro de veículos
- `frt_portaria[]` — registros de saída/entrada de veículos
- `prog_veiculos_dia` — veículo programado por equipe/dia
- `pneus_dados[]`, `frt_manutencoes[]` — gestão da frota

**Consome:**
- `composicao_dia[]` — equipe que usa o veículo
- `plpt_prog_dia` — programação que justifica a saída
- `plpt_requisicoes_materiais` — materiais no veículo (portaria fotográfica)
- `contratos[]` — veículo pertence a contrato/filial

---

### 3.8 Financeiro / Medição
**Produz:**
- `lancamentos[]` — lançamentos financeiros
- `medicoes[]` / `medicoes_itens[]` — medições de obra
- `financeiro_faturamentos[]` — faturamentos por contrato

**Consome:**
- `sot_projetos[]` — projeto medido
- `sot_atividades[]` — atividades medidas (qtd_medida)
- `ordens_diario` — produção do campo para base da medição
- `contratos[]` — contrato faturado

---

### 3.9 SESMT / RH / PLR
**Produz:**
- Status de aptidão de colaboradores (ASO, EPIs, treinamentos)
- `_progStatus{}` contribuição: bloqueia escala se inapto
- `plr_avaliacoes` — avaliações de desempenho

**Consome:**
- `colaboradores[]` — ficha de cada funcionário
- `equipes[]` — equipe do colaborador
- `contratos[]` — para filtros

---

## 4. MAPA DE DEPENDÊNCIAS (quem precisa de quem)

```
Core/Auth
    └─► Todos os módulos (autenticação + funções base)

Contratos/Cadastros
    └─► Todos (contratos[], colaboradores[], equipes[])

SESMT/RH
    └─► Programação TMA (status aptidão → bloquear escala)

Frotas
    └─► Programação TMA (veículos disponíveis)
    └─► Diário de Bordo (veículo do turno)
    └─► Portaria (controle entrada/saída)

Programação TMA
    └─► Diário de Bordo (composicao_dia, sessoes_disp)
    └─► Frotas (prog_veiculos_dia)

Programação PLPT
    └─► Projetos/SOT (plpt_prog_projetos → sot_projetos)
    └─► Diário de Bordo (plpt_prog_dia → proj do dia)

Projetos/SOT
    └─► Materiais/Almox (sot_materiais_proj)
    └─► Diário de Bordo (sot_atividades, etapas)
    └─► Financeiro/Medição (atividades executadas)

Diário de Bordo
    └─► Projetos/SOT (registra execução em ordens_diario)
    └─► Materiais/Almox (plpt_requisicoes_materiais)
    └─► Financeiro/Medição (prod_diaria → base de medição)

Materiais/Almox
    └─► Projetos/SOT (atualiza qtd_entregue, qtd_aplicada)

Financeiro/Medição
    └─► Contratos (faturamento por contrato)
```

---

## 5. SERVICES COMPARTILHADOS QUE DEVEM EXISTIR

Estes são os serviços que **múltiplos módulos precisam** e devem ser centralizados:

### 5.1 `DataService` — acesso ao banco
```javascript
// Hoje: sbFetch, sbInsert, sbUpdate espalhados por todo o código
// Proposta: um único ponto de acesso com tratamento de erro padronizado
DataService.buscar(tabela, filtros)
DataService.salvar(tabela, dados)
DataService.atualizar(tabela, dados, condicao)
DataService.excluir(tabela, condicao)  // soft delete com deleted_at
```

### 5.2 `ColaboradorService` — status e disponibilidade
```javascript
// Hoje: colaboradores[] consultado diretamente em 39 funções diferentes
ColaboradorService.listar(contrato_id)
ColaboradorService.statusHoje(colab_id)         // disponivel/falta/folga/ferias
ColaboradorService.estaApto(colab_id)           // SESMT: ASO, EPIs, treinamentos
ColaboradorService.equipeAtual(colab_id)
ColaboradorService.buscarPorRE(re)
```

### 5.3 `EscalaService` — composição diária
```javascript
// Hoje: composicao_dia[] acessado em 22 funções diferentes
EscalaService.composicaoDia(equipe_id, data)
EscalaService.projetosEquipeHoje(equipe_id)
EscalaService.veiculoEquipe(equipe_id, data)
EscalaService.confirmarComposicao(equipe_id, data)
```

### 5.4 `SessaoService` — turnos e diário de bordo
```javascript
// Hoje: plpt_sessoes acessado de formas diferentes em vários módulos
SessaoService.sessaoAberta(equipe_id)           // retorna sessao ou null
SessaoService.iniciarTurno(equipe_id, dados)
SessaoService.encerrarTurno(sessao_id)
SessaoService.registrarEvento(sessao_id, evento)
SessaoService.restaurarSessao(sessao_id)
```

### 5.5 `MaterialService` — ciclo de materiais
```javascript
// Hoje: plpt_requisicoes + sot_materiais + alm_movimentos = 3 tabelas sem sincronismo claro
MaterialService.criarRequisicao(projeto_id, equipe_id, itens)
MaterialService.aprovarRequisicao(req_id, aprovador)
MaterialService.confirmarEntrega(req_id, almoxarife)
MaterialService.registrarAplicacao(req_id, itens_aplicados)
MaterialService.registrarDevolucao(req_id, itens_devolvidos)
MaterialService.saldoProjeto(projeto_id, material_id)    // programado - aplicado
MaterialService.breakdownMaterial(projeto_id, material_id) // todas as colunas da tabela
```

### 5.6 `ProjetoService` — obras e atividades
```javascript
// Hoje: sot_projetos acessado diretamente em 24 contextos
ProjetoService.abrirProjeto(projeto_id)
ProjetoService.registrarExecucao(projeto_id, atividade_id, qtd, sessao_id)
ProjetoService.calcularSaldo(projeto_id)        // programado vs executado
ProjetoService.statusAtual(projeto_id)
ProjetoService.historico(projeto_id)
```

### 5.7 `NotificacaoService` — avisos entre módulos
```javascript
// Hoje: progShowToast chamado 295 vezes diretamente
// Proposta: eventos tipados para comunicação entre módulos
NotificacaoService.toast(mensagem, tipo)        // info/erro/sucesso
NotificacaoService.emitir(evento, dados)        // dispara evento para ouvintes
NotificacaoService.ouvir(evento, callback)      // módulo B reage ao evento de A
// Exemplos de eventos:
// 'material.entregue'  → Almox notifica Diário e Projetos
// 'turno.encerrado'    → Diário notifica Produção e Medição
// 'requisicao.aprovada'→ PLPT notifica Kanban
// 'adicional.aprovado' → SOT notifica Reservar Materiais
```

### 5.8 `VeiculoService` — frotas para programação
```javascript
VeiculoService.disponiveisHoje(contrato_id, data)
VeiculoService.programadoParaEquipe(equipe_id, data)
VeiculoService.registrarSaida(veiculo_id, equipe_id, dados)
VeiculoService.registrarRetorno(saida_id, km_final)
```

### 5.9 `AuthService` — permissões
```javascript
AuthService.usuarioLogado()
AuthService.temPermissao(acao)       // ex: 'aprovar.adicional', 'excluir.requisicao'
AuthService.cargoPermite(cargo_minimo) // 'coordenador', 'gerente', etc.
AuthService.contratoAtual()
```

---

## 6. FUNÇÕES CENTRAIS A CRIAR

Estas funções **já existem parcialmente** mas estão duplicadas ou espalhadas. Devem ser consolidadas:

| Função central | Substitui | Usada por |
|---|---|---|
| `getColaboradorStatus(colab_id, data)` | `_progStatus[id]` acessado direto | TMA, SESMT, Diário |
| `getComposicaoEquipe(equipe_id, data)` | `composicao_dia.find(...)` repetido 22x | Diário, Frotas, PLPT, Portaria |
| `getSessaoAberta(equipe_id)` | lógica repetida em 5 lugares | Diário, Frotas, Portaria |
| `getMaterialSaldo(projeto_id, mat_id)` | cálculo inline em cada tela | Reservar, Baixa, Kanban |
| `getProjetoEnriquecido(projeto_id)` | `sotAbrirProjeto` + enrichments | SOT, PLPT Diário, Dashboard |
| `formatarData(data)` | `fmtD()` já existe mas com variações | Todos |
| `parseJsonSafe(str, fallback)` | `parseJsonField` já existe | Todos |

---

## 7. FLUXOS PRÁTICOS ENTRE MÓDULOS

### Fluxo 1: Programação → Diário de Bordo
```
1. Gestor cria programação TMA (progSalvar)
   ↓ escreve: composicao_dia, prog_veiculos_dia
   
2. Equipe abre diário (renderDiarioPlpt)
   ↓ lê: plpt_prog_dia, plpt_prog_projetos (via EscalaService)
   ↓ lê: composicao_dia para confirmar composição
   ↓ lê: sessoes_disp para verificar turno anterior

3. Equipe inicia turno (dbAbrirModalTurno)
   ↓ escreve: plpt_sessoes (início do turno)
   ↓ notifica: SessaoService.emitir('turno.iniciado')
   
4. Equipe abre projeto (sotAbrirProjeto via diário)
   ↓ lê: sot_atividades, sot_materiais_proj
   ↓ lê: plpt_requisicoes_materiais (materiais separados)
```

### Fluxo 2: Diário de Bordo → Medição
```
1. Equipe registra execução de atividade (ordens_diario)
   ↓ escreve: ordens_diario com qtd_executada

2. Diário encerra turno (dbEncerrarTurno)
   ↓ escreve: plpt_sessoes.logout_ts
   ↓ notifica: SessaoService.emitir('turno.encerrado', {sessao_id, prod_diaria})

3. Módulo Medição reage ao evento
   ↓ lê: ordens_diario para base de medição
   ↓ consolida: prod_diaria por projeto/data
   
4. Gestor abre Medição (medicoes)
   ↓ lê: prod_diaria + ordens_diario
   ↓ propõe: qtd_medida baseada na produção registrada
```

### Fluxo 3: Diário → Materiais → Almoxarifado
```
1. Equipe solicita material (plptNovoAdicional / plptSalvarAdicional)
   ↓ escreve: sot_adicionais com status='pendente'
   
2. Coordenador aprova (plptAprovarAdicional)
   ↓ escreve: sot_adicionais.status='aprovado'
   ↓ escreve: sot_materiais.qtd_viabilizada += qtd_aprovada
   ↓ notifica: MaterialService.emitir('adicional.aprovado')

3. Equipe faz requisição (sotEnviarRequisicao)
   ↓ escreve: plpt_requisicoes_materiais com status='Aguardando aprovação'
   
4. Almoxarife aprova e separa (plptAprovarReq → plptSepararReq)
   ↓ atualiza: plpt_requisicoes_materiais.status → 'Separação'
   
5. Equipe confirma retirada (plptConfirmarRetirada via Diário)
   ↓ atualiza: plpt_requisicoes_materiais.status → 'Aguardando confirmação almox'
   
6. Almoxarife confirma entrega (coConfirmarEntregaAlmox)
   ↓ atualiza: plpt_requisicoes_materiais.status → 'Em campo'
   ↓ atualiza: sot_materiais.qtd_entregue += qtd_ret
   ↓ notifica: MaterialService.emitir('material.entregue', {projeto_id, mat_id})
   
7. Equipe registra aplicação (coLancarAplicacao)
   ↓ atualiza: plpt_requisicoes_materiais com qtd_aplicada
   ↓ atualiza: sot_materiais.qtd_aplicada += qtd
   ↓ notifica: MaterialService.emitir('material.aplicado')
   
8. Projetos/SOT reage ao evento
   ↓ recalcula: breakdownMaterial(projeto_id) → atualiza Reservar Materiais
```

### Fluxo 4: Frotas → Programação → Portaria
```
1. Frota cadastra veículo disponível (frtRender)
   ↓ escreve: frotas_veiculos com status, contrato_id

2. Programador associa veículo à equipe (progSalvar)
   ↓ escreve: prog_veiculos_dia com equipe_id, veiculo_id, data

3. Portaria verifica saída (portRender / frtPortaria)
   ↓ lê: prog_veiculos_dia via VeiculoService.programadoParaEquipe()
   ↓ lê: plpt_requisicoes_materiais (materiais autorizados para sair)
   ↓ registra: frotas_portaria_saidas

4. Diário usa veículo do turno
   ↓ lê: prog_veiculos_dia para preencher placa no turno
```

### Fluxo 5: SESMT → Programação
```
1. SESMT registra inaptidão (plrRender / sesmtRender)
   ↓ escreve: sesmt_aptidao / perfis_extra com status

2. Programação TMA tenta escalar colaborador
   ↓ consulta: ColaboradorService.estaApto(colab_id)
   ↓ resultado: bloqueia escala com motivo (ASO vencido, EPI pendente, etc.)
```

### Fluxo 6: Contratos/Projetos → Toda a Operação
```
1. Gestor cadastra contrato e projeto (sotAbrirProjeto)
   ↓ escreve: contratos, sot_projetos, sot_atividades, sot_materiais

2. Programação PLPT usa os projetos
   ↓ lê: sot_projetos via plpt_prog_projetos
   
3. Diário executa atividades do projeto
   ↓ lê: sot_atividades → registra em ordens_diario

4. Medição fatura o projeto
   ↓ lê: ordens_diario → propõe medicoes_itens
   
5. Financeiro fecha o ciclo
   ↓ lê: medicoes → gera lancamentos, financeiro_faturamentos
```

---

## 8. PLANO DE MODULARIZAÇÃO EM ETAPAS

### Etapa 0 (Agora) — Criar este mapa ✅
Nenhuma mudança no código. Só documentação.

### Etapa 1 — Extrair o Core (serviços base)
**O que fazer:** Criar `cena-core.js` com:
- `DataService` (sbFetch/sbInsert/sbUpdate encapsulados)
- `AuthService` (usuarioLogado, permissões)
- `NotificacaoService` (eventos entre módulos)
- Utilities: `fmtD`, `escHtml`, `parseJsonField`, `dataHojeLocal`, `progShowToast`

**Risco:** Baixo. São funções sem estado próprio.

### Etapa 2 — Extrair os Services de Dados
**O que fazer:** Criar `cena-services.js` com:
- `ColaboradorService`
- `EscalaService`
- `SessaoService`
- `VeiculoService`
- `MaterialService`
- `ProjetoService`

**Risco:** Médio. Precisam acessar os arrays globais sem criar nova dependência.

### Etapa 3 — Separar módulos por domínio (um de cada vez)
Ordem recomendada (do menos dependente para o mais dependente):
1. `cena-frotas.js` — quase autossuficiente
2. `cena-sesmt.js` — quase autossuficiente
3. `cena-financeiro.js` — depende de contratos e projetos
4. `cena-programacao-tma.js` — depende do Core
5. `cena-programacao-plpt.js` — depende de TMA e Projetos
6. `cena-projetos.js` — depende de contratos e materiais
7. `cena-materiais.js` — depende de projetos e PLPT
8. `cena-diario.js` — depende de tudo acima

### Etapa 4 — Substituir dependências diretas por Services
**O que fazer:** Em cada módulo, substituir acessos diretos a arrays globais por chamadas ao Service correspondente.

### Etapa 5 — Lazy loading por módulo
Carregar cada módulo só quando necessário, usando `_precisaModulo()` já existente no sistema.

---

## 9. REGRAS DE INTEGRAÇÃO (para o futuro)

1. **Um módulo nunca chama funções internas de outro.** Usa apenas os Services.
2. **Um módulo nunca lê diretamente o array global do outro.** Usa `ColaboradorService.listar()`, não `colaboradores.filter(...)`.
3. **Eventos em vez de chamadas diretas.** Quando o Diário encerra um turno, emite `'turno.encerrado'`. A Produção e a Medição ouvem esse evento.
4. **O banco é a fonte da verdade.** Os arrays globais são caches. Ao salvar, sempre confirmar no banco antes de atualizar o cache.
5. **Nomear funções pelo que fazem, não por onde estão.** `getMaterialSaldo(projeto, mat)` em vez de `sotRenderTabReserva_calcSaldo`.

---

## 10. TABELAS CRÍTICAS DE INTEGRAÇÃO

Estas são as tabelas mais lidas e escritas — qualquer mudança nelas afeta múltiplos módulos:

| Tabela | Leitura | Escrita | Módulos afetados |
|--------|---------|---------|-----------------|
| `composicao_dia` | 11 lugares | 46 lugares | TMA, PLPT, Diário, Frotas, Portaria |
| `colaboradores` | 13 lugares | 5 lugares | Todos |
| `contratos` | 5 lugares | 5 lugares | Todos |
| `plpt_requisicoes_materiais` | 10 lugares | 9 lugares | PLPT, Diário, Materiais, SOT |
| `sot_materiais` | 7 lugares | 12 lugares | SOT, Diário, Almox |
| `plpt_sessoes` | 7 lugares | 4 lugares | Diário, TMA, PLPT |
| `ordens_diario` | 9 lugares | 9 lugares | Diário, SOT, Medição |
| `sot_projetos` | 6 lugares | 6 lugares | SOT, PLPT, Financeiro |

---

*Documento gerado em 23/05/2026 — CENA ERP v7.5.0*
*Próximo passo: revisar este documento com a equipe antes de iniciar a Etapa 1.*
