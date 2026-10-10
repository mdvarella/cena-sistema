# Fase 1 LMS/WL - Etapa 1.3 (recebimento seguro do LMS original)

Implementada e testada localmente em 09/10/2026. **Migration não aplicada, bucket não criado e Edge não publicada.** Nenhuma tela chama o fluxo ainda: zero mudança de comportamento no ERP.

- Migration: `supabase/migrations/20261009193000_proj_lms_origem.sql` (tabelas, funções, RLS, grants e bucket)
- Edge Function: `supabase/functions/proj-lms-receber/index.ts` (+ `[functions.proj-lms-receber] verify_jwt = true` em `supabase/config.toml`)
- Parser puro: `supabase/functions/_shared/lms-parser.ts` (`PARSER_VERSION = '1'`)
- Testes: `tests/proj-lms-parser.test.mjs`, `tests/proj-lms-origem-sql.test.mjs`, `tests/proj-lms-receber-edge.test.mjs`
- Fixture anonimizada: `tests/fixtures/lms/` (Etapa 1.0; nesta etapa só saiu o nome do autor dos metadados do XLSX, ver README)
- Depende das Etapas 1.1 (`cena_pode`, ação `PROJ_IMPORTAR_LMS`) e 1.2 (`sot_projeto_processo_contexto`, `sot_projeto_processo_contrato_uuid`). Nenhuma ação ou permissão nova.

## Arquitetura

```
Browser ──(JWT + bytes)──► Edge proj-lms-receber
                              │ cliente do usuário (JWT): sot_lms_autorizar_recebimento → auth.uid() + cena_pode
                              │ valida arquivo → SHA-256 dos bytes → parse A:N (lms-parser.ts)
                              │ cliente de serviço: Storage proj-lms (privado) → sot_lms_importacao_registrar
                              ▼
          sot_lms_importacoes (RASCUNHO/ORIGINAL) + sot_lms_linhas (1 por linha do XLSX) + sot_lms_importacao_eventos
```

- O cliente do usuário só pergunta "pode?". O cliente de serviço só grava, e só depois da resposta positiva. O service_role nunca decide autorização.
- O browser não recebe permissão nenhuma no bucket nem nas tabelas: não faz upload direto, não lê, não grava.
- Recebimento não confirma nada: não congela perfil de processo (não chama `cena_projeto_processo_congelar`), não cria WL, não toca `sot_materiais`, `sot_atividades`, estoque, programação nem TMA. O importador antigo continua como está.

## Fluxo da Edge

Chamada: `POST /functions/v1/proj-lms-receber?projeto_id=<uuid>`, com `Authorization: Bearer <JWT>`, `x-lms-nome: <encodeURIComponent(nome)>`, `Content-Type` do arquivo e corpo = bytes do `.xlsx`. O nome vai em header para não aparecer em URL nem em log.

1. Sessão: `Bearer` obrigatório e `auth.getUser()` válido (senão 401).
2. `projeto_id` UUID (senão 400).
3. Autorização com o JWT do usuário: `sot_lms_autorizar_recebimento(projeto_id)` → `{permitido, motivo}`.
4. Corpo lido com limite de 12 MiB (por `content-length` e durante a leitura; senão 413).
5. Validação do arquivo (`validarArquivo`): nome, extensão, MIME, ZIP, macros, ZIP bomb.
6. SHA-256 dos bytes originais.
7. Parse A:N (`parseLms`); estrutura incompatível → 422 `FORMATO_LMS_INCOMPATIVEL`.
8. Upload em `proj-lms/<projeto_id>/<sha256>.xlsx` com `upsert: false` (objeto existente = mesmos bytes; não sobrescreve).
9. `sot_lms_importacao_registrar` (service_role), tudo numa transação.
10. Resposta com o preview.

Diferença deliberada em relação à ordem sugerida na especificação: **o parse acontece antes do Storage**, para que arquivo inválido nunca chegue ao bucket. O original continua guardado byte a byte; nada do parse é gravado no arquivo.

