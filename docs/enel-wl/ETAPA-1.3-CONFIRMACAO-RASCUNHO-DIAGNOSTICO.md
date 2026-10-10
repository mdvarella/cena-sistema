# Etapa 1.3 — Confirmação Humana do RASCUNHO · Diagnóstico técnico

**Status:** diagnóstico apenas (read-only). **Nada implementado.** Sem migration, Edge, frontend, SQL, commit ou push.
**Branch:** `enel-etapa13-lms`. **Base:** migrations 1.2 (`20261009173000_proj_perfil_processo.sql`) e 1.3 (`20261009193000_proj_lms_origem.sql`).

Objetivo: transformar um RASCUNHO/ORIGINAL recebido (1.3) em **ORIGINAL oficial confirmada**, com autoria/histórico, em dois modos (`ESTRUTURA_NOVA` / `CONCILIACAO`), **sem** criar WL e **sem** tocar legado. Documento para aprovação antes de desenhar a migration.

---

## Decisões finais (aprovadas pelo dono)

1. **Não** criar `ENEL_WL v1` agora. O perfil **não vem do frontend** nem da RPC.
   - `ESTRUTURA_NOVA` **preserva** perfil já congelado.
   - Sem congelamento prévio: resolver pela arquitetura da 1.2 — **sugestão contratual** vigente se existir; sem sugestão, **`BASE_PROJETOS v1`**.
   - Congelamento (quando ocorre) com **origem `LMS_ORIGINAL_ESTRUTURA_NOVA`**.
2. **Nova permissão `PROJ_CONFIRMAR_LMS`.** Não usar `PROJ_IMPORTAR_LMS` como autorização final da confirmação.
3. `ESTRUTURA_NOVA` nesta etapa: confirmar ORIGINAL; gravar `modo`; autoria/data; evento; congelar perfil **se necessário**; **NÃO** criar `sot_wl` ainda.
4. Ampliar a trava de imutabilidade da 1.3 **somente** para os campos controlados da confirmação e **somente** dentro da RPC autorizada. `authenticated` continua **sem UPDATE direto**.
5. `p_modo` **obrigatório, sem default**: `ESTRUTURA_NOVA` | `CONCILIACAO`.
6. **Não** implementar `DESCARTADA` agora.
7. A RPC **não** recebe `perfil_codigo`/`perfil_versao` do cliente. Assinatura:
   ```
   sot_lms_confirmar(p_importacao_id uuid, p_modo text, p_observacao text default null)
   ```
   Projeto, contrato, usuário, hash, perfil e versão são **derivados pelo banco**.
8. Manter: **uma única ORIGINAL confirmada por projeto**; advisory lock por projeto; `FOR UPDATE`; índice único parcial; idempotência `JA_CONFIRMADA`; segunda ORIGINAL recusada.
9. `CONCILIACAO`: não congela perfil; não toca materiais; não toca atividades; não altera quantidades; legado continua operando.
10. Registrar os três **estados derivados** (`LEGADO_SEM_WL`, `EM_CONCILIACAO`, `ESTRUTURADO`). **Não** criar coluna de status de WL.

---

## 1. CHECK/status de `sot_lms_importacoes` hoje
- `status text NOT NULL` com `…_status_chk CHECK (status IN ('RASCUNHO'))` (1.3, L123); `tipo_importacao` com `CHECK (… IN ('ORIGINAL'))` (L122).
- Autoria existente: `criado_por_auth uuid NOT NULL`, `criado_por_usuario_id text`. **Não há** `confirmado_*`, `modo`, `conciliacao_aplicada_*`.
- Unicidade atual: `UNIQUE (projeto_id, hash_sha256)`. **Não há** "uma ORIGINAL confirmada por projeto".

## 2. Função controlada de mudança de status
- **Não existe** nenhuma que confirme/descarte. Existe a **trava** (trigger `BEFORE UPDATE`, L238-243): bloqueia mudança em qualquer campo ≠ `status`, e só deixa mudar `status` quando `current_setting('cena.lms_status_autorizado') = OLD.id::text`. Nenhuma função seta isso hoje → status imutável na prática.

## 3. Congelamento de perfil (1.2)
- Interno `sot_projeto_processo_gravar(projeto_id, modo['CONGELAR'/'ALTERAR'], perfil_codigo, perfil_versao, origem, justificativa, …)` — `SECURITY DEFINER`, **`REVOKE ALL FROM PUBLIC, anon, authenticated, service_role`** (L969): só chamável por função do mesmo owner.
- Advisory lock `'sot_projeto_processo|'+projeto` + `FOR UPDATE`; **idempotente** (`SEM_MUDANCA`); exige `justificativa`; `origem ∈ {GESTOR, LMS_ORIGINAL_ESTRUTURA_NOVA}`.
- Leitura/resolução: `cena_projeto_processo_efetivo(projeto_id)` (congelado? perfil efetivo, origem, sugerido); `sot_projeto_processo_sugestao(contrato)` → `(o_codigo, o_versao)`; `sot_projeto_processo_contrato_uuid` / `sot_projeto_processo_contexto` resolvem o contrato.
- Catálogo `cena_processo_perfis`: só `BASE_PROJETOS v1` semeado.

