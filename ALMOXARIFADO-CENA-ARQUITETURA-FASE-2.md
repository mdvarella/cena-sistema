# ALMOXARIFADO-CENA-ARQUITETURA-FASE-2

**Tipo:** projeto técnico e funcional — sem implementação  
**Base:** `ALMOXARIFADO-CENA-AUDITORIA-0.md` (código 8.1.142) e `ALMOXARIFADO-CENA-AUDITORIA-1-SUPABASE.md` (catálogo Postgres 17.6, 26/09/2026)  
**Branch de trabalho:** `Almocharifado-Abiude`  
**Escopo desta fase:** nenhuma alteração de código, banco, RLS, RPC, trigger, migration ou deploy.

O sistema de referência do Abiude entra **somente como catálogo funcional**. Não se copia código, schema nem arquitetura externa. Tudo abaixo é adaptação ao CENA e às integrações já confirmadas.

---

## 1. Resumo executivo

O Almoxarifado CENA já opera como **núcleo compartilhado** de RH, SESMT/NR-6, ficha/extrato, desmobilização, Programação (leitura), Frota/kits, requisições, NF e patrimônio. Não deve ser reescrito como produto isolado.

O problema estrutural confirmado pelo banco não é “falta de telas”. É a ausência de um **núcleo transacional**:

```text
hoje:  frontend altera estoque.saldo
       frontend (outra chamada) grava movimentacoes_itens
       RLS ALL true + GRANT DELETE para anon
```

A evolução proposta concentra **toda** mutação de saldo em um único contrato server-side (M0). Os módulos M1–M9 deixam de atualizar `estoque.saldo` diretamente. Ledgers paralelos (SAP/campo, PLPT, `sol_materiais`) **não são fundidos** nesta arquitetura; passam a ser origens explícitas, cada uma com adapter.

Decisões que **não** são silenciosas:

- baixa na separação **permanece** até haver `saldo_reservado` confiável (opção B por etapas);
- `epis` / `epi_fichas` continuam fonte NR-6;
- `prog_status_diario` permanece somente leitura para o Almox;
- `dest_base_id` permanece no cabeçalho da requisição;
- UNIQUE em `colaboradores.re` **não** entra sem saneamento prévio.

---

## 2. Problemas atuais

Confirmados pelas auditorias 0 e 1. Nenhum é hipótese.

| Problema | Evidência | Efeito |
|---|---|---|
| Sem atomicidade CENA | zero triggers em `estoque` / `movimentacoes_itens` | saldo e histórico podem divergir |
| Saldo editável direto | GRANT UPDATE/DELETE + RLS ALL true | o banco não é autoridade |
| Dois ledgers | `estoque.saldo` vs `alm_movimentos` (+ array JS) | dois “estoques oficiais” |
| Duas pessoas | `colaboradores.re` não unique; `funcionarios.matricula` unique | extrato/EPI/desmob quebram em duplicata |
| Entrega EPI ≠ saldo CENA | app baixa lote CA, não `estoque.saldo` | SKU some na posse e permanece no depósito |
| Transferência / ajuste | funções JS e RPC **inexistentes** | telas mortas; inventário sem motor |
| ALM-CORR-1 | tabela existe; `alm_correcao_item_executar` não | contrato banco↔app quebrado |
| Estorno sem DELETE | regra só no app; colunas `estornado_*` ausentes; chave NF-e não unique | histórico apagável |
| Idempotência | trava de botão 600 ms | duplo POST cria duas saídas |
| FKs frouxas | `estoque` sem `item_id`; req ids em text; EPI sem FK pessoa | integridade só no JS |
| Três famílias de requisição | `alm_requisicoes`, `plpt_requisicoes_materiais`, `sol_materiais` / `requisicoes_compra` | Kanban/campo e CENA não compartilham estado |
| SQL Almox fora do repo | `sql_alm_*.sql` citados, pasta ausente | regressão sem versão |

---

## 3. Princípios arquiteturais

1. **CENA continua um ERP.** Módulos conversam por contratos; o Almox não vira SaaS paralelo.
2. **Um escritor de saldo.** Só M0 altera quantidade física CENA.
3. **Movimento é fato; saldo é consequência.** Não existe `UPDATE estoque.saldo` sem linha de ledger.
4. **Histórico é append-only.** Estorno cria movimento inverso. Sem DELETE físico de fato operacional.
5. **Idempotência no servidor.** Chave única por operação de negócio.
6. **Integrações existentes são contratos.** RH, SESMT, NR-6, Programação (RO), Frota/kit, desmobilização, `dest_base_id`.
7. **Não duplicar fonte oficial.** EPI não ganha segunda tabela de entrega.
8. **Implantação progressiva.** Convivência temporária fluxo antigo × novo. Sem big bang.
9. **Saneamento antes de UNIQUE.** Duplicidade de RE é projeto de dados, não um `ALTER TABLE`.
10. **Abiude é referência funcional, não template de schema.**

---

## 4. Arquitetura modular proposta

```text
                    ┌─────────────────────────────────────┐
                    │  M9 Inteligência (somente leitura)  │
                    └──────────────────▲──────────────────┘
                                       │
     M2 Req   M5 Devolução   M7 Inventário   M8 NF/Recebimento
     M4 EPI   M6 Patrimônio  M3 Custódia     (adapters campo/SAP)
                                       │
                    ┌──────────────────┴──────────────────┐
                    │     M0 Núcleo transacional          │
                    │  validar → movimento → saldo → audit│
                    └──────────────────▲──────────────────┘
                                       │
                    ┌──────────────────┴──────────────────┐
                    │     M1 Estoque (SKU, depósito, lote)│
                    └─────────────────────────────────────┘

Leitura (sem escrita Almox):
  RH colaboradores  ·  SESMT funcionarios  ·  prog_status_diario
  frota / alm_veiculo_kit_materiais (definição)  ·  caepi_base_publica
```

