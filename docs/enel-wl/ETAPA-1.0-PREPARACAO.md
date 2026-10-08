# Fase 1 LMS/WL — Etapa 1.0 (preparação)

Somente leitura. Nada foi gravado no banco, nenhuma migration foi criada, nenhum código de produção foi alterado.

Fontes: Bloco 2 e Bloco 3 (rodados pelo usuário no SQL Editor em 06/10/2026), `information_schema` de 06/10/2026, `PROGRAMACAO-PROJETOS-JORNADA-AUDITORIA.md` e leitura do código (`index.html`, `portaria-offline.js`, `sw.js`, `modules/`).

---

## B. Matriz de permissões proposta

### Perfis reais em `usuarios_sistema` (Bloco 3, registros não excluídos)

| Perfil | Ativos | Em `PERFIS_BASE` (código) | Em `perfis_sistema` ativo |
|---|---|---|---|
| equipe | 693 | sim | não |
| escritorio | 91 | **não** | **não** |
| encarregado | 81 | sim | não |
| administrativo | 42 | sim | não |
| supervisor | 24 (+1 inativo) | sim | não |
| admin | 18 (+1 inativo) | sim | não |
| supervisor_tma | 12 | **não** | **não** |
| gestor | 11 | sim | não |
| portaria | 8 | não | sim |
| coordenador | 4 | sim | não |
| sesmt | 4 | não | sim |
| almoxarife | 3 | sim | não |
| dp | 3 | sim | não |
| supervisor_frotas | 1 | sim | não |

`diretoria`, `rh` e `gerente_frotas` existem em `PERFIS_BASE` e têm zero usuários. 995 dos 997 usuários estão ativos e vinculados ao Supabase Auth; os 2 sem vínculo estão inativos. `user_permissoes` tem 27 linhas, a maioria inativa (não usada no desenho).

### Matriz perfil × ação

S = concede, N = não concede, **D = decisão do gestor**. Escopo v1: global (contrato vazio). Escopo por contrato exige vínculo usuário → contrato, que ainda não foi auditado.

| Ação | admin | gestor | coordenador | supervisor | escritorio | administrativo | almoxarife | diretoria (0) | demais |
|---|---|---|---|---|---|---|---|---|---|
| PROJ_IMPORTAR_LMS | S | S | S | N | **D** | **D** | N | S | N |
| PROJ_CONCILIAR_LMS | S | S | **D** | N | N | N | N | S | N |
| PROJ_EDITAR_WL | S | S | S | N | **D** | N | N | S | N |
| PROJ_REALIZAR_VIABILIDADE | S | S | S | S | **D** | N | N | S | N |
| PROJ_AVALIAR_CENA | S | S | S | **D** | **D** | N | N | S | N |
| PROJ_APROVAR_AVALIACAO_CENA | S | S | **D** | N | N | N | N | S | N |
| PROJ_REGISTRAR_RETORNO_ENEL | S | S | S | N | **D** | **D** | N | S | N |
| PROJ_PROGRAMAR | S | S | S | S | S | S | N | S | N |
| PROJ_ALTERAR_PERFIL_PROCESSO | S | S | N | N | N | N | N | **D** | N |
| ALM_SAP_RESERVAR (só 1.8) | S | S | **D** | N | N | N | S | N | N |

"Demais" = equipe, encarregado, supervisor_tma, portaria, sesmt, dp, supervisor_frotas. Campo continua lançando pelo fluxo atual; nenhuma ação nova é necessária para equipe/encarregado na Fase 1.

`PROJ_PROGRAMAR` reproduz exatamente os 7 perfis de `cena_prog_pode_programar_projetos()` (admin, diretoria, gestor, coordenador, supervisor, administrativo, escritorio), para não mudar quem programa hoje.

Usuários alcançados só com os "S" (ativos): importar 33; conciliar 29; programar 190; alterar perfil 29; reserva SAP 32.

Decisões do gestor nesta matriz:

1. `escritorio` (91 usuários) recebe importar LMS, editar WL, viabilidade, avaliar e retorno ENEL?
2. `administrativo` (42) recebe importar LMS e retorno ENEL?
3. `coordenador` concilia, aprova avaliação CENA e reserva SAP?
4. `supervisor` avalia CENA?
5. `admin` (18 usuários) recebe ações de negócio ou só administração do sistema?
6. Quem administra a matriz: proposta = perfis aceitos por `cena_usuarios_pode_administrar()` (admin, gestor).
7. `escritorio` e `supervisor_tma` não estão em `PERFIS_BASE` nem em `perfis_sistema`: cadastrar formalmente antes da 1.1?

