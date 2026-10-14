# ETD VARGINHA — plano para liberar a conciliação LMS · Documento para revisão

**Status:** só revisão. **Nada executado.** Nenhum SQL rodado para este documento, nenhuma correção aplicada, nenhuma
chamada de conciliação. Todo SQL abaixo é **proposta** e só roda com autorização explícita, item por item.
**Projeto:** ETD VARGINHA · DAC/S.SUL.25.00106 · `5c7aa799-6205-4414-8466-3fda27ca3421`
**LMS:** importação `e7438e4c-85b5-40bb-9d8a-822e20d67a9e` (ORIGINAL, CONFIRMADA, CONCILIACAO em 12/10/2026 09:20; 110 linhas, 6 WLs)
**Fontes:** leituras já feitas em produção em 12–13/10/2026 (diagnóstico 1.6 e prévia real V6 da 1.6a). Data: 14/10/2026.

---

## 0. Situação atual

Prévia real (`sot_lms_conciliacao_previa`, 13/10/2026): `pode_aplicar = false`, bloqueios `COM_MOVIMENTO` e `UNIDADE_DIFERENTE`.

| Resumo | Valor |
|---|---|
| Itens antigos ativos | 36 (7 atividades, 29 materiais) |
| Códigos | 36 — **27 BATE**, **9 UNIDADE_DIFERENTE** |
| Com movimento | 2 códigos (I-8000656 e R-8000656) — motivo: **item de medição** |
| Quantidades | todas as 36 somas batem com o LMS (o problema é só unidade e medição) |

Para conciliar é preciso **zerar os dois bloqueios**. A regra G2 (unidade e soma exatas) e G3 (movimento bloqueia) não muda.

---

## 1. Diagnóstico da medição de teste

| Item | Valor |
|---|---|
| Parcial | **nº 1** do projeto |
| Status | **aprovado** |
| Data de corte | 05/10/2026 |
| Valor total | **R$ 7.795,44** |
| Itens | 2 |

| Item da medição | Atividade antiga vinculada (`atividade_id`) | Previsto na atividade | Executado | Qtd medida | Valor unit. | Total |
|---|---|---|---|---|---|---|
| I-8000656 — MO INSTAL MO PUXAR CB. DUTO 1 A 70 METRO | `c7acf216-e4d5-4871-94a4-50c38860cc54` | 2 | 0 | **16** | R$ 216,54 | R$ 3.464,64 |
| R-8000656 — MO RETIRA MO PUXAR CB. DUTO 1 A 70 METRO | `91b6540e-dbc3-4895-bfc9-c7002cb454fd` | 2 | 0 | **20** | R$ 216,54 | R$ 4.330,80 |

Sinais de dado de teste (confirmado pelo dono em 11/10): medido 16 e 20 para previsto 2 e executado 0; nenhuma
requisição, adicional, histórico ou lançamento de campo no projeto; todas as demais quantidades operacionais = 0.

**Por que bloqueia:** a conciliação considera movimento qualquer `sot_med_itens.atividade_id` apontando para o item
antigo (qualquer status de medição). Enquanto esses 2 itens existirem ligados às atividades, a prévia mostra `COM_MOVIMENTO`.

### Impacto de cada caminho

| | Manter (A) | Remover a medição de teste (B) |
|---|---|---|
| Conciliação | **bloqueada para sempre** na v1 | liberada quanto a movimento (falta a unidade, §3) |
| Tela de Medição | parcial 1 continua aparecendo como aprovada (R$ 7.795,44) | parcial 1 some; "já medido" das atividades volta a 0 |
| Financeiro/relatórios | valor de teste continua contando como medido | valor de teste deixa de existir |
| Reversão | — | só pelo backup feito antes (§2.B) |

---

## 2. Proposta para a medição

### Opção A — manter e deixar o projeto bloqueado
- Nada é executado. O projeto continua `EM_CONCILIACAO`, operando como legado (os fluxos atuais seguem).
- **Risco:** baixo para os dados; o projeto nunca recebe WL enquanto a v1 da conciliação for a regra; a medição de teste
  continua contaminando "medido" do projeto.

### Opção B — remover a medição de teste (recomendada, por ser teste)
- Remove **só** a parcial nº 1 deste projeto e os seus 2 itens, depois de guardar uma cópia integral.
- Não há "cancelar" na tela para medição aprovada (a exclusão pela tela só existe em rascunho), por isso é SQL.
- **Risco:** é exclusão de registro (não reversível pelo sistema); mitigado por: alvo travado por projeto + número +
  status + valor + ids e quantidades conferidos dentro do próprio SQL (qualquer diferença aborta), backup antes, e V0
  confirmando que nada mais referencia essa medição (nota fiscal, financeiro, programação).

