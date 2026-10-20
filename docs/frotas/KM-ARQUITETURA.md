# Frotas — Arquitetura de quilometragem, correções e exceções

**Situação:** arquitetura **aprovada conceitualmente** — **nada implementado**. Nenhuma tabela, função, migration ou alteração de KM foi feita. A autorização para implementar cada fase é concedida separadamente.
**Data:** 17/10/2026 · **Origem:** diagnóstico do KM atual = 1 (DZH7G12 e mais 6 veículos) e do KM 127491 do TLY9G76.
**Aprovação conceitual do dono:** 17/10/2026 (D1–D9, §2) e 19/10/2026 (P1–P4 decididos e ordem das versões, §2.1–§2.2), sobre o commit `187624c`.

---

## 1. Problema

1. O `frotas_veiculos.km_atual` é um campo que várias telas regravam e, ao mesmo tempo, a referência que a Portaria usa para validar a próxima leitura.
2. Em 17/09/2026, para desbloquear veículos com problema de KM, foram feitos ajustes operacionais (KM de saída → 1) em 7 veículos: DZH7G12, SVZ6D46, TJG0F66, TMB1B53, TTO2J57, RTQ7D65 (→ 1/2) e TTM8E99 (→ 17 por consequência).
3. A regra de `portKmUltimoRegistrado` ("havendo ajuste e o KM do cadastro sendo menor que o dos registros, vale o do cadastro") e a gravação em `portKmAposRegistrar` a cada saída/retorno **perpetuaram o 1**: ~150 regravações desde 26/09.
4. Com referência 1, a validação de KM deixou de funcionar nesses veículos (ex.: DZH7G12 aceitou 64, 646, 5139, 7236 e 71153) e o alerta de salto passou a disparar em toda saída.
5. Caso TLY9G76 (17/10): o porteiro digitou 127491 (indicador de autonomia "127 km" do painel); a foto mostra hodômetro 41363. O valor errado virou `km_atual`.

**Causa estrutural:** leitura, correção, exceção e cadastro são o mesmo campo, e a referência é "o maior/último valor gravado", não "a última leitura confiável".

## 2. Decisões aprovadas (17/10/2026)

| # | Decisão |
|---|---|
| D1 | `FROTAS_CORRIGIR_KM`: Gestor de Frotas e Administrador. |
| D2 | `FROTAS_AUTORIZAR_EXCECAO_KM`: Gestor de Frotas, futuro operador autorizado do CCO e Administrador. |
| D3 | `FROTAS_REGISTRAR_TROCA_HODOMETRO`: Gestor de Frotas e Administrador. |
| D4 | Permissões pelo controle por ação e contrato existente (`cena_acoes`, `cena_permissoes_acao`, `cena_pode(acao, contrato)`). |
| D5 | Exceção: validade 30 min **configurável**; vale para **uma operação**; justificativa e auditoria obrigatórias; **nunca** altera o KM de referência. |
| D6 | Sem limites absolutos (1.000 / 10.000 km): regras por histórico, intervalo de tempo, perfil do veículo, configuráveis. |
| D7 | Offline: registrar ocorrência e evidências; liberação física segue política de segurança própria; **exceção não autorizada não abre o portão**; nenhum registro offline é descartado. |
| D8 | Preservar valores originais e todas as correções; separar **leitura do painel** de **KM total acumulado**; não classificar automaticamente ajustes < 1.000 km como inválidos. |
| D9 | 8.1.224 = correções já desenvolvidas da Portaria. 8.1.225 = correção do ciclo de regravação. Arquitetura definitiva em fases próprias (§11). |

### 2.1 Pontos decididos (19/10/2026)

