# Portaria 8.1.225 — Encerramento administrativo sem horário fictício

**Situação:** desenho técnico e plano de implementação para aprovação — **nada implementado**. Nenhuma migration aplicada, nenhum dos 228 registros históricos alterado, nenhuma saída regularizada.
**Branch:** `fix/portaria-encerramento-adm` (a partir de `fix/portaria-saida-aberta`, 8.1.224).
**Aprovação conceitual do dono:** 20/10/2026 — solução B (status `Retornado` + tipo de encerramento), regras 1–9 (§2).

---

## 1. Problema

Hoje o botão **Encerrar** (aba *Retornos em aberto*, `portEncerrarSaidaAdmin`) grava:
`status='Retornado'`, `data_retorno = <dia da saída>T23:59:59`, `obs_retorno='[Encerramento administrativo] …'`, `retorno_registrado_por`.

- O horário 23:59:59 é **convencional** e fica no mesmo campo do retorno real.
- Nada no sistema diferencia o encerramento de um retorno físico (o prefixo do texto não é lido por nenhum código).
- Existem **228** encerramentos assim (26/05 a 16/10/2026): 228 com 23:59:59, 226 sem KM de retorno; **todos** têm registro correspondente no `audit_log` (quem e quando).
- Efeitos: horas "em campo" até 23:59; custo/KM de Frotas soma `km_retorno − km_saida` com `km_retorno` nulo (**KM negativo**); pedágios associados até o fim do dia.

## 2. Regras aprovadas (20/10/2026)

| # | Regra |
|---|---|
| R1 | O encerramento administrativo **não inventa** horário de retorno. |
| R2 | Data e hora **da regularização** registradas separadamente. |
| R3 | Justificativa e **usuário autenticado** obrigatórios. |
| R4 | KM observado no pátio = **evidência**, não KM de retorno da viagem. |
| R5 | Os **228** históricos preservados integralmente; horários convencionais **identificados**, valores originais intocados. |
| R6 | Bloquear gravação direta que converta encerramento administrativo em retorno físico. |
| R7 | Retornos offline legítimos recebidos depois são **preservados e conciliados**. |
| R8 | Custo por KM, tempo em campo e atrasos não tratam encerramento como retorno real. |
| R9 | Compatibilidade com TMA, Programação de Projetos, Diário, SOT e Portaria. |
| UI | Portaria mostra **"Encerrado administrativamente"**. TMA e PP **sem alteração de código** nesta versão (identificação visual = melhoria futura). |
| V | 8.1.224 saída aberta/fotos/OCR · **8.1.225 encerramento** · 8.1.226 ciclo de regravação de KM. |

## 3. Desenho

### 3.1 Princípio
`status` continua sendo a **situação operacional** (`Em campo` / `Retornado` / `Cancelado`). **Como** a saída terminou passa a ser um dado próprio. Todo código que hoje decide "em campo × fora" (`portEstaEmCampo`, `portSaidaAbertaQualquerDia`, TMA `progTmaPortariaRetornou`, PP `ppOpsSaidaRetornou`, Showroom) **continua correto sem mudança**, porque o status segue `Retornado`.

### 3.2 Colunas novas em `frotas_portaria_saidas` (aditivas, todas anuláveis)

| Coluna | Tipo | Retorno físico | Encerramento administrativo |
|---|---|---|---|
| `tipo_encerramento` | text, CHECK (`RETORNO_FISICO`, `ENCERRAMENTO_ADMINISTRATIVO`) | `RETORNO_FISICO` | `ENCERRAMENTO_ADMINISTRATIVO` |
| `retorno_horario_conhecido` | boolean | `true` | `false` |
| `encerrado_em` | timestamptz | — | **momento real da regularização** (`now()` no banco) |
| `encerrado_por` | text | — | nome do responsável |
| `encerrado_por_auth` | uuid | — | `auth.uid()` |
| `encerramento_justificativa` | text | — | obrigatória (mín. 10 caracteres) |
| `encerramento_evidencia` | jsonb | — | `{foto, km_observado, observado_em, observado_por, local}` — **R4** |
| `encerramento_origem` | text | — | `FUNCAO` (novo) ou `LEGADO_23_59` (histórico) |
| `convertido_retorno_em` / `convertido_retorno_por_auth` / `conversao_justificativa` | | — | só se um retorno real for conciliado depois (§3.5) |