---

## C. Contratos candidatos a ENEL_OBRAS v1

Projetos ativos do Bloco 2 (06/10/2026). Códigos e processo atual de `PROGRAMACAO-PROJETOS-JORNADA-AUDITORIA.md`.

| Código | Contrato | Projetos ativos | Processo atual | Proposta |
|---|---|---|---|---|
| 4600003971 | RDSE | 10 | status SOT | **Candidato recomendado** (é onde aparecem LMS da concessionária, ex.: DAC/S.NOR) |
| 4600004484 | RDSE NOVO | 0 | status SOT (aba própria) | **Candidato recomendado** (sucessor do RDSE) |
| 4600003872 | RDSC | 1 | status SOT | **D** — matriz da auditoria marca quase tudo "A VALIDAR" |
| 4600004482 | RDSC NOVO | 0 | status SOT (aba própria) | **D** |
| 4600004206 | SOT OBRAS | 3 | status SOT | **D** |
| 4600003478 | ETD | 0 | fluxo por código | Não na v1 |
| 4600003913 | BT0 | 0 | lista de obras | Não na v1 |
| 4600003817 | OUTFIT | 0 | lista de obras | Não na v1 |
| 4600004043 | AUTOMAÇÃO CT | 0 | lista de obras | Não na v1 |
| 4600004208 | TMA OESTE | 1 | fluxo de OS | **Excluído** (regra absoluta TMA) |

Efeito: o mapeamento só vale para projetos novos que confirmarem a ORIGINAL em `ESTRUTURA_NOVA` (ou por ação do gestor). Os 10 projetos RDSE atuais continuam BASE_PROJETOS.

Consulta somente leitura para obter os UUIDs na hora do cadastro (não executada):

```sql
SELECT id, codigo, nome, cliente, status, deleted_at
FROM public.contratos
WHERE codigo IN ('4600003971','4600004484','4600003872','4600004482','4600004206')
ORDER BY codigo;
```

---

## D. Mapa de acesso sem login

### Como o código autentica hoje

- Toda chamada REST passa por `cenaAuthAuthorizedFetch` / `cenaAuthPrepareBearer` (`index.html` ~6640–6720): com sessão Auth usa o JWT do usuário (papel `authenticated`); se já houve sessão e o token falha, a chamada é abortada (sem cair para anon). Só usa a anon key quando nunca houve sessão.
- O login por MD5 (`sbFetchLoginUsuarios`, ~7314) lê `usuarios_sistema` com a anon key, mas a migration `20261004190000_seguranca_usuarios_sistema.sql` revogou todo acesso de `anon` a essa tabela. Na prática, só entra quem tem sessão Auth.
- 36 chamadas `fetch` diretas usam `_sbAuthToken || SB.key` (ex.: fallback físico do `sbDelete` ~8361, `portaria-offline.js:454`, uploads, DELETEs de requisições ~103404–104219). Caem para anon só se `_sbAuthToken` estiver vazio no momento (antes da restauração da sessão ou durante logout).
- Portal do candidato (`?candidato=`) usa Edge Function pública (`rh-candidato-portal`), não tabelas.
- `sw.js` não chama a API Supabase.
- `acordos.html` usa token do ERP externo, não Supabase.

Conclusão: dentro do repositório, os fluxos logados já usam `authenticated`. O papel `anon` só aparece em bordas (sessão ainda não restaurada, logout, Portaria offline sem token) e em **consumidores fora do repositório, que não dá para ver pelo código** (automações, integrações, outros apps com a anon key). Medir nos logs da API do Supabase (requisições com papel anon, 7 a 14 dias) antes de fechar cada tabela.

Atenção: fechar `anon` não resolve a autorização. As políticas atuais "acesso total" também valem para `authenticated`: qualquer usuário logado (inclusive os 693 `equipe`) lê e grava essas tabelas pela REST.

### Tabelas auditadas (Bloco 1 + Bloco 3)

Risco = risco de quebrar fluxo ao restringir a política ao papel `authenticated`. Contagem = referências no código (script `tmp-fix/mapa-anon-etapa10.js`).

