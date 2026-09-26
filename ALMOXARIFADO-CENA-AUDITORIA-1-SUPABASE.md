# ALMOXARIFADO-CENA-AUDITORIA-1-SUPABASE

**Tipo:** confirmação de banco — somente leitura  
**Projeto:** `Controle de EPIS e Ferramentas` (`qxexyghcennllrmjqafg`, `sa-east-1`, Postgres 17.6)  
**Acesso:** CLI Supabase `db query --linked` como role `postgres` (Management API). Apenas `SELECT` em `information_schema` / `pg_catalog` e **contagens agregadas** (sem PII).  
**Nenhuma alteração realizada:** sem INSERT/UPDATE/DELETE, sem migration, sem deploy, sem mudança de RLS/RPC/trigger.  
**Base de código:** auditoria 0 (`ALMOXARIFADO-CENA-AUDITORIA-0.md`) em 8.1.142.

---

## 1. Resumo executivo

O banco **existe e está acessível**. As tabelas centrais da auditoria 0 estão no schema `public`. O modelo de saldo CENA (`estoque.saldo` + `movimentacoes_itens`) **não tem trigger, function ou RPC que os amarre**. RLS está ligado na maioria das tabelas, mas as policies críticas são `USING true` / `WITH CHECK true` para `anon` e `authenticated`, e o GRANT inclui `DELETE` e `TRUNCATE`.

```text
ATOMICIDADE:
[ ] SIM
[x] NÃO
[ ] PARCIAL
[ ] NÃO FOI POSSÍVEL CONFIRMAR

Evidência:
- Zero triggers em estoque e movimentacoes_itens (pg_trigger + information_schema).
- estoque.saldo é int4 NULL default 0; UPDATE direto é permitido (GRANT + RLS ALL).
- Não existe function/RPC fn_estoque, alm_registrar_*patrimonio, nem alm_correcao_item_executar.
- Únicos triggers Almox CENA: número da requisição e atualizado_em (não mexem saldo).
- Atomicidade parcial SÓ no fluxo campo/SAP: AFTER INSERT/UPDATE em campo_baixas_materiais chama trg_campo_baixa_recalc_saldo e fn_alm_baixar_estoque_reposicao grava alm_movimentos (não estoque.saldo).
```

Achados de banco que a auditoria 0 não via:

- Tabelas extras: `alm_inventario_sessao` / `alm_inventario_linha`, `alm_entradas_nf`, `desmobilizacoes_itens`, `ferramentas` (legado), `epi_catalogo` / `epi_kits`, `requisicoes_compra`, `sol_materiais`, backups `backup_*_20260628`, staging `stg_epi_*`.
- `prog_status_diario` é **tabela** (não view), UNIQUE `(colaborador_id, data)`, `colaborador_id` **text**.
- RPC `alm_correcao_item_executar` **não existe** no catálogo (comentário da tabela mente / está desatualizado).
- `colaboradores.re` **não é UNIQUE**; 1226 linhas, 24 extras de RE duplicado, 3 RE nulo/vazio. `funcionarios.matricula` **é UNIQUE NOT NULL**.
- Colunas de estorno `estornado_em` etc. **não estão** em `alm_notas_fiscais` (o frontend lista; o banco tem `status` + eventos).
- Kits `alm_kits_colaborador` e `alm_kits_tipo_equipe`: **RLS desligado**.

---

## 2. Schema confirmado

Catálogo `public`: **350 tabelas**, **2 views** (`vw_colaborador_score`, `vw_equipe_score`). Nenhuma view calcula saldo de estoque.

### 2.1 Prioridade da auditoria 0 — confirmadas