| Módulo | Responsabilidade | Pode alterar `estoque.saldo`? |
|---|---|---|
| **M0** Núcleo | movimento, saldo, idempotência, estorno, autorização, origem | **sim, exclusivo** |
| **M1** Estoque | SKU, depósito, lote/CA, mínimo, situação | não (consulta + cadastro) |
| **M2** Requisições | solicitação → aprovação → picking → parcial → dest_base | não (chama M0) |
| **M3** Custódia | quem está com o quê agora | não (projeção de M0 + M4 + uniformes) |
| **M4** EPI/EPC/SESMT | NR-6, ficha, CA, lote, assinatura | não no saldo CENA; lote CA via M0 ou RPC CA já existente |
| **M5** Devoluções | lote de itens, estado, foto, assinatura | não (chama M0) |
| **M6** Patrimônio | unidade física, série, transferência, ajuste, manutenção | não (chama M0) |
| **M7** Inventário | contagem, divergência, aprovação | não (ajuste só via M0) |
| **M8** Recebimento/NF | NF, conferência, parcial, estorno | não (chama M0) |
| **M9** Inteligência | ABC, consumo, mínimo, quebras | não |

Adapters que **não** entram no saldo CENA nesta geração:

- **Campo/SAP/kit veículo:** continua em `alm_movimentos` + `campo_veiculo_saldo_*` + RPCs já existentes (`fn_alm_baixar_estoque_reposicao`, `fn_alm_resolver_kit_veiculo`). Evoluem para o mesmo *padrão* de M0 (RPC + idempotência), sem misturar coluna `estoque.saldo`.
- **PLPT / SOT / `sol_materiais`:** Kanban de obra legado. M2 CENA não os substitui nesta fase; um adapter de leitura/estado pode vir depois.

---

## 5. Núcleo transacional (M0)

Contrato conceitual (nome ilustrativo, **não criar agora**):

```text
alm_executar_movimento(
  p_idempotency_key,
  p_tipo,                  -- entrada | saida | entrega | devolucao
                           -- transferencia_saida | transferencia_entrada
                           -- ajuste | estorno | reserva | libera_reserva
  p_item_id,               -- uuid itens_catalogo (obrigatório no novo contrato)
  p_deposito_id,
  p_quantidade,            -- > 0
  p_origem_documento,      -- requisicao | nf | inventario | epi | desmob | avulso | sap_campo
  p_origem_documento_id,
  p_custodia,              -- colaborador | funcionario | equipe | veiculo | obra | deposito | nulo
  p_motivo,
  p_justificativa,
  p_movimento_estornado_id,-- só estorno
  p_grupo_transferencia_id,-- pares origem/destino
  p_lote_id,               -- CA / lote quando aplicável
  p_unidade_fisica_id,     -- patrimônio individual
  p_auth_uid
)
```

Pipeline **na mesma transação Postgres**:

```text
VALIDAR permissão + item + depósito + qtd + saldo disponível
     + idempotency_key
     + documento de origem
↓
LOCK da linha de saldo (ou equivalente) para o par item×depósito
↓
INSERIR movimentacoes (ledger) — nunca UPDATE de fato antigo
↓
ATUALIZAR saldo (físico e/ou reservado) como efeito do ledger
↓
INSERIR auditoria (saldo anterior, qtd, saldo posterior)
↓
COMMIT
```

Qualquer falha: **ROLLBACK**. O frontend não faz a segunda chamada.

Regras de M0:

- Frontend **não** recebe GRANT de UPDATE/DELETE em `estoque` nem em ledger.
- Tipos de movimento são enumerados no banco (CHECK ou enum).
- `estoque` futuro exige `item_id` UUID (hoje a ligação é por nome/código no app — débito a sanar na FASE A, sem apagar linhas atuais).
- SAP/campo **não** passa por esta função na FASE A; ganha função irmã no mesmo padrão, gravando `alm_movimentos`.

Papel do diagnóstico atual (`almDiag*`): permanece como **ferramenta de reconciliação** até o núcleo estar 100% no caminho crítico; depois vira relatório de exceção, não rotina.

---

## 6. Estoque (M1)

### 6.1 Conceitos

| Conceito | Hoje | Futuro |
|---|---|---|
| SKU | `itens_catalogo` (+ `ferramentas` legado) | `itens_catalogo` oficial; `ferramentas` só leitura/legado |
| Saldo físico | `estoque.saldo` int4 nullable, sem CHECK ≥ 0 | saldo derivado/atualizado só por M0; CHECK ≥ 0 no físico, salvo ajuste autorizado |
| Depósito | `depositos` / `filiais` | permanece; FKs reais |
| Localização | parcial / informal | campo de localização no saldo, não no movimento |
| Lote / CA | `alm_produto_lotes` + `caepi_*` | permanece; entrega EPI consulta `caepi_fn_*` |
| Valor | não é fonte oficial | opcional em M9 / custo médio futuro — fora do crítico |
| Mínimo | `alm_tma_estoque_minimo` (RLS off) | cadastro M1 com RLS; M9 consome |
| Situação | status no catálogo | ativo / inativo / quarentena / sucata |

### 6.2 Três saldos (quando a reserva existir)

```text
saldo_fisico      = quantidade no depósito
saldo_reservado   = comprometido por documento aberto
saldo_disponivel  = saldo_fisico - saldo_reservado
```

Saída física consome `saldo_fisico` e, se houver reserva do mesmo documento, consome `saldo_reservado` na mesma transação.

### 6.3 Saldo negativo

**Regra padrão:** saída, entrega, transferência de origem e estorno de entrada **não** podem deixar `saldo_disponivel` (e, na baixa física, `saldo_fisico`) negativo.

Exceções **explícitas**, nunca silenciosas:

| Exceção | Quando | Quem autoriza |
|---|---|---|
| Ajuste de inventário para menos | divergência aprovada em M7 | `almoxarifado.ajustar` |
| Compensação ALM-CORR-1 | item já processado, gestor aprovou | gestor + RPC de correção |
| Carga inicial / saneamento legado | FASE A, lote controlado | operação excepcional, auditada |
| Kit veículo / SAP | ledger próprio; já tem unique de saída por reserva | **não** usa `estoque.saldo` |

O diagnóstico de drift atual é evidência de que o sistema **já viveu** saldo incoerente. A regra nova não apaga o passado; impede o futuro.

---

## 7. Requisições (M2)

Preservar o documento CENA: `alm_requisicoes` + `alm_requisicao_itens` + `alm_requisicao_eventos`.

Preservar **`dest_base_id`** (Base Destino). Evolução: passar de TEXT para UUID de filial/base **depois** de backfill; até lá a coluna permanece, a obrigatoriedade continua no fluxo (hoje só no frontend).

Status atuais a preservar semanticamente:

```text
rascunho → solicitada → aprovada → separacao
        → parcialmente_atendida | separada → recebida
        (+ cancelada)
```

Eventos continuam append-only — desta vez **enforced** (REVOKE DELETE + sem policy DELETE).

### 7.1 Quando baixar estoque — decisão aberta

Hoje: **baixa na separação**, crédito no depósito destino só no **recebimento**. Aprovação não mexe saldo. Confirmado no banco (nenhum trigger de status altera estoque).

#### Opção A — manter baixa na separação

```text
aprovação     → não reserva, não baixa
separação     → M0 saída no depósito origem
recebimento   → M0 entrada no depósito destino (dest_base / dest_deposito)
cancelamento  → se já separado, estorno via M0; se não, só status
```

| Impacto positivo | Impacto negativo |
|---|---|
| Igual ao operação atual; menor retrabalho | Duas reqs aprovadas podem competir pelo mesmo saldo |
| `dest_base` e recebimento continuam iguais | Kanban “aprovada” não garante material |
| ALM-CORR-1 e relatórios atuais fazem sentido | Oversell até o picking |

#### Opção B — reserva na aprovação + baixa na separação

```text
aprovação     → M0 reserva (saldo_reservado += qtd)
separação     → M0 baixa física + consome reserva
parcial       → reserva residual permanece
cancelamento  → libera reserva; se já separado, estorno físico
recebimento   → inalterado (crédito destino)
```

| Impacto positivo | Impacto negativo |
|---|---|
| Disponível real na aprovação | Exige M0 + colunas de reserva **antes** de mudar regra |
| Atendimento parcial e Kanban ficam honestos | Req hoje aprovada sem estoque passaria a falhar |
| Alinha com picking do Abiude | Treinar almoxarife / gestor |

#### Recomendação

**Não mudar a regra de baixa na primeira entrega de M0.**

Sequência:

1. FASE A: M0 replica o comportamento atual (baixa na separação, crédito no recebimento), só que atômico.
2. FASE B1: introduz `saldo_reservado` **sem obrigar** reserva na aprovação (reserva opcional / piloto).
3. FASE B2: reserva obrigatória na aprovação, depois de medir oversell e treinar.

Critério para ligar B2: 100% das separações CENA passam por M0 **e** relatório de “aprovada sem disponível” revisado com operação.

Kanban / picking (ideia Abiude, adaptação CENA):

- quadro por status já existente + fila de separação por depósito origem;
- picking = conferência das linhas, não um segundo documento;
- parcial = `qtd_atendida < qtd_aprovada` já existe nas colunas; M0 movimenta só o atendido;
- cancelamento controlado: se houver movimento, só via estorno M0.

### 7.2 ALM-CORR-1 no desenho futuro

A tabela `alm_correcao_item_solicitacoes` **permanece**. A RPC ausente passa a ser um **orquestrador** sobre M0, não um segundo motor de saldo:

```text
alm_correcao_item_executar  (a criar só em fase de implementação)
  1. lock da solicitação pendente (unique já existe)
  2. revalidar qtd / depósito / permissão do gestor (auth_user_id)
  3. chamar M0: estorno e/ou compensação
  4. gravar status EXECUTADA | FALHA_EXECUCAO
  5. evento na requisição
```

Enquanto a RPC não existir, o fallback frontend **não deve ser expandido**. Novas correções esperam o núcleo.

---

## 8. Custódia (M3)

Pergunta única: **quem está com este item agora?**

Possíveis detentores: colaborador (RH), funcionário (SESMT), equipe, veículo, obra/base, depósito.

### 8.1 O que já é posse hoje (não duplicar)

| Trilha | Fonte histórica oficial | “Agora” |
|---|---|---|
| EPI/EPC | `epis` | status Ativo |
| Uniforme | `uniformes_colaborador` | linha vigente |
| Patrimonial | `movimentacoes_itens` tipo entrega / “Em uso” | derivado, frágil |
| Kit veículo | `campo_veiculo_saldo_*` | snapshot com trigger |
| Desmob | `desmobilizacoes_itens` | auditoria, não posse |

### 8.2 Três modelos

| Modelo | Vantagem | Risco |
|---|---|---|
| Só derivado do ledger | uma verdade | consulta lenta; posse EPI não está no ledger CENA |
| Só tabela materializada | rápido | drift se alguém gravar fora de M0 |
| **Híbrido** | M4/uniforme continuam donos da trilha legal; M3 materializa **projeção** atualizada por M0 | precisa disciplina: M3 nunca é escrito pela UI |

**Recomendação: híbrido.**

- NR-6 continua em `epis` / `epi_fichas`.
- Uniforme continua em `uniformes_colaborador`.
- Patrimonial / retornável genérico: projeção `alm_custodia_atual` (conceitual) alimentada **somente** por M0 quando o item for `retornavel`.
- Kit veículo: permanece no domínio campo; M3 **lê** (adapter), não regrava.
- Extrato do colaborador e desmobilização passam a consultar M3 + M4 + uniforme, com a mesma ponte RE.

