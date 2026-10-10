# Casos de teste do importador LMS (Fase 1)

Fonte: `modelo-lms-anonimizado.xlsx`, gerado do Modelo LMS.xlsx real por `tmp-fix/lms-gerar-fixture-etapa10.js`. As linhas citadas são as linhas da planilha (iguais no original e no fixture). Totais esperados em `modelo-lms-esperado.json`.

"Real" = caso presente no arquivo. "Variação" = caso que não existe no arquivo e será montado pelo teste a partir de uma linha real, sempre identificado como variação.

## Layout real

- Uma aba: `Planilha1` (não existe aba `LMS...`, `Extração_205` nem `Extração_RESB`).
- Linha 1: `A1:C1` mesclado "Definição de projeto:"; `D1:G1` mesclado com a definição (fixture: `DMP/A.OES.00.00001`).
- Linha 3: cabeçalho em A–N: `WL`, `CTG`, `FT`, `Cód. Ma`, `KIT`, `UMD`, `Descrição`, `Quant. Plan`, `Quant. Real`, `VALOR DE UPS ITEM`, `VALOR FINAL`, `VALOR FINAL PLAN`, `Estorno`, `Adicionais`.
- Dados: linhas 4–203 (200 linhas). Linhas 204–9994 vazias, só formatação. Linha 6024: linha fantasma (só `L6024 = 0` formatado).
- Colunas R e U: listas de pessoas fora da tabela (no fixture, "PESSOA ANONIMA nnn"). Coluna Q: células mescladas vazias.

## Casos

| # | Caso | Tipo | Onde | Resultado esperado no importador novo |
|---|---|---|---|---|
| 1 | Aba detectada | Real | `Planilha1`, cabeçalho na linha 3 | Detecta pela linha de cabeçalho (`WL` + `Cód. Ma` + `Quant. Plan`), não pelo nome da aba. Arquivo sem esse cabeçalho é recusado |
| 2 | Definição de projeto | Real | `D1` (mesclado `D1:G1`) | Lida e comparada com o projeto da importação; divergência bloqueia a confirmação |
| 3 | WL | Real | coluna A, texto `"1"`…`"12"` | 12 WLs; WL guardada como texto, sem conversão numérica |
| 4 | CTG | Real | `WP` (196); `WS` nas linhas 200–203 (WL 12) | Guardado como veio; significado de WP/WS a confirmar com o negócio |
| 5 | FT | Real | `I` (98), `R` (102) | Guardado; nenhuma linha descartada por FT |
| 6 | Cód. Ma material | Real | linha 4: `324894` (célula numérica) | `codigo_cru = "324894"`, `codigo_norm = "324894"`; material |
| 7 | Cód. Ma serviço | Real | linha 12: `I-AHO234` (texto) | `codigo_cru = codigo_norm = "I-AHO234"`; serviço (atividade) |
| 8 | KIT | Real | `NK-AMAR-RC` (l. 4), `M-0324895` (l. 5), `S-AHO234` (l. 12) | Guardado como veio. Em serviço, KIT = `S-` + código sem o prefixo (16 de 16) |
| 9 | UMD | Real | `PC`, `M`, `KG`, `ROL`, `UN`, `US3` (serviços) | Guardada como veio; `US3` vai para `unidade` da atividade |
| 10 | Descrição | Real | l. 14: `"R-POSTE  DE MT OU BT"` (espaço duplo); vírgulas em quase todas | Texto cru preservado em `sot_lms_linhas` |
| 11 | Quant. Plan | Real | coluna H, numérica; l. 200: 552 (M) | Quantidade operacional = Plan |
| 12 | Quant. Real | Real | coluna I, numérica; igual a Plan nas 200 linhas | Guardada como `lms_qtd_real_informada`; nunca operacional |
| 13 | Valores | Real | J texto pt-BR (`"0,2616"`, l. 202); K = J × Real; L = J × Plan; só em serviços (16) | J convertido de pt-BR; K e L guardados. São UPS, não R$: conversão para R$ depende do valor da UPS do contrato |
| 14 | Estorno | Variação | coluna M vazia nas 200 linhas | Coluna reconhecida; conteúdo e significado a definir com o negócio antes do teste |
| 15 | Adicionais | Variação | coluna N vazia nas 200 linhas | Idem |
| 16 | Código repetido em WL diferente | Real | `324894` nas WLs 1, 2, 4, 5, 6 (l. 4, 11, 16, 18, 30); 28 códigos em mais de uma WL | Uma linha por WL; nunca somar entre WLs |
| 17 | Mesmo WL + código + FT com KIT diferente | Real | l. 25–27: WL 6, `310567`, FT I, KITs `NK-RC6AFX`, `NK-I2I`, `NK-S144AFX`; 36 ocorrências | Linhas distintas; não somar, não recusar. Com KIT, zero duplicidades |
| 18 | FT=R em material | Real | l. 10: `328951`, WL 1; 92 de 184 materiais | Importado (retirada), não descartado |
| 19 | Plan=0 e Real>0 | Variação | não existe no arquivo | Montado a partir da l. 4 (Plan 0, Real 6): importa com quantidade operacional 0 e alerta na prévia; nunca usa Real |
| 20 | Material | Real | 184 linhas com código numérico | Vai para `sot_materiais` (`codigo_sap`, `qtd_projetada`) |
| 21 | Atividade | Real | 16 linhas `I-AHO`/`R-AHO`; FT igual ao prefixo em 16 de 16 | Vai para `sot_atividades` (`codigo`, `qtd_prevista`) |
| 22 | Linha sem código (fantasma) | Real | l. 6024: só `L = 0` formatado | Ignorada, não conta como item, aparece no relatório da prévia |
| 23 | Linha sem código com conteúdo | Variação | não existe no arquivo | Montada a partir da l. 4 sem `Cód. Ma`: fica no registro imutável como não operacional, com alerta; não vira linha com WL |
| 24 | Prefixo de serviço diferente do FT | Variação | não existe (16 de 16 batem) | Montada trocando o FT da l. 12: alerta na prévia |
| 25 | Colunas fora da tabela com dados | Real | colunas R e U | Ignoradas pelo importador |
| 26 | Linhas vazias formatadas | Real | 204–9994 | Ignoradas; não contam nem geram erro |

## O que o importador atual faz com este arquivo (leitura do código, não executado)

- `sotLmsLerPlanilha` procura aba cujo nome começa com `LMS` (`SOT_LMS_ABA_RE`): não encontra em `Planilha1` e devolve `null`, então o arquivo vai para a análise por IA.
- Mesmo com a aba renomeada, `sotLmsExtrair` exige cabeçalho exatamente `Código`; aqui é `Cód. Ma`.
- Se lesse: descartaria os 92 materiais FT=R e somaria o mesmo código entre WLs e KITs.
