# CLAUDE.md — Guia do ERP CENA

Guia operacional para quem programa aqui (Claude Code **e** Cursor). Objetivo: manter o mesmo padrão e **não quebrar** o que já funciona. Leia antes de editar.

---

## 1. O que é este projeto

ERP interno da CENA. Front-end **monolítico** em `index.html` (~162k linhas) sendo **modularizado aos poucos** para `modules/` e shells na raiz. Back-end **Supabase** (PostgREST + Auth + Storage + Edge/proxy functions). Sem framework, sem build step — é HTML + JS servido estático.

- Arquitetura e dependências entre módulos: **`MAPA_DE_INTEGRACAO_DOS_MODULOS.md`** (leitura obrigatória antes de mexer em integração).
- Roadmap: `ROADMAP_CENA.md`.

## 2. Rodar / visualizar

Servidor estático local (de `launch.json`):

```bash
python -m http.server 8000
```

Depois abrir `http://localhost:8000`. Não há `npm run build`; `package.json` só traz o CLI do Supabase (devDependency).

## 3. Layout do repositório

| Caminho | O quê |
|---|---|
| `index.html` | App principal (monólito; 10 blocos `<script>` inline) |
| `modules/` | Módulos já extraídos (`frotas`, `projetos`) |
| `*-shell.js` na raiz | Shells de módulos (`prog-projetos-shell.js`, `sesmt-alm-shell.js`, `portaria-camera.js`, `portaria-offline.js`) |
| `functions/claude-proxy.js` | Proxy de backend para IA (esconde a chave; **não** colocar segredo no front) |
| `sw.js`, `manifest.json` | PWA / service worker |
| `docs/` | Documentação de domínio |
| `sql_*.sql` | Migrações/correções SQL (ver §6) |
| `tmp-*.js`, `_patch_*`, `_tmp_*` | Arquivos temporários/experimentais — **não** referência de padrão |

## 4. Fonte da verdade e Git (IMPORTANTE)

- **Diretório de trabalho oficial: `C:\dev\cena-sistema`.** Existe uma cópia antiga em `OneDrive\...\ERP CENA` — **não usar para desenvolver** (git dentro do OneDrive corrompe; está defasada).
- Remoto: `github.com/mdvarella/cena-sistema`.
- Rotina para não perder trabalho:
  1. **`git pull` antes de começar** (ou Pull no GitHub Desktop).
  2. Commits **pequenos e frequentes**, mensagem clara + versão (`8.1.x`).
  3. **Push ao fim de cada etapa.**
  4. **Uma ferramenta editando por vez** no mesmo arquivo. Ao alternar Cursor ⇄ Claude: quem editou faz commit+push, o outro dá pull antes de tocar.
- **Versão nunca regride:** há guard de `APP_VERSAO`/`SW_VERSION` que impede publicar versão menor que `origin`. Ao mexer na versão, sempre subir, nunca baixar.

## 5. Convenções de código

- **ES5 apenas** no `index.html`: `var` + `function`, nada de `let`/`const`/arrow/template literals nos blocos inline. (Módulos novos em arquivo próprio podem ser mais modernos — seguir o padrão do arquivo onde está editando.)
- Acesso ao banco **sempre** pelos wrappers: `sbFetch` / `sbFetchAll` / `sbInsert` / `sbUpdate` / `sbDelete` / `sbRpc`.
  - ⚠️ **Teto de 1000 linhas do PostgREST:** `sbFetch` corta em 1000. Para listas grandes use `sbFetchAll` (pagina) **ou** busca por filtro com paginação — nunca assuma que veio tudo.
  - `sbDelete(tabela, filtro)` espera string de filtro: `'id=eq.'+id` (não o id cru).
- Upload de arquivo: `sbUpload(file, path)` → bucket **`cena-docs`** (devolve URL pública). **Nunca** base64 de arquivo grande no banco; guardar **URL/metadados**.
- **Humanizar seleções:** em listas/seletores mostrar sempre o **NOME**, nunca id/código/número.
- Não reescrever módulos inteiros. Mudança **aditiva** e localizada. Não apagar legado sem plano de migração.
- Páginas seguem o padrão `pg-<modulo>-<x>`; navegação por `showPage()`; módulos pesados carregam sob demanda via `_precisaModulo()` / `carregarModulo*()`.

## 6. SQL

- Todo SQL deve ser **idempotente** (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, etc.).
- **Nunca rodar SQL sem aprovação** do usuário; nada destrutivo (sem `DROP`/`DELETE` em massa sem plano).
- Entregar o `.sql` para o usuário rodar no Supabase → SQL Editor (salvo quando ele pedir que eu aplique).

## 7. Autenticação (estado atual)

Login **híbrido**: tenta **Supabase Auth** (`signInWithPassword` → JWT em `_sbAuthToken`) e cai para **MD5 legado** (`usuarios_sistema.senha_hash`) para usuários não migrados. Vínculo Auth↔perfil hoje é **por email**. Perfil/permissões ficam em `usuarios_sistema` (`PERFIS_BASE`). Toda chamada usa `_sbAuthToken || SB.key`. (Plano de endurecer isso — migração total p/ Auth + RLS — antes de features fiscais.)

## 8. Antes de considerar "pronto"

- **Validar sintaxe** dos scripts inline do `index.html` (extrair cada `<script>` e rodar `node --check`), já que é um arquivo só e um erro derruba tudo.
- Se a mudança for visível no navegador, **conferir no preview** (console sem erros).
- Reportar com honestidade o que foi testado e o que ficou pendente.

## 9. O que NÃO fazer

- Não colocar segredo (token, chave, senha, certificado) no front — usar `functions/` (backend).
- Não quebrar os módulos acoplados: Programação (TMA/PLPT), Diário de Bordo, Frotas/Portaria, Almoxarifado, SESMT/RH, Financeiro. Ver dependências no MAPA.
- Não editar a cópia do OneDrive.
- Diagnóstico **antes** de implementar em mudanças grandes (padrão do time).
