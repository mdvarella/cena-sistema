# FROTAS-PEDAGIOS-1

Módulo **Frotas → Pedágios** e integração com a **Viabilidade Econômica**.
Versão do ERP: **8.1.125**.

SQL manual (não executado pelo ERP): `sql_frotas_pedagios_1.sql`

---

## INTEGRAÇÃO COM VIABILIDADE ECONÔMICA

### Fonte do vínculo

A passagem em `frotas_pedagios` / `frt_pedagios` é a **única origem operacional do custo**.

Cadeia usada (sem copiar dados que já existem por relacionamento):

```text
PEDÁGIO
   ↓
VEÍCULO (placa / veiculo_id)
   ↓
SAÍDA / VIAGEM (frotas_portaria_saidas — placa + janela data_saida/data_retorno)
   ↓
EQUIPE (equipe_id da saída; fallback equipes.contrato_id)
   ↓
PROGRAMAÇÃO / COMPOSIÇÃO DO DIA (projeto_ids, se existir)
   ↓
PROJETO / OBRA / CONTRATO
   ↓
VIABILIDADE ECONÔMICA (vbeColetarCustosERP — mesmo motor de combustível/manutenção/locação)
```

A API Sem Parar, quando existir, **não** lança na Viabilidade. Grava primeiro em Frotas → Pedágios (`syncSemPararPedagios` permanece stub).

### Como identifica projeto

1. Viagem compatível em `frotas_portaria_saidas`.
2. `composicao_dia.projeto_ids` (equipe + dia da saída).
3. Fallback `prog_projetos` no mesmo dia/equipe.
4. Nome resolvido em `sot_projetos` / `projetos` se o id existir.

Se nenhum projeto for encontrado: **não inventa obra**. O pedágio fica `SEM_APROPRIACAO`.

Não existe `projeto_id` em `frotas_portaria_saidas` (schema real: `contrato_id`, `equipe_id`, `veiculo_id`, `placa`, `base_saida`). `centro_custo` é texto, no padrão de `lancamentos` — não há `centro_custo_id` na frota.

### Como identifica contrato

Ordem:

1. `frotas_portaria_saidas.contrato_id`
2. `equipes` / `equipes_disp.contrato_id` da equipe da viagem
3. Classificação manual (fila administrativa)

A Viabilidade só apropria custo ao contrato quando `apropriacao_status = APROPRIADO` e `contrato_id` bate com o contrato da tela.

### Como identifica equipe

`frotas_portaria_saidas.equipe_id` / `equipe_nome`. Sem viagem, a equipe não é chutada.

### Categoria utilizada

Taxonomia já existente da Viabilidade:

- estrutura gerencial: `frota.pedagios` (rótulo **Pedágios**)
- grupo: `frota` (`vbeGrupoGerencialDaCategoria`)
- chave legada de custo: `pedagio` (`VBE_CATEGORIAS_CUSTO`)
- DRE simples: linha **(−) Pedagios**, origem `Frotas → Pedágios`
- DRE expansível: grupo **Frota → Pedágios**
- DRE legado de 5 linhas: pedágio continua dentro de `manutencao_frota` agregado (pneus/docs/seguros), para **não mudar a razão oficial**. O detalhe expansível e a DRE simples destacam a categoria própria.

Não foi criada categoria paralela.

### Quais status entram no custo

Entram (tipo `PASSAGEM`):

- `VALIDADO`
- `CONCILIADO`

Não entram:

- `PENDENTE`
- `CANCELADO`
- `POSSIVEL_DUPLICIDADE`
- `DIVERGENTE`
- qualquer registro `tipo = FATURA`
- `apropriacao_status = SEM_APROPRIACAO` (válido, mas sem contrato — não vai para nenhum projeto)

Competência: **data/hora da passagem**, não vencimento de fatura.

### Tratamento de duplicidade

- Hash operacional (`placa + data/hora + praça + valor + origem + tipo`).
- Duplicata de importação nasce `POSSIVEL_DUPLICIDADE` e **não soma**.
- Lançamento financeiro classificado como pedágio é **deduplicado** quando o módulo já trouxe o valor (`skipDedupReal`), igual combustível/manutenção/locação.
- Fatura Sem Parar **não** é custo. Só as passagens entram.

### Tratamento de cancelamento

A Viabilidade **não copia** o valor para uma tabela própria. Lê `frt_pedagios` na hora (`vbeColetarCustosERP` / `frtPedSomarContrato`).

- cancelar / estornar / marcar duplicata → some do custo no próximo recálculo
- editar `R$ 18,70 → R$ 21,40` → a VBE passa a mostrar `R$ 21,40`

### Despesas sem apropriação

A VBE não tem fila genérica de “despesas sem vínculo” utilizável para pedágio (`itens_sem_contrato` é só estrutura interna).

Fila reutilizada/criada em **Frotas → Pedágios → Sem apropriacao**:

- data, placa, veículo, praça, valor, motorista, possível equipe, motivo
- classificação manual para contrato / centro de custo / projeto (nome)
- não associa obra automaticamente
- auditoria em `audit_log` (apropriação automática, manual, troca, remoção, cancelamento, ajuste de valor)

### Previsto × realizado

A Viabilidade já tem orçamento previsto (Premissas) para folha/receita; **não** há linha “Pedágios previstos”. Não foi criada estrutura nova. Realizado = passagens validadas do módulo.

### Testes realizados

Runner: `frtPedagiosRodarTestesVbe()` (console).

| # | Caso | Resultado esperado |
|---|------|--------------------|
| 24 | pedágio + viagem | `portaria_saida_id` da saída |
| 25 | equipe | TMA-014 |
| 26 | contrato | XYZ |
| 27 | projeto/apropriação | `APROPRIADO` (projeto só se a programação tiver) |
| 28–33 | VBE | categoria Pedágio, valor 21,40, entra no custo total / margem |
| 34 | editar valor | leitura ao vivo |
| 35 | cancelar | some do custo |
| 36 | duplicidade | não entra |
| 37–38 | sem viagem | `SEM_APROPRIACAO`, sem projeto inventado |
| 39 | classificar manual | passa a somar no contrato |
| 40 | audit_log | `auditLog()` nas ações reais |
| 41 | fatura + passagem | só R$ 21,40 |

### Impacto em resultado / margem

Pedágio validado e apropriado entra em:

- `despesas.frota.pedagios`
- `despesas.custo_total`
- DRE simples (`total_despesas` e `resultado_operacional`)
- DRE completo (via estrutura gerencial; legado agrega em manutenção)

Exemplo da spec: receita 100.000 − MO 35.000 − materiais 20.000 − combustível 4.200 − pedágios 1.850 − outros 10.000 = **28.950**. O pedágio reduz o resultado e a margem.

---

## CONFIRMAÇÃO

**PEDÁGIOS VALIDADOS ALIMENTAM A VIABILIDADE ECONÔMICA SEM DUPLICIDADE DE CUSTO**