| HTTP | `error` | Quando |
|---|---|---|
| 401 | `SEM_SESSAO`, `SESSAO_INVALIDA` | sem JWT, JWT inválido, chave anon sem usuário |
| 400 | `PROJETO_INVALIDO` | `projeto_id` ausente ou não UUID |
| 403 | `USUARIO_ERP_INATIVO`, `SEM_PERMISSAO`, `CONTRATO_NAO_IDENTIFICADO` | autorização negada |
| 404 | `PROJETO_INEXISTENTE` | projeto não existe |
| 409 | `PROJETO_EXCLUIDO` | projeto com `deleted_at` |
| 413 | `ARQUIVO_GRANDE_DEMAIS` | acima de 12 MiB, ZIP bomb, descompactado acima do limite |
| 415 | `TIPO_ARQUIVO_INVALIDO` | não é XLSX (CSV/XLS renomeado, XLSM, macro, ZIP criptografado, MIME recusado) |
| 422 | `FORMATO_LMS_INCOMPATIVEL`, `REGISTRO_INCONSISTENTE` | aba/cabeçalho/limites; banco recusou o conteúdo |
| 500 | `FALHA_STORAGE`, `FALHA_REGISTRO`, `ERRO_AUTORIZACAO`, `ERRO_INTERNO` | falha técnica, sem detalhe interno nem stack |

Erros de arquivo e de formato vêm com `erros: [{codigo, detalhe}]` (ex.: `CABECALHO_INCOMPATIVEL` com coluna, esperado e encontrado, este cortado em 60 caracteres e sempre de A:N).

## Autorização

`sot_lms_autorizar(projeto_id)` (interna, `SECURITY DEFINER`, sem `EXECUTE` para ninguém), exposta só por `sot_lms_autorizar_recebimento` para `authenticated`:

1. `auth.uid()` nulo → `SEM_SESSAO`.
2. `cena_usuario_perfil_sessao()` nulo (sem cadastro, inativo ou excluído em `usuarios_sistema`) → `USUARIO_ERP_INATIVO`.
3. Projeto inexistente → `PROJETO_INEXISTENTE`; `deleted_at` preenchido → `PROJETO_EXCLUIDO`.
4. Contrato do projeto (texto legado) resolvido por `sot_projeto_processo_contrato_uuid`, sem CAST cego. Texto que não é `contratos.id` → `CONTRATO_NAO_IDENTIFICADO` (**não cai na regra global**). Sem contrato (nulo ou só espaços) → regra global.
5. `cena_pode('PROJ_IMPORTAR_LMS', contrato)` falso → `SEM_PERMISSAO`.

Hoje `PROJ_IMPORTAR_LMS` está liberada (regra global da Etapa 1.1) para admin, gestor, coordenador, escritorio e administrativo; negação/concessão por contrato da 1.1 vale (testado). Nada vem do frontend: perfil, contrato, e-mail e user_id enviados pelo cliente são ignorados.

O registro (`sot_lms_importacao_registrar`) só aceita service_role e recebe o `auth.uid()` que a Edge obteve do JWT. Ele **revalida** o que não depende de sessão (usuário ERP ativo, projeto existente e não excluído, contrato resolvível), mas não refaz `cena_pode` (a função lê só a sessão, e fingir a sessão do usuário com o service_role está proibido). Janela residual: permissão revogada entre a autorização e o registro (milissegundos) ainda grava aquele RASCUNHO.

## Storage

- Bucket `proj-lms`: `public = false`, limite 12 MiB, MIME só `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`. Reaplicar a migration força `public = false` de novo.
- Caminho `<projeto_id>/<sha256>.xlsx`: determinístico, sem nome de arquivo, e-mail, RE ou CPF. O banco deriva o caminho (CHECK); a Edge não manda caminho para o registro.
- Nenhuma policy em `storage.objects` para o bucket: anon/authenticated não leem, não listam, não gravam. Só a Edge (service_role) grava.
- Sem URL pública. Signed URL **não implementada** nesta etapa (nem persistida).
- Bucket na mesma migration, como o padrão do repositório (`20260927223000`).

