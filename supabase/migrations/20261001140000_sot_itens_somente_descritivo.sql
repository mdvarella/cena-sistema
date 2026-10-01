-- Projetos (SOT): itens "somente descritivo" na lista de atividades e de materiais do projeto.
-- Material ou mão de obra sem cadastro no contrato (fora do Almoxarifado SAP / da lista de serviços) pode ser
-- executado ou fornecido por outra empresa: aparece no projeto só como descrição do que será usado.
-- Item descritivo não tem valor, execução, medição, faturamento, viabilidade, requisição, entrega nem aplicação:
-- o banco recusa (23514) essas quantidades/valores vindos de qualquer tela.
-- Nenhuma linha existente muda: a coluna nasce false para todas.

BEGIN;

ALTER TABLE public.sot_atividades ADD COLUMN IF NOT EXISTS somente_descritivo boolean NOT NULL DEFAULT false;
ALTER TABLE public.sot_materiais  ADD COLUMN IF NOT EXISTS somente_descritivo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.sot_atividades.somente_descritivo IS
  'Serviço sem cadastro no contrato (outra empresa): só descritivo, sem valor, execução, medição, faturamento ou viabilidade.';
COMMENT ON COLUMN public.sot_materiais.somente_descritivo IS
  'Material sem cadastro no Almoxarifado SAP do contrato (outra empresa): só descritivo, sem viabilidade, requisição, entrega, aplicação, devolução ou baixa SAP.';

ALTER TABLE public.sot_atividades DROP CONSTRAINT IF EXISTS sot_atividades_descritivo_sem_operacao;
ALTER TABLE public.sot_atividades ADD CONSTRAINT sot_atividades_descritivo_sem_operacao CHECK (
  NOT somente_descritivo OR (
        coalesce(qtd_executada, 0)   = 0
    AND coalesce(qtd_medida, 0)      = 0
    AND coalesce(qtd_faturada, 0)    = 0
    AND coalesce(qtd_viabilizada, 0) = 0
    AND coalesce(valor_unitario, 0)  = 0
    AND coalesce(valor_total, 0)     = 0
    AND servico_id IS NULL));

ALTER TABLE public.sot_materiais DROP CONSTRAINT IF EXISTS sot_materiais_descritivo_sem_operacao;
ALTER TABLE public.sot_materiais ADD CONSTRAINT sot_materiais_descritivo_sem_operacao CHECK (
  NOT somente_descritivo OR (
        coalesce(qtd_viabilizada, 0)    = 0
    AND coalesce(qtd_requisitada, 0)    = 0
    AND coalesce(qtd_entregue, 0)       = 0
    AND coalesce(qtd_aplicada, 0)       = 0
    AND coalesce(qtd_devolvida, 0)      = 0
    AND coalesce(qtd_processada_sap, 0) = 0));

COMMIT;

-- Validação (após aplicar):
--   SELECT conname FROM pg_constraint WHERE conname IN ('sot_atividades_descritivo_sem_operacao','sot_materiais_descritivo_sem_operacao');
--   SELECT count(*) FROM public.sot_atividades WHERE somente_descritivo;   -- 0 logo após aplicar
--
-- Para desfazer
-- ALTER TABLE public.sot_atividades DROP CONSTRAINT IF EXISTS sot_atividades_descritivo_sem_operacao;
-- ALTER TABLE public.sot_materiais DROP CONSTRAINT IF EXISTS sot_materiais_descritivo_sem_operacao;
-- ALTER TABLE public.sot_atividades DROP COLUMN IF EXISTS somente_descritivo;
-- ALTER TABLE public.sot_materiais DROP COLUMN IF EXISTS somente_descritivo;