| Nome | Finalidade (comentário/uso) | PK | FKs reais | RLS |
|---|---|---|---|---|
| `estoque` | Saldo físico CENA | `id uuid` | `filial_id→filiais`, `deposito_id→depositos`, `contrato_id→contratos`. **Sem FK para itens_catalogo** | on, policy ALL true |
| `movimentacoes_itens` | Ledger patrimonial | `id uuid` | `item_id→itens_catalogo` | on, ALL true |
| `alm_movimentos` | Ledger SAP/campo | `id uuid` | **nenhuma FK** (ids text/uuid soltos) | on, ALL true |
| `epis` | Posse EPI/EPC NR-6 | `id uuid` | só `filial_id→filiais`. **`responsavel_id` sem FK** | on, ALL true |
| `epi_fichas` | Ficha NR-6 | `id uuid` | `ficha_pai_id→epi_fichas`. **`colaborador_id` sem FK** | on; INSERT/SELECT/UPDATE true; **sem policy DELETE** |
| `uniformes_colaborador` | Posse uniforme | `id uuid` | `uniforme_id→uniformes_catalogo`. **`funcionario_id` sem FK** | on, ALL true |
| `colaboradores` | Pessoa RH | `id uuid` | (outras FKs de RH; **sem UNIQUE em re**) | on, ALL true |
| `funcionarios` | Pessoa SESMT | `id uuid` | — ; **UNIQUE matricula** | on, ALL true |
| `alm_requisicoes` | Cabeçalho req CENA | `id uuid` | **nenhuma FK** (ids **text**) | on, ALL true |
| `alm_requisicao_itens` | Linhas | `id uuid` | `requisicao_id→alm_requisicoes`. `item_id` **text sem FK** | on, ALL true |
| `alm_requisicao_eventos` | Histórico append (comentário) | `id uuid` | `requisicao_id→alm_requisicoes` | on, ALL true (DELETE permitido) |
| `alm_notas_fiscais` | NF digital | `id uuid` | — | on; anon ALL; auth SELECT/INSERT/UPDATE |
| `alm_nota_fiscal_movimentacoes` | Vínculo NF↔mov | `id uuid` | `nota_fiscal_id→alm_notas_fiscais` | idem |
| `alm_nota_fiscal_eventos` | Auditoria NF | `id uuid` | `nota_fiscal_id→alm_notas_fiscais` | anon ALL; auth INSERT/SELECT |
| `alm_correcao_item_solicitacoes` | ALM-CORR-1 | `id uuid` | **sem FK** (ids TEXT, comentário) | on, ALL true |
| `alm_produtos` / `alm_produto_lotes` | Mestre EPI/EPC + CA | uuid | lote→produto; lote→`caepi_base_publica` | on, ALL public |
| `alm_veiculo_kit_materiais` | Kit operacional do veículo | `id uuid` | uniques parciais por veículo/tipo | on, ALL public |
| `alm_kits_tipo_equipe` / `alm_kits_colaborador` | Kits JSON | `id uuid` | **RLS false** | off |
| `alm_reservas_campo` / `alm_reserva_itens` | Kanban campo | uuid | uniques carga/reposição | on, ALL public |
| `alm_entregas_campo` | Kanban legado | uuid | — | on, ALL public |
| `desmobilizacoes_itens` | Auditoria desmob | `id uuid` | **sem FK** p/ colaborador (uuid NOT NULL mesmo assim) | on (não listada nas policies filtradas — ver lacuna) |
| `itens_catalogo` | Catálogo | `id uuid` | `alm_produto_id` coluna sem FK listada | on, ALL true |
| `filiais` / `depositos` | Local | uuid | deposito→filial | on, ALL true |
| `prog_status_diario` | Status do dia | `id uuid` | **não é view**; UNIQUE (colaborador_id text, data) | on, ALL true |
| `vales` | Vale mau uso | `id uuid` | UNIQUE numero | on, ALL true |

### 2.2 Encontradas no banco e pouco/não citadas no frontend 8.1.142

| Nome | Nota |
|---|---|
| `alm_inventario_sessao` / `alm_inventario_linha` | Inventário de estoque no banco, com FK para contratos/depositos/filiais/`colaboradores`. Status check: rascunho/finalizado/ajustado/cancelado |
| `alm_entradas_nf` | Lote de entrada NF aguardando validação (EPI/EPC); status pendente_validacao/validada/cancelada. **Paralela** a `alm_notas_fiscais` |
| `ferramentas` | Tabela legado unitária (estado Bom/Regular/Danificado) **além** de `itens_catalogo` |
| `epi_catalogo` / `epi_kits` | Catálogo/kits SESMT; `alm_produto_id` de migração |
| `requisicoes_compra` | RC com `numero_rc`, status Pendente — **não** amarrada a `alm_notas_fiscais.rc` (texto) |
| `sol_materiais` | SAP/cliente (comentário da req CENA: não confundir) |
| `campo_*` (saldo_dia, saldo_base, baixas, vistoria, checklists, recebimentos, solicitações) | Kit veículo TMA |
| `caepi_base_publica` + hist + importações | Espelho CA MTE |
| `ativos_*` | Inventário de Ativos (módulo separado) |
| `backup_*_20260628` | Cópias epis/estoque/catálogo |
| `stg_epi_*` / `stg_importacao_itens_almoxarifado` | Staging importação |
| `alm_tma_estoque_minimo` | Mínimos TMA; **RLS false** |
| `alm_migracao_log` | Log migração |