## Hash e idempotência

- SHA-256 sobre os bytes recebidos, antes de qualquer interpretação; o objeto no Storage tem exatamente esses bytes (testado).
- Idempotência por `UNIQUE (projeto_id, hash_sha256)` + trava `pg_advisory_xact_lock(projeto|hash)`. Mesmos bytes no mesmo projeto (mesmo com outro nome ou outro usuário) devolvem a importação existente com `reenvio: true`, sem linhas novas, com evento `REENVIO`. Mesmo arquivo em outro projeto = outra importação.

## Compensação (Storage gravou, banco falhou)

- Upload antes do registro, com `upsert: false`. Se o registro falhar e **esta** requisição criou o objeto, a Edge confere se existe importação para projeto+hash (um reenvio concorrente pode ter registrado) e só remove se não existir.
- Resultado registrado no log `REGISTRO_FALHOU` com `compensacao`: `OBJETO_REMOVIDO`, `OBJETO_EM_USO`, `NAO_NECESSARIA` ou `PENDENTE` (remoção falhou: objeto órfão a limpar; nunca importação pela metade).
- Se o objeto já existia, depois do registro a Edge tenta o upload de novo (`upsert: false`): recria o original caso tenha sumido no meio (log `OBJETO_RECRIADO`).
- O banco é tudo ou nada: importação, linhas e evento na mesma transação. Qualquer divergência desfaz tudo.

## Tabelas

`sot_lms_importacoes` (um arquivo recebido): `id`, `projeto_id` (sem FK), `contrato_id_projeto` (texto do projeto no recebimento, só registro), `tipo_importacao` (`ORIGINAL`), `status` (`RASCUNHO`), `hash_sha256`, `arquivo_nome_original` (sanitizado), `arquivo_tamanho`, `mime_informado`, `mime_validado`, `storage_bucket`, `storage_path`, `parser_version`, `worksheet`, `projeto_identificacao_raw` (D1), `qtd_linhas`, `qtd_wls_distintas`, `resumo jsonb`, `criado_em`, `criado_por_auth`, `criado_por_usuario_id`. CHECKs em tudo (hash hex, nome `.xlsx` sem barra, tamanho, MIME, caminho derivado, limites).

`sot_lms_linhas` (uma por linha do XLSX): `importacao_id` (FK), `linha_excel`, `ordem`, `linha_raw jsonb` (células A:N como vieram: `{t, v, w?}`), `wl/ctg/ft/codigo/kit/umd _raw` + `_norm` **calculados pelo banco** (colunas geradas), `descricao_raw`, `qtd_plan_raw`/`qtd_plan`, `qtd_real_raw`/`lms_qtd_real_informada`, `valor_ups_item_raw`/`valor_ups_item`, `valor_final_raw`/`valor_final`, `valor_final_plan_raw`/`valor_final_plan`, `estorno_raw`, `adicionais_raw`, `alertas text[]`. Únicas unicidades: `(importacao_id, linha_excel)` e `(importacao_id, ordem)`. Nunca por código, WL, FT ou KIT. CHECK: `linha_raw` só com chaves A–N.

`sot_lms_importacao_eventos`: `CRIADA` e `REENVIO`, com `auth.uid()` e `usuarios_sistema.id`. Append-only.

Sem FK para `sot_projetos` (exclusão física legada, mesmo motivo da 1.2); a existência é validada nas funções. Sem `sot_wl`, sem `wl_id`/`lms_linha_id` em materiais/atividades, sem estado estrutural (`LEGADO_SEM_WL`, `EM_CONCILIACAO`, `ESTRUTURADO`).

## Conferência no banco