| # | Ponto | Decisão do dono |
|---|---|---|
| P1 | Perfil "Gestor de Frotas" (não existia; hoje há `supervisor_frotas`, 1 usuário). | **Planejar a criação do perfil `gestor_frotas`**, mantendo o `supervisor_frotas` existente. O supervisor **não** recebe automaticamente as novas permissões de gestão (D1–D3). |
| P2 | Perfil do operador do CCO. | **Prever o perfil `operador_cco`**, criado somente quando o módulo da Central de Controle Operacional for iniciado. A autorização de exceções exige **usuário autenticado** (Supabase Auth), **permissão válida** (`cena_pode`) e **separação entre solicitante e autorizador**. |
| P3 | Liberação física sem internet (§6.3). | Registrar ocorrências e evidências **localmente**. **Proibida** a abertura automática do portão com exceção ainda não autorizada. Um **procedimento de contingência supervisionado** para ausência de internet será documentado futuramente (documento próprio, com aprovação). |
| P4 | Validação de KM (§5.3). | Começar **só com alertas** e calibração pelo histórico real dos veículos. **Nenhum bloqueio automático** antes de homologação específica das regras. |

### 2.2 Ordem das versões (19/10/2026)

1. **8.1.224** — concluir primeiro a homologação da Portaria (correções já desenvolvidas: saída aberta de qualquer dia, PATCH 400 das fotos/OCR).
2. **8.1.225** — correção do ciclo de regravação do KM (§10), com autorização separada.
3. **F1–F6** — arquitetura definitiva (§11), cada fase com autorização própria.

## 3. Princípios

1. **Histórico só de inclusão:** toda leitura, correção, exceção ou troca de hodômetro é um evento novo. Nada é sobrescrito ou apagado.
2. **Referência calculada:** o KM de referência é **derivado** no banco = última leitura **confiável**, em ordem cronológica do evento, no **ciclo de hodômetro atual**. Nunca o maior valor, nunca o campo do cadastro.
3. **Cadastro é cópia:** `frotas_veiculos.km_atual` passa a ser cópia da referência, mantida só pelo banco. Nenhuma tela grava esse campo diretamente.
4. **Exceção não é leitura confiável:** autoriza **uma operação**; o KM informado fica registrado, mas não vira referência.
5. **Banco decide, tela mostra:** validação e gravações em funções do banco com `auth.uid()` e `cena_pode()` (mesmo padrão da 1.7b), fail-closed.
6. **Evidência junto:** foto do hodômetro (pacote de fotos da saída) e OCR acompanham a leitura.

## 4. Modelo de dados (proposto — não criado)

### 4.1 `frotas_km_eventos` (histórico de leituras e decisões)

| Coluna | Tipo | Observação |
|---|---|---|
| id | uuid PK | |
| veiculo_id | uuid | FK `frotas_veiculos` |
| placa | text | cópia para leitura humana |
| ciclo | int | ciclo do hodômetro (§4.2) |
| tipo | text | `LEITURA_SAIDA`, `LEITURA_RETORNO`, `LEITURA_ABASTECIMENTO`, `LEITURA_DIARIO`, `LEITURA_CADASTRO`, `CORRECAO`, `EXCECAO`, `TROCA_HODOMETRO`, `AJUSTE_LEGADO` |
| evento_em | timestamptz | momento real da leitura (não o do envio) |
| km_painel | numeric | o que o hodômetro mostra |
| km_acumulado | numeric | `km_inicial_acumulado do ciclo + (km_painel − km_inicial_painel do ciclo)` |
| confiabilidade | text | `CONFIAVEL`, `PROVISORIA`, `NAO_CONFIAVEL`, `A_REVISAR` |
| motivo_validacao | jsonb | resultado da validação (regras disparadas, referência usada) |
| referencia_km | numeric | referência vigente no momento |
| origem | text | `PORTARIA`, `DIARIO`, `ABASTECIMENTO`, `CADASTRO`, `MIGRACAO` |
| saida_id | uuid | `frotas_portaria_saidas` quando aplicável |
| evento_origem_id | uuid | evento corrigido / exceção relacionada |
| ocr_km, ocr_confianca | numeric | leitura automática |
| foto_ref | text | ponteiro para a foto (ex.: `saida:<id>:km`); a imagem continua no pacote da saída |
| justificativa | text | obrigatória em correção, exceção, troca e ajuste legado |
| finalidade | text | ex.: `DESBLOQUEIO_OPERACIONAL` (ajustes de 17/09) |
| autor_auth, autor_nome | uuid, text | quem registrou |
| status | text | para exceção: `PENDENTE`, `AUTORIZADA`, `NEGADA`, `EXPIRADA`, `UTILIZADA` |
| autorizado_por_auth, autorizado_por_nome, autorizado_em | | |
| canal | text | `LOCAL`, `REMOTO_CCO`, `OFFLINE_SINCRONIZADO` |
| valida_ate | timestamptz | exceção: criado + validade configurada |
| offline_event_id, dispositivo_id | text | rastreio da fila offline |
| criado_em | timestamptz | |