#### V0 — leitura obrigatória antes de decidir a forma exata (só leitura; precisa de autorização para rodar)
```sql
-- V0.1 colunas de sot_medicoes (há deleted_at? há colunas de NF/aprovação?)
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'sot_medicoes' ORDER BY ordinal_position;
-- V0.2 tabelas/colunas que podem referenciar a medição (medicao_id em qualquer tabela) e FKs para sot_medicoes
SELECT table_name, column_name FROM information_schema.columns
 WHERE table_schema = 'public' AND column_name IN ('medicao_id', 'sot_medicao_id') ORDER BY 1;
SELECT conrelid::regclass, conname FROM pg_constraint WHERE confrelid = 'public.sot_medicoes'::regclass;
-- V0.3 a medição e os itens, inteiros (vira o backup do §2.B, guardar o resultado no próprio commit deste documento)
SELECT to_jsonb(m) AS medicao,
       (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.codigo) FROM public.sot_med_itens i WHERE i.medicao_id = m.id::text) AS itens
  FROM public.sot_medicoes m
 WHERE m.projeto_id::text = '5c7aa799-6205-4414-8466-3fda27ca3421';
-- V0.4 valores agregados do projeto (a aprovação pode ter gravado medido/faturado no projeto)
SELECT * FROM public.sot_projetos WHERE id = '5c7aa799-6205-4414-8466-3fda27ca3421';
-- V0.5 quantidades medidas nas atividades antigas (esperado 0; a prévia não acusou QTD_MEDIDA)
SELECT id, codigo, qtd_medida, qtd_faturada FROM public.sot_atividades
 WHERE id IN ('c7acf216-e4d5-4871-94a4-50c38860cc54', '91b6540e-dbc3-4895-bfc9-c7002cb454fd');
```
Se V0.2 mostrar outra tabela apontando para essa medição, **o SQL do §2.B não roda** e este documento volta para revisão.
Se V0.4 mostrar `valor_medido`/`valor_faturado` do projeto contendo os R$ 7.795,44, o §2.B ganha um passo para zerá-los
(proposto à parte, depois do V0).

#### SQL proposto — Opção B (NÃO executar; só depois do V0 e de autorização)
```sql
-- BEGIN;
-- DO $$
-- DECLARE
--   v_proj uuid := '5c7aa799-6205-4414-8466-3fda27ca3421';
--   v_med  uuid;
--   n      integer;
-- BEGIN
--   -- trava o alvo: exatamente 1 medição nº 1, aprovada, R$ 7.795,44 neste projeto
--   SELECT m.id INTO v_med FROM public.sot_medicoes m
--    WHERE m.projeto_id::text = v_proj::text AND m.numero = 1 AND m.status = 'aprovado' AND m.valor_total = 7795.44;
--   GET DIAGNOSTICS n = ROW_COUNT;
--   IF n <> 1 THEN RAISE EXCEPTION 'medição de teste não encontrada exatamente (achou %)', n; END IF;
--   -- confere os 2 itens: códigos, atividades e quantidades esperados, e nenhum outro item
--   IF (SELECT count(*) FROM public.sot_med_itens WHERE medicao_id = v_med::text) <> 2
--      OR NOT EXISTS (SELECT 1 FROM public.sot_med_itens WHERE medicao_id = v_med::text AND codigo = 'I-8000656'
--                     AND atividade_id = 'c7acf216-e4d5-4871-94a4-50c38860cc54' AND qtd_medida = 16)
--      OR NOT EXISTS (SELECT 1 FROM public.sot_med_itens WHERE medicao_id = v_med::text AND codigo = 'R-8000656'
--                     AND atividade_id = '91b6540e-dbc3-4895-bfc9-c7002cb454fd' AND qtd_medida = 20) THEN
--     RAISE EXCEPTION 'itens da medição diferentes do diagnóstico: nada foi alterado';
--   END IF;
--   DELETE FROM public.sot_med_itens WHERE medicao_id = v_med::text;
--   GET DIAGNOSTICS n = ROW_COUNT;
--   IF n <> 2 THEN RAISE EXCEPTION 'esperava remover 2 itens, removeria %', n; END IF;
--   DELETE FROM public.sot_medicoes WHERE id = v_med;
--   GET DIAGNOSTICS n = ROW_COUNT;
--   IF n <> 1 THEN RAISE EXCEPTION 'esperava remover 1 medição, removeria %', n; END IF;
-- END $$;
-- COMMIT;
```