Consumível: saída **não** abre custódia. Retornável: saída/entrega abre; devolução fecha.

---

## 9. EPI / SESMT (M4)

Não criar sistema paralelo de entrega.

```text
Almoxarifado (M0/M1)
    ↕  (baixa de lote CA / futuro SKU, nunca UPDATE epis.saldo genérico)
EPI posse          → tabela epis
Ficha NR-6         → tabela epi_fichas
SESMT pessoa       → funcionarios (ponte RE)
Ficha colaborador  → extrato lê; cadastro RH não é dono da posse
```

Fonte oficial futura = fonte atual confirmada:

- posse: `epis`
- ficha: `epi_fichas`
- mestre + lote/CA: `alm_produtos` / `alm_produto_lotes` / `caepi_base_publica`
- RPCs CA existentes: `caepi_fn_lookup`, `caepi_fn_pode_entregar_lote`, `caepi_fn_aprovar_lote_manual`

`epi_catalogo` / `epi_kits` / backups: **legado**, não fonte de entrega.

Assinatura: permanece nas colunas atuais neste horizonte; Storage dedicado é melhoria posterior, sem quebrar leitura da ficha.

Interface M0 × M4: a entrega de EPI chama M0 **só** se o SKU tiver saldo CENA a baixar (hoje não baixa). Até essa amarração, a entrega NR-6 **não espera** o estoque CENA — a obrigação legal não pode ficar presa ao núcleo novo. A amarração SKU↔lote é FASE C, depois de M0 estável.

---

## 10. Devoluções (M5)

Hoje: devolução unitária (EPI, uniforme, patrimonial) e ALM-1C **não iniciado**.

Documento futuro de devolução (conceitual):

- cabeçalho: colaborador/equipe/veículo, assinatura, fotos;
- linhas: item, qtd, estado (`bom` / `manutencao` / `quarentena` / `baixa`), depósito destino.

Cada linha vira **uma** chamada M0 (ou um lote na mesma transação RPC):

| Estado | Efeito M0 | Custódia |
|---|---|---|
| bom | entrada no depósito | fecha |
| manutencao | entrada em depósito/local de manutenção | fecha posse pessoa; abre posse oficina |
| quarentena | entrada bloqueada para saída | fecha |
| baixa | movimento de baixa, sem retornar disponível | fecha |

Vários itens numa única devolução = um `grupo_devolucao_id` compartilhado, vários movimentos, um COMMIT.

---

## 11. Patrimônio (M6)

Dois níveis:

```text
SKU          itens_catalogo          (ex.: MARTELETE BOSCH)
unidade      alm_unidade_fisica      (conceitual: ATIVO 001 / série X)
```

Hoje o catálogo mistura série no SKU; `ferramentas` é tabela unitária paralela; `ativos_inventario` é outro módulo. Futuro: SKU agrega; unidade física tem número de patrimônio/série único, responsável atual via M3, histórico via M0.

Transferência (hoje **inexistente** no JS e no `pg_proc`):

```text
documento de transferência (idempotency_key)
    ↓  mesma transação lógica
saída origem     (tipo transferencia_saida)
trânsito         (opcional: depósito virtual ou status em_transito)
entrada destino  (tipo transferencia_entrada, mesmo grupo_transferencia_id)
```

Recomendação: **dois movimentos vinculados**, um `grupo_transferencia_id`. Se o destino não confirma, o item permanece `em_transito` (custódia depósito origem em trânsito), não “some”. Confirmação posterior é M0 entrada. Não usar dois REST soltos.

Ajuste patrimonial (hoje inexistente): somente tipo `ajuste` via M0, com justificativa obrigatória e permissão `almoxarifado.ajustar`. Inventário (M7) é o caminho normal; ajuste avulso é exceção.

Manutenção: estado da unidade física; não edita saldo de SKU consumível. Ranking de quebras alimenta M9.

---

## 12. Inventário (M7)

Tabelas `alm_inventario_sessao` / `alm_inventario_linha` **já existem** (status rascunho/finalizado/ajustado/cancelado). Não há RPC de ajuste. O desenho reusa essas tabelas.

Escopos: geral, categoria, localização, depósito, rotativo.

```text
contagem
  → divergência (contado ≠ saldo_fisico)
  → aprovação
  → M0 tipo ajuste (nunca UPDATE estoque.saldo na UI)
  → sessão = ajustado
```

Idempotência: uma linha de divergência gera no máximo um movimento de ajuste (`origem_documento=inventario`, `origem_documento_id=linha_id`).

---

## 13. Recebimento / NF (M8)

Hoje há **duas** estruturas paralelas: `alm_notas_fiscais` (arquivo digital + eventos) e `alm_entradas_nf` (lote EPI/EPC). Sem FK. Chave NF-e **não unique**.

Fluxo alvo:

```text
NF cadastrada (ATIVA, chave unique quando preenchida)
  → recebimento (parcial permitido por linha)
  → conferência
  → M0 entrada (depósito destino obrigatório)
  → vínculo alm_nota_fiscal_movimentacoes
  → evento
```

Estorno:

```text
NF permanece (status ESTORNADA ou equivalente)
recebimento original permanece
M0 cria movimento inverso com movimento_estornado_id
sem DELETE em NF, evento, vínculo ou ledger
```

Colunas `estornado_em` / `estornado_por` / `justificativa` passam a existir **no modelo** (hoje o frontend espera e o banco não tem). Implementação só em fase posterior.

Duplicidade: UNIQUE de chave NF-e quando `chave` not null e status ATIVA; o “registrar mesmo assim” vira permissão explícita `almoxarifado.nf_forcar_duplicata`, não índice frouxo.

`requisicoes_compra.numero_rc` e `alm_notas_fiscais.rc` (texto) não são unificados nesta geração — adapter de leitura.

Recebimento de **requisição CENA** (crédito no destino) é M2+M0, não M8. M8 é NF/fornecedor.

