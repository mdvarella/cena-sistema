// 8.1.206 — Logout zera o sistema: #pg-app realmente escondido, sessão Auth encerrada (fail-closed) e recarga limpa.
import fs from 'node:fs';

const ARQ = 'index.html';
const ARQ_SW = 'sw.js';

function carregar(arq) {
  const bruto = fs.readFileSync(arq, 'utf8');
  const crlf = bruto.includes('\r\n');
  return { crlf, txt: crlf ? bruto.replace(/\r\n/g, '\n') : bruto };
}
function salvar(arq, { crlf, txt }) {
  fs.writeFileSync(arq, crlf ? txt.replace(/\n/g, '\r\n') : txt, 'utf8');
}
function trocar(doc, nome, de, para, esperado = 1) {
  const n = doc.txt.split(de).length - 1;
  if (n !== esperado) throw new Error(`${nome}: esperado ${esperado} ocorrência(s), achou ${n}`);
  doc.txt = doc.txt.split(de).join(para);
  console.log('ok  ' + nome + (esperado > 1 ? ` (${n}x)` : ''));
}

const html = carregar(ARQ);
const sw = carregar(ARQ_SW);

// 1. CSS: #pg-app{display:flex} (seletor de ID) vencia .hidden; o reforço de div[id^="pg-"].hidden exclui #pg-app
trocar(html, 'css #pg-app.hidden',
`#pg-app{display:flex;flex-direction:column;height:100vh;overflow:hidden;}
#topbar{`,
`#pg-app{display:flex;flex-direction:column;height:100vh;overflow:hidden;}
/* #pg-app{display:flex} vence .hidden pela especificidade do ID */
#pg-app.hidden{display:none!important;}
body.cena-saindo{pointer-events:none;cursor:progress;}
#topbar{`);

// 2. fazerLogout
trocar(html, 'fazerLogout',
`function fazerLogout(){
  auditLog('logout','sistema','Logout do sistema');
  // Circuit breaker ANTES de qualquer coisa — impede refresh pós-logout
  _cenaAuthInvalid = true;
  // Para timers autenticados + WebSocket ANTES de limpar token
  try{ if(typeof cenaAuthStopAuthenticatedLoops==='function') cenaAuthStopAuthenticatedLoops(); }catch(eStop){}
  // Tira da lista de online antes de limpar o token (só se JWT ainda válido)
  try{ onlineOffline(); }catch(e){}
  // Encerrar sessão no Supabase Auth (se existir)
  _sbAuthToken = null;
  _cenaAuthHadSession = false;
  // NÃO resetar _cenaAuthInvalid aqui — só no próximo login Auth válido
  try{ if(supabaseClient) supabaseClient.auth.signOut(); }catch(e){}
  document.body.classList.remove('perfil-equipe');`,
`var _cenaSaindo = false;
var CENA_LOGOUT_MSG_KEY = 'cena_logout_msg';
/** Apaga a sessão Supabase salva no navegador: signOut sem rede não apaga, e a recarga reabriria a sessão. */
function cenaAuthRemoverSessaoLocal(){
  try{
    var chaves=[];
    for(var i=0;i<localStorage.length;i++){
      var k=localStorage.key(i);
      if(k && /^sb-.*-auth-token(-code-verifier)?$/i.test(k)) chaves.push(k);
    }
    chaves.forEach(function(k){ localStorage.removeItem(k); });
  }catch(e){}
}
async function cenaAuthEncerrarSessaoSupabase(){
  if(supabaseClient && supabaseClient.auth){
    try{ if(typeof supabaseClient.auth.stopAutoRefresh==='function') supabaseClient.auth.stopAutoRefresh(); }catch(eAr){}
    try{
      await Promise.race([
        supabaseClient.auth.signOut(),
        new Promise(function(r){ setTimeout(r, 4000); })
      ]);
    }catch(eOut){}
  }
  cenaAuthRemoverSessaoLocal();
}
function fazerLogout(opts){
  if(_cenaSaindo) return;
  _cenaSaindo = true;
  opts = opts || {};
  auditLog('logout','sistema','Logout do sistema');
  // Circuit breaker ANTES de qualquer coisa — impede refresh pós-logout
  _cenaAuthInvalid = true;
  // Para timers autenticados + WebSocket ANTES de limpar token
  try{ if(typeof cenaAuthStopAuthenticatedLoops==='function') cenaAuthStopAuthenticatedLoops(); }catch(eStop){}
  // Tira da lista de online antes de limpar o token (só se JWT ainda válido)
  try{ onlineOffline(); }catch(e){}
  // Encerrar sessão no Supabase Auth (se existir)
  _sbAuthToken = null;
  _cenaAuthHadSession = false;
  // NÃO resetar _cenaAuthInvalid aqui — só no próximo login Auth válido
  document.body.classList.remove('perfil-equipe');`);