`alm_estoque` **não existe** como tabela (confirma array JS da auditoria 0).

---

## 3. Relacionamentos (fatos)

```text
itens_catalogo.id  <── movimentacoes_itens.item_id     (FK)
depositos.id       <── estoque.deposito_id             (FK)
filiais.id         <── estoque.filial_id, epis.filial_id
contratos.id       <── estoque.contrato_id, alm_inventario_sessao.contrato_id

alm_requisicoes.id <── alm_requisicao_itens.requisicao_id
                   <── alm_requisicao_eventos.requisicao_id

alm_notas_fiscais.id <── alm_nota_fiscal_* 

alm_produtos.id    <── alm_produto_lotes.produto_id
caepi_base_publica.id <── alm_produto_lotes.caepi_id

uniformes_catalogo.id <── uniformes_colaborador.uniforme_id
                      <── estoque_uniformes.uniforme_id

NÃO EXISTE FK:
  epis.responsavel_id  → funcionarios.id
  epi_fichas.colaborador_id → funcionarios.id nem colaboradores.id
  uniformes_colaborador.funcionario_id → funcionarios.id
  estoque ↛ itens_catalogo
  alm_requisicoes.dest_base_id (TEXT) ↛ filiais
  alm_requisicao_itens.item_id (TEXT) ↛ itens_catalogo
  colaboradores.re ↛ funcionarios.matricula
  desmobilizacoes_itens.colaborador_id ↛ colaboradores.id
```

---

## 4. Estoque e movimentações

### CENA

- Saldo oficial **persistido:** `estoque.saldo` (`int4`, default 0, **nullable**, **sem CHECK ≥ 0**).
- Ledger: `movimentacoes_itens.tipo_mov` NOT NULL; `quantidade int4` NOT NULL default 1; `deleted_at` presente.
- `estoque` **não tem** `item_id`. Ligação ao catálogo é por nome/codigo/sku no aplicativo.
- Soft-delete: coluna `deleted_at` em estoque e movimentos; **sem trigger** que impeça DELETE físico.

### SAP / campo

- Ledger oficial: `alm_movimentos` (`tipo`, `qtd`, `qtd_aplicada`, `qtd_devolvida`, `deleted_at`, `reserva_item_id`, `origem_movimento`).
- **Não há coluna de saldo.** Unique parcial: uma `saida` por `reserva_item_id` em carga/reposição.
- Snapshot operacional veículo: `campo_veiculo_saldo_dia` / `campo_veiculo_saldo_base` (recalc via trigger/RPC de **campo**, não de `estoque.saldo`).

### Views de saldo

**Não encontradas.**

### Triggers que atualizam `estoque.saldo`

**Não encontradas.**

### `estoque.saldo` pode ser alterado direto?

**Sim.** GRANT `UPDATE`+`DELETE` para `anon`/`authenticated`; RLS `ALL USING true`.

---

## 5. Atomicidade

Ver caixa no resumo. Complemento:

| Proteção DB | CENA patrimonial | SAP/campo |
|---|---|---|
| Trigger pares saldo+mov | não | não em `estoque`; sim recalc em `campo_baixas_materiais` |
| RPC transacional | não | `fn_alm_baixar_estoque_reposicao` (só `alm_movimentos`) |
| Constraint que exija movimento | não | unique saída por reserva_item (reposição) |
| Procedure | não | não |

---

## 6. EPI / NR-6 / SESMT

### `epis`

- PK `id uuid`.
- `responsavel_id uuid NULL` — **sem FK** (app usa `funcionarios.id`).
- CA: `ca`, `ca_validade`, snapshot `ca_numero_entregue`, `ca_validade_entregue`, `ca_situacao_entregue`.
- Lote: `lote_id`, `produto_id` **sem FK** para `alm_produto_lotes` / `alm_produtos`.
- Entrega: `data_entrega`, `motivo_entrega`, `status` default `Ativo`.
- Substituição: `data_prevista_substituicao`; status livres (índice exclui Devolvido/Substituído/Cancelado).
- Assinatura: `assinatura_url` / `assinatura_em` / `assinatura_nome` (texto; não Storage).
- CHECK `tipo IN ('EPI','EPC')`.
- `deleted_at` existe.
- Trigger: **nenhum**. RLS: ALL true. GRANT inclui DELETE.

