-- 99b — inserir só hash que ainda não existe (nem ativo, nem soft-delete)
-- Rode depois do 99_aplicar.sql (A). Sem ON CONFLICT.

INSERT INTO public.frotas_pedagios (
  veiculo_id, placa, placa_normalizada, modelo,
  data_hora, valor, praca, concessionaria, centro_custo,
  origem, tipo, status,
  apropriacao_status, motivo_sem_apropriacao,
  contrato_id, contrato_nome,
  hash_deduplicacao, observacao,
  criado_por, atualizado_por
)
SELECT DISTINCT ON (s.hash)
  v.id,
  s.placa,
  s.placa_norm,
  v.modelo,
  s.data_hora,
  s.valor,
  s.estabelecimento,
  s.estabelecimento,
  s.centro_custo,
  s.origem,
  s.tipo,
  s.status,
  CASE WHEN v.contrato_id IS NOT NULL THEN 'APROPRIADO' ELSE 'SEM_APROPRIACAO' END,
  CASE WHEN v.contrato_id IS NOT NULL THEN NULL ELSE 'SEM_CONTRATO_NO_VEICULO' END,
  v.contrato_id,
  NULL,
  'imp_ago26_'||s.hash,
  'IMPORT_AGOSTO_2026'||COALESCE(' | '||s.tipo_origem,''),
  'IMPORT_SQL_AGOSTO_2026',
  'IMPORT_SQL_AGOSTO_2026'
FROM public._stg_ped_ago26 s
LEFT JOIN LATERAL (
  SELECT fv.id, fv.modelo, fv.contrato_id
  FROM public.frotas_veiculos fv
  WHERE (fv.deleted_at IS NULL)
    AND regexp_replace(upper(coalesce(fv.placa,'')), '[^A-Z0-9]', '', 'g') = s.placa_norm
  LIMIT 1
) v ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM public.frotas_pedagios x
  WHERE x.hash_deduplicacao IS NOT DISTINCT FROM ('imp_ago26_'||s.hash)
);