Índices: `(veiculo_id, ciclo, evento_em desc)`; parcial em `status='PENDENTE'`.
RLS: leitura para autenticados com acesso ao contrato; **escrita só pelas funções** (sem INSERT/UPDATE/DELETE direto).

### 4.2 `frotas_hodometros` (ciclos)

| Coluna | Observação |
|---|---|
| veiculo_id, ciclo | ciclo 1 = hodômetro original |
| inicio_em | data da troca/reinicialização |
| km_inicial_painel | leitura do painel novo |
| km_inicial_acumulado | KM total acumulado no início do ciclo (= final do ciclo anterior) |
| km_final_painel_anterior | última leitura do painel antigo |
| motivo | `TROCA`, `REINICIALIZACAO`, `TROCA_PAINEL`, `VEICULO_NOVO` |
| manutencao_id | vínculo com `frotas_manutencoes` |
| foto_ref, justificativa, autor_auth, autorizado_em | |

### 4.3 `frotas_km_regras` (configuração — D6)

Por **perfil de veículo** (`frotas_veiculos.tipo`: utilitário, caminhão, leve, máquina…) com sobreposição por contrato e por veículo.

| Parâmetro | Uso |
|---|---|
| velocidade_media_max_kmh | teto físico: `horas desde a referência × velocidade` |
| km_dia_max | teto diário do perfil |
| fator_media_historica | alerta quando o percurso passa de N× a média diária do próprio veículo (últimos 30 dias confiáveis) |
| margem_minima_km | folga absoluta pequena para ruído de leitura |
| fracao_digito_faltando | suspeita de dígito faltando quando `km < referência × fração` (relativo, sem 1.000/10.000) |
| exige_foto | foto obrigatória |
| ocr_confianca_minima, ocr_divergencia_max | comparação OCR × digitado |
| excecao_validade_min | padrão 30 (D5) |
| modo | `ALERTA` ou `BLOQUEIO` (permite ativar por fases) |

### 4.4 Colunas novas em tabelas existentes (aditivas)

- `frotas_portaria_saidas`: `km_saida_evento_id`, `km_retorno_evento_id`, `km_excecao_id` (vínculos com o histórico). Colunas atuais (`km_saida`, `km_retorno`, `km_ajustes`…) **continuam** e não são reescritas.
- `frotas_veiculos`: `km_referencia_evento_id`, `km_atual_atualizado_em` (rastreio da cópia).

### 4.5 Funções (todas com `auth.uid()` + `cena_pode()`)

| Função | Faz |
|---|---|
| `fn_frotas_km_referencia(veiculo)` | última leitura confiável do ciclo atual, por `evento_em` |
| `fn_frotas_km_validar(veiculo, km_painel, evento_em, ocr?, foto?)` | devolve `OK` / `ALERTA` / `BLOQUEIO` + motivos; **não grava** |
| `fn_frotas_km_registrar_leitura(...)` | grava a leitura com a confiabilidade calculada; atualiza a cópia do cadastro se for confiável |
| `fn_frotas_km_corrigir(evento, km_novo, justificativa, foto?)` | `FROTAS_CORRIGIR_KM`; novo evento `CORRECAO`; original preservado |
| `fn_frotas_km_solicitar_excecao(veiculo, operacao, km, justificativa, evidências)` | cria exceção `PENDENTE` |
| `fn_frotas_km_decidir_excecao(excecao, autoriza, justificativa)` | `FROTAS_AUTORIZAR_EXCECAO_KM`; nunca mexe na referência |
| `fn_frotas_km_usar_excecao(excecao, saida)` | consome a exceção (uma vez, dentro da validade) |
| `fn_frotas_km_trocar_hodometro(...)` | `FROTAS_REGISTRAR_TROCA_HODOMETRO`; abre novo ciclo |
| `fn_frotas_km_classificar_legado(evento, finalidade, confiabilidade, justificativa)` | revisão dos ajustes antigos (§9) |