Além dos CHECKs, o registro recusa o lote inteiro (`22023`) quando:

- `qtd_linhas` ≠ linhas recebidas; `qtd_wls_distintas` ≠ WLs gravadas; `ordem` fora da sequência de `linha_excel`;
- `codigo_norm` do parser ≠ `fn_proj_codigo_norm(codigo_raw)` (paridade JS × SQL);
- algum campo gravado ≠ célula guardada em `linha_raw` (`sot_lms_linha_confere`): o raw tem que ser o valor da célula e o número tem que vir da própria coluna. **Quant. Plan só de H e Quant. Real só de I**: trocar uma pela outra, apagar KIT ou mudar WL é recusado no banco, não só no parser.

## Imutabilidade

- `sot_lms_linhas` e `sot_lms_importacao_eventos`: UPDATE, DELETE e TRUNCATE bloqueados por gatilho para **todos** os papéis (inclusive dono e service_role).
- `sot_lms_importacoes`: DELETE/TRUNCATE bloqueados; UPDATE só do `status`, e só se a transação estiver marcada por uma função controlada futura (`cena.lms_status_autorizado = id`). Nesta etapa nenhuma função faz isso e o CHECK só aceita `RASCUNHO`.
- INSERT nas duas tabelas de fonte só dentro de `sot_lms_importacao_registrar` (marca local da transação com o id da importação): nem o dono grava direto.

## RLS e grants

- RLS `ENABLE` + `FORCE` nas 3 tabelas. FORCE porque as funções `SECURITY DEFINER` rodam como dono com BYPASSRLS (pré-condição verificada) e, sem FORCE, qualquer outro uso do dono passaria direto.
- **Nenhuma policy**: authenticated não lê as tabelas direto. Leitura só por `sot_lms_importacao_consultar(importacao_id, offset, limite ≤ 500)`, com a mesma autorização do recebimento (`PROJ_IMPORTAR_LMS` no contrato do projeto).
- Grants de tabela: nenhum para anon, PUBLIC ou authenticated; service_role só `SELECT` em `sot_lms_importacoes` (checagem de existência na compensação).
- Funções: authenticated executa `sot_lms_autorizar_recebimento`, `sot_lms_importacao_consultar` e as de normalização; service_role só `sot_lms_importacao_registrar`; anon nada; internas e de gatilho, ninguém.

## Parser (`lms-parser.ts`, `PARSER_VERSION = '1'`)

Puro: recebe bytes + SheetJS e devolve estrutura; não acessa rede, banco nem Storage. Mudou a interpretação do XLSX = nova `PARSER_VERSION`; importações antigas não são reinterpretadas (o preview de reenvio só mostra amostra se a versão gravada for a atual).

- Aba `Planilha1`; cabeçalho da linha 3 conferido coluna a coluna em A:N (comparação com NFC, espaços colapsados e maiúsculas: `Quant. Plan`, `Cód. Ma` etc.). Qualquer diferença → `FORMATO_LMS_INCOMPATIVEL`, sem adivinhar e sem gravar nada.
- D1 = identificação do projeto (`projeto_identificacao_raw`), guardada como texto, sem interpretação.
- Só refs `A1..N∞` são lidas; o resto da planilha é descartado na leitura.
- SheetJS 0.20.3 (mesma versão do `index.html`), cópia local em `supabase/functions/_shared/vendor/xlsx-0.20.3.mjs` (+ licença Apache-2.0): o bundler do Supabase recusa import de `cdn.sheetjs.com` e o npm só tem a 0.18.5. SHA-256 `1a0fb062…77db`, igual ao arquivo do CDN, conferido no teste da Edge. Lido com `cellFormula: false`, sem HTML, estilos, datas, VBA nem arquivos internos.

### Linha operacional (critério exato)

