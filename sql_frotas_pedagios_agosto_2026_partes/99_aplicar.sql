-- 99 — aplicar agosto/2026
-- Rode A. Se o editor aceitar só um comando, rode A e depois B (sem o DROP).
-- No fim, rode C.
-- Staging _stg_ped_ago26 precisa existir.

-- A) reativa/atualiza hash já existente (zerar / tentativa anterior)
UPDATE public.frotas_pedagios p
SET
  deleted_at = NULL,
  veiculo_id = v.id,
  placa = s.placa,
  placa_normalizada = s.placa_norm,
  modelo = v.modelo,
  data_hora = s.data_hora,
  valor = s.valor,
  praca = s.estabelecimento,
  concessionaria = s.estabelecimento,
  centro_custo = s.centro_custo,
  origem = s.origem,
  tipo = s.tipo,
  status = s.status,
  apropriacao_status = CASE WHEN v.contrato_id IS NOT NULL THEN 'APROPRIADO' ELSE 'SEM_APROPRIACAO' END,
  motivo_sem_apropriacao = CASE WHEN v.contrato_id IS NOT NULL THEN NULL ELSE 'SEM_CONTRATO_NO_VEICULO' END,
  contrato_id = v.contrato_id,
  observacao = 'IMPORT_AGOSTO_2026'||COALESCE(' | '||s.tipo_origem,''),
  atualizado_por = 'IMPORT_SQL_AGOSTO_2026'
FROM public._stg_ped_ago26 s
LEFT JOIN LATERAL (
  SELECT fv.id, fv.modelo, fv.contrato_id
  FROM public.frotas_veiculos fv
  WHERE (fv.deleted_at IS NULL)
    AND regexp_replace(upper(coalesce(fv.placa,'')), '[^A-Z0-9]', '', 'g') = s.placa_norm
  LIMIT 1
) v ON TRUE
WHERE p.hash_deduplicacao = ('imp_ago26_'||s.hash);