## 5. Regras de negócio

### 5.1 Confiabilidade
- `CONFIAVEL`: passou em todas as regras **ou** foi corrigida por quem tem permissão **ou** foi confirmada por uma leitura seguinte coerente.
- `PROVISORIA`: passou com alerta confirmado pelo porteiro. Não vira referência; é promovida a confiável quando a próxima leitura confiável for coerente com ela.
- `NAO_CONFIAVEL`: leitura de exceção, ajuste operacional (ex.: 17/09) ou leitura reprovada.
- `A_REVISAR`: legado aguardando classificação (§9).

### 5.2 Referência (D8)
`referência = km_acumulado` da última leitura `CONFIAVEL` com `evento_em` anterior ao evento em validação, no ciclo atual. Leituras fora de ordem (offline sincronizado depois) são validadas contra a referência **do momento em que ocorreram**.

### 5.3 Validação (D6 — sem limites absolutos)
Com `Δt` = tempo desde a referência e `Δkm` = km informado − referência:

| Regra | Resultado padrão |
|---|---|
| `Δkm < 0` | BLOQUEIO → correção ou exceção |
| `km < referência × fracao_digito_faltando` | BLOQUEIO (suspeita de dígito faltando) |
| `Δkm > min(velocidade_media_max × Δt, km_dia_max × dias) + margem` | BLOQUEIO (fisicamente improvável) |
| `Δkm > fator_media_historica × média diária × dias + margem` | ALERTA |
| OCR com confiança ≥ mínima e divergência > máxima do digitado | ALERTA (mostra as duas leituras) |
| Foto obrigatória ausente | BLOQUEIO |
| OCR com confiança baixa | ALERTA |

**P4 (decidido):** todas as regras começam em modo `ALERTA`, com calibração pelo histórico real dos veículos (F2). A coluna "Resultado padrão" acima indica o comportamento **alvo**; nenhuma regra passa a `BLOQUEIO` antes de homologação específica (F5). Enquanto em `ALERTA`, a leitura que dispararia bloqueio fica `PROVISORIA` e entra no painel de inconsistências.

### 5.4 Correção (item 1)
Só `FROTAS_CORRIGIR_KM`; justificativa obrigatória; foto opcional; só leituras passadas. Gera evento `CORRECAO` ligado ao original. A saída mostra o KM corrigido e mantém o original visível. O banco recalcula referência e cópia do cadastro.

### 5.5 Exceção (item 2 — D5)
1. A leitura é bloqueada → o porteiro solicita exceção (justificativa + foto + KM informado).
2. Quem tem `FROTAS_AUTORIZAR_EXCECAO_KM` autoriza ou nega, com justificativa — sempre **autenticado** (sem fallback anônimo) e **diferente do solicitante** (P2).
3. Registro: veículo, operação (saída/retorno), saída, solicitante, autorizador, data/hora, justificativa, KM informado, referência do momento, canal.
4. Vale **uma vez**, até `valida_ate` (padrão 30 min, configurável). Depois: `EXPIRADA`.
5. A leitura liberada fica `NAO_CONFIAVEL`. **Referência e cadastro não mudam.**
6. Toda exceção usada entra no painel de inconsistências para correção posterior.

### 5.6 Troca / reinicialização de hodômetro (item 3)
Evento próprio, com a última leitura do painel antigo, a primeira do novo, data, foto e manutenção. Abre ciclo novo; a validação passa a usar só o ciclo novo; o KM acumulado continua crescendo. Relatórios de KM rodado usam `km_acumulado`.

### 5.7 Alertas de inconsistência (item 6)
- Na tela da Portaria: foto anterior ao lado da atual, OCR × digitado, motivo da validação.
- Painel de inconsistências (Frotas): leituras `PROVISORIA`/`NAO_CONFIAVEL`/`A_REVISAR`, exceções usadas, veículos sem leitura confiável recente — com foto e ação de correção.

## 6. Fluxos