#### Validação depois da Opção B (só leitura)
```sql
SELECT (SELECT count(*) FROM public.sot_medicoes WHERE projeto_id::text = '5c7aa799-6205-4414-8466-3fda27ca3421') medicoes,      -- 0
       (SELECT count(*) FROM public.sot_med_itens WHERE atividade_id IN
          ('c7acf216-e4d5-4871-94a4-50c38860cc54', '91b6540e-dbc3-4895-bfc9-c7002cb454fd')) itens_ligados,                     -- 0
       (SELECT count(*) FROM public.sot_atividades WHERE projeto_id = '5c7aa799-6205-4414-8466-3fda27ca3421' AND deleted_at IS NULL) ativ,  -- 7
       (SELECT count(*) FROM public.sot_materiais WHERE projeto_id = '5c7aa799-6205-4414-8466-3fda27ca3421' AND deleted_at IS NULL) mat,   -- 29
       public.sot_lms_estado_wl_calc('5c7aa799-6205-4414-8466-3fda27ca3421') estado;                                           -- EM_CONCILIACAO
```
e a prévia (no bloco desfeito, como no V6 da 1.6a): `COM_MOVIMENTO` **some** dos bloqueios.

**Reversão da Opção B:** reinserir a medição e os itens a partir do backup V0.3 (SQL gerado na hora, com aprovação).

---

## 3. Diagnóstico da unidade diferente

| # | Tipo | Código | Item antigo (descrição) | Qtd antiga | Unid. antiga | Qtd LMS | Unid. LMS | Linhas do LMS |
|---|---|---|---|---|---|---|---|---|
| 1 | Atividade | I-8000656 | MO INSTAL MO PUXAR CB. DUTO 1 A 70 METRO | 2 | UN | 2 | US3 | WL 5, WL 6 (1 + 1) |
| 2 | Atividade | I-8000670 | MO INSTAL MO PUXAM.CIRCN 1 A 70M | 2 | UN | 2 | US3 | WL 5, WL 6 |
| 3 | Atividade | I-8000690 | MO INSTAL NUMERAR CIRCUITO / EQUIPAMENTO | 2 | UN | 2 | US3 | WL 5, WL 6 |
| 4 | Atividade | I-ASQ03TI | MO INSTAL CONF. TERM. INT. CABO 500 MM2 | 2 | UN | 2 | US3 | WL 5, WL 6 |
| 5 | Atividade | I-ASQ04ES | MO INSTAL CONF EMEN RETA CABO 500 MM2 | 2 | UN | 2 | US3 | WL 2, WL 3 |
| 6 | Atividade | R-8000656 | MO RETIRA MO PUXAR CB. DUTO 1 A 70 METRO | 2 | UN | 2 | US3 | WL 5, WL 6 |
| 7 | Atividade | R-ASQ03TI | MO RETIRA CONF. TERM. INT. CABO 500 MM2 | 2 | UN | 2 | US3 | WL 5, WL 6 |
| 8 | Material | 325070 | "M-0325070" (descrição = KIT; só descritivo) | 100 | UN | 100 | M | WL 1, WL 4 (50 + 50) |
| 9 | Material | 348165 | "K-ASQ04ES" (descrição = KIT; só descritivo) | 64 | UN | 64 | PC | 6 linhas em 4 WLs (8+8+12+12+12+12) |

Leitura:
- **As 9 quantidades batem**; só a unidade diverge. Os outros 27 códigos já batem (unidade e soma).
- Atividades: o cadastro antigo grava **UN** para serviço; o LMS usa **US3** (unidade de serviço ENEL) — mesma
  contagem (1 por WL), diferença só de rótulo.
- Materiais 8 e 9 são os dois itens que o **importador antigo gravou errado** (descrição trocada pelo KIT e marcados
  só descritivos — achado do diagnóstico 1.6, tarefa G9). A unidade UN também vem desse erro: 325070 é cabo (M) e
  348165 é abraçadeira (PC).
- **Impacto na conciliação:** com unidade diferente, a prévia mostra `UNIDADE_DIFERENTE` e a aplicação recusa
  (`CONCILIACAO_BLOQUEADA (UNIDADE_DIFERENTE 9)`), mesmo sem a medição.

---

## 4. Propostas para a unidade