---

## 14. Programação

Objeto confirmado: tabela `prog_status_diario`, UNIQUE `(colaborador_id text, data)`.

Contrato futuro **inalterado**:

- Almox **lê** status do dia (inclui treinamento na UX atual ALM-REQ-UX-1).
- Almox **não escreve**.
- RLS futuro do Almox: role de almoxarife sem policy INSERT/UPDATE/DELETE nessa tabela.
- Nenhuma trigger M0 aponta para Programação.

---

## 15. Frota

Contrato a preservar:

| Objeto | Papel futuro |
|---|---|
| `alm_veiculo_kit_materiais` | definição do kit |
| `fn_alm_resolver_kit_veiculo` | leitura STABLE — **não mudar assinatura** sem versão nova |
| `fn_alm_baixar_estoque_reposicao` | escrita SAP/campo; evolui para padrão M0 no ledger `alm_movimentos` |
| `campo_veiculo_saldo_*` | posse/snapshot do kit |
| veículos / portaria | donos no módulo Frota |

M3 lê kit como custódia de veículo. M2 CENA não substitui o Kanban de reposição campo. Unificar “estoque do kit” com `estoque.saldo` **não** está nesta arquitetura.

---

## 16. RH — ponte RE

Fato: `funcionarios.matricula` UNIQUE NOT NULL; `colaboradores.re` text NULL, **não unique**; 24 linhas extras duplicadas; 3 RE vazios; 1156 RE nas duas tabelas; **sem FK e sem view** da ponte.

### 16.1 O que não fazer

- Não aplicar UNIQUE agora.
- Não apagar colaboradores duplicados nesta fase.
- Não trocar a ponte por UUID sem mapa de coexistência (EPI e uniforme usam `funcionarios.id`).

### 16.2 Plano conceitual de saneamento (não executar)

```text
1. Inventário: listar RE duplicados, nulos, só-RH, só-SESMT
2. Classificar sobrevivente por regra humana:
     preferir linha com deleted_at nulo + vínculo SESMT + mais recente
3. Congelar cadastro de novo RE duplicado (validação de app + unique parcial
     WHERE deleted_at IS NULL AND re <> '')
4. Tabela de mapa explícito (conceitual) colaborador_id ↔ funcionario_id
     preenchida a partir da ponte texto, com conflitos em fila
5. Consumidores (extrato, EPI, desmob, vales) passam a preferir o mapa;
     fallback temporário: re = matricula
6. Só então UNIQUE parcial em colaboradores.re
```

Pessoa oficial:

- RH / req / programação: `colaboradores.id`
- NR-6 / uniforme / vales: `funcionarios.id`
- Ponte: mapa, não JOIN solto por texto

---

## 17. Auditoria

Toda operação M0 grava, no mínimo:

| Campo | Origem |
|---|---|
| usuário | `auth.uid()` + nome/RE snapshot |
| data/hora | `now()` no servidor |
| ação | tipo do movimento |
| registro | id do movimento |
| origem | módulo + documento |
| referência | req / NF / inventário / correção |
| saldo anterior | lock da linha |
| quantidade | parâmetro |
| saldo posterior | após aplicar |
| justificativa | obrigatória em ajuste/estorno/correção |

Trilhas atuais a **preservar** e alinhar:

- `alm_requisicao_eventos` (req)
- `alm_nota_fiscal_eventos` (NF)
- `auditLog` do ERP (hoje raro no Almox) — M0 pode emitir um evento padronizado

Não substituir as trilhas de req/NF; elas são domínio. M0 é a trilha de **estoque**.

---

## 18. Segurança / RLS / permissões

### 18.1 Permissões por ação

```text
almoxarifado.visualizar
almoxarifado.requisitar
almoxarifado.aprovar
almoxarifado.separar
almoxarifado.entregar
almoxarifado.devolver
almoxarifado.inventariar
almoxarifado.ajustar
almoxarifado.estornar
almoxarifado.transferir
almoxarifado.nf_registrar
almoxarifado.nf_estornar
almoxarifado.corrigir_item          -- ALM-CORR-1 (gestor)
```

Página visível ≠ ação permitida. O perfil de equipe pode `requisitar`; não `ajustar`.

### 18.2 RLS futuro (não aplicar agora)

| Objeto | SELECT autenticado | INSERT/UPDATE/DELETE direto |
|---|---|---|
| `estoque` | sim | **não** — só função M0 `SECURITY DEFINER` |
| ledger de movimento | sim (sem deleted físicos) | INSERT só via M0; UPDATE/DELETE **não** |
| `alm_requisicoes` | sim | INSERT/UPDATE de cabeçalho sim; saldo não |
| `epis` / `epi_fichas` | sim | escrita pelos fluxos NR-6 autenticados; DELETE físico **não** |
| `prog_status_diario` | sim para Almox | **não** para papéis de Almox |
| `alm_kits_*` | ligar RLS (hoje off) | autenticado restrito |

`anon` deixa de ter DELETE/TRUNCATE nas tabelas críticas.

FASE A precisa de **janela de convivência**: enquanto o `index.html` ainda faz REST direto, o REVOKE total quebra produção. Ver §25.

---

## 19. Idempotência

Tabela conceitual `alm_operacao_idempotente` (unique `idempotency_key`):

- primeira chamada executa M0 e grava resultado;
- repetição com a mesma chave **retorna o mesmo movimento**, sem segunda saída.

Aplicação:

| Fluxo | Chave sugerida (conceito) |
|---|---|
| Entrega avulsa | `entrega:{usuario}:{item}:{colab}:{ts_cliente}` ou UUID de formulário |
| Requisição salvar/enviar | já há unique de `numero`; chave de clique = id do rascunho + ação |
| Separação | `sep:{requisicao_item_id}:{qtd}:{seq}` |
| Recebimento req | `rec:{requisicao_id}` |
| Devolução | `dev:{grupo_devolucao_id}` |
| Inventário ajuste | `inv:{linha_id}` |
| Transferência | `trf:{grupo_transferencia_id}` |
| Estorno | `est:{movimento_id}` |
| NF entrada | `nfent:{nota_id}:{linha}` |
| ALM-CORR-1 | unique de pendência **já existe**; a RPC deve respeitar |

