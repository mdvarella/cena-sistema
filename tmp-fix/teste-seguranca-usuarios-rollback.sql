-- TESTE DE SEGURANÇA usuarios_sistema — NADA É GRAVADO
-- Simula, dentro do banco, usuário comum, gestor, admin, uma conta com o e-mail do admin mas outro UID, e anon,
-- usando o mesmo papel (authenticated/anon) e o mesmo auth.uid() que o PostgREST usa.
-- Cada teste é desfeito individualmente e o bloco inteiro termina com erro proposital, que desfaz tudo.
-- O resultado aparece na mensagem de erro "RESULTADO ...". Rodar o arquivo inteiro de uma vez.
DO $$
DECLARE
  v_u public.usuarios_sistema%ROWTYPE;
  v_g public.usuarios_sistema%ROWTYPE;
  v_a public.usuarios_sistema%ROWTYPE;
  v_o public.usuarios_sistema%ROWTYPE;
  t record;
  n int;
  uid uuid;
  em text;
  obtido text;
  r text := '';
  falhas int := 0;
  ins text := 'INSERT INTO public.usuarios_sistema (id, nome, email, senha_hash, perfil, ativo) VALUES (gen_random_uuid(), %L, %L, %L, %L, true)';
BEGIN
  SELECT * INTO v_u FROM public.usuarios_sistema
   WHERE ativo AND deleted_at IS NULL AND auth_user_id IS NOT NULL
     AND perfil NOT IN ('admin','gestor','diretoria','coordenador','supervisor')
   ORDER BY (perfil = 'equipe') DESC, id LIMIT 1;
  SELECT * INTO v_g FROM public.usuarios_sistema
   WHERE ativo AND deleted_at IS NULL AND auth_user_id IS NOT NULL AND perfil = 'gestor' ORDER BY id LIMIT 1;
  SELECT * INTO v_a FROM public.usuarios_sistema
   WHERE ativo AND deleted_at IS NULL AND auth_user_id IS NOT NULL AND perfil = 'admin' ORDER BY id LIMIT 1;
  SELECT * INTO v_o FROM public.usuarios_sistema
   WHERE ativo AND deleted_at IS NULL AND perfil NOT IN ('admin','gestor','diretoria') AND id <> v_u.id
   ORDER BY id LIMIT 1;
  IF v_u.id IS NULL OR v_g.id IS NULL OR v_a.id IS NULL OR v_o.id IS NULL THEN
    RAISE EXCEPTION 'Faltam usuários de teste: comum=% gestor=% admin=% outro=%',
      v_u.id IS NOT NULL, v_g.id IS NOT NULL, v_a.id IS NOT NULL, v_o.id IS NOT NULL;
  END IF;

  FOR t IN
    SELECT * FROM (VALUES
      ( 1, 'comum',       'permitido', 'comum lê o próprio cadastro (login)',              format('SELECT 1 FROM public.usuarios_sistema WHERE id = %L', v_u.id)),
      ( 2, 'comum',       'negado',    'comum muda o próprio perfil para admin',           format('UPDATE public.usuarios_sistema SET perfil = %L WHERE id = %L', 'admin', v_u.id)),
      ( 3, 'comum',       'negado',    'comum muda o próprio perfil para gestor',          format('UPDATE public.usuarios_sistema SET perfil = %L WHERE id = %L', 'gestor', v_u.id)),
      ( 4, 'comum',       'negado',    'comum muda o próprio perfil para diretoria',       format('UPDATE public.usuarios_sistema SET perfil = %L WHERE id = %L', 'diretoria', v_u.id)),
      ( 5, 'comum',       'negado',    'comum muda o próprio perfil para coordenador',     format('UPDATE public.usuarios_sistema SET perfil = %L WHERE id = %L', 'coordenador', v_u.id)),
      ( 6, 'comum',       'negado',    'comum muda o próprio perfil para supervisor',      format('UPDATE public.usuarios_sistema SET perfil = %L WHERE id = %L', 'supervisor', v_u.id)),
      ( 7, 'comum',       'negado',    'comum altera o próprio auth_user_id',              format('UPDATE public.usuarios_sistema SET auth_user_id = gen_random_uuid() WHERE id = %L', v_u.id)),
      ( 8, 'comum',       'negado',    'comum altera o perfil de outro usuário',           format('UPDATE public.usuarios_sistema SET perfil = %L WHERE id = %L', 'supervisor', v_o.id)),
      ( 9, 'comum',       'negado',    'comum insere usuário admin',                       format(ins, 'TESTE ROLLBACK', 'teste.rollback.1@invalido.local', 'x', 'admin')),
      (10, 'comum',       'negado',    'comum insere usuário comum',                       format(ins, 'TESTE ROLLBACK', 'teste.rollback.2@invalido.local', 'x', 'equipe')),
      (11, 'email_admin', 'negado',    'conta com e-mail do admin e outro UID lê cadastros', 'SELECT 1 FROM public.usuarios_sistema LIMIT 1'),
      (12, 'email_admin', 'negado',    'conta com e-mail do admin e outro UID altera perfil', format('UPDATE public.usuarios_sistema SET perfil = %L WHERE id = %L', 'supervisor', v_o.id)),
      (13, 'gestor',      'permitido', 'gestor lê cadastros',                              'SELECT 1 FROM public.usuarios_sistema LIMIT 1'),
      (14, 'gestor',      'permitido', 'gestor altera perfil de comum para supervisor',    format('UPDATE public.usuarios_sistema SET perfil = %L WHERE id = %L', 'supervisor', v_o.id)),
      (15, 'gestor',      'negado',    'gestor promove comum a admin',                     format('UPDATE public.usuarios_sistema SET perfil = %L WHERE id = %L', 'admin', v_o.id)),
      (16, 'gestor',      'negado',    'gestor promove comum a diretoria',                 format('UPDATE public.usuarios_sistema SET perfil = %L WHERE id = %L', 'diretoria', v_o.id)),
      (17, 'gestor',      'negado',    'gestor muda o próprio perfil',                     format('UPDATE public.usuarios_sistema SET perfil = %L WHERE id = %L', 'supervisor', v_g.id)),
      (18, 'gestor',      'negado',    'gestor altera cadastro de admin',                  format('UPDATE public.usuarios_sistema SET nome = nome WHERE id = %L', v_a.id)),
      (19, 'gestor',      'permitido', 'gestor cria usuário comum sem auth_user_id',       format(ins, 'TESTE ROLLBACK', 'teste.rollback.3@invalido.local', 'x', 'equipe')),
      (20, 'gestor',      'negado',    'gestor altera auth_user_id de comum',              format('UPDATE public.usuarios_sistema SET auth_user_id = gen_random_uuid() WHERE id = %L', v_o.id)),
      (21, 'admin',       'permitido', 'admin promove comum a admin',                      format('UPDATE public.usuarios_sistema SET perfil = %L WHERE id = %L', 'admin', v_o.id)),
      (22, 'admin',       'negado',    'admin altera auth_user_id (só Edge/service_role)', format('UPDATE public.usuarios_sistema SET auth_user_id = gen_random_uuid() WHERE id = %L', v_o.id)),
      (23, 'admin',       'permitido', 'admin cria usuário diretoria sem auth_user_id',    format(ins, 'TESTE ROLLBACK', 'teste.rollback.4@invalido.local', 'x', 'diretoria')),
      (24, 'anon',        'negado',    'anon lê cadastros',                                'SELECT 1 FROM public.usuarios_sistema LIMIT 1'),
      (25, 'anon',        'negado',    'anon insere usuário',                              format(ins, 'TESTE ROLLBACK', 'teste.rollback.5@invalido.local', 'x', 'equipe'))
    ) AS x(ord, quem, espera, rotulo, comando)
    ORDER BY ord
  LOOP
    BEGIN
      IF t.quem = 'anon' THEN
        PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
        PERFORM set_config('request.jwt.claim.sub', '', true);
        SET LOCAL ROLE anon;
      ELSE
        uid := CASE t.quem WHEN 'comum' THEN v_u.auth_user_id WHEN 'gestor' THEN v_g.auth_user_id
                           WHEN 'admin' THEN v_a.auth_user_id ELSE gen_random_uuid() END;
        em  := CASE t.quem WHEN 'comum' THEN v_u.email WHEN 'gestor' THEN v_g.email ELSE v_a.email END;
        PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'email', em)::text, true);
        PERFORM set_config('request.jwt.claim.sub', uid::text, true);
        SET LOCAL ROLE authenticated;
      END IF;
      EXECUTE t.comando;
      GET DIAGNOSTICS n = ROW_COUNT;
      RESET ROLE;
      RAISE EXCEPTION USING ERRCODE = 'P0099',
        MESSAGE = CASE WHEN n > 0 THEN 'PERMITIDO (' || n || ' linha)' ELSE 'NEGADO (0 linhas)' END;
    EXCEPTION WHEN OTHERS THEN
      obtido := CASE WHEN SQLSTATE = 'P0099' THEN SQLERRM ELSE 'NEGADO (' || SQLSTATE || ' ' || left(SQLERRM, 60) || ')' END;
    END;
    IF (t.espera = 'permitido') <> (obtido LIKE 'PERMITIDO%') THEN falhas := falhas + 1; END IF;
    r := r || E'\n' || CASE WHEN (t.espera = 'permitido') = (obtido LIKE 'PERMITIDO%') THEN 'OK    ' ELSE 'FALHA ' END
           || lpad(t.ord::text, 2) || '. ' || t.rotulo || ' — esperado ' || t.espera || ', obtido ' || obtido;
  END LOOP;

  RAISE EXCEPTION E'RESULTADO (nada foi gravado): % falha(s) de 25\nperfis usados: comum=% outro=% %',
    falhas, v_u.perfil, v_o.perfil, r;
END $$;
