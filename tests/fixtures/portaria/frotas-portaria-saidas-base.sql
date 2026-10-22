-- Base de teste da Portaria: frotas_portaria_saidas com as colunas reais de produção (20/10/2026), audit_log e os
-- dois gatilhos de saída acompanhante exatamente como estão em produção (cena_portaria_saida_acomp_validar/_retorno).
-- Usada pelos testes SQL (PGlite e PostgreSQL real). Não é migration.
create table if not exists public.frotas_portaria_saidas (
  id uuid primary key default gen_random_uuid(), veiculo_id uuid, placa text, modelo text, motorista text,
  equipe_id text, equipe_nome text, contrato_id text, contrato_nome text, base_saida text,
  data_saida timestamptz not null, previsao_retorno timestamptz, km_saida numeric, km_retorno numeric,
  data_retorno timestamptz, base_retorno text, status text default 'Em campo', obs text, obs_retorno text,
  registrado_por text, criado_em timestamptz default now(), deleted_at timestamptz,
  foto_carga_saida_b64 text, foto_carga_saida_ts timestamptz, foto_carga_retorno_b64 text, foto_carga_retorno_ts timestamptz,
  tem_materiais_saida boolean default false, retorno_registrado_por text, status_devolucao text, destino text,
  equipe text, quem_saiu text, liberado_por text, tipo_liberacao text, km_ajustes jsonb default '[]'::jsonb,
  km_ajustado_por text, km_ajustado_em timestamptz, km_ajuste_justificativa text, saida_principal_id uuid,
  constraint frotas_portaria_saidas_acomp_outra_chk check ((saida_principal_id is null) or (saida_principal_id <> id)),
  constraint frotas_portaria_saidas_acomp_sem_km_chk check ((saida_principal_id is null) or ((km_saida is null) and (km_retorno is null))));

create table if not exists public.audit_log (
  id bigserial primary key, acao text not null, modulo text not null, descricao text, usuario_id text, usuario_nome text,
  usuario_perfil text, dados_extra jsonb, data_hora timestamptz not null default now(), sessao_id text);

CREATE OR REPLACE FUNCTION public.cena_portaria_saida_acomp_validar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  p          public.frotas_portaria_saidas%ROWTYPE;
  v_placa    text;
  v_placa_p  text;
  v_eq       text;
  v_eq_p     text;
BEGIN
  IF NEW.saida_principal_id IS NOT NULL AND NEW.deleted_at IS NULL AND EXISTS (
       SELECT 1 FROM public.frotas_portaria_saidas a
        WHERE a.saida_principal_id = NEW.id AND a.deleted_at IS NULL AND a.id <> NEW.id) THEN
    RAISE EXCEPTION 'Esta saída já é a principal de outra equipe; não pode ser acompanhante.' USING ERRCODE = '23514';
  END IF;
  IF NEW.saida_principal_id IS NULL OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.deleted_at IS NULL
     AND NEW.saida_principal_id IS NOT DISTINCT FROM OLD.saida_principal_id
     AND NEW.placa     IS NOT DISTINCT FROM OLD.placa
     AND NEW.equipe_id IS NOT DISTINCT FROM OLD.equipe_id
     AND NEW.equipe    IS NOT DISTINCT FROM OLD.equipe THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('portaria_saida_acomp|' || NEW.saida_principal_id::text));
  SELECT * INTO p FROM public.frotas_portaria_saidas WHERE id = NEW.saida_principal_id;
  IF NOT FOUND OR p.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Saída principal não encontrada (ou excluída). A saída acompanhante não foi gravada.' USING ERRCODE = '23514';
  END IF;
  IF p.saida_principal_id IS NOT NULL THEN
    RAISE EXCEPTION 'A saída indicada já é acompanhante de outra; aponte para a saída principal.' USING ERRCODE = '23514';
  END IF;
  IF p.data_retorno IS NOT NULL OR p.status = 'Retornado' THEN
    RAISE EXCEPTION 'O veículo % já retornou nessa saída; registre uma saída nova.', p.placa USING ERRCODE = '23514';
  END IF;
  v_placa   := upper(regexp_replace(coalesce(NEW.placa, ''), '[^A-Za-z0-9]', '', 'g'));
  v_placa_p := upper(regexp_replace(coalesce(p.placa, ''),   '[^A-Za-z0-9]', '', 'g'));
  IF v_placa = '' OR v_placa <> v_placa_p THEN
    RAISE EXCEPTION 'A saída acompanhante precisa da mesma placa da principal (%).', coalesce(nullif(v_placa_p, ''), 'sem placa')
      USING ERRCODE = '23514';
  END IF;
  v_eq   := coalesce(nullif(btrim(NEW.equipe_id), ''), 'nome:' || nullif(lower(btrim(coalesce(NEW.equipe, NEW.equipe_nome))), ''));
  v_eq_p := coalesce(nullif(btrim(p.equipe_id), ''),   'nome:' || nullif(lower(btrim(coalesce(p.equipe, p.equipe_nome))), ''));
  IF v_eq IS NULL THEN
    RAISE EXCEPTION 'A saída acompanhante precisa identificar a equipe.' USING ERRCODE = '23514';
  END IF;
  IF v_eq = v_eq_p THEN
    RAISE EXCEPTION 'A saída acompanhante precisa ser de outra equipe (a principal já é desta equipe).' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.frotas_portaria_saidas a
              WHERE a.saida_principal_id = p.id AND a.deleted_at IS NULL AND a.id <> NEW.id) THEN
    RAISE EXCEPTION 'O veículo % já saiu com 2 equipes nessa saída. Máximo de 2 equipes.', p.placa USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cena_portaria_saida_acomp_retorno()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ BEGIN IF NEW.saida_principal_id IS NOT NULL OR NEW.deleted_at IS NOT NULL OR NEW.data_retorno IS NULL OR OLD.data_retorno IS NOT NULL THEN RETURN NULL; END IF; UPDATE public.frotas_portaria_saidas a SET status = NEW.status, data_retorno = NEW.data_retorno, base_retorno = coalesce(a.base_retorno, NEW.base_retorno), retorno_registrado_por = coalesce(a.retorno_registrado_por, NEW.retorno_registrado_por) WHERE a.saida_principal_id = NEW.id AND a.deleted_at IS NULL AND a.data_retorno IS NULL; RETURN NULL; END; $function$;

drop trigger if exists trg_portaria_saida_acomp_validar on public.frotas_portaria_saidas;
create trigger trg_portaria_saida_acomp_validar before insert or update on public.frotas_portaria_saidas
  for each row execute function public.cena_portaria_saida_acomp_validar();
drop trigger if exists trg_portaria_saida_acomp_retorno on public.frotas_portaria_saidas;
create trigger trg_portaria_saida_acomp_retorno after update of data_retorno on public.frotas_portaria_saidas
  for each row execute function public.cena_portaria_saida_acomp_retorno();