O anti-duplo-clique de 600 ms **permanece** como UX; deixa de ser a única defesa.

---

## 20. Estorno

Modelo:

```text
movimento original (imutável)
        ↓
movimento de estorno (tipo=estorno, movimento_estornado_id = original)
        ↓
efeito de saldo invertido via M0
```

Regras:

- um original tem no máximo um estorno efetivo (unique parcial);
- reverter estorno (ALM-NF-1.1c) cria **outro** movimento, não DELETE do estorno (o app hoje marca ajuste revertido com soft-delete — o futuro prefere movimento de reativação explícito);
- NF, eventos e req não são apagados;
- REVOKE DELETE nas tabelas de fato.

---

## 21. Fontes oficiais

| Informação | Fonte atual (auditorias) | Fonte futura |
|---|---|---|
| Colaborador | `colaboradores.id` (re não unique) | mesma; mapa RE saneado |
| Funcionário | `funcionarios.id` + UNIQUE matricula | mesma |
| EPI | `epis` | `epis` |
| Ficha EPI | `epi_fichas` | `epi_fichas` |
| Estoque CENA | `estoque.saldo` (app) | `estoque` atualizado **só** por M0 |
| Estoque SAP/campo | soma `alm_movimentos` no app | ledger `alm_movimentos` via RPC padrão M0 |
| Movimento CENA | `movimentacoes_itens` | mesmo ledger, só M0 escreve |
| Requisição CENA | `alm_requisicoes` + itens + eventos | mesmas tabelas |
| Patrimônio SKU | `itens_catalogo` (+ `ferramentas` legado) | `itens_catalogo` |
| Unidade física | implícita / `ferramentas` / `ativos_*` | unidade física M6 (novo conceito) |
| Custódia | espalhada (epis, uniforme, “Em uso”, campo) | M3 híbrido |
| NF | `alm_notas_fiscais` (+ `alm_entradas_nf` paralela) | `alm_notas_fiscais` oficial; entradas_nf legado até migrar leitura |
| Recebimento req | colunas no cabeçalho + app | cabeçalho + M0 |
| Kit veículo | kit + RPC resolver + `campo_veiculo_saldo_*` | igual |
| Programação | `prog_status_diario` | igual, RO |
| Veículo | cadastro Frota | igual |

Não inferido: não há view de saldo oficial hoje; o futuro pode ter view **de consulta** (`saldo_disponivel`), nunca como escritor.

---

## 22. Funcionalidades do sistema do Abiude

Referência funcional apenas. Código/schema externos **não** entram.

| Funcionalidade | Existe no CENA? | Como funciona hoje | Vale incorporar? | Módulo | Dependência | Risco |
|---|---|---|---|---|---|---|
| Kanban de requisições | Parcial | Status em `alm_requisicoes`; Kanban forte é o de **campo** (`alm_reservas_campo`) | Sim, quadro CENA por status/depósito | M2 | M0 para não desenhar saldo falso | Médio: misturar Kanban campo com req CENA |
| Picking | Parcial | Separação linha a linha (`almReqAtenderItem`) | Sim, lista de conferência + parcial | M2 | M0 + `dest_base_id` | Alto se mudar momento da baixa sem reserva |
| Curva ABC | Não | Relatórios 1/2 por período/status | Sim, depois do ledger confiável | M9 | M0 estável ≥ 1 ciclo | Baixo se for só leitura |
| Inventário | Tabelas sim, motor não | `alm_inventario_*` sem RPC; JS de ajuste ausente | Sim | M7 | M0 ajuste | Alto se UI editar saldo |
| Rastreamento de entrega | Parcial | Eventos da req + timeline patrimonial | Sim, um id de documento ponta a ponta | M2/M3 | idempotência | Médio |
| Itens em posse | Parcial | Extrato/desmob montam 3 trilhas + kit | Sim, visão M3 | M3 | ponte RE | Alto (duplicar EPI) |
| QR Code | Não no Almox CENA (há no portal de candidato) | — | Opcional, FASE F | M6/M3 | unidade física | Médio (etiqueta vs SKU) |
| Manutenção | Frota separado; ferramenta “estado” legado | `ferramentas` Bom/Regular/Danificado | Sim para retornável | M6 | M5 estados | Médio |
| Ranking de quebras | Não | — | Sim, M9 | M9 | M5/M6 estados | Baixo |
| Consumível × retornável | Implícito (tipo de item / devol. no catálogo) | Campos no cadastro; regra não enforced | **Sim, obrigatório no modelo** | M1/M3 | M0 | Médio se classificar errado o histórico |
| Assinatura | Sim (EPI/ficha, base64 na coluna) | NR-6 | Preservar; Storage depois | M4 | SESMT | Alto se migrar URL sem dual-read |
| Fotos | Parcial (NF/docs; campo/portaria) | Storage `cena-docs` | Sim na devolução M5 | M5 | bucket | Médio |
| Múltiplos itens | Req sim; entrega/devolução avulsa limitada | ALM-1B/1C não iniciados | Sim | M5/M2 | M0 lote | Médio |

---

## 23. Matriz preservar / melhorar / substituir / criar / legado

