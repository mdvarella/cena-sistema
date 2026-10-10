/* =========================================================================
 * tmp-fix/testes-negativos-13.js  —  Etapa 1.3 / Edge proj-lms-receber
 * PREPARAÇÃO dos testes NEGATIVOS reais (rodar MANUALMENTE no console do ERP).
 *
 * REGRAS (não violar):
 *  - NÃO roda nada sozinho. Cada caso é chamado um a um: await LMS_NEG.<caso>()
 *  - Imprime SOMENTE: caso | HTTP status | error | erros[].codigo
 *  - NUNCA imprime JWT, apikey, service_role, conteúdo de arquivo, nome/RE/CPF.
 *  - NÃO usa service_role. Token vem do helper oficial cenaAuthGetValidToken.
 *  - Os corpos enviados são SEMPRE arquivos inválidos (fake/texto/vazio/grande):
 *    nenhum caso envia um LMS válido, então NENHUM caso pode gravar importação.
 *  - Este arquivo NÃO deve ser commitado.
 *
 * Pré-requisito: estar LOGADO no ERP via Supabase Auth (JWT), não MD5.
 *
 * Nuance verify_jwt=true (gateway valida o JWT ANTES da Edge):
 *  - "sem JWT"  -> o GATEWAY devolve 401 (sem o corpo da Edge; error pode vir vazio).
 *  - "anon key" -> passa o gateway (é um JWT válido) e a Edge devolve
 *                  401 SESSAO_INVALIDA (auth.getUser sem usuário).
 * ========================================================================= */
