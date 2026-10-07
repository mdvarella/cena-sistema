# Fase 1 LMS/WL — Plano técnico consolidado

Status: aprovado conceitualmente. Etapa 1.0 autorizada. Nenhuma migration, alteração de banco ou de código de produção autorizada.

Nomes marcados como **(proposto)** ainda não existem no banco nem no código.

---

## 1. Princípios

- LMS é a fonte principal da estrutura de projetos novos ENEL_OBRAS.
- `public.sot_wl` é a única WL operacional em projeto ESTRUTURADO.
- `sot_projetos.wl_distribuicao` e `sot_projetos.plano_execucao` são "WL do croqui (IA)": só planejamento visual. Nunca criam `sot_wl`, nunca preenchem `wl_id`, nunca programam, nunca calculam material, nunca concluem WL.
- WL só nasce de evidência: linha de LMS importada ou cadastro manual unitário e auditado. Sem preenchimento automático por código, quantidade, ordem, croqui ou descrição.
- Registro legado (`wl_id IS NULL`) continua funcionando como hoje.
- Programar WL não baixa estoque.

## 2. Regras transversais

- Migration versionada por etapa, aplicada pelo usuário, com teste PGlite e bloco de rollback (padrão `tests/*-sql.test.mjs`). Sem SQL solto, sem `db reset`.
- Tabelas novas: RLS ativo e FORCE, nada para `anon`, GRANTs explícitos, autorização por `auth.uid()` → `usuarios_sistema.auth_user_id`. Nunca por e-mail.
- Funções autorizadas: `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `cena_pode(...)` antes de qualquer gravação, `EXECUTE` revogado de `PUBLIC` e `anon`.
- `service_role` só no backend (Edge). Nenhuma credencial no navegador.
- Mudança de tela: `APP_VERSAO` + log, 7 tags `?v=`, `SW_VERSION`. `index.html` só por script com verificação de trecho único.
- Não tocar: TMA (telas, regras, estrutura), `composicao_dia` (sem gatilho, sem FK), regras do Almoxarifado CENA, débitos de senha registrados.
- Iniciativa separada da migration da Portaria (`20261005180000_portaria_saida_acompanhante.sql`).

## 3. Tipos e colunas reais confirmados (consulta `information_schema`, 06/10/2026)

| Conceito | `sot_materiais` | `sot_atividades` |
|---|---|---|
| id | `id uuid` | `id uuid` |
| projeto | `projeto_id uuid` (nulo permitido) | `projeto_id uuid` (nulo permitido) |
| código | `codigo_sap text` | `codigo text` |
| quantidade planejada | `qtd_projetada numeric` | `qtd_prevista numeric` |
| UMD | `unidade text` | `unidade text` |
| descritivo / exclusão | `somente_descritivo bool NOT NULL`, `deleted_at` | idem |

Outros: `sot_projetos.id uuid`, `sot_projetos.contrato_id text` (não uuid), `contratos.id uuid`, `composicao_dia.id uuid`, `composicao_dia.equipe_id text`, `composicao_dia.data date`, `composicao_dia.projeto_ids text`, `prog_projetos_agenda.id uuid`, `sot_atividades.servico_id text` (não substitui `sot_atividades.id`).

---

## 4. Etapas

### 1.0 Preparação (sem banco, sem código de produção)

Entregas em `docs/enel-wl/ETAPA-1.0-PREPARACAO.md` e `tests/fixtures/lms/`.

### 1.1 Permissões por ação

- `cena_acoes`, `cena_permissoes_acao` (perfil, ação, contrato opcional) **(propostos)**.
- `cena_pode(p_acao text, p_contrato_id text)` **(proposto)**: `SECURITY DEFINER`, `STABLE`, fail-closed. Falso sem sessão, com usuário inativo ou com contrato que não corresponda a `contratos.id`.
- Ações: `PROJ_IMPORTAR_LMS`, `PROJ_CONCILIAR_LMS`, `PROJ_EDITAR_WL`, `PROJ_REALIZAR_VIABILIDADE`, `PROJ_AVALIAR_CENA`, `PROJ_APROVAR_AVALIACAO_CENA`, `PROJ_REGISTRAR_RETORNO_ENEL`, `PROJ_PROGRAMAR`, `PROJ_ALTERAR_PERFIL_PROCESSO`, `ALM_SAP_RESERVAR` **(proposto, só 1.8)**.
- Seed a partir dos perfis reais de `usuarios_sistema` (matriz na Etapa 1.0). Segregação avaliar ≠ aprovar: opção configurável, desligada.

### 1.2 Perfis de processo versionados

- `cena_processo_perfis` chave `(codigo, versao)`; requisitos por versão **(proposto: `cena_processo_perfil_requisitos`)**. Versão usada por projeto é imutável.
- `cena_contrato_processo_perfil` **(proposto)**: `contrato_id uuid` FK `contratos`, perfil + versão sugeridos para projetos novos.
- `sot_projeto_processo` **(proposto)**: perfil efetivamente congelado.
  - `projeto_id uuid UNIQUE NOT NULL`, `perfil_codigo text NOT NULL`, `perfil_versao integer NOT NULL`, `definido_em timestamptz NOT NULL`, `definido_por_auth uuid NOT NULL`, `motivo text`.
  - Sem FK física para `sot_projetos` nesta fase (projeto pode ser apagado fisicamente no legado). Existência validada pela função.
  - RLS FORCE, nada para `anon`.
- `sot_projeto_processo_eventos` **(proposto)**: perfil/versão anterior, perfil/versão nova, quem, quando, justificativa.
- Congelamento: só na confirmação da ORIGINAL em `modo = ESTRUTURA_NOVA` ou por ação explícita do gestor. Sem gatilho em `sot_projetos`.
- Projeto sem linha em `sot_projeto_processo` = BASE_PROJETOS. Resolver da Jornada: perfil congelado primeiro; sem ele, regra atual inalterada (inclusive Equatorial).
- Troca posterior: `PROJ_ALTERAR_PERFIL_PROCESSO` + justificativa + função + evento antes/depois.

### 1.3 Registro imutável da LMS e recepção do arquivo

**Tabelas (propostas)**

- `sot_lms_importacoes`: projeto, tipo (ORIGINAL, SUBSTITUTIVA, COMPLEMENTAR, CORRIGIDA, INFORMATIVA), status (`RASCUNHO`, `CONFIRMADA`, `DESCARTADA`), `modo` (`ESTRUTURA_NOVA`, `CONCILIACAO`), `base_vigente`, `arquivo_path`, `arquivo_sha256`, tamanho, `recebido_em`, referência à importação anterior, `conciliacao_aplicada_em`, `conciliacao_aplicada_por_auth`, autoria.
  - Únicos parciais: uma ORIGINAL confirmada por projeto; uma base vigente; `(projeto_id, arquivo_sha256)`.
  - `arquivo_path`, `arquivo_sha256`, tamanho e `recebido_em` só gravados pelo backend.
- `sot_lms_linhas`: imutável. Aba, linha da planilha, `codigo_cru`, `codigo_norm`, WL, CTG, FT, KIT, UMD, descrição, `lms_qtd_planejada`, `lms_qtd_real_informada`, valores, tipo de linha, operacional sim/não.

**Normalização — `fn_proj_codigo_norm(text)` (proposta)**

- `IMMUTABLE STRICT PARALLEL SAFE`, só funções imutáveis.
- NULL → NULL; vazio ou só espaços → NULL; trim; maiúsculas; zeros à esquerda removidos só se o valor inteiro for numérico (`^[0-9]+$`), mantendo pelo menos `0`. Códigos alfanuméricos nunca perdem zeros.
- Depois de usada em índice, a semântica não muda no lugar. Nova regra = nova função versionada + migration de reconstrução dos índices.

**Edge Function `proj-lms-receber` (proposta) — dois contextos separados**

1. Cliente do usuário: criado com a anon key + `Authorization: Bearer <JWT do navegador>`. `auth.uid()` representa o usuário real. Chama `cena_pode('PROJ_IMPORTAR_LMS', contrato_id)`. Sem autorização, encerra.
2. Só depois da autorização, cliente administrativo com `SUPABASE_SERVICE_ROLE_KEY` (só dentro da Edge): grava no Storage privado, grava hash, cria `sot_lms_importacoes`, grava `sot_lms_linhas`.
   - O cliente `service_role` nunca é usado para decidir autorização.
3. Validações no servidor:
   - tamanho máximo;
   - XLSX real e parseável (cabeçalho `PK` sozinho não basta);
   - limites de quantidade de entradas do ZIP e de taxa/tamanho de expansão (proteção contra zip bomb);
   - workbook válido com a linha de cabeçalho LMS (`WL`, `Cód. Ma`, `Quant. Plan`…), detectada pelo conteúdo e não pelo nome da aba (o modelo real usa `Planilha1`);
   - SHA-256 calculado sobre os bytes recebidos.
4. Storage privado **(proposto: bucket `proj-lms`)**, caminho `projeto_id/sha256.xlsx`, sem URL pública, sem `anon`. Leitura por URL assinada após verificação de permissão.
5. Leitura da planilha no servidor, a partir do arquivo gravado. Linhas da prévia presas à importação e ao hash. O navegador só exibe.
6. Hash calculado no navegador pode existir para UX (aviso de arquivo repetido). Nunca é evidência de integridade.

**Funções (propostas)**: descartar prévia; confirmar importação (ORIGINAL única; primeira confirmação é ORIGINAL; `CONCILIACAO_ABERTA` durante conciliação; congela perfil em `ESTRUTURA_NOVA`; recusa importação sem hash/caminho gravados pelo servidor).

### 1.4 WL oficial, unicidade e proteção estrutural

**`sot_wl` (proposta)**: única WL operacional.

**Colunas novas** em `sot_atividades` e `sot_materiais` (todas nulas, sem default): `wl_id`, `lms_linha_id` (FK `sot_lms_linhas`), `ctg`, `ft`, `kit`.

**CHECK**: `wl_id IS NULL OR fn_proj_codigo_norm(<codigo>) IS NOT NULL` (linha com WL nunca tem código normalizado nulo). Hoje nenhuma linha tem WL.

**Unicidade**

- Atividades sem WL: regra única atual reproduzida exatamente como existe (código cru, incluindo registros excluídos), como índice parcial `WHERE wl_id IS NULL`. Definição relida do banco imediatamente antes da migration. Nenhum `on_conflict` em `sot_atividades`/`sot_materiais` e nenhuma dependência do nome da constraint foram encontrados no código.
- Atividades com WL: único em `(projeto_id, wl_id, fn_proj_codigo_norm(codigo), coalesce(upper(btrim(ft)), ''))` `WHERE wl_id IS NOT NULL AND deleted_at IS NULL`.
- Materiais com WL: idem com `codigo_sap`. Sem regra nova para materiais sem WL.
- **Ajuste proposto pela análise do Modelo LMS.xlsx real (pendente de aprovação):** o arquivo tem 36 linhas com o mesmo WL + código + FT que só se distinguem pelo KIT. A chave acima recusaria a LMS real. Proposta: acrescentar `coalesce(upper(btrim(kit)), '')` às duas chaves com WL (com KIT, zero duplicidades no arquivo).
- `deleted_at`: registro excluído logicamente não ocupa a chave WL. Reativação com ativo igual é recusada pelo índice.
- FT nulo, vazio e com espaços contam igual; `'r'` = `'R '`.
- Antes da migration: consulta somente leitura contra dados reais (colisões da regra legada recriada; grupos diferentes só por zeros/maiúsculas; colisões potenciais ao ligar registros a WLs) e teste PGlite.

**Proteção estrutural — linha estruturada = `wl_id IS NOT NULL OR lms_linha_id IS NOT NULL`**

- Linhas legadas (`wl_id IS NULL AND lms_linha_id IS NULL`): sem nenhuma proteção nova.
- Linhas estruturadas, para `anon`/`authenticated`:
  - UPDATE recusado se mudar campo estrutural (comparação OLD × NEW com `IS DISTINCT FROM`);
  - mudança de `deleted_at` recusada;
  - DELETE físico recusado.
- INSERT por `anon`/`authenticated` recusado se `wl_id` ou `lms_linha_id` (ou `ctg`, `ft`, `kit`) vier preenchido.
- UPDATE de linha legada que tente preencher `wl_id`, `lms_linha_id`, `ctg`, `ft` ou `kit` recusado.
- Campos estruturais:
  - `sot_atividades`: `projeto_id`, `codigo`, `descricao`, `unidade`, `qtd_prevista`, `somente_descritivo`, `wl_id`, `lms_linha_id`, `ctg`, `ft`, `kit`, e `deleted_at` em linha estruturada.
  - `sot_materiais`: `projeto_id`, `codigo_sap`, `descricao`, `unidade`, `qtd_projetada`, `somente_descritivo`, `wl_id`, `lms_linha_id`, `ctg`, `ft`, `kit`, e `deleted_at` em linha estruturada.
- Campos operacionais continuam no fluxo atual, inclusive em linha estruturada: `qtd_executada`, `qtd_viabilizada`, `qtd_medida`, `qtd_faturada`, `qtd_requisitada`, `qtd_entregue`, `qtd_aplicada`, `qtd_devolvida`, `qtd_processada_sap`, `valor_unitario`, `valor_total`, `status`, `etapa`, `ordem_exec`, `observacoes`, `observacao`, `obs_viabilidade`, `obs_execucao`, `servico_id`.
- Implementação **(proposta: `fn_proj_protege_linha_estruturada`)**: gatilho BEFORE INSERT/UPDATE/DELETE, `SECURITY INVOKER` (obrigatório para `current_user` ser o chamador). Age só se `current_user IN ('anon','authenticated')`. Dentro das funções autorizadas (`SECURITY DEFINER`), `current_user` é o dono e a gravação passa. Não depende de sinal enviado pela tela.
- Remover, substituir ou alterar estruturalmente linha WL: só por função autorizada e, depois, pelo fluxo de revisão.
- Regressão PGlite com papéis `anon`/`authenticated`: `sotValidarLancamento` (inclui atividade criada automaticamente), `npProcessarLista`, `_sotLancarPendentes`, `sotConfirmarImportacao`, edição de material, `sbDelete` (soft e fallback físico), fluxos que copiam registros, regravação da linha inteira com os mesmos valores.

**`fn_proj_lms_aplicar_estrutura_nova` (proposta)**: uma transação; cria WLs, atividades e materiais a partir da ORIGINAL; quantidade operacional = Quant. Plan.

### 1.5 Telas da estrutura nova (versão nova)

- Importador ENEL_OBRAS: envio para a Edge, prévia completa (abas, totais por WL, linhas sem código, FT=R, Estorno, Adicionais, Plan=0 com Real>0 destacadas), aviso da ORIGINAL com caixa de confirmação.
- Selos "Sem WL / Projeto legado" e "WL do croqui (IA)".
- Jornada lendo o perfil congelado.
- Importador antigo (`sotLmsExtrair`) mantido para legado; bloqueado em projeto ESTRUTURADO.

### 1.6 Conciliação de projetos antigos

- Estados (calculados, sem coluna de status): LEGADO_SEM_WL (sem ORIGINAL confirmada); EM_CONCILIACAO (ORIGINAL `modo = CONCILIACAO` e `conciliacao_aplicada_em IS NULL`); ESTRUTURADO (ORIGINAL `ESTRUTURA_NOVA`, ou `CONCILIACAO` aplicada). Importações posteriores não mudam o estado.
- `sot_lms_conciliacao` **(proposta)**: `lms_linha_id`, `material_id uuid`, `atividade_id uuid` (sem FK física), `num_nonnulls(material_id, atividade_id) <= 1`, CHECKs por decisão (VINCULAR, CRIAR_NOVO, NAO_INCORPORAR com justificativa, MANTER_LEGADO, REJEITAR), `origem_decisao` (AUTOMATICA, MANUAL, LOTE_SUGESTOES_SEGURAS), `aplicado_em`, retrato do item, invalidação com histórico. Únicos parciais por importação para itens ativos.
- Confirmação automática conservadora; lote seguro (descrição neutra); um para um; nunca divide.
- Impressão digital determinística (ordem por tipo e `id`; `id`, código normalizado, quantidade planejada com `trim_scale`, `unidade`, FT, KIT, `wl_id`, `somente_descritivo`, `vivo`); `CONCILIACAO_DESATUALIZADA`; "Recalcular sugestões".
- Durante EM_CONCILIACAO: fluxos legados seguem; novas programações ficam "Sem WL"; confirmar outra LMS recusado com `CONCILIACAO_ABERTA`.
- Conciliar não altera quantidade e não muda o perfil de processo. Projeto BASE_PROJETOS continua BASE_PROJETOS; passar a ENEL_OBRAS exige `PROJ_ALTERAR_PERFIL_PROCESSO` com justificativa e evento. Nenhuma promoção automática.

### 1.7 Execução por projeto, equipe e data

- `prog_proj_execucoes` **(proposta)** = projeto + equipe + data. Sem `wl_id`.
  - `id uuid`, `projeto_id uuid`, `composicao_dia_id uuid NOT NULL` (sem FK), cópias `equipe_id text` e `data date`, `agenda_id uuid` FK `prog_projetos_agenda.id`, `orientacao_execucao text`, `criado_por_auth`, `criado_em`, `cancelada_em`, `cancelada_por_auth`, `motivo_cancelamento`.
  - Único ativo: `(composicao_dia_id, projeto_id) WHERE cancelada_em IS NULL`.
- `prog_proj_execucao_itens` **(proposta)** = WL + atividade daquela execução.
  - `execucao_id` FK, `wl_id NOT NULL` FK `sot_wl`, `atividade_id uuid NOT NULL` (sem FK física), `qtd_programada numeric`.
  - Único ativo: `(execucao_id, wl_id, atividade_id)`.
  - "WL inteira" nunca é atividade NULL: expande para uma linha por atividade ativa da WL.
  - Função valida: WL do projeto; atividade do projeto, viva e com o mesmo `wl_id`.
- Consultas `vw_proj_saldo_atividade` e `vw_proj_execucao_situacao` **(propostas)**.
- Decisão obrigatória antes da migration: fonte única da quantidade executada em projeto ESTRUTURADO (hoje `sotValidarLancamento` soma em `sot_atividades.qtd_executada`).

### 1.8 Proteção do fluxo SAP (`alm_movimentos`)

Saldo no banco; reserva separada da saída física (modelo próprio, sem segundo estoque); correção da contagem dupla; função transacional com trava por contrato + código SAP; vínculo opcional projeto/WL/execução; RLS e `ALM_SAP_RESERVAR`; telas SAP adaptadas (versão nova); 610 movimentos atuais preservados.

### 1.9 Separação por WL no ENEL

Só depois da 1.8.

### Frente S (paralela): acesso anônimo

Mapa em `docs/enel-wl/ETAPA-1.0-PREPARACAO.md`. Fechamento tabela por tabela com regressão (Campo, Portaria, offline, Programação, Almoxarifado). Sem revogação em massa.

## 5. Fora da Fase 1

Vínculo croqui → WL; dividir registro legado; adotar quantidade da LMS em registro antigo; FKs físicas para `sot_atividades`, `sot_materiais`, `sot_projetos`; fluxo de revisão por SUBSTITUTIVA/COMPLEMENTAR.
