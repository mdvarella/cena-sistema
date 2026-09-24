# CENA-MOD-PED-1 — RELATÓRIO

Modularização piloto de **Frotas > Pedágios** dentro do mesmo ERP CENA.  
Não é um sistema independente. Sem alteração de schema, SQL, regra de negócio, UI ou resultado da Viabilidade Econômica.

**Decisão arquitetural:** scripts clássicos (IIFE + namespace). Sem `import`/`export` / `type="module"` nesta fase — o ERP e o service worker atuais não usam ES Modules.

---

## 1. Mapa de dependências do módulo Pedágios

| Dependência | Classificação | Observação |
|---|---|---|
| `modules/frotas/pedagios/pedagios.js` | INTERNA DO MÓDULO | UI, filtros, cards, modal, wrappers |
| `modules/frotas/pedagios/pedagios-service.js` | INTERNA DO MÓDULO | Regras homologadas FROTAS-PEDAGIOS-1 |
| `modules/frotas/pedagios/pedagios-repository.js` | INTERNA DO MÓDULO | Persistência `frotas_pedagios` / memória |
| `frt_pedagios` | INTERNA DO MÓDULO | Array em memória do ERP |
| `#pg-frotas-pedagios` + filtros/cards | INTERNA DO MÓDULO | Container no `index.html` |
| `escHtml`, `progShowToast`, `setModal`, `closeModal`, `showMain`, `showSub` | CORE COMPARTILHADO | Não copiados |
| `frtNormPlaca`, `frtPlacaMatchBusca`, `frtHintFiltroPlacas`, `frtPasteFiltroPlacas` | FROTAS | Filtro de placas compartilhado |
| `frt_veiculos` / `frotas_veiculos` | FROTAS | Vínculo veículo / placa / TAG (concessionária) |
| `frt_portaria` / `frotas_portaria_saidas` | PORTARIA | Janela data_saida → data_retorno (+18h se sem retorno) |
| `composicao_dia`, `prog_projetos` | PROGRAMAÇÃO | Resolução de projeto/obra |
| `equipes`, `equipes_disp` | PROGRAMAÇÃO | Equipe → contrato |
| `contratos` | CORE COMPARTILHADO | Contrato / apropriação |
| `sot_projetos` / `projetos` / `obras_projetos` | PROGRAMAÇÃO | Nome do projeto (não inventa ID) |
| `vbeColetarCustosERP`, `vbeAdicionarValorNaEstrutura`, `vbeMontarDreViabilidade` | VIABILIDADE | Gancho fino: `frtPedSomarContrato` |
| `vbeEnsureDadosCustosERP` → `frtPedCarregar` | VIABILIDADE | Carga do mês da competência |
| `DEMO`, `usuarioLogado` | AUTH | Mesmo perfil Frotas; aba oculta em `perfil-portaria` |
| `sbFetchAll`, `sbInsert`, `sbUpdate`, whitelist `_schemaCols` | SUPABASE | Tabela `frotas_pedagios` |
| `auditLog` + `_AUDIT_MODULO_TABELA` | AUDITORIA | Módulo `frotas` |
| `_SOFT_DELETE_TABLES` | SUPABASE | `deleted_at` em `frotas_pedagios` |
| Anexos do ERP (`setModal` / storage existente) | STORAGE | Sem tela nova de anexo; não há bucket exclusivo |
| `syncSemPararPedagios` | FROTAS | Stub: grava em Pedágios, não na VBE |
| Fatura / conciliação (`tipo=FATURA`) | INTERNA DO MÓDULO | Não entra no custo operacional |

Integrações obrigatórias **preservadas**: veículo, TAG/concessionária, viagem/portaria, equipe, contrato, projeto/obra, VBE, audit_log, fatura/conciliação.

---

## 2. Arquivos criados

- `modules/frotas/pedagios/pedagios.js` (390 linhas)
- `modules/frotas/pedagios/pedagios-service.js` (555 linhas)
- `modules/frotas/pedagios/pedagios-repository.js` (101 linhas)
- `CENA-MOD-PED-1.md` (este relatório)

## 3. Arquivos alterados

- `index.html` — bootstrap, container, menu, ganchos VBE, whitelist/audit/soft-delete, versão
- `sw.js` — `SW_VERSION` + PRECACHE dos 3 scripts

SQL **não** alterado. Banco **não** alterado.

---

## 4. Funções retiradas do index.html

Nenhuma função Pedágios foi extraída do `index.html` 8.1.124 — o estado em disco **não tinha** o monolito (ele existiu em 8.1.125 e desapareceu).  
A implementação homologada foi recolocada **já fatiada** nos 3 arquivos do módulo, em vez de voltar para o `index.html`.

Wrappers globais mantidos no módulo (não no index):

`frtPedInit`, `frtPedRender`, `frtPedAba`, `frtPedAbrirNovo`, `frtPedConfirmarNovo`, `frtPedAbrirEditar`, `frtPedConfirmarEditar`, `frtPedAbrirClassificar`, `frtPedConfirmarClassificar`, `frtPedConfirmarRemoverVinculo`, `frtPedConfirmarCancelar`, `frtPedSeedDemo`, `frtPedagiosRodarTestesVbe`, `frtPedSomarContrato`, `frtPedCarregar`, `frtPedEntraNoCusto`, `frtPedApropriarAuto`, `frtPedNormStatus`, `frtPedEhFatura`