### `epi_fichas`

- PK `id`. Self-FK `ficha_pai_id`.
- `colaborador_id uuid NULL` **sem FK**; também `colaborador_re` text.
- `itens jsonb NOT NULL`.
- Assinatura nas mesmas três colunas.
- RLS: SELECT/INSERT/UPDATE true; **sem DELETE policy** → DELETE de `anon`/`authenticated` tende a falhar por RLS (GRANT ainda tem DELETE). `service_role` ignora RLS.

### Duplicatas SESMT

Sim, no banco: `epi_catalogo`, `epi_kits`, `alm_produtos`+lotes, `epis`, backups `backup_epis_20260628` / `backup_epi_catalogo_20260628`.

---

## 7. RH (ponte RE)

| | `colaboradores.re` | `funcionarios.matricula` |
|---|---|---|
| Tipo | `text NULL` | `text NOT NULL` |
| UNIQUE | **não** | **sim** (`funcionarios_matricula_key`) |
| FK entre tabelas | **não** | **não** |
| View/function da ponte | **não encontrada** (só `epi_imp_fn_norm_matricula` / correção de import) | |

Contagens (26/09/2026, agregado):

| Métrica | Valor |
|---|---|
| colaboradores | 1226 |
| RE nulo/vazio | 3 |
| RE distintos | 1199 |
| linhas extras por RE duplicado | 24 |
| funcionarios | 1160 |
| matricula nula | 0 |
| RE presente nas duas tabelas | 1156 |
| RE só em colaboradores | 43 |
| matrícula só em funcionarios | 4 |

**Risco estrutural confirmado pelo banco:** a ponte é convenção de texto, sem constraint; RE duplicado no RH quebra o casamento 1:1 com SESMT.

---

## 8. Requisições CENA

Tabelas: `alm_requisicoes` + `alm_requisicao_itens` + `alm_requisicao_eventos`.

- Cabeçalho: `numero` UNIQUE, `status` CHECK (enum textual), `deposito_id`/`dest_base_id`/`dest_deposito_id` **text, nullable, sem FK**.
- `dest_base_id` **existe no banco** (obrigatoriedade é frontend).
- Solicitante/aprovador/atendimento/recebimento: colunas `*_por` / `*_em` text/timestamptz. Sem FK para `auth.users`.
- Item: qtd solicitada/aprovada/atendida; `entrega_individual`; colaborador/equipe/veículo **text**.
- Eventos: CHECK de tipo (`criada`, `enviada`, `aprovada`, …); comentário append-only **não é enforced** (DELETE grant+policy).
- Triggers: `trg_alm_req_set_numero` BEFORE INSERT; `trg_alm_req_atualizado_em` BEFORE UPDATE. **Não alteram estoque.**
- **Nenhuma function** dispara saldo em mudança de status.

`plpt_requisicoes_materiais`, `sol_materiais`, `requisicoes_compra` coexistеm — ledgers paralelos.

---

## 9. Recebimento

**Requisição CENA — confirmado no banco:** não há trigger/RPC de recebimento. O crédito no destino é **somente frontend** (`almReqConfirmarRecebimento` → `almRegistrarEntradaPatrimonio`). Colunas `recebido_por` / `recebido_em` existem.

```text
Recebimento req CENA
↓
UPDATE alm_requisicoes.recebido_* / status   (app)
↓
[DB: nenhum trigger]
↓
INSERT movimentacoes_itens + UPDATE estoque.saldo   (app, duas chamadas)
```

**Campo/veículo:** `campo_recebimentos_materiais` existe; saldo do kit é `fn_campo_recalc_saldo_veiculo` / `campo_veiculo_saldo_dia` — **não** `estoque.saldo`.

**NF:** `alm_entradas_nf` (validação lote) **e** `alm_notas_fiscais` (arquivo digital). Sem FK entre elas.

Duplicidade NF: índice **não unique** em `chave_acesso_nfe` (`idx_alm_nf_chave`). Proteção só no app.

---

## 10. NF + estorno sem DELETE