trocar(html, 'fazerLogout fim',
`  var btn=document.getElementById('btn-voltar-painel');if(btn)btn.style.display='none';
  document.getElementById('pg-app').classList.add('hidden');
  document.getElementById('pg-login').classList.remove('hidden');
  document.body.classList.add('sem-login');
}
`,
`  var btn=document.getElementById('btn-voltar-painel');if(btn)btn.style.display='none';
  var pgApp=document.getElementById('pg-app');
  if(pgApp){ pgApp.style.cssText=''; pgApp.classList.add('hidden'); }
  var ma=document.getElementById('modal-area');if(ma)ma.innerHTML='';
  document.getElementById('pg-login').classList.remove('hidden');
  document.body.classList.add('sem-login');
  document.body.classList.add('cena-saindo');
  try{
    sessionStorage.removeItem('lastPage');
    sessionStorage.removeItem('lastMain');
    sessionStorage.removeItem('_cena_sessao');
    if(opts.msg) sessionStorage.setItem(CENA_LOGOUT_MSG_KEY, String(opts.msg));
  }catch(eSs){}
  // Recarregar descarta dados, telas, modais e timers da sessão anterior; sem ?page= o próximo login não herda a tela
  var recarregar=function(){ location.replace(location.pathname); };
  cenaAuthEncerrarSessaoSupabase().then(recarregar, recarregar);
}
`);

// 3. Sessão expirada: o aviso sobrevive à recarga e aparece na tela de login
trocar(html, 'cenaAuthHandleUnauthorized',
`    if(typeof fazerLogout === 'function' && usuarioLogado){
      fazerLogout();
    } else {`,
`    if(typeof fazerLogout === 'function' && usuarioLogado){
      fazerLogout({msg:msg});
    } else {`);

trocar(html, 'boot aviso de saída',
`  if(elEmail)elEmail.addEventListener('keydown',function(e){if(e.key==='Enter')fazerLogin();});
`,
`  if(elEmail)elEmail.addEventListener('keydown',function(e){if(e.key==='Enter')fazerLogin();});
  try{
    var msgSaida=sessionStorage.getItem(CENA_LOGOUT_MSG_KEY);
    if(msgSaida){
      sessionStorage.removeItem(CENA_LOGOUT_MSG_KEY);
      var elErrSaida=document.getElementById('login-err');
      if(elErrSaida){ elErrSaida.textContent=msgSaida; elErrSaida.classList.remove('hidden'); }
    }
  }catch(eMsgSaida){}
`);

// 4. Versão
trocar(html, 'APP_VERSAO',
`  numero: '8.1.205',
  data:   '04/10/2026',
  build:  '20261004-2130',
  log: [
`,
`  numero: '8.1.206',
  data:   '05/10/2026',
  build:  '20261005-1145',
  log: [
    {v:'8.1.206', d:'05/10/2026', itens:[
      'Logout: "Sair" passa a zerar o sistema. Antes a barra superior e o menu sumiam, mas o conteúdo da última tela continuava abaixo do login e aceitava cliques, porque o CSS do #pg-app vencia a classe hidden. Agora o app é escondido de fato, a sessão do Supabase Auth é encerrada (sem rede, a sessão salva no navegador é apagada mesmo assim) e a página recarrega sem ?page=, descartando dados carregados, modais e timers da sessão anterior. O próximo usuário não abre na última tela de quem saiu. Sessão expirada mostra o aviso na tela de login. Sem SQL. Sem alteração na Programação TMA.',
    ]},
`);

trocar(html, 'script ?v=', '?v=8.1.205"', '?v=8.1.206"', 7);
trocar(sw, 'SW_VERSION', "const SW_VERSION   = 'cena-8.1.205';", "const SW_VERSION   = 'cena-8.1.206';");

salvar(ARQ, html);
salvar(ARQ_SW, sw);
console.log('gravado: ' + ARQ + ' (' + (html.crlf ? 'CRLF' : 'LF') + '), ' + ARQ_SW + ' (' + (sw.crlf ? 'CRLF' : 'LF') + ')');