Regras de forma (CHECK):
- `tipo_encerramento='ENCERRAMENTO_ADMINISTRATIVO'` ⇒ `retorno_horario_conhecido=false`, `encerrado_em`, `encerrado_por` e `encerramento_justificativa` não nulos.
- Encerramento novo (`encerramento_origem='FUNCAO'`) ⇒ `data_retorno IS NULL` e `km_retorno IS NULL` (**R1/R4**).
- Histórico (`LEGADO_23_59`) mantém `data_retorno` original (**R5**).

> Alternativa avaliada e não recomendada: tabela separada `frotas_portaria_encerramentos`. Evita colunas novas, mas obriga todas as telas a juntar duas consultas; as colunas mantêm uma leitura só (`sbFetch` atual).

### 3.3 Funções do banco (SECURITY DEFINER, `auth.uid()` + `cena_pode`)

| Função | Faz |
|---|---|
| `fn_portaria_encerrar_saida_admin(p_saida uuid, p_justificativa text, p_evidencia jsonb)` | Exige autenticado (sem fallback anônimo) e `cena_pode('PORT_ENCERRAR_SAIDA_ADMIN', contrato)`. Só saída `Em campo`, não excluída, não acompanhante. Grava `status='Retornado'`, `tipo_encerramento`, `retorno_horario_conhecido=false`, `encerrado_*`, justificativa, evidência, `encerramento_origem='FUNCAO'`; **`data_retorno` e `km_retorno` ficam nulos**. Encerra junto as acompanhantes (`saida_principal_id`), porque o gatilho atual só age quando `data_retorno` muda para não nulo. Idempotente: se já encerrada, devolve o registro. Concorrência: `SELECT … FOR UPDATE`. |
| `fn_portaria_converter_retorno_fisico(p_saida uuid, p_data_retorno timestamptz, p_km_retorno numeric, p_origem text, p_justificativa text, p_evento_offline text)` | Única porta para transformar encerramento em retorno físico (**R6/R7**). Exige hora **real** (≥ saída, ≤ agora) e KM; grava `data_retorno`, `km_retorno`, `tipo_encerramento='RETORNO_FISICO'`, `retorno_horario_conhecido=true`, `convertido_*`. Mantém `encerrado_*` e justificativa originais (histórico). Origens: `OFFLINE_SINCRONIZADO` (evento do tablet com horário do evento) ou `GESTOR_COM_EVIDENCIA` (`PORT_ENCERRAR_SAIDA_ADMIN`). |

### 3.4 Proteção contra gravação direta (R6)
Ampliar o gatilho existente `cena_portaria_saida_acomp_validar` (BEFORE INSERT/UPDATE) — ou um gatilho novo dedicado, a decidir na implementação para não tocar a lógica atual de acompanhantes — com:
- linha com `tipo_encerramento='ENCERRAMENTO_ADMINISTRATIVO'`: recusar UPDATE que altere `data_retorno`, `km_retorno`, `tipo_encerramento`, `encerrado_*`, `encerramento_*`, salvo quando a sessão vier das funções do §3.3 (marcador `set_config('cena.portaria_enc','1', true)`, mesmo padrão da 1.7b);
- recusar `tipo_encerramento='ENCERRAMENTO_ADMINISTRATIVO'` gravado fora da função;
- não altera nenhuma outra gravação (retorno físico normal continua igual).