| Fato banco | Evidência |
|---|---|
| Tabela | `alm_notas_fiscais.status` default `ATIVA`; eventos e vínculos |
| Colunas `estornado_em` / `estornado_por_*` / `justificativa_estorno` | **AUSENTES** nesta base (existem no allowlist do `index.html`) |
| UNIQUE chave NF-e | **não**; só btree index |
| Rule/trigger anti-DELETE | **não** |
| GRANT DELETE anon | **sim** |
| RLS bloquear DELETE | **não** (anon `ALL`) |

“Estorno sem DELETE” é **regra de aplicativo**, não de banco. DELETE físico de NF **é possível** via PostgREST com a anon key.

`movimentacoes_itens.deleted_at` e `alm_movimentos.deleted_at` existem; DELETE físico também é GRANT.

---

## 11. ALM-CORR-1

- Tabela `alm_correcao_item_solicitacoes` **existe**, RLS on, UNIQUE parcial de pendência por `requisicao_item_id`.
- CHECK status: `AGUARDANDO_APROVACAO|APROVADA_EXECUTANDO|EXECUTADA|FALHA_EXECUCAO|REJEITADA|CANCELADA`.
- Comentário da tabela cita RPC `alm_correcao_item_executar`.
- **Function `alm_correcao_item_executar`: NÃO EXISTE** (`pg_proc` vazio para `%correcao_item%` / `%alm_correcao%`).
- Execução hoje, se houver, é o **fallback frontend** da auditoria 0.
- Risco de regressão: criar a RPC depois sem o contrato do fallback; ou o front assumir que a RPC existe.

---

## 12. Kits de veículo

| Objeto | Papel |
|---|---|
| `alm_veiculo_kit_materiais` | Definição: veículo **ou** tipo_operacional+contrato; `quantidade_basica`; UNIQUE parciais |
| `fn_alm_resolver_kit_veiculo(...)` | RPC **STABLE** (leitura): veículo → tipo+contrato → tipo global |
| `campo_vistoria_inicial_*` | Baseline físico; trigger calcula faltante/excedente |
| `alm_reservas_campo` tipo `carga_inicial_veiculo` / `reposicao_veiculo` | Entrega/reposição; unique por vistoria/baixa |
| `fn_alm_baixar_estoque_reposicao` | VOLATILE: insert `alm_movimentos` tipo saida; **não toca `estoque`** |
| `campo_veiculo_saldo_base` / `_dia` | Posse/histórico diário do kit |
| `fn_campo_recalc_saldo_veiculo` | Recalc snapshot |
| `fn_atualizar_status_kit_veiculo` | Status no veículo |

EPI/ferramenta de kit pessoal: `alm_kits_colaborador` / `alm_kits_tipo_equipe` (JSON `itens`, **RLS off**).

---

## 13. Desmobilização

Tabela própria: `desmobilizacoes_itens`  
CHECK `trilha IN ('epi','epc_nr6','uniforme','patrimonio')`.  
Fontes lidas pelo app (auditoria 0) vs banco:

| Trilha | Fonte de posse | Registro desmob |
|---|---|---|
| EPI | `epis` | linha `trilha=epi` |
| EPC NR-6 | `epis` tipo EPC | `epc_nr6` |
| Uniforme | `uniformes_colaborador` | `uniforme` |
| Patrimonial | `movimentacoes_itens` Em uso | `patrimonio` |
| Pendência | não há tabela de “pendência desmob” além desta auditoria | — |

`colaborador_id` NOT NULL **sem FK**. `funcionario_id` nullable sem FK. Sem trigger.

---

## 14. Programação

`prog_status_diario`: **tabela**, não view.  
Campos usados pelo Almox (app): `colaborador_id` (text), `data`, `status` (inclui `treinamento` no índice).  
UNIQUE `(colaborador_id, data)`.  
RLS ALL true; GRANT DELETE para anon.  
**Nenhum trigger Almox escreve nesta tabela** (confirmado: triggers Almox só em `alm_requisicoes` e `campo_*`).  
Dependência: Almox **lê**; Programação é dona da escrita. Não alterada nesta auditoria.

---

## 15. RLS

Padrão dominante: `PERMISSIVE ALL USING true WITH CHECK true` para `{anon,authenticated}` ou `{public}`.

