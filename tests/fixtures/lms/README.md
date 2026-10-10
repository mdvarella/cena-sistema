# Fixture LMS (Fase 1 LMS/WL)

Arquivos usados pelos testes do futuro importador LMS. Nenhum teste de produção depende desta pasta ainda.

## Conteúdo

- `modelo-lms-anonimizado.xlsx`: cópia do Modelo LMS.xlsx real.
- `modelo-lms-esperado.json`: totais esperados (linhas, WLs, materiais, serviços, FT=R, duplicidades).
- `modelo-lms-casos.md`: casos de teste.

SHA-256 de `modelo-lms-anonimizado.xlsx`: `b8e3b9d48fc06d7fd56bc51713f7ed0f9d6ee4ce9f9868abc1cb4163e3ae37a4` (4.481.455 bytes).

Etapa 1.3: `creator` e `lastModifiedBy` foram removidos de `docProps/core.xml` (nome do autor). As outras 9 partes do ZIP ficaram byte a byte iguais; o conteúdo da planilha e `modelo-lms-esperado.json` não mudaram. Hash anterior: `28f53dce21874c611575b27ecc50d0f8261957293f3807bf18c393ee0379228d`.

## Como foi gerado

`node tmp-fix/lms-gerar-fixture-etapa10.js "<caminho do Modelo LMS.xlsx>"` (SheetJS 0.20.3, mesma versão do `index.html`, instalada fora do repositório). O original não é alterado.

Mantido igual ao original: aba `Planilha1`, cabeçalho na linha 3, colunas A–N com os mesmos valores e tipos de célula (conferido célula a célula), mesclagens, formatos numéricos, linha fantasma 6024 e as linhas vazias formatadas.

Trocado:

- `D1` (definição de projeto): número trocado por `00.00001`, prefixo mantido;
- colunas R e U (listas de pessoas, com RE): "PESSOA ANONIMA nnn" e "PESSOA ANONIMA nnn R:nnnnnn". Conferido: nenhum dos 167 nomes originais ficou no arquivo.

Não trocado: códigos e descrições de material e serviço (catálogo), quantidades e coeficientes de UPS (não são valores em R$).

Limitação: SheetJS não grava estilos visuais (cores, fontes). Valores, tipos, mesclagens e formatos numéricos são preservados.