| Funcionalidade | Situação |
|---|---|
| Ponte `colaboradores.re` ↔ `funcionarios.matricula` | **Preservar** contrato; **melhorar** com mapa + saneamento |
| `epis` / `epi_fichas` / CA / lote / NR-6 | **Preservar** |
| `dest_base_id` | **Preservar**; **melhorar** FK depois do backfill |
| Baixa na separação (comportamento) | **Preservar** até FASE B2 |
| `alm_requisicoes` + itens + eventos | **Preservar**; **melhorar** FKs e append-only |
| Anti-duplo-clique UI | **Preservar**; complementar com idempotência server |
| Kits veículo + `fn_alm_resolver_kit_veiculo` | **Preservar** |
| `prog_status_diario` RO | **Preservar** |
| Desmobilização 4 trilhas | **Preservar**; **melhorar** lendo M3 |
| NF digital + eventos | **Preservar**; **melhorar** unique/estorno no banco |
| Diagnóstico de drift | **Preservar** até M0; depois relatório |
| ALM-CORR-1 tabela + unique pendência | **Preservar**; **criar** RPC sobre M0 |
| `estoque.saldo` escrito pelo frontend | **Substituir** (escritor = M0) |
| REST sequencial saldo+movimento | **Substituir** |
| RLS ALL true / DELETE anon | **Substituir** |
| Transferência / ajuste patrimonial | **Criar** (M0 + M6) |
| Idempotency key | **Criar** |
| `saldo_reservado` / `saldo_disponivel` | **Criar** (FASE B) |
| Unidade física rastreável | **Criar** (M6) |
| Custódia materializada híbrida | **Criar** (M3) |
| Permissões por ação | **Criar** |
| Motor de inventário via M0 | **Criar** (tabelas já existem) |
| Devolução múltipla / entrega múltipla | **Criar** (ALM-1B/1C) |
| Curva ABC / ranking | **Criar** (M9) |
| `ferramentas` (tabela) | **Legado** |
| `epi_catalogo` / `epi_kits` | **Legado** |
| `alm_entradas_nf` | **Legado** (leitura até unificar em NF) |
| `alm_estoque[]` JS | **Legado** (nunca foi tabela) |
| `backup_*_20260628` / `stg_epi_*` | **Legado** |
| `plpt_requisicoes_materiais` / `sol_materiais` | **Legado operacional paralelo** — não fundir na FASE A–C |

---

## 24. Dependências

### FASE A — Fundação e segurança

| Tipo | Itens |
|---|---|
| Tabelas (conceitual) | ledger CENA, `estoque` (passar a ter `item_id`), idempotência, auditoria M0; **sem drop** |
| RPCs | `alm_executar_movimento` (nome ilustrativo); **não** criar `alm_correcao_item_executar` ainda se o M0 não estiver estável — ou criar como wrapper no fim da A |
| Componentes | adapters JS `almRegistrarEntrada/Entrega/DevolucaoPatrimonio` → RPC; diagnóstico permanece |
| Módulos afetados | Almox entradas/movimentações/estoque |
| RH | somente leitura `colaboradores` |
| SESMT | não alterar entrega EPI nesta fase |
| Programação | nenhuma escrita |
| Frota | não alterar RPCs de kit |

### FASE B — Requisições e separação

| Tipo | Itens |
|---|---|
| Tabelas | req existentes; reserva (colunas ou tabela); `dest_base_id` permanece |
| RPCs | orquestradores separar / receber / cancelar / `alm_correcao_item_executar` |
| Componentes | `almReq*`, Kanban CENA, relatórios 1/2 |
| RH | solicitante = colaborador |
| SESMT | não |
| Programação | leitura `prog_status_diario` (treinamento) |
| Frota | não misturar com Kanban campo |

### FASE C — Custódia e devolução

| Tipo | Itens |
|---|---|
| Tabelas | projeção M3; documento de devolução; amarração SKU↔lote CA (opcional) |
| RPCs | lote de devolução via M0 |
| Componentes | extrato, desmob, ALM-1B/1C |
| RH | ponte RE / mapa |
| SESMT | `epis` continua oficial; extrato lê |
| Programação | não |
| Frota | M3 lê saldo kit |

### FASE D — Inventário

| Tipo | Itens |
|---|---|
| Tabelas | `alm_inventario_sessao` / `linha` (já existem) |
| RPCs | fechar sessão → N ajustes M0 |
| Componentes | UI inventário (hoje incompleta) |
| Outros módulos | nenhum write |

### FASE E — Patrimônio e manutenção

| Tipo | Itens |
|---|---|
| Tabelas | unidade física (novo conceito); transferência |
| RPCs | transferência dois movimentos; ajuste já é M0 |
| Componentes | telas mortas atuais passam a chamar M0 |
| Frota | manutenção de veículo permanece em Frotas; manutenção de ferramenta é M6 |

### FASE F — Inteligência

| Tipo | Itens |
|---|---|
| Tabelas | nenhuma obrigatória (views) |
| RPCs | leitura |
| Componentes | ABC, mínimos, quebras |
| Dependência dura | M0 + classificação consumível/retornável |

---

## 25. Ordem de implementação

Validada contra o código real (funções mortas, req em produção, tabelas de inventário órfãs, NR-6 vivo, kit veículo já transacional no SAP):

```text
FASE A   Fundação e segurança
         M0 atômico · idempotência · REVOKE gradual · item_id no saldo
         Entrada / saída / entrega / devolução patrimoniais atuais passam pelo núcleo
         Comportamento de saldo = o de hoje (baixa na separação)

FASE B   Requisições e separação
         almReqAtender / Receber via M0
         RPC ALM-CORR-1
         Kanban CENA + picking
         B1 reserva opcional → B2 reserva na aprovação (decisão operacional)

FASE C   Custódia e devolução
         M3 híbrido · ALM-1B/1C · desmob lê M3
         Não duplicar epis

FASE D   Inventário
         Reusar alm_inventario_* · ajuste só M0

FASE E   Patrimônio e manutenção
         Transferência · unidade física · ajuste avulso
         (depende de M0; hoje as funções nem existem)

FASE F   Inteligência e relatórios
         ABC · mínimos · quebras · QR opcional
```

Por que **não** inverter E e A: transferência/ajuste sem M0 reproduziria o bug atual em REST duplo.