(function () {
  'use strict';

  var FN   = 'proj-lms-receber';
  var BASE = (typeof SB_URL !== 'undefined' ? SB_URL : (window.SB && window.SB.url)) + '/functions/v1/' + FN;
  var APIKEY = (typeof SB_KEY !== 'undefined' ? SB_KEY : (window.SB && window.SB.key)); // anon — NUNCA imprimir
  var XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  // >>> PREENCHER antes de rodar os casos que exigem ID real (deixe os outros como estão) <<<
  var IDS = {
    // Projeto VÁLIDO e AUTORIZADO para o usuário logado (usado nos casos de arquivo:
    // 415/413 e sem-permissão). Como o arquivo é inválido, passa a autorização e PÁRA
    // na validação do arquivo — não grava nada.
    projetoValido:        'PREENCHER-uuid-projeto-autorizado',
    // Projeto com deleted_at preenchido (caso 2 -> 409 PROJETO_EXCLUIDO)
    projetoExcluido:      'PREENCHER-uuid-projeto-excluido',
    // Projeto cujo contrato é texto legado que NÃO é contratos.id (caso 3 -> 403 CONTRATO_NAO_IDENTIFICADO)
    projetoContratoTexto: 'PREENCHER-uuid-projeto-contrato-texto'
    // Caso 4 (sem permissão): LOGAR com a 2ª conta SEM PROJ_IMPORTAR_LMS e usar projetoValido.
  };

  async function getToken() {
    if (typeof cenaAuthGetValidToken === 'function') {
      return await cenaAuthGetValidToken({ requireAuth: true, reason: 'edge:proj-lms-receber' });
    }
    // Fallback só se o helper oficial não existir:
    if (window._cenaSupabaseClient) {
      var s = await window._cenaSupabaseClient.auth.getSession();
      return s && s.data && s.data.session ? s.data.session.access_token : null;
    }
    return null;
  }

  function linha(caso, status, error, codigos) {
    return 'CASO: ' + caso +
           ' | HTTP ' + status +
           ' | error=' + (error || '-') +
           ' | erros[].codigo=' + (codigos || '-');
  }

  // auth: 'user' (padrão, JWT real) | 'anon' (chave anon) | 'none' (sem Authorization)
  async function enviar(caso, opts) {
    opts = opts || {};
    try {
      var headers = { 'apikey': APIKEY };
      if (opts.auth === 'none') {
        // nada de Authorization (testa o gateway)
      } else if (opts.auth === 'anon') {
        headers['Authorization'] = 'Bearer ' + APIKEY;
      } else {
        var tok = await getToken();
        if (!tok || tok === 'demo') {
          console.log(linha(caso, '(sem JWT — faça login via Supabase Auth)', '', ''));
          return;
        }
        headers['Authorization'] = 'Bearer ' + tok;
      }
      if (opts.contentType) headers['Content-Type'] = opts.contentType;
      headers['x-lms-nome'] = encodeURIComponent(opts.nome || 'teste.xlsx'); // sem dado pessoal

      var qs = (opts.projetoId !== undefined)
        ? ('?projeto_id=' + encodeURIComponent(opts.projetoId))
        : '';
      var r = await fetch(BASE + qs, { method: opts.method || 'POST', headers: headers, body: opts.body });

      var txt = await r.text(), data = null;
      try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
      var codigos = (data && Array.isArray(data.erros))
        ? data.erros.map(function (x) { return x && x.codigo; }).filter(Boolean).join(',')
        : '';
      console.log(linha(caso, r.status, data && data.error, codigos));
      return { status: r.status, error: data && data.error, codigos: codigos };
    } catch (e) {
      // Falha de rede/gateway (ex.: corpo grande cortado antes da Edge)
      console.log(linha(caso, 'Failed to fetch', (e && e.name) || 'erro_rede', ''));
      return { status: 'Failed to fetch' };
    }
  }

  // Corpos de teste (todos INVÁLIDOS de propósito)
  function corpoFakeXlsx() { return new Blob([new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])]); } // "PK" mas não é xlsx
  function corpoTexto()    { return new Blob(['isto nao e um xlsx']); }
  function corpoVazio()    { return new Blob([]); }
  function corpoGrande()   { return new Blob([new Uint8Array(13 * 1024 * 1024)]); } // ~13 MiB (> 12)

  var T = {};

  // --- Negativos que NÃO precisam de ID extra (só projetoValido p/ os de arquivo) ---
  T.semJWT      = function () { return enviar('sem JWT (esperado 401)',            { auth: 'none', projetoId: IDS.projetoValido, contentType: XLSX_MIME, body: corpoFakeXlsx() }); };
  T.anon        = function () { return enviar('chave anon (401 SESSAO_INVALIDA)',  { auth: 'anon', projetoId: IDS.projetoValido, contentType: XLSX_MIME, body: corpoFakeXlsx() }); };
  T.projIdVazio = function () { return enviar('projeto_id ausente (400)',          { projetoId: '',          contentType: XLSX_MIME, body: corpoFakeXlsx() }); };
  T.projIdInval = function () { return enviar('projeto_id nao-UUID (400)',         { projetoId: 'nao-e-uuid',contentType: XLSX_MIME, body: corpoFakeXlsx() }); };
  T.metodoGET   = function () { return enviar('GET (405)',                         { method: 'GET', projetoId: IDS.projetoValido }); };
  T.vazio       = function () { return enviar('corpo vazio (415)',                 { projetoId: IDS.projetoValido, contentType: XLSX_MIME, body: corpoVazio() }); };
  T.csv         = function () { return enviar('.csv renomeado (415)',              { projetoId: IDS.projetoValido, contentType: 'text/csv',  body: corpoTexto() }); };
  T.mime        = function () { return enviar('MIME recusado (415)',               { projetoId: IDS.projetoValido, contentType: 'application/octet-stream', body: corpoFakeXlsx() }); };
  T.texto       = function () { return enviar('texto puro (415)',                  { projetoId: IDS.projetoValido, contentType: 'text/plain', body: corpoTexto() }); };
  T.projInexistente = function () { return enviar('projeto inexistente (404)',     { projetoId: (crypto.randomUUID ? crypto.randomUUID() : '00000000-0000-4000-8000-000000000000'), contentType: XLSX_MIME, body: corpoFakeXlsx() }); };
  T.arquivoGrande = function () { return enviar('arquivo > 12 MiB (413; se "Failed to fetch" = gateway cortou antes da Edge)', { projetoId: IDS.projetoValido, contentType: XLSX_MIME, body: corpoGrande() }); };

  // --- Negativos que EXIGEM ID/conta reais (preencher IDS / logar 2ª conta) ---
  T.projExcluido  = function () { return enviar('projeto excluido (409 PROJETO_EXCLUIDO)',          { projetoId: IDS.projetoExcluido,      contentType: XLSX_MIME, body: corpoFakeXlsx() }); };
  T.contratoTexto = function () { return enviar('contrato nao identificavel (403 CONTRATO_NAO_IDENTIFICADO)', { projetoId: IDS.projetoContratoTexto, contentType: XLSX_MIME, body: corpoFakeXlsx() }); };
  T.semPermissao  = function () { return enviar('usuario sem PROJ_IMPORTAR_LMS (403 SEM_PERMISSAO) [logar 2a conta]', { projetoId: IDS.projetoValido, contentType: XLSX_MIME, body: corpoFakeXlsx() }); };

  // Expõe sem rodar nada
  window.LMS_NEG = T;
  window.LMS_NEG_IDS = IDS;
  console.log('[LMS_NEG] pronto. 1) preencha window.LMS_NEG_IDS  2) rode UM caso por vez, ex.: await LMS_NEG.semJWT()');
  console.log('[LMS_NEG] sem ID extra: semJWT, anon, projIdVazio, projIdInval, metodoGET, vazio, csv, mime, texto, projInexistente, arquivoGrande');
  console.log('[LMS_NEG] exigem ID/conta: projExcluido, contratoTexto, semPermissao');
  console.log('[LMS_NEG] depois: rodar a conferencia (tmp-fix/etapa-1.3-conferencia-producao.sql) e checar que segue 1 importacao / 200 linhas / CRIADA,REENVIO / 1 objeto.');
})();
