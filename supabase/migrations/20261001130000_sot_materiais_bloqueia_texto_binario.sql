-- Projetos (SOT): sot_materiais recusa gravar texto com conteúdo binário em codigo_sap, descricao, unidade ou observacao.
-- Motivo: "Importar materiais" gravou 1245 linhas de bytes (arquivo .xlsx lido como texto) no projeto DAC/S.NOR-25.00228
-- em 01/10/2026; a tela foi corrigida na 8.1.188 e o banco passa a recusar o mesmo conteúdo vindo de qualquer cliente.
-- Binário = caractere de controle (exceto tab, LF e CR), DEL, faixa C1 (U+0080–U+009F) ou U+FFFD (byte inválido em UTF-8).
-- Só INSERT e UPDATE dessas colunas: excluir/restaurar (deleted_at) e lançar quantidades não passam pelo trigger.
-- Conferido em 01/10/2026 (só leitura): nenhum material fora da importação de 07:36 tem esses caracteres.

BEGIN;

CREATE OR REPLACE FUNCTION public.cena_sot_texto_binario(p text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(p, '') ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\uFFFD]';
$$;

CREATE OR REPLACE FUNCTION public.cena_sot_materiais_bloqueia_binario()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.cena_sot_texto_binario(NEW.codigo_sap) OR public.cena_sot_texto_binario(NEW.descricao)
     OR public.cena_sot_texto_binario(NEW.unidade) OR public.cena_sot_texto_binario(NEW.observacao) THEN
    RAISE EXCEPTION 'Material com caracteres inválidos (conteúdo binário, ex.: planilha lida como texto). Nada foi gravado.'
      USING ERRCODE = '22021';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.cena_sot_texto_binario(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cena_sot_texto_binario(text) TO authenticated;

DROP TRIGGER IF EXISTS trg_sot_materiais_bloqueia_binario ON public.sot_materiais;
CREATE TRIGGER trg_sot_materiais_bloqueia_binario
  BEFORE INSERT OR UPDATE OF codigo_sap, descricao, unidade, observacao ON public.sot_materiais
  FOR EACH ROW EXECUTE FUNCTION public.cena_sot_materiais_bloqueia_binario();

DO $$
DECLARE v_vivos int;
BEGIN
  SELECT count(*) INTO v_vivos FROM public.sot_materiais m
   WHERE m.deleted_at IS NULL
     AND (public.cena_sot_texto_binario(m.codigo_sap) OR public.cena_sot_texto_binario(m.descricao)
          OR public.cena_sot_texto_binario(m.unidade) OR public.cena_sot_texto_binario(m.observacao));
  IF v_vivos > 0 THEN
    RAISE NOTICE 'Atenção: % material(is) vivo(s) já têm conteúdo binário (rode antes a 20261001120000). Edição deles será recusada até a exclusão.', v_vivos;
  END IF;
END $$;

COMMIT;

-- Validação (após aplicar):
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.sot_materiais'::regclass AND tgname = 'trg_sot_materiais_bloqueia_binario';
--
-- Para desfazer
-- DROP TRIGGER IF EXISTS trg_sot_materiais_bloqueia_binario ON public.sot_materiais;
-- DROP FUNCTION IF EXISTS public.cena_sot_materiais_bloqueia_binario();
-- DROP FUNCTION IF EXISTS public.cena_sot_texto_binario(text);
