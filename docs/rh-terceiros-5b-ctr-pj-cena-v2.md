# CTR-PJ-CENA v2 — tokens, fontes e invariantes

Modelo histórico **CTR-PJ-CENA v1** (`f57297e5-819b-42dc-937a-cfab632e081c`) permanece publicado e imutável. A v2 é versão independente.

## Distinções

| Conceito | Fonte | Não é |
|---|---|---|
| Data do instrumento (`data_instrumento` / `[[DATA_INSTRUMENTO_CONTRATO]]`) | Snapshot `rh_contratacao_partes_pj` | Data/hora da assinatura eletrônica futura |
| Honorários | `valor_honorarios` + `rhDocExtensoMoeda` | Salário / remuneração CLT |
| Objeto / atividades | `objeto_contrato` / `descricao_atividades` | Cargo master / `[[CARGO]]` |
| Forma de pagamento | `forma_pagamento` | Texto fixo de NF/PIX/boleto |
| Representantes | Snapshot congelado da parte PJ | Cadastro mestre após congelar |

Assinatura digital (DocuSign / ZapSign / envelope / `DS_*` / `ZAPSIGN_*`) **não** entra nesta fase. Restam só os blocos visuais CONTRATANTE e CONTRATADA.

## Testemunhas

Testemunhas removidas da v2 por ausência de regra operacional estruturada; poderão retornar em versão futura.

## Vigência

- `DETERMINADO`: exige `data_inicio` e `data_fim`. `[[CLAUSULA_VIGENCIA]]` cita início e fim.
- `INDETERMINADO`: exige `data_inicio`; `data_fim` não é obrigatória. Texto de prazo indeterminado.

## Mapa de tokens v2

| Token | Fonte |
|---|---|
| `[[EMPRESA_RAZAO_SOCIAL]]` `[[EMPRESA_CNPJ]]` `[[EMPRESA_ENDERECO]]` | Empresa empregadora do processo |
| `[[REPRESENTANTE_EMPRESA]]` e documentos CENA | `contratante_representante_*` (snapshot) |
| `[[RAZAO_SOCIAL_CONTRATADA]]` `[[CNPJ_CONTRATADA]]` `[[ENDERECO_CONTRATADA]]` | Snapshot da contratada |
| Representante da contratada (nome/CPF/RG/nacionalidade/estado civil/endereço/qualificação) | Snapshot `representante_*` |
| `[[NUMERO_CONTRATO]]` | `numero_contrato` (opcional) |
| `[[OBJETO_CONTRATO]]` | `objeto_contrato` |
| `[[DESCRICAO_ATIVIDADES]]` | `descricao_atividades` |
| `[[VALOR_HONORARIOS]]` | `valor_honorarios` |
| `[[VALOR_HONORARIOS_EXTENSO]]` | derivado `rhDocExtensoMoeda` |
| `[[FORMA_PAGAMENTO]]` | `forma_pagamento` |
| `[[DATA_INICIO_CONTRATO]]` `[[DATA_FIM_CONTRATO]]` `[[TIPO_VIGENCIA]]` | snapshot |
| `[[CLAUSULA_VIGENCIA]]` | derivado de tipo + datas |
| `[[DATA_INSTRUMENTO_CONTRATO]]` | `data_instrumento` |
| `[[VERSAO_MODELO]]` | modelo |

Não entram na v2: `[[CARGO]]`, `[[OBJETO_DA_FUNÇÃO]]`, `[[DESCRIÇÃO_DAS_ATIVIDADES_E_RESPONSABILIDADES]]`, `[[BENEFICIOS]]`, `[[DATA_ASSINATURA]]` (wizard CLT), `[[PAGINA]]`, `[[TOTAL_PAGINAS]]`, hash/IP/assinante/código de verificação.

## Invariantes

- Rascunho PJ incompleto **pode** ser salvo.
- Gerar CTR-PJ-CENA **bloqueia** se faltar dado essencial (empregadora, representante CENA congelado com nome/CPF/RG/nacionalidade/estado civil/qualificação, contratada razão/CNPJ/endereço, representante da contratada com os campos que permanecem no texto, objeto, atividades, honorários, forma de pagamento, início, tipo de vigência, data do instrumento; fim se determinado).
- v1 **não gera** documento.
- Pacote `TERCEIRO_PJ` permanece **Pacote PJ em preparação** (sem inclusão automática da v2).