Linha ≥ 4 com **conteúdo em alguma coluna A–G** (texto só com espaços não conta), **ou** Quant. Plan/Quant. Real numérica **diferente de zero**. O resto é ignorado e listado (`linhas_ignoradas`, até 100 números + total). Na fixture: 200 linhas reais (4–203); a linha fantasma 6024 (só `L = 0`) e as linhas formatadas vazias até 9994 ficam de fora. Linha com identificação e Plan = 0 é preservada.

### Normalização

| Função | Regra |
|---|---|
| `codigo_norm` (`fn_proj_codigo_norm`) | trim (espaço, tab, CR, LF, NBSP) → maiúsculas ASCII → só dígitos: sem zeros à esquerda (`" 000123 "` → `123`, `"000000"` → `0`) → vazio: NULL. `codigo_raw` sempre preservado. |
| `wl/ctg/ft/kit/umd _norm` (`fn_proj_texto_norm`) | trim + maiúsculas ASCII; vazio → NULL. Sem semântica de negócio. |

As duas são `IMMUTABLE STRICT PARALLEL SAFE`, com `translate` (não dependem de locale/collation). Semântica congelada: regra nova = função nova. Paridade JS × SQL testada em 224 entradas e conferida em todo registro.

### Plan × Real

- `qtd_plan` = Quant. Plan (H), quantidade planejada da fonte.
- `lms_qtd_real_informada` = Quant. Real (I), **informação original do LMS**. Não é execução, medição nem quantidade programada; nunca substitui Plan.
- Plan = 0 com Real > 0: linha preservada, Plan continua 0, alerta `PLAN_ZERO_REAL_POSITIVO` e contagem no preview.
- Zero é dado: `0` vira `0`, não NULL (quantidades, valores e código `"0"`).

### Valores

Raw + número. Célula numérica do XLSX vai direto; texto pt-BR é convertido (`"6,132"` → 6.132, `"1.234,5"` → 1234.5, `"0.5"` → 0.5). Ambíguo (`"1.234"`) ou não numérico → NULL + alerta `*_INVALIDA/O`, raw preservado. `VALOR DE UPS ITEM` é UPS, não BRL: nenhuma conversão monetária.

### Fórmulas e macros

Fórmulas nunca são executadas nem lidas como texto: vale o valor gravado na célula. XLSM, `vbaProject.bin`, macrosheets e activeX são recusados antes do SheetJS. O `Default` genérico de `.bin` com "macroEnabled" que o Excel e o SheetJS gravam em todo XLSX não é tratado como macro (só os `Override` contam).

### Duplicidades, KIT, FT=R, Estorno/Adicionais

- Nada é agregado, somado, deduplicado ou sobrescrito. Repetições viram números no preview: `codigos_repetidos` (códigos em mais de uma linha), `duplicados_wl_codigo_ft` e `duplicados_wl_codigo_ft_kit` (linhas excedentes), `linhas_repetidas` (14 campos idênticos, alerta `LINHA_REPETIDA` nas duas).
- KIT é preservado e entra na contagem com KIT (fixture: 36 excedentes por WL+código+FT, 0 com KIT).
- Material com FT = R é preservado (92 na fixture).
- CTG/FT/KIT/UMD: só trim/maiúsculas. Material/serviço é **classificação de preview** (código só dígitos = `MATERIAL_PROVAVEL`; `I-`/`R-` = `SERVICO_PROVAVEL`); a oficial fica para a estruturação.
- Estorno e Adicionais: preservados como vieram, só alerta `ESTORNO_INFORMADO`/`ADICIONAIS_INFORMADO`, sem regra.

Alertas (diagnóstico, nunca correção): `WL_VAZIA`, `CTG_VAZIA`, `FT_VAZIA`, `CODIGO_VAZIO`, `KIT_VAZIO`, `UMD_VAZIA`, `DESCRICAO_VAZIA`, `QTD_PLAN_VAZIA`, `QTD_PLAN_INVALIDA`, `QTD_REAL_INVALIDA`, `VALOR_*_INVALIDO`, `QTD_NEGATIVA`, `PLAN_ZERO_REAL_POSITIVO`, `CELULA_COM_ERRO`, `ESTORNO_INFORMADO`, `ADICIONAIS_INFORMADO`, `SERVICO_PREFIXO_DIFERENTE_FT`, `SERVICO_KIT_FORA_DO_PADRAO`, `LINHA_REPETIDA`.