### Opção A — manter G2 estrita e corrigir o cadastro antigo antes de conciliar (recomendada)
- Ajustar a **unidade** dos 9 itens antigos para a unidade do LMS (US3, M, PC). Quantidade, código e descrição não mudam.
- É edição de linha legada (sem WL): a trava da 1.4 permite; a regra da conciliação não muda.
- Quando a conciliação for aplicada, esses 9 itens antigos são substituídos pelas linhas do LMS e o retrato guardado
  no registro de conciliação terá a unidade já corrigida — a unidade original (UN) fica registrada **neste documento**
  e no backup V0.3/A0.
- **Risco:** baixo. Afeta só 9 linhas deste projeto; reversível (voltar para UN). Mantém a regra igual para todos.

### Opção B — exceção controlada só para o ETD VARGINHA
- Exigiria alterar a função/migration da 1.6a (lista de projetos ou de códigos aceitos com unidade diferente).
- **Risco:** médio/alto. Abre exceção na regra aprovada (G2/P1), cria caminho de código só para um projeto, pede
  migration nova, teste e nova aplicação no banco. Não recomendado.

### Opção C — tabela de unidades equivalentes (ex.: UN ≡ US3)
- Só faria sentido se houver justificativa operacional ENEL de que UN e US3 são a mesma unidade de serviço.
- Para materiais **não há** equivalência defensável (UN × M num cabo, UN × PC numa abraçadeira são erro de cadastro).
- **Risco:** alto. Esconde erro real de cadastro em outros projetos; muda a regra G2 para todos; pede migration.
  Não recomendado sem uma norma ENEL que diga que UN e US3 são equivalentes.

#### A0 — leitura antes da Opção A (só leitura; com autorização)
```sql
SELECT 'ATIVIDADE' t, id, codigo, unidade, qtd_prevista q FROM public.sot_atividades
 WHERE projeto_id = '5c7aa799-6205-4414-8466-3fda27ca3421' AND wl_id IS NULL AND deleted_at IS NULL
UNION ALL
SELECT 'MATERIAL', id, codigo_sap, unidade, qtd_projetada FROM public.sot_materiais
 WHERE projeto_id = '5c7aa799-6205-4414-8466-3fda27ca3421' AND wl_id IS NULL AND deleted_at IS NULL AND codigo_sap IN ('325070', '348165')
ORDER BY 1, 3;   -- esperado: 7 atividades UN (q 2) + 325070 UN (100) + 348165 UN (64)
```

#### SQL proposto — Opção A (NÃO executar; só com autorização)
```sql
-- BEGIN;
-- DO $$
-- DECLARE
--   v_proj uuid := '5c7aa799-6205-4414-8466-3fda27ca3421';
--   n integer;
-- BEGIN
--   UPDATE public.sot_atividades SET unidade = 'US3'
--    WHERE projeto_id = v_proj AND wl_id IS NULL AND deleted_at IS NULL AND unidade = 'UN'
--      AND codigo IN ('I-8000656', 'I-8000670', 'I-8000690', 'I-ASQ03TI', 'I-ASQ04ES', 'R-8000656', 'R-ASQ03TI');
--   GET DIAGNOSTICS n = ROW_COUNT;
--   IF n <> 7 THEN RAISE EXCEPTION 'esperava 7 atividades, achou %: nada foi alterado', n; END IF;
--   UPDATE public.sot_materiais SET unidade = 'M'
--    WHERE projeto_id = v_proj AND wl_id IS NULL AND deleted_at IS NULL AND unidade = 'UN' AND codigo_sap = '325070';
--   GET DIAGNOSTICS n = ROW_COUNT;
--   IF n <> 1 THEN RAISE EXCEPTION 'esperava 1 material 325070, achou %: nada foi alterado', n; END IF;
--   UPDATE public.sot_materiais SET unidade = 'PC'
--    WHERE projeto_id = v_proj AND wl_id IS NULL AND deleted_at IS NULL AND unidade = 'UN' AND codigo_sap = '348165';
--   GET DIAGNOSTICS n = ROW_COUNT;
--   IF n <> 1 THEN RAISE EXCEPTION 'esperava 1 material 348165, achou %: nada foi alterado', n; END IF;
-- END $$;
-- COMMIT;
```
Reversão: o mesmo bloco trocando de volta para `UN` (as 9 linhas e unidades originais estão na tabela do §3).

