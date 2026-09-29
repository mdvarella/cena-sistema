-- Colaboradores: migração em massa do contrato RDSE NOVO (4600004484) para o RDSE (4600003971).
-- Altera SOMENTE colaboradores.contrato_id dos 24 colaboradores listados abaixo (conferidos em 29/09/2026).
-- Não altera equipes, programação, ponto, frota, almoxarifado, históricos nem o cadastro do contrato RDSE NOVO.
-- Fail-closed: se o RDSE NOVO tiver colaborador fora da lista, se algum da lista não estiver mais no RDSE NOVO
-- ou se algum contrato não existir, nada é alterado.
-- Grava audit_log COLAB_MIGRACAO_CONTRATO com os ids e o contrato anterior (permite desfazer).

BEGIN;

DO $$
DECLARE
  v_origem  uuid := 'c403dac6-753f-4f35-8113-21a12ccfeb27'; -- RDSE NOVO
  v_destino uuid := '3925df4e-7e39-498d-8c96-891a7f4d415c'; -- RDSE
  v_ids uuid[] := ARRAY[
    '5a7e48db-9ee9-4896-bf37-cdea20bc84b3', -- 1870 ALEXSON MARIANO NASCIMENTO
    'b6037259-b0b5-4150-806b-2558f2a00bff', -- 1857 ANTHONY PAIVA BARROS
    '279f45ec-fc35-44bd-9b1f-cce39f060876', -- 1846 CLEVERSON ALCANTARA DOS SANTOS
    '881b543c-26c5-4b2a-8672-e1e77f6d1688', -- 1858 CLOVIS CEZAR CIERJACKS
    'a844fd85-d79c-48a2-a764-68326c96eec7', -- 1823 DIMITRI ALEXANDER LEVIN (inativo)
    'a4840ae2-229a-42e5-a7fa-1fe361ba2dc1', -- 1848 EDSON CARLOS DE AVELAR (inativo)
    '2c49923e-1949-4ffb-8e63-55d407204831', -- 1867 EDUARDO EVARISTO GONCALVES (inativo)
    '60d01fd4-5b1c-419a-8fae-91c3bbf96ed6', -- 1854 EDVALDO RIBEIRO DE OLIVEIRA (inativo)
    '4eb555ea-4bb4-456c-bfde-000b1362011d', -- 1825 FELIPE NEGREIROS SILVA
    'dba03acc-7c15-4944-85e7-52e0a216a649', -- 1865 FERNANDO BRAZ RIBEIRO DA SILVA
    'e08a6b1e-f857-4239-9897-1b893ca9b5e5', -- 1851 FRANCISCO CUNHA LIMA
    'bf8440bf-a108-471f-8f65-3c8ce7689a5d', -- 1871 JARDEL PABLO RODRIGUES VIEIRA
    'b7880d8c-41cf-4faf-8ded-a59fea0e0994', -- 1866 JEFFERSON SILVA DE JESUS
    '751bc823-6172-4662-a4fd-e9f94f286f8b', -- 1852 JOHNNY SILVA
    '691aae0f-ab42-4964-ae5e-71507d624b12', -- 1850 JOSE JESUS WESLEY DA SILVA
    '372fc120-3385-40f2-ade3-062516e8225b', -- 1861 JOSE RODRIGUES DE SOUZA NETO
    'dd8028dc-865a-4ed9-8919-6f80cbd1183b', -- 1855 JOSE SERGIO DA SILVA
    '7febba12-afc7-4fec-a305-5cb9d5bf55f3', -- 1856 KEVIN ALVES DOS SANTOS
    '365b8e6f-4e57-4756-8dd4-e3fce5dc2a6d', -- 1860 PAULO ROBERTO DE ALMEIDA JUNIOR
    'a0bebc4c-6572-44a4-9850-ce0e4fbf6258', -- 1862 ROBERT NASCIMENTO SILVA RODRIGUES
    '34609112-7d40-43e2-846b-5f86b45e69fa', -- 1832 ROBSON DE OLIVEIRA REIS (inativo)
    '13e47935-f91b-4942-b8a8-eff6c9a12b0f', -- 1863 THIAGO DO NASCIMENTO COSTA (inativo)
    'bae2810e-a85c-4104-937c-58cb79f2a51c', -- 1864 VANDO MOREIRA (inativo)
    'f1c79ba2-2550-4006-a299-1ca49326ed63'  -- 1849 WESLEY CASTOR SILVA
  ]::uuid[];
  v_esperado int := 24;
  v_na_lista int;
  v_fora_lista int;
  v_upd int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.contratos WHERE id = v_origem AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'PARAR: contrato de origem RDSE NOVO não encontrado.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contratos WHERE id = v_destino AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'PARAR: contrato de destino RDSE não encontrado.';
  END IF;
  IF array_length(v_ids, 1) <> v_esperado THEN
    RAISE EXCEPTION 'PARAR: lista com % ids; esperado %.', array_length(v_ids, 1), v_esperado;
  END IF;

  PERFORM 1 FROM public.colaboradores
  WHERE contrato_id = v_origem OR id = ANY(v_ids)
  FOR UPDATE;

  SELECT count(*) INTO v_na_lista
  FROM public.colaboradores
  WHERE id = ANY(v_ids) AND contrato_id = v_origem;
  IF v_na_lista <> v_esperado THEN
    RAISE EXCEPTION 'PARAR: só % dos % colaboradores da lista estão no RDSE NOVO. Nenhuma alteração.', v_na_lista, v_esperado;
  END IF;

  SELECT count(*) INTO v_fora_lista
  FROM public.colaboradores
  WHERE contrato_id = v_origem AND NOT (id = ANY(v_ids));
  IF v_fora_lista <> 0 THEN
    RAISE EXCEPTION 'PARAR: o RDSE NOVO tem % colaborador(es) fora da lista conferida. Nenhuma alteração.', v_fora_lista;
  END IF;

  UPDATE public.colaboradores
  SET contrato_id = v_destino
  WHERE id = ANY(v_ids) AND contrato_id = v_origem;

  GET DIAGNOSTICS v_upd = ROW_COUNT;
  IF v_upd <> v_esperado THEN
    RAISE EXCEPTION 'PARAR: UPDATE afetou % linhas; esperado %. Rollback.', v_upd, v_esperado;
  END IF;

  INSERT INTO public.audit_log (
    acao, modulo, descricao,
    usuario_id, usuario_nome, usuario_perfil,
    dados_extra, data_hora, sessao_id
  ) VALUES (
    'COLAB_MIGRACAO_CONTRATO',
    'rh',
    'Migração em massa de ' || v_upd || ' colaboradores do contrato RDSE NOVO (4600004484) para o RDSE (4600003971).',
    '',
    coalesce(current_user, 'sql-editor'),
    '',
    jsonb_build_object(
      'contrato_origem_id', v_origem,
      'contrato_origem', 'RDSE NOVO (4600004484)',
      'contrato_destino_id', v_destino,
      'contrato_destino', 'RDSE (4600003971)',
      'colaborador_ids', to_jsonb(v_ids),
      'registros_afetados', v_upd
    ),
    now(),
    'sql:20260929200000_colab_rdse_novo_para_rdse'
  );
END $$;

COMMIT;

-- Validação (após aplicar):
--   SELECT count(*) FROM public.colaboradores WHERE contrato_id = 'c403dac6-753f-4f35-8113-21a12ccfeb27';  -- esperado 0
--   SELECT acao, descricao, data_hora FROM public.audit_log
--    WHERE sessao_id = 'sql:20260929200000_colab_rdse_novo_para_rdse' ORDER BY data_hora DESC LIMIT 1;
--
-- Para desfazer (só se necessário):
--   UPDATE public.colaboradores SET contrato_id = 'c403dac6-753f-4f35-8113-21a12ccfeb27'
--    WHERE contrato_id = '3925df4e-7e39-498d-8c96-891a7f4d415c'
--      AND id IN (SELECT e::uuid
--                   FROM (SELECT dados_extra FROM public.audit_log
--                          WHERE sessao_id = 'sql:20260929200000_colab_rdse_novo_para_rdse'
--                          ORDER BY data_hora DESC LIMIT 1) a,
--                        jsonb_array_elements_text(a.dados_extra->'colaborador_ids') e);