### 6.1 Saída online
`ler KM + foto (+ OCR)` → `fn_frotas_km_validar` →
- OK → saída gravada + `fn_frotas_km_registrar_leitura` (CONFIAVEL);
- ALERTA → porteiro confirma com justificativa → leitura PROVISORIA;
- BLOQUEIO → corrigir a digitação **ou** pedir exceção → saída só depois de `AUTORIZADA` e `fn_frotas_km_usar_excecao`.

### 6.2 Retorno online
Mesma validação, com referência = KM de saída da própria viagem se confiável; o retorno não pode ser menor que a saída da mesma viagem (salvo exceção).

### 6.3 Offline (D7)
1. Leitura, foto, OCR e, se bloqueada, o **pedido de exceção** são gravados no aparelho (IndexedDB, fila atual), nunca descartados.
2. Validação local usa a última referência baixada (cache) — é só orientação.
3. **Liberação física (P3, decidido):** exceção não autorizada **não libera** o veículo e **não abre o portão automaticamente**. Veículo bloqueado não sai enquanto não houver autorização. O **procedimento de contingência supervisionado** para ausência de internet será documentado à parte, para aprovação (ponto de partida: autorização por telefone registrada com nome do autorizador e horário, revisada obrigatoriamente pelo gestor ao sincronizar). Não se propõe código/semente secreta no aparelho (regra do projeto: nada de segredo no front).
4. Ao sincronizar: os eventos entram com `evento_em` real, validados contra a referência daquele momento; pendências viram exceções `PENDENTE` ou itens do painel.

### 6.4 Correção, troca e revisão de legado
Telas de Frotas, restritas às permissões D1/D3, sempre com justificativa e confirmação do impacto (referência antes/depois).

## 7. Permissões (D1–D4)

| Ação (`cena_acoes`) | `admin` | `gestor_frotas` (novo, P1) | `supervisor_frotas` | `operador_cco` (futuro, P2) | `portaria` |
|---|---|---|---|---|---|
| `FROTAS_CORRIGIR_KM` | ✔ | ✔ | — | — | — |
| `FROTAS_AUTORIZAR_EXCECAO_KM` | ✔ | ✔ | — | ✔ (só na fase CCO) | — |
| `FROTAS_REGISTRAR_TROCA_HODOMETRO` | ✔ | ✔ | — | — | — |
| Registrar leitura / solicitar exceção | ✔ | ✔ | ✔ | — | ✔ (sem ação especial) |

- Concessão por contrato via `cena_permissoes_acao.contrato_id`; checagem no banco por `cena_pode()`.
- `supervisor_frotas` continua existindo e **não** recebe automaticamente as permissões de gestão; concessão individual só por decisão expressa na matriz.
- Perfil `gestor_frotas`: criação planejada (ainda não criado). Perfil `operador_cco`: criado só ao iniciar o módulo CCO.
- **Autorizar exceção exige:** usuário autenticado no Supabase Auth (`auth.uid()` não nulo — sem fallback anônimo), permissão válida e **solicitante ≠ autorizador** (checado no banco).

## 8. Integração futura com o CCO

- **Fila:** exceções `PENDENTE` já são uma fila no banco; o CCO assina via Realtime (mesmo mecanismo já usado na Portaria — `20260930170000_realtime_portaria_programacao.sql`).
- **Painel do CCO:** foto do hodômetro, OCR, gráfico do KM acumulado do veículo, equipe, programação do dia, histórico de exceções do veículo e do porteiro.
- **Decisão remota:** `fn_frotas_km_decidir_excecao` com `canal='REMOTO_CCO'`, pelo perfil `operador_cco` (criado nesta fase), com as mesmas exigências de autenticação, permissão e separação solicitante/autorizador; o tablet da Portaria escuta a própria solicitação e libera assim que `AUTORIZADA`.
- **Prazo e escalonamento:** sem resposta no prazo → próximo nível; avisos externos (celular/WhatsApp) por `functions/` (sem segredo no front).
- **Indicadores:** exceções por veículo/porteiro/base, tempo de resposta, veículos com leituras não confiáveis, divergências OCR × digitado.
- **Fonte adicional:** `frotas_veiculos.km_rastreador` / telemetria como origem de leitura `CONFIAVEL` com prioridade configurável.