## 4. O que reutilizar (e o que não)
| Reutilizar | Papel na confirmação |
|---|---|
| `sot_lms_autorizar(projeto_id)` (interna) | base da autorização (sessão/usuário/projeto/contrato) — **reforçada** pela nova ação `PROJ_CONFIRMAR_LMS` |
| `cena_projeto_processo_efetivo` | saber se já há perfil congelado (preservar) |
| `sot_projeto_processo_sugestao` | derivar perfil quando não congelado |
| `sot_projeto_processo_gravar(…, 'LMS_ORIGINAL_ESTRUTURA_NOVA', …)` | congelar, chamada direta pela RPC (mesmo owner) |
| `sot_lms_importacao_consultar` | prévia na tela (etapa de UI, depois) |
| **NÃO** `cena_projeto_processo_congelar` | origem fixa `GESTOR` |
| **NÃO** `sot_lms_importacao_registrar` | é service_role / recebimento |

## 5. No máximo uma ORIGINAL confirmada por projeto
- **Índice único parcial**: `UNIQUE (projeto_id) WHERE tipo_importacao='ORIGINAL' AND status='CONFIRMADA'` (garantia dura).
- **Mais** checagem na RPC: segunda ORIGINAL → recusa explícita (`ORIGINAL_JA_CONFIRMADA` / `CONCILIACAO_ABERTA`), antes de bater no índice.

## 6. Concorrência (duas confirmações simultâneas)
- `pg_advisory_xact_lock('sot_lms_confirmar|'+projeto_id)` → serializa por projeto.
- `SELECT … FOR UPDATE` na linha da importação.
- Transição só `RASCUNHO → CONFIRMADA`; o índice parcial é o backstop.

## 7. Idempotência
- Importação já `CONFIRMADA` (mesma linha) → devolve `operacao: JA_CONFIRMADA`, sem novo evento nem novo congelamento.
- Transição válida só de `RASCUNHO` (duplo clique / duas abas → a 2ª vê o status já mudado dentro do lock).
- Congelamento idempotente pela 1.2 (`SEM_MUDANCA`).

## 8. Registro (quem/quando/importacao/projeto/hash/modo/evento)
- **Evento append-only** `sot_lms_importacao_eventos` (já tem `por_auth`, `por_usuario_id`, `detalhe jsonb`): novo `tipo_evento='CONFIRMADA'`, `detalhe = {hash, modo, perfil_codigo, perfil_versao, projeto_id, observacao}`.
- **Colunas na importação** (para consulta/estado): `modo`, `confirmado_por_auth`, `confirmado_por_usuario_id`, `confirmado_em`, `conciliacao_aplicada_em`, `conciliacao_aplicada_por_auth`.
- Gravadas **apenas** dentro da RPC autorizada (ver trava, §12).

## 9. Os dois modos (`p_modo` obrigatório)

### ESTRUTURA_NOVA
- `status RASCUNHO→CONFIRMADA`, `modo='ESTRUTURA_NOVA'`, `confirmado_*`, evento `CONFIRMADA`.
- Perfil de processo (decisão 1):
  - **já congelado** → **preserva** (não chama `gravar`);
  - **não congelado** → deriva: `sot_projeto_processo_sugestao(contrato)` se houver; senão `BASE_PROJETOS v1`; então `sot_projeto_processo_gravar(…, 'CONGELAR', <derivado>, 'LMS_ORIGINAL_ESTRUTURA_NOVA', justificativa)` na **mesma transação**.
- **NÃO cria `sot_wl`** (fica para a 1.4 / `fn_proj_lms_aplicar_estrutura_nova`).
- Estado derivado passa a `ESTRUTURADO`.

### CONCILIACAO
- `status RASCUNHO→CONFIRMADA`, `modo='CONCILIACAO'`, `confirmado_*`, evento `CONFIRMADA`.
- **Não** congela/muda perfil; **não** toca materiais/atividades/quantidades; legado segue.
- Estado derivado `EM_CONCILIACAO` (enquanto `conciliacao_aplicada_em IS NULL`). Confirmar outra LMS nesse estado → recusa `CONCILIACAO_ABERTA`.

## 10. O que a ação NÃO pode fazer
Não escreve em `sot_materiais`, `sot_atividades`, estoque, programação/TMA; **não** usa `wl_distribuicao`/`plano_execucao` **nem croqui/IA** como evidência; **não** substitui silenciosamente ORIGINAL já confirmada (índice único + recusa). No `CONCILIACAO`, nada de legado muda. Única escrita fora de `sot_lms_*` = `sot_projeto_processo_gravar` (apenas no `ESTRUTURA_NOVA` sem perfil congelado; append controlado da 1.2).

