# Continuar o trabalho em outro PC (estado em 10/10/2026)

Arquivo de passagem: o histórico do chat do Cursor fica só no PC antigo. Num chat novo, peça ao agente:
"leia docs/enel-wl/CONTINUAR-EM-OUTRO-PC.md e docs/enel-wl/ETAPA-1.3-LMS-ORIGINAL.md e siga de onde parou".

## 1. Preparar o PC novo

1. Instalar Git, Node.js (LTS) e Cursor.
2. Clonar e abrir a branch da Etapa 1.3:
   ```powershell
   cd C:\DEV
   git clone https://github.com/mdvarella/cena-sistema.git cena-sistema
   cd cena-sistema
   git worktree add ..\cena-enel-lms enel-etapa13-lms
   ```
   Abrir `C:\DEV\cena-enel-lms` no Cursor (ou trabalhar direto em `cena-sistema` com `git switch enel-etapa13-lms`).
3. Banco de teste local (PGlite) para os testes SQL:
   ```powershell
   mkdir $env:TEMP\pglite-cena; cd $env:TEMP\pglite-cena; npm.cmd init -y; npm.cmd i @electric-sql/pglite@0.2.17
   ```
   SheetJS não precisa instalar: os testes LMS usam `supabase/functions/_shared/vendor/xlsx-0.20.3.mjs`.
4. Suíte completa (na raiz do worktree):
   ```powershell
   $env:PGLITE_PATH="$env:TEMP\pglite-cena"; node tmp-fix/rodar-suite.js
   ```
   Esperado em 10/10/2026: 64 arquivos, 64 passaram (proj-lms-parser 127, proj-lms-origem-sql 141, proj-lms-receber-edge 65).
5. Supabase CLI (só para deploy de Edge; o PowerShell bloqueia `npx.ps1`, usar `npx.cmd`):
   ```powershell
   npx.cmd supabase login
   npx.cmd supabase functions deploy <funcao> --project-ref qxexyghcennllrmjqafg
   ```
   Rodar o deploy na raiz do worktree que tem a função (usa `supabase/config.toml` e `supabase/functions/_shared`).

## 2. Branches

| Branch | Situação |
|---|---|
| `main` | 8.1.213 em produção; inclui `tests/versao-nao-regride.test.js`. |
| `enel-etapa12-processo` | Etapa 1.2 (perfil de processo), commit `768b048`, no remoto, **não mergeada**; migration já aplicada em produção. |
| `enel-etapa13-lms` | Etapa 1.3 (LMS original), no remoto, **não mergeada**. Migration aplicada e Edge publicada em produção (abaixo). |
| `seg/rh-docs-rls` | Migration de segurança RH/SESMT/Frotas (`20261009150000_seg_documentos_rh_sesmt_frotas.sql`) + teste (1011 verificações). No remoto, **não mergeada**. Base antiga (8.1.210). Confirmar no Supabase se já foi aplicada; pendência registrada: testar no app. |
| `autaliza-01` | Mudanças locais (index.html, sw.js, 2 testes de Frotas/menu) ficaram **só no PC antigo**, sem commit, por decisão do dono. |

## 3. Etapa 1.3 — onde parou

Feito em produção (detalhe na seção "Validação remota necessária" de `ETAPA-1.3-LMS-ORIGINAL.md`):
- Migration `20261009193000_proj_lms_origem.sql` aplicada; `tmp-fix/etapa-1.3-conferencia-producao.sql` deu 28/28 ok.
- Edge `proj-lms-receber` publicada (SheetJS em cópia local: o bundler recusa `cdn.sheetjs.com`).
- Fixture enviada no projeto de teste "TESTE 1" do contrato ENEL RDSE (`92722d1e-30b9-4340-856e-3486c68c24da`):
  importação `aac33bfb-6095-43da-a48c-91b601d0347f`, 200 linhas, 12 WLs, 0 divergências, eventos `CRIADA,REENVIO`, 1 objeto no bucket.
  Depois dos testes negativos, a conferência dá ok em tudo menos itens 23–25 (1 importação, 200 linhas, 2 eventos): esperado.

Em andamento — testes negativos reais pelo console do ERP (trecho no histórico do PC antigo; refazer se preciso):
- Códigos HTTP recebidos e corretos: sem login 401, chave anon 401, projeto_id inválido 400, GET 405, vazio/.csv/MIME/texto 415 (4×).
- Falta ver: a tabela do console (códigos de detalhe), o caso "acima de 12 MiB" (esperado 413; se vier `Failed to fetch`, o gateway recusou antes da Edge — registrar como achado), projeto excluído (409) e contrato não identificado (403) se houver projetos assim, usuário sem `PROJ_IMPORTAR_LMS` (403, precisa de outra conta).
- Depois: confirmar que nada foi gravado (continua 1 importação / 200 linhas / `CRIADA,REENVIO` / 1 objeto).

Falta da validação remota: item 5 (arquivo perto dos limites: memória/tempo da Edge e corpo da RPC) e item 6 (logs da Edge sem nome de arquivo/conteúdo).

Próxima etapa (não começar sem pedido): confirmação humana do RASCUNHO, que pode congelar o perfil de processo (origem `LMS_ORIGINAL_ESTRUTURA_NOVA` da 1.2), depois `sot_wl`/conciliação e a tela de upload/preview.

## 4. Regras do dono (valem sempre)

- Não aplicar migration, não publicar Edge, não executar SQL remoto, não commitar, não dar push, não mergear sem pedido explícito. O dono aplica migrations e publica Edge; o agente prepara e confere.
- Banco: mudança só por migration versionada (nada de SQL solto, nada de `db reset`). RLS ativo nas tabelas novas; anon sem acesso; autorização por `auth.uid()`/`auth_user_id`, nunca por e-mail; `service_role` só no backend/Edge; grants explícitos; fail-closed; não confiar só em validação no JavaScript.
- Não mascarar problema no frontend; não criar controle de estoque paralelo; não alterar saldo físico; não inventar tabelas/campos; mostrar só dados com fonte real (nada sintético, nada de status inventado).
- **Não alterar TMA.** Não misturar ENEL/WL com Portaria. Não criar gatilho em `sot_projetos`. Não mexer em RH/Frotas/Portaria fora da tarefa pedida.
- Git: nunca `git add .`/`-A`, nunca `reset --hard`, nunca reescrever histórico/force push, nunca resetar `main`, não apagar/renomear branches ou worktrees sem aprovação; conflito = parar e mostrar. Não perder mudanças não commitadas de outro assunto. Push em `main` só com aprovação.
- `index.html`: nunca sobrescrever inteiro.
- Segredos: nunca pedir/colar tokens, JWT, `service_role`; nunca imprimir o token ERP; não reproduzir dados pessoais (nomes, REs) em respostas nem no repositório.
- Não assumir que local = produção; o que não der para reproduzir: "VALIDAÇÃO REMOTA AINDA NECESSÁRIA".

## 5. Débitos registrados (não mexer sem pedido)

- 928 senhas iguais ao RE; `senha_hash` visível para autenticados (prioritário; nada de alteração silenciosa).
- Bucket público `cena-docs` (policy `allow_all_cena_docs` para `public`).
- Worker sem autenticação; token ERP no `acordos.html`.
- `cena_rh_pode_dados_pj` não alterar silenciosamente.
- Botão "Entrada Inteligente" em Frotas; cron de fornecedores não confirmado.
- 1.3: janela residual de autorização no registro; corpo da RPC com 5.000 linhas não medido; compensação PENDENTE pode deixar objeto órfão; existência de projeto inferível (`PROJETO_INEXISTENTE` × `SEM_PERMISSAO`).