## 9. Migração dos dados antigos (D8)

Princípio: **nada é reescrito**; a migração só **cria eventos** a partir do que existe.

1. **Ciclo 1** para todos os veículos.
2. Cada saída/retorno vira `LEITURA_SAIDA`/`LEITURA_RETORNO` com `origem='MIGRACAO'`, `evento_em` real e foto apontada para o pacote.
3. Cada item de `km_ajustes` vira `AJUSTE_LEGADO`, com antes/depois, autor e justificativa originais.
4. **Classificação:**
   - leituras recalculadas em ordem cronológica com as regras do §5.3 (em modo cálculo) → `CONFIAVEL` ou `A_REVISAR`;
   - ajustes legados entram `A_REVISAR` — **sem** regra automática "< 1.000 = inválido";
   - os ajustes de 17/09 dos 7 veículos, **por confirmação expressa do dono**, recebem `finalidade='DESBLOQUEIO_OPERACIONAL'` e `NAO_CONFIAVEL` (lista nominal, não regra).
5. **Referência inicial** de cada veículo recalculada; relatório com `km_atual` atual × referência proposta × evidência (foto) **para aprovação antes** de atualizar o cadastro.
6. Revisão dos `A_REVISAR` pelo Gestor de Frotas no painel (`fn_frotas_km_classificar_legado`).

Casos já levantados: DZH7G12 (referência provável 65401; fotos 09/10 = 65267, 17/10 = 65334), TLY9G76 (41363 na foto de 17/10; 127491 = autonomia), demais 6 veículos de 17/09 a levantar foto a foto.

## 10. 8.1.225 — correção do ciclo de regravação (antes da arquitetura)

Escopo mínimo, só tela, sem tabelas novas:
- `portKmUltimoRegistrado`: a regra "ajuste + cadastro menor que registros → vale o cadastro" só se aplica quando o ajuste é o registro mais recente da placa (ou da mesma viagem); depois disso valem os registros.
- `portKmAposRegistrar`/`portKmDefinirAtualVeiculo`: não gravar no cadastro um valor menor que a última leitura registrada da placa (comparação relativa ao histórico, sem limites absolutos — D6).
- Testes com os casos reais (DZH7G12, RTQ7D65, TTM8E99) e de regressão da Portaria.
- **Não** corrige os KMs gravados (isso é §9, com aprovação).

## 11. Etapas de implementação e testes

| Fase | Entrega | Testes obrigatórios |
|---|---|---|
| 8.1.225 | §10 | casos reais, regressão Portaria, isolamento TMA/Diário/PP/SOT |
| F1 — Banco | tabelas §4, regras, funções, permissões, RLS (migration idempotente, sem tocar dados) | PGlite + Postgres real: confiabilidade, referência cronológica, ciclos, exceção uso único/expiração, autoaprovação proibida, sem permissão → recusa, concorrência (duas exceções na mesma saída) |
| F2 — Migração em modo leitura | eventos a partir do histórico; relatório de referência proposta; regras em modo ALERTA | reconstrução idempotente; nenhum dado original alterado (assinatura antes/depois); conferência amostral com fotos |
| F3 — Portaria | validação pelo banco, pedido/uso de exceção, offline (§6.3); fim da gravação direta de `km_atual` | fluxos online/offline, fila sem perda, exceção expirada, tablets em versão antiga |
| F4 — Frotas | correção, troca de hodômetro, revisão de legado, painel de inconsistências | permissões por contrato, auditoria completa, relatórios de KM rodado por ciclo |
| F5 — Ativação de bloqueios | `modo=BLOQUEIO` por perfil, **somente após homologação específica das regras** (P4) | simulação com 30 dias reais (quantos bloqueios/alertas teriam ocorrido); homologação das regras com o dono |
| F6 — CCO | fila em tempo real, decisão remota, escalonamento, indicadores | latência, prazo, canal registrado, tablet libera só com AUTORIZADA |

Cada fase: diagnóstico → aprovação → implementação → testes → homologação → publicação autorizada.