Observação: a descrição errada dos materiais 8 e 9 ("M-0325070", "K-ASQ04ES") **não** bloqueia a conciliação (a regra
compara tipo, código, unidade e soma) e é substituída pela descrição do LMS quando a conciliação for aplicada. Não
precisa ser corrigida antes.

---

## 5. Plano recomendado

Ordem pensada para fazer primeiro o que é reversível e conferir cada passo pela prévia (sem nunca chamar a aplicação):

| Passo | O quê | Tipo | Autorização |
|---|---|---|---|
| 1 | **V0 + A0** (§2 e §4): leituras e backup integral da medição e dos 9 itens | só leitura | sim (rodar SQL de leitura) |
| 2 | Revisar o resultado do V0: nenhuma outra tabela aponta para a medição; valores agregados do projeto | revisão | — |
| 3 | **Unidade — Opção A** (9 linhas) | escrita reversível | sim |
| 4 | Prévia (bloco desfeito): esperado `bloqueios = ["COM_MOVIMENTO"]`, `BATE 34`, `COM_MOVIMENTO 2` | só leitura | — |
| 5 | **Medição — Opção B** (1 medição + 2 itens), só se o V0 estiver limpo | escrita (exclusão com backup) | sim |
| 6 | Validação pós-B (§2) e prévia: esperado `pode_aplicar = true`, `bloqueios = []`, **36 BATE** | só leitura | — |
| 7 | Conciliação pelo dono na tela (aba 📥 LMS → "Aplicar conciliação") | ação na tela | decisão do dono |
| 8 | Conferência pós-conciliação (só leitura): ESTRUTURADO, 6 WLs, 36 registros em `sot_lms_conciliacao`, 36 itens antigos com `deleted_at`, evento `CONCILIACAO_APLICADA`, nenhum outro projeto alterado | só leitura | — |

**Como confirmar que o projeto ficou apto (passo 6):** a prévia real do projeto precisa voltar com
`pode_aplicar = true`, `bloqueios = []`, `resumo.legado_itens = 36`, `por_situacao = {"BATE": 36}` — e a tela da aba
📥 LMS mostra o botão "Aplicar conciliação" sem a caixa vermelha.

**O que a conciliação vai produzir (referência para o passo 8):** a estrutura do LMS (6 WLs, 110 linhas: atividades
de serviço e materiais, com as retiradas FT=R como só descritivos), os 36 itens antigos baixados e registrados. O
cadastro antigo deixa de somar retirada com instalação (ex.: 321638 passa de 28 operacionais para 14 operacionais + 14
descritivos), o que corrige a quantidade a requisitar.

## 6. Decisões para o dono

| # | Decisão | Recomendação |
|---|---|---|
| H1 | Medição de teste | **Opção B** (remover com backup), condicionada ao V0 limpo |
| H2 | Unidade | **Opção A** (corrigir as 9 unidades do cadastro antigo; G2 estrita mantida) |
| H3 | Ordem | V0/A0 → unidade → prévia → medição → prévia → conciliação pela tela |
| H4 | Quem aplica a conciliação | o dono, pela tela, depois da prévia liberada |

---

## 7. Leituras V0 e A0 (14/10/2026) — resultado

Rodadas com autorização do dono, **somente SELECT** (sem UPDATE, DELETE, INSERT, correção de unidade, remoção de
medição ou chamada de conciliação).

### V0 — medição de teste: **limpo**
| Leitura | Resultado |
|---|---|
| V0.1 colunas de `sot_medicoes` | id, projeto_id, numero, status, data_corte, data_envio, data_aprovacao, data_emissao, data_nf, valor_total, valor_nf, nfs, observacao, criado_por, criado_em, atualizado_em. **Sem `deleted_at`** (não há exclusão lógica: a Opção B é remoção do registro) |
| V0.2 FKs para `sot_medicoes` | **nenhuma** |
| V0.2 triggers em `sot_medicoes` / `sot_med_itens` | **nenhum** |
| V0.2 colunas com "medic" no banco | `sot_med_itens.medicao_id` (os 2 itens desta medição) e `medicoes_obra_itens.medicao_id` (**0** referências a esta medição); `contrato_viabilidade_premissas.modelo_medicao` e `treinamentos.medico` não têm relação |
| V0.3 medição e itens | 1 medição + 2 itens (retrato abaixo) |
| V0.4 valores do projeto | `valor_medido` 0, `valor_faturado` 0, `valor_executado` 0, `valor_previsto` 0, `valor_viabilizado` 0 — a aprovação não gravou nada no projeto (o passo extra de zerar valores do §2 **não é necessário**) |
| V0.5 atividades ligadas | I-8000656 e R-8000656 com `qtd_medida`, `qtd_faturada`, `qtd_executada` e `qtd_viabilizada` = 0 |
| Situação do projeto | EM_CONCILIACAO · 7 atividades e 29 materiais ativos · 0 WLs · 0 requisições · 0 adicionais · 1 medição |