## 11. Proposta (nível de desenho — sem migration)

**Colunas novas em `sot_lms_importacoes`:** `modo text`, `confirmado_por_auth uuid`, `confirmado_por_usuario_id text`, `confirmado_em timestamptz`, `conciliacao_aplicada_em timestamptz`, `conciliacao_aplicada_por_auth uuid`.
**CHECKs ampliados:** `status IN ('RASCUNHO','CONFIRMADA')` (DESCARTADA fora por ora); eventos `tipo_evento IN ('CRIADA','REENVIO','CONFIRMADA')`; `modo IN ('ESTRUTURA_NOVA','CONCILIACAO')` quando status=CONFIRMADA (NULL enquanto RASCUNHO).
**Índice único parcial:** item 5.
**RPC pública (authenticated):** `sot_lms_confirmar(p_importacao_id uuid, p_modo text, p_observacao text default null)` → `SECURITY DEFINER`; deriva projeto/contrato/usuário/hash/perfil/versão; autoriza por `PROJ_CONFIRMAR_LMS`; lock + FOR UPDATE; grava status+colunas+evento; congela se aplicável; **sem Edge** (puro banco com JWT; não toca Storage).
**Funções internas reutilizadas:** `sot_lms_autorizar`, `cena_projeto_processo_efetivo`, `sot_projeto_processo_sugestao`, `sot_projeto_processo_gravar`.
**Permissões/RLS/grants:** nova ação `PROJ_CONFIRMAR_LMS` (1.1); `GRANT EXECUTE` de `sot_lms_confirmar` só para `authenticated`; nada p/ anon/service_role; RLS/FORCE e imutabilidade da 1.3 mantidas (trava ampliada só no whitelist).
**Eventos:** `CONFIRMADA` (append-only).
**Locks/transação:** advisory lock por projeto + FOR UPDATE; tudo numa transação (status + colunas + evento + congelamento); falha desfaz tudo.
**Estados derivados (sem coluna de status WL):** `LEGADO_SEM_WL` (sem ORIGINAL confirmada) · `EM_CONCILIACAO` (ORIGINAL `CONCILIACAO` e `conciliacao_aplicada_em IS NULL`) · `ESTRUTURADO` (ORIGINAL `ESTRUTURA_NOVA`, ou `CONCILIACAO` aplicada).

**Testes (PGlite, padrão 1.3):**
- *Positivos:* confirmar ORIGINAL `ESTRUTURA_NOVA` sem perfil → congela derivado (sugestão/BASE_PROJETOS, origem LMS_ORIGINAL_ESTRUTURA_NOVA); com perfil já congelado → preserva; confirmar `CONCILIACAO` → EM_CONCILIACAO, legado intacto; `JA_CONFIRMADA` idempotente; estados derivados corretos.
- *Negativos:* sem `PROJ_CONFIRMAR_LMS`; importação inexistente; confirmar não-RASCUNHO; segunda ORIGINAL (índice + recusa); projeto excluído; `p_modo` ausente/ inválido; justificativa/observação conforme regra.
- *Mutação:* alterar campo fora do whitelist dentro da transação; `authenticated` com UPDATE direto; `authenticated`/anon com EXECUTE na interna `gravar`; congelar com origem indevida; confirmar fora da RPC (trava).

## 12. Conflitos com 1.2 / 1.3
1. **Trava de imutabilidade da 1.3** (só `status`): ampliar o whitelist para `status, modo, confirmado_*, conciliacao_*`, **somente** dentro da transação marcada por `cena.lms_status_autorizado`. É a mudança mais sensível (próxima migration, aditiva).
2. **CHECKs da 1.3** (`status`/eventos) e novo CHECK de `modo`: ampliação aditiva.
3. **1.1**: criar a ação `PROJ_CONFIRMAR_LMS` (regra global + por contrato) antes de expor a RPC.
4. **Catálogo 1.2 só tem BASE_PROJETOS**: coerente com a decisão 1 (sem ENEL_WL agora); perfil derivado nunca vem do cliente.
5. **`sot_wl` é 1.4**: a confirmação não cria WL; `ESTRUTURADO` é estado derivado, independente de existir linha em `sot_wl` (aplicação real = 1.4).

---

## Próximo passo (após aprovação)
Preparar a migration aditiva (colunas + CHECKs + índice + `sot_lms_confirmar` + ação `PROJ_CONFIRMAR_LMS` + trava ampliada + grants) e os testes PGlite. Eu preparo e confiro; **o dono aplica**. A tela de upload/prévia entra em seguida. **Não iniciar `sot_wl` / 1.4.**