## Limites

| Limite | Valor | Referência (modelo real) |
|---|---|---|
| Arquivo | 12 MiB | 4,4 MB |
| Partes no ZIP | 100 | 10 |
| Descompactado total / por parte | 40 MiB / 30 MiB | 4,4 MB (planilha) |
| Razão de compressão (partes > 1 MiB) | 200 | planilha sem compressão |
| Tamanho real × declarado no ZIP | iguais (cada parte é descompactada com limite) | — |
| Linhas operacionais | 5.000 (acima: recusa inteira, sem truncar) | 200 |
| Caracteres por célula A:N | 2.000 | — |
| Nome do arquivo | 200 caracteres, `.xlsx` | — |
| Amostra no preview | 50 linhas | — |
| Página da consulta | até 500 linhas | — |

ZIP64, ZIP criptografado, método diferente de stored/deflate e caminho com `..` são recusados.

## Privacidade

Conteúdo de O em diante (no modelo real: listas de pessoas com RE nas colunas R e U) **não sai do parser**: não vai para o banco, resposta, preview, erro nem log; o CHECK de `linha_raw` recusa chave fora de A–N no banco. O original privado continua com tudo, no bucket fechado. Logs (JSON) só com `projeto_id`, `importacao_id`, `hash`, `status`, `linhas`, `auth_uid`, código do erro e resultado da compensação: sem nome de arquivo, sem células, sem JWT, sem chaves.

## Preview (resposta 200)

`ok`, `reenvio`, `importacao_id`, `projeto_id`, `status`, `tipo_importacao`, `arquivo {nome, tamanho, sha256, mime_validado}`, `parser_version`, `worksheet`, `projeto_identificacao_raw`, `qtd_linhas`, `qtd_wls_distintas`, `resumo` (WLs com linhas e materiais/serviços prováveis, Plan=0/Real>0, códigos repetidos, códigos nulos, duplicidades, linhas repetidas, linhas ignoradas, contagem de alertas), `amostra` (50 primeiras linhas, sem `linha_raw`), `erros`, `avisos`. O restante das linhas: `sot_lms_importacao_consultar`.

## Testes

| Arquivo | Verificações | Cobre |
|---|---|---|
| `proj-lms-parser.test.mjs` | 127 | Oráculo `modelo-lms-esperado.json` (linhas, WLs, materiais, FT=R, serviços, UPS por WL, duplicidades), comparação célula a célula independente do parser, hash, normalização, números pt-BR, linha fantasma, Plan=0/Real>0, KIT, FT=R, Estorno/Adicionais, fora de A:N, fórmula, cabeçalho/aba, limites, arquivos maliciosos montados em memória (CSV, XLS, XLSM, VBA, ZIP criptografado, path traversal, ZIP bomb, tamanho declarado falso). |
| `proj-lms-origem-sql.test.mjs` | 141 | PGlite com as migrations reais (sessão, 1.1, 1.2, 1.3): estáticos, RLS/FORCE, grants, autorização (todos os motivos, negação/concessão por contrato), registro da fixture linha a linha, reenvio, 17 adulterações recusadas sem gravação parcial, imutabilidade para dono/authenticated/anon/service_role, consulta paginada, legado intacto, desfazer/reaplicar, pré-condições. |
| `proj-lms-receber-edge.test.mjs` | 65 | `index.ts` real com Auth/Storage simulados e banco PGlite: lista de segurança da seção 46, SheetJS local com hash do CDN, sucesso, preview, reenvio, fora de A:N, compensação (Storage falha, banco falha, remoção falha, objeto em uso, objeto recriado), logs sem PII/segredos, ordem usuário → serviço. |

