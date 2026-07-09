-- =============================================================================
-- ⚠️ OBSOLETO — não rodar em produção após migração para colaboradores.id
-- Substituído por: sql_sesmt_migrar_funcionarios_para_colaboradores.sql
-- (unificar IDs em colaboradores e eliminar dependência da tabela funcionarios)
-- =============================================================================
-- ERP CENA — Sincronizar colaboradores ATIVOS que faltam em funcionarios (SESMT)
-- Motivo (legado): treinamentos/ASO ligavam por funcionarios.matricula.
-- Mapeamento: re->matricula, nome->nome, cargo->cargo, area->setor, ativo=true.
-- Seguro: idempotente (NOT EXISTS por matricula normalizada); nao altera existentes.
-- Rodar no Supabase → SQL Editor.
-- =============================================================================

-- 1) PRÉVIA — quantos e quais serao criados (rode antes p/ conferir)
SELECT c.re, c.nome, c.cargo
FROM colaboradores c
WHERE coalesce(c.ativo,true)=true
  AND coalesce(c.dispensado,false)=false
  AND c.re IS NOT NULL
  AND ltrim(regexp_replace(c.re::text,'\D','','g'),'0') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM funcionarios f
    WHERE ltrim(regexp_replace(coalesce(f.matricula,'')::text,'\D','','g'),'0')
        = ltrim(regexp_replace(c.re::text,'\D','','g'),'0')
  )
ORDER BY c.nome;

-- 2) INSERT — cria os que faltam
INSERT INTO funcionarios (matricula, nome, cargo, setor, ativo, criado_em)
SELECT DISTINCT ON (ltrim(regexp_replace(c.re::text,'\D','','g'),'0'))
       c.re::text, c.nome, c.cargo, c.area, true, now()
FROM colaboradores c
WHERE coalesce(c.ativo,true)=true
  AND coalesce(c.dispensado,false)=false
  AND c.re IS NOT NULL
  AND ltrim(regexp_replace(c.re::text,'\D','','g'),'0') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM funcionarios f
    WHERE ltrim(regexp_replace(coalesce(f.matricula,'')::text,'\D','','g'),'0')
        = ltrim(regexp_replace(c.re::text,'\D','','g'),'0')
  )
ORDER BY ltrim(regexp_replace(c.re::text,'\D','','g'),'0'), c.id;

-- 3) CONFERÊNCIA — deve retornar 0 (ninguem mais faltando)
SELECT count(*) AS ainda_faltando
FROM colaboradores c
WHERE coalesce(c.ativo,true)=true
  AND coalesce(c.dispensado,false)=false
  AND c.re IS NOT NULL
  AND ltrim(regexp_replace(c.re::text,'\D','','g'),'0') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM funcionarios f
    WHERE ltrim(regexp_replace(coalesce(f.matricula,'')::text,'\D','','g'),'0')
        = ltrim(regexp_replace(c.re::text,'\D','','g'),'0')
  );