| Tabela | SELECT | INSERT | UPDATE | DELETE | Nota |
|---|---|---|---|---|---|
| `estoque` | sim | sim | sim | **sim** | 3 policies ALL true |
| `movimentacoes_itens` | sim | sim | sim | **sim** | |
| `alm_movimentos` | sim | sim | sim | **sim** | |
| `epis` | sim | sim | sim | **sim** | |
| `epi_fichas` | sim | sim | sim | **não (policy)** | GRANT ainda tem DELETE |
| `uniformes_colaborador` | sim | sim | sim | **sim** | |
| `alm_requisicoes` e itens/eventos | sim | sim | sim | **sim** | |
| `alm_notas_fiscais` | sim | sim | sim | **sim (anon ALL)** | auth sem policy DELETE explícita, mas anon cobre |
| `alm_correcao_item_solicitacoes` | sim | sim | sim | **sim** | |
| `alm_kits_colaborador` / `tipo_equipe` | n/a RLS | — | — | — | **RLS desligado** + GRANT total |
| `prog_status_diario` | sim | sim | sim | **sim** | Almox não deveria escrever |
| `colaboradores` / `funcionarios` | sim | sim | sim | **sim** | |

Segurança de estoque/EPI/req: **dependência exclusiva do frontend** + JWT. Confirmado pelo banco.

---

## 16. Triggers

```text
TRIGGER: trg_alm_req_set_numero
Tabela: alm_requisicoes
Evento: BEFORE INSERT
Função: alm_req_set_numero()
Objetivo: gera REQ-CENA-######
Impacta saldo? NÃO
Impacta histórico? NÃO (só numero)
Impacta RH? NÃO
Impacta SESMT? NÃO
Risco: BAIXO
```

```text
TRIGGER: trg_alm_req_atualizado_em
Tabela: alm_requisicoes
Evento: BEFORE UPDATE
Função: alm_req_set_atualizado_em()
Objetivo: timestamp
Impacta saldo? NÃO
Risco: BAIXO
```

```text
TRIGGER: trg_campo_baixa_reposicao
Tabela: campo_baixas_materiais
Evento: AFTER INSERT
Função: trg_campo_baixa_gerar_reposicao() → fn_campo_gerar_reposicao_baixa
Objetivo: card kanban reposição
Impacta saldo? indireto (alm_movimentos via fluxo seguinte)
Impacta histórico? SIM (reserva)
Risco: ALTO (campo/Frota)
```

```text
TRIGGER: trg_campo_baixa_saldo
Tabela: campo_baixas_materiais
Evento: AFTER INSERT e AFTER UPDATE
Função: trg_campo_baixa_recalc_saldo() → fn_campo_recalc_saldo_veiculo
Objetivo: snapshot saldo kit veículo
Impacta saldo? SIM — campo_veiculo_saldo_dia, NÃO estoque.saldo
Risco: ALTO no fluxo campo; NULO no estoque CENA
```

```text
TRIGGER: trg_vistoria_item_calc_bi
Tabela: campo_vistoria_inicial_itens
Evento: BEFORE INSERT/UPDATE
Função: trg_vistoria_item_calc()
Objetivo: faltante/excedente
Impacta saldo CENA? NÃO
Risco: MÉDIO (kit)
```

**Não há trigger em:** `estoque`, `movimentacoes_itens`, `epis`, `epi_fichas`, `uniformes_colaborador`, `alm_notas_fiscais`, `alm_correcao_item_solicitacoes`, `desmobilizacoes_itens`, `prog_status_diario`.

---

## 17. Functions / RPC

Lista pública relacionada (56 nomes no filtro). Destaques:

```text
NOME: fn_alm_resolver_kit_veiculo
Tipo: RPC STABLE
Parâmetros: p_veiculo_id uuid, p_tipo_operacional text, p_contrato_id uuid
Retorno: TABLE kit efetivo
Tabelas lidas: alm_veiculo_kit_materiais
Tabelas alteradas: nenhuma
Chamadores: index.html kanban/carga
Finalidade: resolver kit
Risco: CRÍTICO se assinatura mudar
```

```text
NOME: fn_alm_baixar_estoque_reposicao
Tipo: RPC VOLATILE
Parâmetros: p_reserva_id uuid, p_registrado_por text
Retorno: integer
Tabelas lidas: reserva
Tabelas alteradas: alm_movimentos (comentário; unique saida por item)
Chamadores: index.html reposição
Finalidade: baixa SAP/campo
Risco: ALTO no SAP; não cobre estoque.saldo
```