### 3.5 Offline (R7)
`portOffSyncRetorno` (portaria-offline.js) hoje: se o servidor já tem `Retornado` + `data_retorno` → CONFLITO; o PATCH usa `data_retorno=is.null`.
Novo comportamento:
- servidor com **encerramento administrativo** e evento offline de RETORNO com horário real → chama `fn_portaria_converter_retorno_fisico` (origem `OFFLINE_SINCRONIZADO`, `evento_em` real, KM e fotos do evento) → evento `SINCRONIZADO`;
- se a conversão for recusada (ex.: horário antes da saída), o evento fica `CONFLITO` com mensagem clara — **nunca descartado**, KM e fotos preservados no aparelho;
- servidor com retorno físico já registrado → CONFLITO como hoje.

### 3.6 Os 228 históricos (R5)
Migration **só preenche colunas novas**, sem tocar `status`, `data_retorno`, `km_retorno`, `obs_retorno`, `retorno_registrado_por`:
- critério: `obs_retorno LIKE '[Encerramento administrativo]%'` e `tipo_encerramento IS NULL`;
- `tipo_encerramento='ENCERRAMENTO_ADMINISTRATIVO'`, `retorno_horario_conhecido=false`, `encerramento_origem='LEGADO_23_59'`;
- `encerramento_justificativa` = texto após o prefixo;
- `encerrado_em` / `encerrado_por` = primeira entrada do `audit_log` que gravou esse encerramento (228 de 228 têm);
- relatório antes/depois por assinatura md5 de `status, data_retorno, km_retorno, obs_retorno, retorno_registrado_por` — deve ser **idêntica**.

Retornos físicos antigos **não** são marcados em massa (`tipo_encerramento` fica nulo = "não classificado", tratado como físico pelas telas, como hoje). A partir da 8.1.225 todo retorno novo grava `RETORNO_FISICO`.

## 4. Telas e código (index.html / portaria-offline.js)

| Ponto | Mudança |
|---|---|
| `portEncerrarSaidaAdmin` (90140), `portEncerrarUmAdmin` (90154), `portEncerrarSelecionadas` (90165) | Chamam `fn_portaria_encerrar_saida_admin`; janela própria (sem `prompt`) com justificativa obrigatória, foto e KM observado no pátio opcionais (evidência); mensagem de erro clara (`SEM_PERMISSAO`, `SEM_LOGIN`). Remove o `T23:59:59`. |
| `portPodeEncerrarAbertos` (90017) | Mantida como pré-checagem visual; a decisão real é do banco. |
| Gravação de retorno físico: `portAbrirVistoriaRetorno` (89839), `frtPortariaAbrirRetornoItem` (99889), demais `sbUpdate` de retorno | Incluem `tipo_encerramento='RETORNO_FISICO'`, `retorno_horario_conhecido=true` e a trava `status=eq.Em campo` no filtro (hoje só `data_retorno=is.null`, que um encerramento novo com `data_retorno` nulo deixaria passar). |
| `portSuprimirCloneSaida` (91028) | Filtro passa a exigir `status=eq.Em campo` (evita excluir cópia encerrada). |
| `portFundirSaidas` (90991) / `portPreferirSaida` (90972) | Tratar encerramento administrativo como "fora de campo" mesmo sem `data_retorno`; preservar os campos novos na fusão. |
| `portOffSyncRetorno` (portaria-offline.js) | §3.5. |
| Aba Retorno, detalhe (`frtPortariaMostrarDetalhe` 100006), lista de registros | Selo **"Encerrado administrativamente"**, "Horário de retorno desconhecido", data/hora e responsável da regularização, justificativa e evidência. Históricos `LEGADO_23_59`: "23:59:59 convencional — horário real desconhecido". |
| `frtPortariaRender` (94890) | Cartão próprio **"Encerradas adm."**; fora de "Retornados" e de "Atrasados"; coluna de horas vazia. |
| `frtCustosRender` (custo/KM, 98663) | Soma só quando `km_retorno` existe, `> km_saida` e não é encerramento administrativo (**corrige o KM negativo atual**). |
| `_ocioCalcMetricas` (97982) | Saída encerrada conta como uso do veículo, mas não entra em KM nem em tempo em campo. |
| `portSalvarAjusteKm` (100141) | Hoje exige KM de retorno se `Retornado`; para encerramento administrativo, KM de retorno não é exigido nem aceito (só pela conversão §3.3). |
| `portKmTsRegistro` / `portKmUltimoRegistroPlaca` | Encerramento sem horário ordena pela saída (não por 23:59); histórico `LEGADO_23_59` idem. Sem outra mudança no KM (ciclo de regravação fica para 8.1.226). |
| Pedágios (`modules/frotas/pedagios/pedagios-service.js` `resolverViagem`) | Encerramento sem horário usa a janela padrão (+18h), não até 23:59. |
| `PORT_SAIDA_SEL_LISTA` e selects da Portaria | Incluir as colunas novas leves (não o jsonb de evidência na lista; só no detalhe). |
| **TMA, Programação de Projetos, Diário, SOT** | **Nenhuma alteração de código** (R9 + decisão de UI). TMA/PP continuam mostrando "Retornou" (sem hora para os novos encerramentos). Identificação visual específica fica como melhoria futura. |