#### Backup V0.3 (retrato integral, exatamente como lido)
Medição:
```json
{"id":"7854cb60-32a1-4084-b5df-a12b17ce97e5","nfs":null,"numero":1,"status":"aprovado","data_nf":null,"valor_nf":0,
 "criado_em":"2026-10-05T18:57:43.902-03:00","criado_por":null,"data_corte":"2026-10-05","data_envio":"2026-10-05",
 "observacao":"Revisado","projeto_id":"5c7aa799-6205-4414-8466-3fda27ca3421","valor_total":7795.44,"data_emissao":null,
 "atualizado_em":"2026-10-05T18:57:44.53373-03:00","data_aprovacao":"2026-10-05"}
```
Itens (`sot_med_itens`):
```json
[{"id":"d1fa2df7-dfb0-4cc3-801b-49789bfb6543","codigo":"I-8000656","qtd_ups":1,"unidade":"UN",
  "criado_em":"2026-10-05T18:58:13.166683-03:00","descricao":"MO INSTAL MO PUXAR CB. DUTO 1 A 70 METRO","valor_ups":0,
  "medicao_id":"7854cb60-32a1-4084-b5df-a12b17ce97e5","projeto_id":"5c7aa799-6205-4414-8466-3fda27ca3421","qtd_medida":16,
  "atividade_id":"c7acf216-e4d5-4871-94a4-50c38860cc54","qtd_executada":0,"valor_unitario":216.54},
 {"id":"f3ceafb3-3236-4b0a-a4f8-241faf468683","codigo":"R-8000656","qtd_ups":1,"unidade":"UN",
  "criado_em":"2026-10-05T18:58:44.314732-03:00","descricao":"MO RETIRA MO PUXAR CB. DUTO 1 A 70 METRO","valor_ups":0,
  "medicao_id":"7854cb60-32a1-4084-b5df-a12b17ce97e5","projeto_id":"5c7aa799-6205-4414-8466-3fda27ca3421","qtd_medida":20,
  "atividade_id":"91b6540e-dbc3-4895-bfc9-c7002cb454fd","qtd_executada":0,"valor_unitario":216.54}]
```
Reversão da Opção B: reinserir esses três registros com os mesmos valores (SQL gerado na hora, com aprovação).

### A0 — unidade: **9 itens confirmados exatamente como no §3**
| Tipo | id | Código | Unidade | Qtd | Só descritivo |
|---|---|---|---|---|---|
| Atividade | `c7acf216-e4d5-4871-94a4-50c38860cc54` | I-8000656 | UN | 2 | não |
| Atividade | `04465ca2-ba7a-4ee9-a3e8-47a39d9e1973` | I-8000670 | UN | 2 | não |
| Atividade | `fd3d3596-8ef1-4a07-aa78-3c73fd16e1ed` | I-8000690 | UN | 2 | não |
| Atividade | `368145ec-bb55-49a1-b450-f53d02623470` | I-ASQ03TI | UN | 2 | não |
| Atividade | `32b8545c-cd60-4d0f-b7bd-fbc7eb1ca486` | I-ASQ04ES | UN | 2 | não |
| Atividade | `91b6540e-dbc3-4895-bfc9-c7002cb454fd` | R-8000656 | UN | 2 | não |
| Atividade | `633845cb-ab72-4581-8a07-9c98743be0cb` | R-ASQ03TI | UN | 2 | não |
| Material | `a4c69b4a-7e69-4883-aeef-a94800184f81` | 325070 | UN | 100 | sim ("M-0325070") |
| Material | `7adf33e2-9820-4253-a348-a2be5c34afe5` | 348165 | UN | 64 | sim ("K-ASQ04ES") |

Todos ativos e sem WL. Os filtros do SQL da Opção A (§4) acertam exatamente 7 + 1 + 1 linhas.

### Recomendação após as leituras
- **H1 → Opção B** (remover a medição de teste com o backup acima): V0 limpo.
- **H2 → Opção A** (corrigir as 9 unidades).
- Ordem mantida: unidade → prévia → medição → prévia → conciliação pelo dono na tela. Nenhuma escrita foi feita até aqui.