```text
NOME: fn_campo_recalc_saldo_veiculo / fn_campo_fechar_carga_inicial / fn_campo_gerar_*
Tipo: RPC VOLATILE
Tabelas: campo_* / alm_reservas_campo
Finalidade: kit veículo
Risco: ALTO (Frota/campo)
```

```text
NOME: caepi_fn_lookup / caepi_fn_pode_entregar_lote / caepi_fn_aprovar_lote_manual
Tipo: RPC
Tabelas: caepi_*, alm_produto_lotes
Finalidade: CA / entrega
Risco: ALTO (NR-6)
```

```text
NOME: alm_req_proximo_numero / alm_req_set_numero / alm_req_set_atualizado_em
Tipo: trigger/sequence
Tabelas: alm_requisicoes
Finalidade: numeração
Risco: BAIXO
```

```text
NOME: alm_correcao_item_executar
Tipo: citado no COMMENT da tabela
Parâmetros: —
Status: NÃO EXISTE no pg_proc
Risco: CRÍTICO (contrato quebrado banco↔app)
```

```text
NOME: fn_estoque / alm_registrar_transferencia_patrimonio / alm_registrar_ajuste_patrimonio
Status: NÃO EXISTEM
```

Nenhuma function `SECURITY DEFINER` na lista filtrada (`prosecdef=False` em todas as 56).

Edge Functions desta etapa: **não listadas** (CLI de functions não consultado). Pasta do repo só tem `claude-proxy.js`.

---

## 18. Funções ausentes — transferência e ajuste

```text
TRANSFERÊNCIA PATRIMONIAL
Frontend chama: almRegistrarTransferenciaPatrimonio (JS)
Banco possui correspondente: NÃO
  (pg_proc sem %transferencia_patrimon%; sem %transfer% de estoque CENA)
Status: AUSENTE NO FRONT E NO BANCO
Evidência: query pg_proc 26/09/2026, rows vazias para esses nomes
```

```text
AJUSTE PATRIMONIAL
Frontend chama: almRegistrarAjustePatrimonio / almAjusteEhEntrada (JS)
Banco possui correspondente: NÃO
  (sem %ajuste_patrimon%; alm_inventario_* são tabelas, sem RPC de ajuste ligada)
Status: AUSENTE NO FRONT E NO BANCO
  Tabelas alm_inventario_sessao/linha EXISTEM (possível resto de UI antiga)
Evidência: pg_proc vazio; tabelas de inventário CENA presentes
```

---

## 19. Fontes oficiais (após inspeção do banco)

| Informação | Fonte oficial confirmada |
|---|---|
| Colaborador | Tabela `colaboradores` (PK uuid). RE **não** unique |
| Funcionário | Tabela `funcionarios` (PK uuid, UNIQUE `matricula`) |
| EPI (posse NR-6) | Tabela `epis` |
| Ficha EPI | Tabela `epi_fichas` |
| Estoque CENA | Coluna `estoque.saldo` (não view, não trigger) |
| Estoque SAP | Soma de `alm_movimentos` no app; DB só o ledger |
| Movimentação CENA | `movimentacoes_itens` |
| Uniforme | `uniformes_colaborador` (+ catálogo / `estoque_uniformes`) |
| Item patrimonial | `itens_catalogo` + movimentos; tabela legada `ferramentas`; módulo separado `ativos_inventario` |
| Requisição CENA | `alm_requisicoes` + itens + eventos |
| NF | `alm_notas_fiscais` (+ `alm_entradas_nf` paralela) |
| Recebimento req | Colunas no cabeçalho; movimento/saldo só via app |
| Kit de veículo | `alm_veiculo_kit_materiais` + RPC resolver + `campo_veiculo_saldo_*` |
| Programação | Tabela `prog_status_diario` |

Não inferido: não há view “saldo oficial” nem FK da ponte RE.

---

## 20. Matriz de transacionalidade