## 5. Funções mantidas compartilhadas (não copiadas)

`frtNormPlaca`, `frtPlacaMatchBusca`, `parseJsonField`, `auditLog`, `escHtml`, `progShowToast`, `setModal`, `closeModal`, `showMain`, `showSub`, `sbFetchAll`, `sbInsert`, `sbUpdate`, `vbeColetarCustosERP`, `vbeAdicionarValorNaEstrutura`, `vbeMontarDreViabilidade`, arrays `frt_veiculos`, `frt_portaria`, `contratos`, `equipes`, `equipes_disp`, `composicao_dia`, `prog_projetos`.

---

## 6. API pública do módulo

```
CENA.Frotas.Pedagios.init()
CENA.Frotas.Pedagios.abrir()
CENA.Frotas.Pedagios.recarregar()
```

Interno (não contrato público): `_repo`, `_svc`.

## 7. Dependências com outros módulos

- **Frotas:** veículos, placas, menu, `frtInit`
- **Portaria:** viagem (`frt_portaria`)
- **Programação:** equipe / composição / projeto
- **Viabilidade:** custo operacional categoria `pedagios` / legado `pedagio`
- **Auth:** mesmo acesso de Frotas
- **Auditoria / Supabase / Storage:** infraestrutura existente

---

## 8. Linhas no index.html

- `index.html` atual: **152.177** linhas
- Código específico de Pedágios **não** foi recolocido no index (evitadas ~1.046 linhas de monolito)
- Index recebeu só integração: 3 `<script>`, aba/menu/`ALL_PAGES`, `#pg-frotas-pedagios`, `var frt_pedagios`, seed DEMO, ganchos VBE, whitelist/audit/soft-delete, CSS portaria

---

## 9. Resultado dos testes

Reexecução FROTAS-PEDAGIOS-1 testes **24–41: 18/18**.

| Item | Resultado |
|---|---|
| Aba Pedágios abre | OK |
| Listagem (3 linhas DEMO) | OK |
| Cards (custo 40,10 / 2 válidas / fatura 21,40 / 1 sem apropriação) | OK |
| Filtros (mês, contrato, placa, status) | OK |
| Modal cadastro | OK |
| Fila sem apropriação + Classificar | OK |
| Veículo / viagem / equipe / contrato / projeto | OK (testes 24–27) |
| Duplicidade fora do custo | OK (36) |
| Pedágio sem apropriação | OK (37–38) |
| Classificação manual | OK (39) |
| Cancelamento some do custo | OK (35) |
| Edição reflete | OK (34) |
| Fatura não duplica | OK (41) |
| audit_log | OK (40) — `auditLog()` nas ações |
| Scripts 200 (Network) | OK (repository/service/ui + shells) |
| `salvarEntrada` | OK (sem regressão Almox) |
| Funções Frotas/Portaria/Programação/VBE | OK (ainda definidas) |
| RLS / permissões reais | Não reexecutado contra JWT — SQL/RLS intocados |

Anexos: não há UI exclusiva homologada de anexo em Pedágios; permanece o mecanismo compartilhado do ERP.

## 10. Resultado da Viabilidade Econômica

Contrato DEMO `c1` / competência atual:

- custo operacional **R$ 21,40** (passagem VALIDADA + APROPRIADA)
- categoria **`frota.pedagios`**
- fatura **não** entra
- SEM_APROPRIACAO **não** entra em contrato
- DRE simples: linha Pedágios = 21,40; total = 21,40
- `vbeColetarCustosERP`: `despesas.frota.pedagios = 21.40`
- alteração/cancelamento/duplicidade: cobertos pelos testes 34–36
- **nenhuma duplicidade de custo introduzida**

Regra aprovada intacta: pedágio validado → custo operacional → projeto/contrato → VBE.

## 11. Regressões encontradas

Nenhuma nos módulos tocados por referência (Frotas, Combustível, Manutenção, Portaria, Programação, VBE, Almox `salvarEntrada`).

Observação DEMO: o select de veículo do modal lista `frt_veiculos`; se o DEMO ainda não hidratou a frota, o combo fica só em “Selecione…”. Comportamento já existente da fonte compartilhada — não é regra nova.

---

## 12. APP_VERSAO

`8.1.126` — build `20260924-0700`

## 13. SW_VERSION

`cena-8.1.126`  
PRECACHE inclui os 3 arquivos em `modules/frotas/pedagios/`.  
`?v=8.1.126` fura cache do SW antigo.

---

**PEDÁGIOS CONTINUA FUNCIONALMENTE IDÊNTICO AO ESTADO HOMOLOGADO.**

Pedágios é o primeiro módulo **organizado dentro do mesmo ERP**, não um produto separado.

**STATUS: AGUARDANDO APROVAÇÃO CENA-MOD-PED-1**

Não iniciada modularização de outro módulo.