| Tabela | Funcionalidades (exemplos de funções) | Uso | Risco |
|---|---|---|---|
| `perfis_sistema` | Cadastro de perfis extras (`carregarPerfisExtras`, `cadastrarPerfilExtra`), carregada após login | select/insert/update | **BAIXO** (gravidade alta: anon grava perfis) |
| `user_permissoes` | Tela de permissões (`permCarregar`, `permSalvarTodas`), após login | select/insert/update | **BAIXO** (gravidade alta: anon grava permissões) |
| `sot_documentos` | Documentos do projeto (`sotAbrirProjeto`, `sotExcluirDoc`) | 4 | BAIXO |
| `sot_medicoes` | Medições (`sotNovaMedicao`, `sotRegistrarNF`), notificação em tempo real | 9 | BAIXO |
| `sot_med_itens` | Itens de medição | 6 | BAIXO |
| `sot_projetos_historico` | Histórico de status (`sotAlterarStatus`, `_sotProgramarProjeto`) | 6 | BAIXO |
| `sot_atividades_historico` | Histórico de execução (`sotLancarExecucaoAtividade`) | 1 | BAIXO |
| `sot_adicionais` | Adicionais (Projetos/PLPT), notificação em tempo real, Jornada | 19 | BAIXO |
| `sot_materiais_historico` | Baixa de material (`_abrirBaixaModal`, insert). **RLS desligado** | 1 | **MÉDIO** (exige ligar RLS + política `authenticated` na mesma migration) |
| `sot_ativ_rapidas` | Atividades rápidas (`sotSalvarAtivRapida` e outras). RLS ligado **sem política**: já fechada para todos | 5 | n/a — achado funcional: recurso provavelmente falha hoje |
| `depositos` | Locais (requisições, SESMT, usuários) | 4 | BAIXO |
| `materiais_sap` | Obras SAP (`carregarModuloObras`, `openNovoItemSAP`) | 5 | BAIXO |
| `alm_movimentos` | Estoque SAP (`almCarregarMovimentos`, `almSalvarMovimentoSeguro`) | 9 | BAIXO (será redesenhado na 1.8) |
| `sot_lancamentos_campo` | Lançamentos de campo (`dbConfirmarLancamento`, `sotValidarLancamento`) | 4 | **MÉDIO** (Campo) |
| `sot_projetos` | Projetos, PLPT campo/diário (`renderDiarioPlpt`, `_plptRestaurarSessao`), programação, contratos | 25 | **MÉDIO** (Campo + Programação) |
| `sot_atividades` | Projetos, PLPT campo (`plptConfirmarAtividade`), validação de campo | 22 | **MÉDIO** |
| `sot_materiais` | Projetos, PLPT baixa/aplicação/devolução, contratos | 38 | **MÉDIO** |
| `contratos` | Base de quase todas as telas (`carregarDadosBase`, menu mobile, RH, SESMT) | 24 | **MÉDIO** (uso transversal) |
| `itens_catalogo` | Almoxarifado, entradas, SESMT/EPI | 18 | **MÉDIO** |
| `estoque` | Almoxarifado, EPI, pneus, frotas | 54 | **MÉDIO** |
| `movimentacoes_itens` | Almoxarifado patrimonial, EPI, extrato do colaborador | 26 | **MÉDIO** |
| `alm_requisicoes` / `alm_requisicao_itens` / `alm_requisicao_eventos` | Requisições do Almoxarifado CENA; RPCs `fn_alm_req_*` também concedidas a `anon` | 12 / 7 / 4 | **MÉDIO** (fechar tabelas e `EXECUTE` das RPCs juntos) |
| `composicao_dia` | Programação, TMA (`relTma*`, `progBuscarEscalaTMAData`), Portaria (`portSincronizarProgramacaoDia`, `portSyncProgAssinar`), diário de campo, inspeção de campo SESMT, frotas, tempo real | 127 | **ALTO** (Portaria offline, TMA intocável, tempo real) |

Fora do escopo auditado: as demais tabelas do schema `public` (Portaria, frotas, RH etc.) não passaram pelo Bloco 1. Consulta somente leitura para o mapa completo (não executada):