Por que inventário depois de req: operação diária quebra mais gente; tabelas de inventário já esperam.

Por que inteligência por último: ABC sobre ledger podre é indicador falso.

---

## 26. Estratégia de migração futura (Abiude e legado CENA)

Nada se importa nesta fase.

O modelo futuro deve **comportar** origem externa, sem criar colunas agora:

```text
origem_sistema          -- CENA | ABIUDE | SAP_CAMPO | PLPT | IMPORT
origem_registro_id      -- id no sistema de origem
legacy_id               -- alias se necessário
data_original           -- fato histórico, não now()
usuario_original        -- snapshot
```

Regras:

- importação gera movimentos M0 com `origem_sistema` preenchido e idempotency_key estável (`import:{sistema}:{id}`);
- não recalcular saldo por UPDATE em massa se puder reaplicar ledger;
- kits/EPI do Abiude mapeiam para fontes oficiais CENA (`epis`, `itens_catalogo`), nunca para tabelas clone;
- convivência: um item pode ter `origem_sistema=ABIUDE` e operar no M0 no dia seguinte.

---

## 27. Compatibilidade (sem big bang)

```text
1. M0 existe; frontend antigo ainda grava REST  →  feature flag por fluxo
2. Adapters JS chamam RPC e, se flag off, caminho antigo
3. Diagnóstico mede drift
4. Flag on por tipo (entrada, depois entrega, depois req)
5. REVOKE UPDATE em estoque quando 100% do tipo passou
6. Caminho antigo vira erro explícito, não silêncio
```

Dois escritores no mesmo saldo **não** coexistem no estado 5. O estado 1–4 é a janela controlada.

NR-6, kits veículo e Programação **não** entram nessa janela como piloto de saldo CENA. EPI só quando houver decisão explícita de amarrar lote↔SKU.

---

## 28. Riscos e critérios de aceite

### Riscos

#### CRÍTICO (já confirmado; o desenho precisa eliminar)

| Risco | Origem | Tratamento no desenho |
|---|---|---|
| Saldo ≠ movimento | frontend + ausência de trigger | M0 única transação |
| DELETE anon | GRANT/RLS | REVOKE + append-only |
| RPC correção ausente | catálogo | wrapper M0 na FASE B |
| Transferência/ajuste mortos | JS e `pg_proc` | FASE E sobre M0, não REST |

#### ALTO

| Risco | Origem | Tratamento |
|---|---|---|
| UNIQUE prematuro em `re` | 24 duplicatas | saneamento §16 |
| Mudar baixa para aprovação sem reserva | tentação de “igual Abiude” | opção A até B2 |
| Duplicar EPI em M3 | posse vs NR-6 | híbrido, `epis` oficial |
| Unificar SAP kit com `estoque.saldo` | dois ledgers | adapters separados |
| REVOKE RLS cedo demais | app ainda REST | §25 flag |

#### MÉDIO

| Risco | Origem | Tratamento |
|---|---|---|
| `alm_entradas_nf` vs NF digital | duas tabelas | NF oficial; legado de leitura |
| `dest_base_id` text | sem FK | preservar, backfill depois |
| Assinatura base64 | coluna | dual-read se migrar Storage |
| SQL fora do repo | processo | versionar SQL **quando** houver implementação |

#### BAIXO

Numeração `REQ-CENA`; views IEC; backups.

Separação explícita:

- **Observado no frontend:** REST duplo, anti-duplo-clique, funções JS ausentes, entrega EPI ≠ saldo, `dest_base` obrigatório só na UI.
- **Confirmado no banco:** sem trigger, RLS permissivo, RPC CORR ausente, RE não unique, NF sem unique/estorno, inventário sem RPC.
- **Não confirmado:** Edge Functions, policies de Storage, bodies completos das 56 functions — não bloqueiam este desenho.

### Critérios de aceite desta FASE 2 (documento)

- [x] M0 definido como único escritor de saldo CENA
- [x] Atomicidade, idempotência e estorno sem DELETE especificados
- [x] Alternativas A/B da reserva com recomendação explícita
- [x] NR-6, ponte RE, `dest_base`, Programação RO, kits, desmob preservados
- [x] ALM-CORR-1, transferência e ajuste encaixados sem implementação
- [x] Abiude mapeado funcionalmente, sem cópia de arquitetura
- [x] Ordem A–F justificada pelo código/banco reais
- [x] Nenhuma migration, RPC, RLS ou código aplicados

### Critérios de aceite da implementação futura (ainda não iniciar)

Uma fase só fecha quando:

1. movimento e saldo daquele fluxo nascem na mesma transação;
2. repetir a mesma `idempotency_key` não duplica quantidade;
3. DELETE físico do fato falha para o papel da aplicação;
4. extrato, desmob, EPI e kit veículo continuam iguais para o usuário nesses contratos;
5. `prog_status_diario` não recebe escrita do Almox;
6. diagnóstico de drift do fluxo migrado = zero em homologação.

---

## Preservar obrigatoriamente (checklist de arquitetura)

| Item | Onde vive hoje | No desenho futuro |
|---|---|---|
| Ponte RE | convenção texto | preservada até mapa saneado |
| NR-6 | `epis` / `epi_fichas` | fonte oficial inalterada |
| `dest_base` | coluna text na req | preservada |
| NF + estorno sem DELETE | só app | passa a ser regra de M0 + RLS |
| ALM-CORR-1 | tabela sim / RPC não | RPC = orquestrador M0 |
| Kits de veículo | tabelas + RPC leitura | preservados; ledger SAP separado |
| Desmobilização | `desmobilizacoes_itens` + 4 fontes | preservada; M3 como leitura |
| Anti-duplo-clique | frontend | UX + chave server |
| Programação RO | tabela `prog_status_diario` | contrato RO explícito |

---

`STATUS: ARQUITETURA FASE 2 CONCLUÍDA — NENHUMA IMPLEMENTAÇÃO REALIZADA`