Permissão nova no catálogo: `PORT_ENCERRAR_SAIDA_ADMIN` (módulo PORTARIA) para `admin`, `gestor`, `coordenador` e `diretoria` (equivalente ao `portPodeEncerrarAbertos` atual), concessão por contrato.

## 5. Migration (não aplicada)

`supabase/migrations/2026102xxxxxxx_portaria_encerramento_administrativo.sql`, idempotente, em transação:
1. pré-requisitos (tabela e gatilhos existentes);
2. `ADD COLUMN IF NOT EXISTS` (§3.2) + CHECKs com `NOT VALID` seguido de `VALIDATE` após o passo 5;
3. ação `PORT_ENCERRAR_SAIDA_ADMIN` em `cena_acoes` + matriz em `cena_permissoes_acao` (`ON CONFLICT DO NOTHING`);
4. funções §3.3 e gatilho §3.4;
5. classificação dos 228 (§3.6), com contagem esperada e abortando se a assinatura dos campos originais mudar;
6. `GRANT EXECUTE` às funções para `authenticated` (não `anon`);
7. `NOTIFY pgrst, 'reload schema'`.

**Rollback** (bloco comentado no arquivo, só com autorização; revisado em 22/10/2026): remove gatilho, funções, a ação/permissões novas (revogação, sem exclusão física) e as colunas novas. **Nunca altera o status** de saída nem reabre veículo/equipe.
- Antes de remover, **acrescenta** uma cópia completa dos metadados em `frotas_portaria_saidas_encerramento_bkp` (com `rollback_id` único, data/hora e o estado operacional da saída no momento) e registra contagem + assinatura em `frotas_portaria_saidas_encerramento_rollbacks`. Essas tabelas e a função `cena_portaria_enc_bkp_assinatura` são permanentes (criadas pela migration, nunca apagadas pelo rollback), sem acesso pela API.
- **Reaplicação:** confere contagem e assinatura de **todas** as cópias; restaura a cópia **mais recente** de cada saída; recusa a saída que mudou de forma incompatível desde o rollback. Qualquer divergência interrompe a migration inteira (`BACKUP_INCONSISTENTE` / `RESTAURACAO_INCONSISTENTE`, com as saídas citadas) sem restaurar nem apagar nada. Encerramentos feitos pela versão antiga entre as aplicações são identificados como histórico (`LEGADO_23_59`). As regras de permissão revogadas pelo próprio rollback são recriadas (regra revogada não volta, por proteção da tabela); a ação volta a ficar ativa se o rollback a desativou.
- Testado em 4 ciclos (PGlite) e 3 ciclos (PostgreSQL 17.6 real), incluindo cópia adulterada e saída alterada depois do rollback.

Antes de aplicar: backup confirmado no painel, assinatura md5 dos 228 e de toda a tabela, conferência de colunas.

## 6. Testes