```sql
SELECT c.relname AS tabela,
       c.relrowsecurity AS rls,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
       has_table_privilege('anon', c.oid, 'INSERT') AS anon_insert,
       has_table_privilege('anon', c.oid, 'UPDATE') AS anon_update,
       has_table_privilege('anon', c.oid, 'DELETE') AS anon_delete,
       EXISTS (SELECT 1 FROM pg_policies p
               WHERE p.schemaname = 'public' AND p.tablename = c.relname
                 AND ('anon' = ANY (p.roles) OR 'public' = ANY (p.roles))
                 AND coalesce(p.qual, 'true') = 'true') AS politica_aberta
FROM pg_class c
WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
ORDER BY 1;
```

### Ordem sugerida para a Frente S

1. Medir uso real do papel anon nos logs da API.
2. BAIXO primeiro, começando por `perfis_sistema` e `user_permissoes` (maior gravidade).
3. `sot_materiais_historico` com RLS + política `authenticated` na mesma migration.
4. MÉDIO por módulo, com regressão de Campo, Programação e Almoxarifado.
5. `composicao_dia` por último, com teste de Portaria offline e sem alterar regras TMA.
6. Em seguida, a segunda camada: autorização por perfil para `authenticated`.

---

## A. Fixture LMS

Arquivo real recebido do usuário (Modelo LMS.xlsx). Cópia anonimizada em `tests/fixtures/lms/modelo-lms-anonimizado.xlsx`, totais em `modelo-lms-esperado.json`, procedimento em `tests/fixtures/lms/README.md`. O original não foi alterado.

## Análise real do Modelo LMS.xlsx

- Uma aba, `Planilha1`. Não há aba `LMS...`, `Extração_205` nem `Extração_RESB` (o layout assumido pelo importador atual e pelo teste sintético `tests/sot-lista-lms.test.js` não corresponde a este modelo).
- Definição de projeto em `D1` (mesclado `D1:G1`), formato `DMP/A.OES.nn.nnnnn`.
- Cabeçalho na linha 3 (A–N): `WL`, `CTG`, `FT`, `Cód. Ma`, `KIT`, `UMD`, `Descrição`, `Quant. Plan`, `Quant. Real`, `VALOR DE UPS ITEM`, `VALOR FINAL`, `VALOR FINAL PLAN`, `Estorno`, `Adicionais`. Tudo numa linha só por item: a WL vem na própria linha.
- 200 linhas de dados (4–203), 12 WLs (`"1"`…`"12"`, texto). Linha fantasma 6024 (só `L = 0` formatado). Linhas 204–9994 vazias com formatação. Sem fórmulas (valores colados).
- Materiais: 184, código numérico de 6 dígitos em célula numérica. 92 com FT=R (retirada).
- Serviços: 16, código texto `I-AHO…`/`R-AHO…`; prefixo igual ao FT em 16 de 16; KIT = `S-` + código sem prefixo.
- CTG: `WP` (196), `WS` (4, WL 12). UMD: `PC`, `M`, `KG`, `ROL`, `UN`, `US3`.
- Quant. Plan = Quant. Real nas 200 linhas (nenhum caso Plan=0 com Real>0).
- Valores só em serviços: `VALOR DE UPS ITEM` é texto pt-BR (`"0,2616"`); `VALOR FINAL` = UPS × Real e `VALOR FINAL PLAN` = UPS × Plan (16 de 16). São UPS, não R$.
- `Estorno` e `Adicionais`: colunas presentes, vazias em todas as linhas.
- 28 códigos aparecem em mais de uma WL. **36 linhas repetem WL + código + FT e só se distinguem pelo KIT** (ex.: linhas 25–27, WL 6, `310567`). Com KIT, zero duplicidades.
- Colunas R e U: listas de pessoas com RE, fora da tabela (dado pessoal; removido do fixture).

## E. Casos de teste do importador

26 casos em `tests/fixtures/lms/modelo-lms-casos.md`: 21 presentes no arquivo real e 5 variações montadas a partir de linhas reais (Estorno, Adicionais, Plan=0 com Real>0, linha sem código com conteúdo, prefixo de serviço diferente do FT).

Importador atual × este arquivo (leitura do código): não acha aba `LMS` e manda para a IA; exige cabeçalho `Código` (aqui é `Cód. Ma`); se lesse, descartaria os 92 materiais FT=R e somaria o mesmo código entre WLs e KITs.
