-- =============================================================================
-- ERP CENA — Migração de treinamentos p/ cursos atuais + limpeza
-- - Normaliza códigos antigos/órfãos (nr) para a sigla atual do cadastro
-- - CMRDA -> CRMDA | DIR-DEF -> DIREÇÃO DEFENSIVA | NR-10-BAS -> NR 10 | etc.
-- - RAS-CAS-SAS: recria o curso no cadastro (mantém os registros)
-- - TR: exclui (soft delete) os 10 registros
-- - Remove ASO duplicado por funcionário (mantém o mais recente)
-- Seguro: usa a sigla/nome do próprio cadastro (sem digitar à mão);
--          exclusões são soft delete (deleted_at) = reversíveis.
-- =============================================================================

-- ── 0) PRÉVIA: distribuição atual dos códigos (rode antes p/ comparar) ───────
-- SELECT nr, count(*) FROM treinamentos WHERE deleted_at IS NULL GROUP BY nr ORDER BY 2 DESC;

BEGIN;

-- ── 1) Normalizações/transferências (nr + titulo vindos do cadastro) ─────────
UPDATE treinamentos t SET nr=c.sigla, titulo=c.nome
FROM sesmt_cursos c WHERE c.sigla='NR 6'
  AND t.deleted_at IS NULL AND t.nr IN ('NR-06','NR-6');

UPDATE treinamentos t SET nr=c.sigla, titulo=c.nome
FROM sesmt_cursos c WHERE c.sigla='NR 10'
  AND t.deleted_at IS NULL AND t.nr IN ('NR-10','NR-10-BAS');

UPDATE treinamentos t SET nr=c.sigla, titulo=c.nome
FROM sesmt_cursos c WHERE c.sigla='NR-35'
  AND t.deleted_at IS NULL AND t.nr IN ('nr 35','NR-35-FORM');

UPDATE treinamentos t SET nr=c.sigla, titulo=c.nome
FROM sesmt_cursos c WHERE c.sigla='nr 10 sep'
  AND t.deleted_at IS NULL AND t.nr IN ('NR-10-SEP');

UPDATE treinamentos t SET nr=c.sigla, titulo=c.nome
FROM sesmt_cursos c WHERE c.sigla='NR33'
  AND t.deleted_at IS NULL AND t.nr IN ('NR-33');

UPDATE treinamentos t SET nr=c.sigla, titulo=c.nome
FROM sesmt_cursos c WHERE c.sigla='DIREÇÃO DEFENSIVA'
  AND t.deleted_at IS NULL AND t.nr IN ('DIR-DEF');

UPDATE treinamentos t SET nr=c.sigla, titulo=c.nome
FROM sesmt_cursos c WHERE c.sigla='CRMDA'
  AND t.deleted_at IS NULL AND t.nr IN ('CMRDA');

-- ── 2) RAS-CAS-SAS: recriar o curso no cadastro (revise a validade depois) ────
INSERT INTO sesmt_cursos (nome, sigla, categoria, periodicidade, tipo_validade, pode_vencer, status)
SELECT 'RAS / CAS / SAS', 'RAS-CAS-SAS', 'Segurança', 24, 'Meses', true, 'Ativo'
WHERE NOT EXISTS (SELECT 1 FROM sesmt_cursos WHERE upper(sigla)='RAS-CAS-SAS');

-- ── 3) TR: excluir (soft delete) ─────────────────────────────────────────────
UPDATE treinamentos SET deleted_at=now()
WHERE nr='TR' AND deleted_at IS NULL;

-- ── 4) ASO duplicado por funcionário: manter só o mais recente ───────────────
UPDATE treinamentos t SET deleted_at=now()
WHERE t.nr='ASO' AND t.deleted_at IS NULL
  AND t.id NOT IN (
    SELECT DISTINCT ON (funcionario_id) id
    FROM treinamentos
    WHERE nr='ASO' AND deleted_at IS NULL
    ORDER BY funcionario_id, coalesce(data, validade) DESC NULLS LAST, criado_em DESC
  );

COMMIT;

-- ── 5) CONFERÊNCIA: códigos restantes (todos devem existir no cadastro) ───────
SELECT t.nr, count(*) AS qtd,
       CASE WHEN c.sigla IS NULL THEN 'ORFAO' ELSE 'ok' END AS situacao
FROM treinamentos t
LEFT JOIN sesmt_cursos c ON c.sigla=t.nr
WHERE t.deleted_at IS NULL
GROUP BY t.nr, c.sigla
ORDER BY situacao DESC, qtd DESC;