| Bloco | Casos |
|---|---|
| SQL (PGlite + Postgres real 17) | encerrar sem login → recusa; sem permissão → recusa; sem justificativa → recusa; saída já retornada / excluída / acompanhante → recusa; encerrar grava `encerrado_em` real e **`data_retorno` nulo**; idempotência e concorrência (duas sessões); acompanhantes encerradas juntas; UPDATE direto tentando pôr `data_retorno`/`km_retorno` num encerramento → recusa; conversão com horário real → aceita e preserva `encerrado_*`; conversão com horário antes da saída / futuro → recusa; classificação dos 228 idempotente e assinatura dos campos originais idêntica; rollback devolve o esquema anterior. |
| Tela (vm + sandbox, padrão atual) | botão Encerrar chama a função e nunca envia `T23:59:59`; janela exige justificativa; retorno físico grava `RETORNO_FISICO` e filtra `status=eq.Em campo`; supressão de cópia não atinge encerrada; fusão preserva encerramento; detalhe/lista mostram "Encerrado administrativamente"; cartões de Registros; custo/KM sem KM negativo; ociosidade; ajuste de KM em encerrada. |
| Offline | retorno offline sobre encerramento → conversão com horário do evento; conversão recusada → CONFLITO sem perder KM/fotos; tablet em 8.1.224 sincronizando contra servidor 8.1.225. |
| Compatibilidade | TMA (`progTmaPortariaRetornou`, `progTmaStatusPortaria`), PP (`ppOpsSaidaRetornou`), Showroom, Diário e SOT **com funções idênticas** à base (teste de isolamento); 8.1.224 trava de saída aberta continua igual; suíte completa sem falhas nem SKIP. |
| Homologação | endereço de teste da branch, leitura + um encerramento real **somente com autorização** (ex.: TLY9G76 16/10, cuja volta está provada pelas saídas seguintes). |

## 7. Compatibilidade entre versões
- **Tablets ainda na 8.1.224/8.1.223** depois da migration: o "Encerrar" antigo continuaria gravando `23:59:59` sem `tipo_encerramento`. Mitigação: o gatilho §3.4 marca automaticamente como `ENCERRAMENTO_ADMINISTRATIVO / LEGADO_23_59` qualquer gravação com `obs_retorno` iniciando por `[Encerramento administrativo]` e `encerrado_em = now()` (preserva o valor enviado, registra a hora real). Publicar a 8.1.225 logo após a migration.
- Retornos físicos de versões antigas continuam funcionando (colunas novas ficam nulas = "não classificado").
- `sbFetch` com `select=*` passa a trazer as colunas novas; selects explícitos antigos não quebram.

## 8. Plano de implementação (após aprovação)

| Passo | Entrega | Saída |
|---|---|---|
| 1 | Migration + teste SQL (PGlite) + teste em Postgres real (concorrência, rollback) | commit na branch |
| 2 | Portaria: encerrar pela função, janela de justificativa/evidência, selo "Encerrado administrativamente", travas de retorno físico, supressão de cópias, fusão | commit + testes de tela |
| 3 | Offline: conciliação §3.5 | commit + testes offline |
| 4 | Frotas: Registros, custo/KM, ociosidade, ajuste de KM; pedágios | commit + testes |
| 5 | Teste de isolamento TMA/PP/Diário/SOT; suíte completa; versão 8.1.225 | commit + push |
| 6 | Homologação no endereço de teste (leitura) | relatório |
| 7 | **Com autorização:** backup, migration, conferência dos 228 | relatório |
| 8 | **Com autorização:** merge e publicação (8.1.224 e 8.1.225 em sequência) | — |

## 9. Fora do escopo
- Regularizar as 4 saídas pendentes (TKK3C13, STE7A94, TLY9G76, STC8B57) — só depois de aprovado e publicado, caso a caso.
- Correções de KM do TLY9G76 (17/10 → 41.363 aprovada conceitualmente; 18/10 pendente de evidência).
- Identificação visual em TMA/PP; ciclo de regravação de KM (8.1.226); arquitetura de KM (F1–F6).