| Fluxo | Atualiza saldo | Cria movimento | Mesma transação? | Proteção DB | Risco |
|---|---|---|---|---|---|
| Entrada CENA | `estoque.saldo` via app | `movimentacoes_itens` via app | **Não** | Nenhuma | CRÍTICO (confirmado DB) |
| Saída/entrega CENA | idem | idem | **Não** | Nenhuma | CRÍTICO |
| Separação req | origem via app | entrega via app | **Não** | Trigger req não toca saldo | CRÍTICO |
| Entrega EPI | `alm_produto_lotes.quantidade_atual` via app | linha `epis` | **Não** | Sem trigger lote↔epis | CRÍTICO |
| Devolução EPI | lote via app | update `epis` | **Não** | Nenhuma | ALTO |
| Transferência CENA | função JS ausente | — | — | Tabelas inventário existem; RPC não | CRÍTICO (inoperante) |
| Ajuste/inventário CENA | JS ausente | — | — | `alm_inventario_*` sem RPC | CRÍTICO (inoperante) |
| Recebimento req | destino via app | entrada via app | **Não** | Só colunas recebido_* | CRÍTICO |
| Estorno NF | app | app / eventos | **Não** | Sem anti-DELETE; colunas estorno ausentes | ALTO |
| Reposição kit veículo | `alm_movimentos` via RPC | sim na RPC | **Parcial (essa RPC)** | Unique saída por reserva_item | ALTO (SAP) |

---

## 21. Riscos

### CRÍTICO — confirmado pelo banco

- Sem atomicidade `estoque.saldo` × `movimentacoes_itens`.
- RLS+GRANT permitem UPDATE/DELETE em estoque, movimentos, epis, req, NF para `anon`.
- Ponte RE sem FK/UNIQUE no lado RH; 24 linhas extras de RE duplicado.
- RPC ALM-CORR-1 **inexistente**.
- Transferência/ajuste patrimonial **inexistentes** no JS e no DB.

### CRÍTICO — já no frontend, agora **ratificado** (nada no DB cobre)

- Entrega EPI não baixa `estoque.saldo`.
- Recebimento req em dois REST.

### ALTO — confirmado pelo banco

- `alm_kits_*` sem RLS.
- `chave_acesso_nfe` não unique.
- Colunas de estorno do frontend **não estão** na tabela NF.
- `epi.responsavel_id` / ficha `colaborador_id` sem FK.
- `prog_status_diario` gravável por anon (Almox não deveria escrever).
- Triggers de campo alteram saldo de **kit**, fácil de confundir com estoque CENA.

### ALTO — não confirmável nesta etapa

- Edge Functions / Storage policies (não inspecionados).
- Conteúdo de `service_role` em produção além do GRANT.

### MÉDIO

- Tabelas duplicadas (`ferramentas`, `epi_catalogo`, `alm_entradas_nf` vs `alm_notas_fiscais`, backups).
- `alm_requisicao_eventos` “append-only” sem enforcement.
- `dest_base_id` text sem FK.

### BAIXO

- Triggers de numeração da req.
- Views IEC (`vw_colaborador_score`) irrelevantes para saldo.

---

## 22. Preservar obrigatoriamente (validação banco)

| Item auditoria 0 | No banco? | Nota |
|---|---|---|
| Ponte RE | Convenção apenas | UNIQUE só em `funcionarios.matricula` |
| NR-6 (`epis`/`epi_fichas`) | Sim | Sem FK pessoa; ficha sem policy DELETE |
| `dest_base` | Colunas existem | TEXT, nullable, sem FK; regra no frontend |
| NF + estorno sem DELETE | **Não enforced** | DELETE permitido; colunas estorno ausentes |
| ALM-CORR-1 | Tabela sim, RPC **não** | Preservar tabela e unique de pendência |
| Kits de veículo | Sim | RPC leitura + unique reposição + saldo campo |
| Desmobilização | Tabela `desmobilizacoes_itens` | Sem FK |
| Anti-duplo-clique | **Só frontend** | UNIQUE só em `alm_requisicoes.numero` |
| Programação só leitura via `prog_status_diario` | Tabela confirmada | Almox não tem trigger nela; RLS ainda permite write |

---

## O que ainda não foi visto (não impede o status)

- Bodies completos de todas as 56 functions (lidas assinatura+comentário; bodies das 5 RPCs pedidas — `alm_correcao_item_executar` não havia body).
- Policies de Storage `cena-docs`.
- Lista de Edge Functions no dashboard.
- Cada uma das 350 tabelas public (priorizadas as 108 com nome Almox/RH/EPI).

Nada disso muda as conclusões de atomicidade, RLS e RPCs ausentes.

---

`STATUS: AUDITORIA SUPABASE CONCLUÍDA — NENHUMA ALTERAÇÃO REALIZADA`