Mutações (cópias temporárias; arquivos definitivos intactos), todas detectadas: Quant. Real no lugar de Plan; agregação de códigos repetidos; descarte de FT=R; remoção do KIT; importação de conteúdo fora de A:N; anon com SELECT nas linhas; anon com EXECUTE na autorização; banco ignorando `cena_pode`; Edge ignorando a autorização; hash calculado depois do parse (Edge); hash sobre outra coisa (parser).

Suíte completa: 64 arquivos, 64 passaram (inclui 1.1 com 185 e 1.2 com 271 verificações).

## Riscos e dívidas

1. Janela residual de autorização descrita acima (revogação entre autorizar e registrar).
2. Registro em uma chamada (até 5.000 linhas, alguns MB de JSON). Garante tudo-ou-nada; limite de corpo do PostgREST/Edge precisa de conferência remota com arquivo grande.
3. SheetJS em cópia local (atualizar = trocar o arquivo e o hash do teste juntos); memória da Edge com planilha de 30 MiB descompactada não foi medida no Supabase.
4. Policies em `storage.objects` criadas fora das migrations (painel) que não filtram `bucket_id` liberariam o bucket novo. Query de conferência no fim da migration.
5. Compensação `PENDENTE` deixa objeto órfão (privado, sem importação): limpeza manual pelo log.
6. Existência de projeto distinguível para usuário ERP ativo sem permissão (`PROJETO_INEXISTENTE` × `SEM_PERMISSAO`).
7. Sem tela: o fluxo só é chamado pela Edge (teste/curl) até a etapa de interface.
8. Débitos anteriores intocados (senhas iguais ao RE, `senha_hash` visível, bucket público `cena-docs`, token ERP no front).

## Validação remota necessária

1. Aplicar a migration no SQL Editor (role `postgres`) e rodar `tmp-fix/etapa-1.3-conferencia-producao.sql`. **Feito em 09/10/2026: 28/28 ok** (policies de `storage.objects` conferidas antes: só `cena-docs` e `cena-rh-pj-documentos`).
2. `supabase functions deploy proj-lms-receber` e conferir que a função sobe sem erro. Primeira tentativa recusada pelo bundler (import de `cdn.sheetjs.com`); corrigido com a cópia local. **Feito em 10/10/2026**; projeto inexistente com JWT real → 404 `PROJETO_INEXISTENTE`, sem gravação.
3. Upload da fixture com usuário real autorizado: 200, 200 linhas, objeto em `proj-lms/<projeto>/<hash>.xlsx`, reenvio idempotente. **Feito em 10/10/2026** no projeto de teste "TESTE 1" do contrato ENEL RDSE (`92722d1e-…24da`): importação `aac33bfb-…347f` RASCUNHO/ORIGINAL, Planilha1, 200 linhas gravadas, 12 WLs, 0 linhas divergentes da célula, hash `b8e3b9d4…37a4` e tamanho 4.481.455 bytes iguais à fixture, eventos `CRIADA,REENVIO`, reenvio devolveu a mesma importação, 1 objeto no bucket no caminho esperado. A importação fica permanente nesse projeto de teste.
4. Negativas reais: sem JWT, usuário sem `PROJ_IMPORTAR_LMS`, projeto excluído, contrato texto, arquivo inválido.
5. Arquivo próximo dos limites (linhas e tamanho) para medir memória/tempo da Edge e o corpo da RPC.
6. Logs da Edge sem nome de arquivo/conteúdo.

## Próxima etapa

Confirmação humana do RASCUNHO (ORIGINAL + `ESTRUTURA_NOVA`), que poderá congelar o perfil de processo na mesma transação (origem `LMS_ORIGINAL_ESTRUTURA_NOVA` da 1.2), e depois `sot_wl`/conciliação. Para isso: ampliar o CHECK de `status`, criar a função controlada de status e a tela de upload/preview.
