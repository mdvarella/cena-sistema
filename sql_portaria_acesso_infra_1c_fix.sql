-- sql_portaria_acesso_infra_1c_fix.sql
-- Correção pós-seed 1C (schema real 22/09/2026).
-- Aplicar manualmente no SQL Editor do Supabase se o seed original já rodou.
--
-- 1) portaria_id só quando a filial tem EXATAMENTE 1 portaria Ativo.
--    CENA02 (CAMACAM) tem 2 ativas → portaria_id fica NULL (sem chute).
-- 2) códigos de dispositivo: sufixo = filial.codigo sanitizado [A-Za-z0-9].
--    "CENA 09" → CENA09. Não usa nome.

-- Pontos: associa só se unicidade; senão NULL
UPDATE public.portaria_pontos_acesso p
SET portaria_id = u.id,
    atualizado_em = now()
FROM public.filiais f
LEFT JOIN (
  SELECT filial_id, (array_agg(id))[1] AS id
  FROM public.portaria_configs
  WHERE coalesce(status, 'Ativo') = 'Ativo'
  GROUP BY filial_id
  HAVING count(*) = 1
) u ON u.filial_id = f.id
WHERE p.base_id = f.id
  AND p.portaria_id IS DISTINCT FROM u.id;

-- Dispositivos acompanham o ponto
UPDATE public.portaria_dispositivos d
SET portaria_id = p.portaria_id,
    atualizado_em = now()
FROM public.portaria_pontos_acesso p
WHERE d.ponto_acesso_id = p.id
  AND d.portaria_id IS DISTINCT FROM p.portaria_id;

-- Códigos/identificadores com caractere instável (espaço etc.)
UPDATE public.portaria_dispositivos d
SET
  codigo = regexp_replace(d.codigo, '_[^_]*$', '')
           || '_'
           || coalesce(nullif(regexp_replace(btrim(f.codigo), '[^A-Za-z0-9]', '', 'g'), ''), 'BASE'),
  identificador_hardware = regexp_replace(coalesce(d.identificador_hardware, d.codigo), '_[^_]*$', '')
           || '_'
           || coalesce(nullif(regexp_replace(btrim(f.codigo), '[^A-Za-z0-9]', '', 'g'), ''), 'BASE'),
  atualizado_em = now()
FROM public.filiais f
WHERE d.base_id = f.id
  AND (
    d.codigo ~ '[^A-Za-z0-9_]'
    OR coalesce(d.identificador_hardware, '') ~ '[^A-Za-z0-9_]'
  );
