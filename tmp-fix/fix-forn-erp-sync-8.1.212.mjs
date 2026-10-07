// 8.1.212 — Fornecedores: o navegador deixa de buscar no ERP e de guardar cache; lê só a tabela fornecedores,
// que a Edge erp-fornecedores-sync mantém igual ao ERP CENA (cron diário + botão Sincronizar).
// Requer supabase/migrations/20261006190000_fornecedores_erp_sync.sql e a Edge publicada.
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
function contar(txt, s) { return txt.split(s).length - 1; }
function trocar(doc, nome, de, para, esperado = 1) {
  const n = contar(doc.txt, de);
  if (n !== esperado) throw new Error(`${nome}: esperado ${esperado} ocorrência(s), achou ${n}`);
  doc.txt = doc.txt.split(de).join(para);
  console.log('ok  ' + nome + (esperado > 1 ? ` (${n}x)` : ''));
}
/** Substitui do início de `inicio` até o início de `fim` (exclusivo); confere o que sai. */
function trocarEntre(doc, nome, inicio, fim, novo, deveConter, naoPodeConter = []) {
  if (contar(doc.txt, inicio) !== 1) throw new Error(`${nome}: início não é único (${contar(doc.txt, inicio)})`);
  const a = doc.txt.indexOf(inicio);
  const b = doc.txt.indexOf(fim, a + inicio.length);
  if (b < 0) throw new Error(`${nome}: fim não encontrado depois do início`);
  const trecho = doc.txt.slice(a, b);
  for (const s of deveConter) if (!trecho.includes(s)) throw new Error(`${nome}: trecho não contém ${s}`);
  for (const s of naoPodeConter) if (trecho.includes(s)) throw new Error(`${nome}: trecho contém ${s} (fim errado?)`);
  doc.txt = doc.txt.slice(0, a) + novo + doc.txt.slice(b);
  console.log(`ok  ${nome} (${trecho.split('\n').length - 1} linhas substituídas)`);
}

const html = carregar(ARQ);
const sw = carregar(ARQ_SW);

// ── Objeto ERP: sem cache local ──
trocar(html, 'ERP.cache',
`  disabledMsg: 'Sincronização ERP exige login via Supabase Auth (JWT). Faça login Auth ou configure o proxy.',
  cache: { key:'cena_erp_forn_v6', keyTs:'cena_erp_forn_ts_v6', ttl:30*60*1000 }
};`,
`  disabledMsg: 'Sincronização ERP exige login via Supabase Auth (JWT). Faça login Auth ou configure o proxy.'
};`);

// ── Busca no ERP pelo navegador + cache -> leitura do banco e disparo da Edge ──
trocarEntre(html, 'bloco ERP navegador',
`// Restaurar cache do localStorage ao iniciar
(function(){`,
`// ── FIM INTEGRAÇÃO ERP ──`,
`// Fornecedores do ERP CENA: a Edge erp-fornecedores-sync grava na tabela fornecedores (cron diário + botão Sincronizar).
// O navegador só lê o banco. As chaves antigas guardavam a lista do ERP com dados pessoais.
try{ localStorage.removeItem('cena_erp_forn_v6'); localStorage.removeItem('cena_erp_forn_ts_v6'); }catch(e){}

function _erpSetStatus(txt,cor){
  var el=document.getElementById('forn-load-status');
  if(el) el.innerHTML=txt?'<span style="color:'+(cor||'#888')+'">'+txt+'</span>':'';
}

var _erpFornUltimaExec=null;
function erpCarregarUltimaSincFornecedores(){
  if(DEMO) return Promise.resolve(null);
  return Promise.resolve(sbFetch('erp_sync_execucoes',{
    select:'iniciado_em,finalizado_em,modo,disparo,status,lidos,inseridos,atualizados,vinculados,inativados,conflitos,erro',
    filters:['recurso=eq.suppliers','modo=neq.SIMULACAO'], order:'iniciado_em.desc', limit:1
  })).then(function(r){ _erpFornUltimaExec=(Array.isArray(r)&&r[0])||null; return _erpFornUltimaExec; })
    .catch(function(){ return null; });
}

function erpCarregarFornecedores(forceRefresh){
  if(forceRefresh) return erpSincronizarFornecedores('auto');
  return carregarFornDB().then(function(r){
    fornecedores=(r||[]).slice();
    return r||[];
  });
}

/** Dispara a sincronização no servidor. modo: 'auto' | 'completa' | 'simulacao' (simulação não grava fornecedores). */
async function erpSincronizarFornecedores(modo){
  modo=modo||'auto';
  if(['auto','completa','simulacao'].indexOf(modo)<0){ console.warn('[ERP] modo inválido:', modo); return null; }
  if(DEMO){ if(typeof progShowToast==='function') progShowToast('Sincronização com o ERP indisponível no modo demonstração.'); return null; }
  _erpSetStatus('🔄 Sincronizando com o ERP...','#888');
  var res=null, msg='';
  try{
    res=await chamarEdgeFunction('erp-fornecedores-sync',{modo:modo});
  }catch(e){
    var st=e&&e.status;
    msg = st===409 ? 'Já existe uma sincronização em andamento. Tente de novo em alguns minutos.'
      : st===403 ? 'Seu perfil não pode sincronizar fornecedores do ERP.'
      : st===401 ? 'Sessão expirada ou sem login Auth. Entre novamente.'
      : 'Falha na sincronização com o ERP: '+((e&&e.message)||'erro desconhecido');
  }
  await erpCarregarFornecedores(false);
  await erpCarregarUltimaSincFornecedores();
  if(res&&res.ok){
    var c=res.contadores||{};
    var txt=(res.modo==='SIMULACAO'?'Simulação (nada gravado): ':'Fornecedores sincronizados: ')
      +(c.lidos||0)+' lidos, '+(c.inseridos||0)+' novos, '+(c.atualizados||0)+' atualizados, '
      +(c.vinculados||0)+' vinculados ao cadastro, '+(c.inativados||0)+' inativados, '+(c.conflitos||0)+' conflitos';
    if(res.status==='PARCIAL') txt+=' — PARCIAL: '+(res.aviso||'leitura incompleta');
    if(res.modo==='SIMULACAO') console.log('[ERP] simulação de fornecedores', res);
    _erpSetStatus((res.status==='OK'?'✅ ':'⚠ ')+escHtml(txt),res.status==='OK'?'#3B6D11':'#854F0B');
    if(typeof progShowToast==='function') progShowToast(txt, res.status==='OK'?undefined:'erro');
  } else {
    if(!msg) msg='Falha na sincronização com o ERP.';
    _erpSetStatus('⚠ '+escHtml(msg),'#854F0B');
    if(typeof progShowToast==='function') progShowToast('⚠ '+msg,'erro');
  }
  setTimeout(function(){_erpSetStatus('');},8000);
  if(document.getElementById('tbody-forn-vis')) renderFornecedoresVis();
  return res;
}
`,
['function erpFetchTodos', 'function erpNorm', 'function erpDedup', 'function erpCacheInfo', 'function erpCarregarFornecedores', 'function _erpSetStatus'],
['var usuarioLogado', 'function carregarFornDB']);

// ── Leitura do banco: ordem estável para a paginação ──
trocar(html, 'carregarFornDB ordem',
`    ? sbFetchAll('fornecedores',{order:'razao_social.asc',pageSize:1000,maxPages:20})`,
`    ? sbFetchAll('fornecedores',{order:'razao_social.asc,id.asc',pageSize:1000,maxPages:20})`);

// ── Carga inicial: com o espelho do ERP passa de 1000 linhas (sbFetch corta em 1000) ──
trocar(html, 'carga inicial paginada',
`      sbFetch('fornecedores',{filters:['status=eq.Ativo','deleted_at=is.null'],order:'razao_social'}),`,
`      sbFetchAll('fornecedores',{filters:['status=eq.Ativo','deleted_at=is.null'],order:'razao_social.asc,id.asc',pageSize:1000,maxPages:20}),`);

// ── Tela de fornecedores ──
trocar(html, 'botão Sincronizar',
`      +'<button class="btn" onclick="erpCarregarFornecedores(true).then(function(){renderFornecedoresVis();})" title="Forçar sincronização com ERP">🔄 Sincronizar</button>'`,
`      +'<button class="btn" onclick="erpSincronizarFornecedores(\\'auto\\')" title="Atualiza agora o cadastro com o ERP CENA (também roda todo dia às 03:00)">🔄 Sincronizar</button>'`);

trocar(html, 'abrir tela',
`    Promise.resolve(carregarFornDB())
      .then(function(){ return erpCarregarFornecedores(false); })
      .then(function(){ renderFornecedoresVis(); })`,
`    Promise.all([erpCarregarFornecedores(false), erpCarregarUltimaSincFornecedores()])
      .then(function(){ renderFornecedoresVis(); })`);

trocarEntre(html, 'renderFornecedoresVis + erpVerFornecedor',
`function renderFornecedoresVis(){`,
`function renderCategoriasVis(){`,
`function _fornEhErp(f){ return !!(f && (f.origem==='ERP' || f._erp)); }
function _fornDataHora(v){
  if(!v) return '';
  var d=new Date(v);
  return isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
}
function renderFornecedoresVis(){
  var tb = document.getElementById('tbody-forn-vis'); if(!tb) return;

  var cacheEl = document.getElementById('forn-cache-info');
  if(cacheEl){
    var nDb = (_fornDB||[]).length;
    var nErp = (_fornDB||[]).filter(_fornEhErp).length;
    var ex = _erpFornUltimaExec;
    cacheEl.textContent = (nDb ? nDb+' no cadastro · '+nErp+' do ERP · '+(nDb-nErp)+' manuais' : '')
      + (ex ? ' · última sincronização '+_fornDataHora(ex.finalizado_em||ex.iniciado_em)+' ('+ex.status+(ex.disparo==='CRON'?', automática':', manual')+')' : '');
  }

  var busca  = ((document.getElementById('forn-busca')||{}).value||'').trim();
  var status = ((document.getElementById('forn-fil-status')||{}).value||'');

  var merged = typeof _fornListaBusca==='function' ? _fornListaBusca() : (fornecedores||[]);
  var base = merged.filter(function(f){
    if(status && f.status !== status) return false;
    return true;
  });
  var lista = busca
    ? (function(){
        var minSc = _fornMinScoreBusca(busca), scores = [];
        base.forEach(function(f){
          var sc = _fornScoreBusca(busca, f);
          if(sc >= minSc) scores.push({ f: f, sc: sc });
        });
        scores.sort(function(a, b){
          if(b.sc !== a.sc) return b.sc - a.sc;
          return (a.f.razao_social||'').localeCompare(b.f.razao_social||'', 'pt-BR', { sensitivity: 'base' });
        });
        return scores.map(function(s){ return s.f; });
      })()
    : base;

  if(!lista.length){
    tb.innerHTML = '<tr><td colspan="9" style="padding:1.5rem;text-align:center;color:#aaa">'
      + (merged.length
          ? 'Nenhum resultado para os filtros aplicados.'
          : 'Nenhum fornecedor. Clique em 🔄 Sincronizar para trazer do ERP ou + Novo para cadastrar.')
      + '</td></tr>';
    return;
  }

  tb.innerHTML = lista.map(function(f){
    var doErp = _fornEhErp(f);
    var locStr = [f.cidade, f.estado].filter(Boolean).join('/');
    var erpTag = doErp ? '<span style="background:#E8F0FE;color:#185FA5;border-radius:4px;padding:1px 5px;font-size:10px;margin-left:4px">ERP</span>' : '';
    var email = (f.email||'').trim();
    var tel = (f.telefone||'').trim();
    return '<tr>'
      + '<td style="font-weight:500">' + escHtml(f.razao_social||'') + erpTag + '</td>'
      + '<td style="font-size:12px;color:#666">' + escHtml(f.nome_fantasia||'—') + '</td>'
      + '<td style="color:#888;font-family:monospace;font-size:12px">' + escHtml(f.cnpj_cpf||'—') + '</td>'
      + '<td>' + escHtml(f.tipo||'—') + '</td>'
      + '<td style="font-size:12px">' + (email ? '<a href="mailto:'+escHtml(email)+'" style="color:#185FA5;text-decoration:none">'+escHtml(email)+'</a>' : '<span style="color:#bbb">—</span>') + '</td>'
      + '<td style="font-size:12px;font-family:monospace;white-space:nowrap">' + (tel ? escHtml(tel) : '<span style="color:#bbb">—</span>') + '</td>'
      + '<td style="font-size:12px;color:#888">' + escHtml(locStr||'—') + '</td>'
      + '<td><span class="bdg ' + (f.status==='Ativo'?'ok':'gray') + '">' + escHtml(f.status||'—') + '</span></td>'
      + '<td style="display:flex;gap:4px">'
      + (doErp
          ? '<button class="btn btn-sm" id="vver-forn-'+escHtml(f.id)+'">Ver</button>'
            + '<button class="btn btn-sm" id="vedit-forn-'+escHtml(f.id)+'" title="Só tipo e contato; o restante vem do ERP">Editar</button>'
          : '<button class="btn btn-sm" id="vedit-forn-'+escHtml(f.id)+'">Editar</button>'
            + '<button class="btn btn-sm" style="color:#A32D2D;border-color:#A32D2D" id="vdel-forn-'+escHtml(f.id)+'">Excluir</button>')
      + '</td></tr>';
  }).join('');

  lista.forEach(function(f){
    var bv = document.getElementById('vver-forn-'+f.id); if(bv) bv.onclick = function(){ erpVerFornecedor(f); };
    var be = document.getElementById('vedit-forn-'+f.id); if(be) be.onclick = function(){ editarFornecedor(f.id); };
    var bd = document.getElementById('vdel-forn-'+f.id); if(bd) bd.onclick = function(){ excluirFornecedor(f.id); setTimeout(function(){ renderFornecedoresVis(); }, 100); };
  });
}

function erpVerFornecedor(f){
  var e = escHtml;
  var campos = [
    {l:'Nome fantasia',v:f.nome_fantasia},{l:'CNPJ/CPF',v:f.cnpj_cpf},{l:'Tipo',v:f.tipo},{l:'Contato',v:f.contato},
    {l:'E-mail',v:f.email},{l:'Telefone',v:f.telefone},{l:'Cidade',v:f.cidade},{l:'Estado',v:f.estado},{l:'Status',v:f.status},
    {l:'ID no ERP',v:f.erp_id!=null?String(f.erp_id):''},{l:'Matriz no ERP',v:f.erp_parent_id!=null?String(f.erp_parent_id):''},
    {l:'Última sincronização',v:_fornDataHora(f.erp_sincronizado_em)},
    {l:'Não encontrado no ERP desde',v:_fornDataHora(f.erp_ausente_desde)}
  ];
  setModal('<div class="modal-bg" onclick="if(event.target===this)closeModal()">'
    +'<div class="modal" style="max-width:520px">'
    +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem">'
    +'<h3 style="margin:0">🏢 '+e(f.razao_social||'')+'</h3>'
    +'<button onclick="closeModal()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#888">✕</button>'
    +'</div>'
    +'<span style="background:#E8F0FE;color:#185FA5;border-radius:4px;padding:2px 8px;font-size:11px">Fonte: ERP CENA — altere os dados no ERP</span>'
    +'<div style="margin-top:.75rem;display:grid;grid-template-columns:1fr 1fr;gap:.5rem">'
    +campos.filter(function(x){return x.v;})
      .map(function(x){return '<div><div style="font-size:10px;color:#888;font-weight:600">'+e(x.l)+'</div><div style="font-size:13px">'+e(x.v)+'</div></div>';})
      .join('')
    +'</div>'
    +'<div style="text-align:right;margin-top:1rem"><button class="btn" onclick="closeModal()">Fechar</button></div>'
    +'</div></div>');
}

`,
['var erpTag = f._erp', 'var r=f._erp_raw||f;', 'erpCacheInfo()'],
['function renderCategoriasVis']);

// ── Excluir: fornecedor do ERP não sai daqui (o banco também recusa) ──
trocar(html, 'excluir ERP',
`  if(f._erp){
    if(typeof progShowToast==='function') progShowToast('Fornecedor do ERP não pode ser excluído aqui.','erro');`,
`  if(_fornEhErp(f)){
    if(typeof progShowToast==='function') progShowToast('Fornecedor do ERP não pode ser excluído aqui — inative no ERP CENA.','erro');`);

// ── Editar: no fornecedor do ERP só tipo e contato ──
trocarEntre(html, 'editarFornecedor + salvarEditarForn',
`function editarFornecedor(fid){`,
`function openNovaCategoria(){`,
`function editarFornecedor(fid){
  var f=(typeof _fornFindById==='function'?_fornFindById(fid):null)
    || (fornecedores||[]).find(function(x){return String(x.id)===String(fid);});
  if(!f)return;
  var esc=typeof escHtml==='function'?escHtml:function(s){return String(s||'').replace(/"/g,'&quot;');};
  var doErp=_fornEhErp(f);
  var ro=doErp?' disabled title="Mantido pelo ERP CENA — altere no ERP"':'';
  setModal('<div class="modal-bg"><div class="modal"><h3>Editar fornecedor</h3>'
    +(doErp?'<div style="background:#E8F0FE;color:#185FA5;border-radius:8px;padding:.5rem .7rem;font-size:12px;margin-bottom:.6rem">Fornecedor do ERP CENA: razão social, CNPJ/CPF, telefone e e-mail vêm do ERP e são atualizados pela sincronização. Aqui só tipo e contato.</div>':'')
    +'<div class="g2">'
    +'<div class="fg" style="grid-column:1/-1"><label>Razão social</label><input id="nf-rs" value="'+esc(f.razao_social||'')+'"'+ro+'/></div>'
    +'<div class="fg"><label>CNPJ/CPF</label><input id="nf-cnpj" value="'+esc(f.cnpj_cpf||'')+'"'+ro+'/></div>'
    +'<div class="fg"><label>Tipo</label><select id="nf-tipo">'+['Fornecedor','Locadora','Prestador','Transportadora'].map(function(t){return '<option'+(f.tipo===t?' selected':'')+'>'+t+'</option>';}).join('')+'</select></div>'
    +'<div class="fg"><label>Contato</label><input id="nf-cont" value="'+esc(f.contato||'')+'"/></div>'
    +'<div class="fg"><label>Telefone</label><input id="nf-tel" value="'+esc(f.telefone||'')+'"'+ro+'/></div>'
    +'<div class="fg"><label>E-mail</label><input id="nf-email" value="'+esc(f.email||'')+'"'+ro+'/></div>'
    +'</div>'
    +'<div class="ma"><button class="btn" onclick="closeModal()">Cancelar</button>'
    +'<button class="btn btn-pri" onclick="salvarEditarForn(\\''+String(fid).replace(/'/g,"\\\\'")+'\\')">Salvar</button></div></div></div>');
}
async function salvarEditarForn(fid){
  var f=(typeof _fornFindById==='function'?_fornFindById(fid):null)
    || (fornecedores||[]).find(function(x){return String(x.id)===String(fid);});
  if(!f)return;
  function g(id){ return (document.getElementById(id)||{}).value; }
  var campos = _fornEhErp(f)
    ? { tipo:g('nf-tipo')||f.tipo, contato:g('nf-cont')||'' }
    : { razao_social:g('nf-rs')||f.razao_social, cnpj_cpf:g('nf-cnpj')||'', tipo:g('nf-tipo')||f.tipo,
        contato:g('nf-cont')||'', telefone:g('nf-tel')||'', email:g('nf-email')||'', status:f.status||'Ativo' };
  if(!DEMO && typeof isUUID==='function' && isUUID(String(fid))){
    var ok=await sbUpdate('fornecedores',campos,'id=eq.'+fid);
    if(!ok){
      if(typeof progShowToast==='function') progShowToast('Erro ao salvar fornecedor.','erro');
      else alert('Erro ao salvar fornecedor.');
      return;
    }
  }
  Object.assign(f,campos);
  closeModal();
  _fornRefreshLista();
}
`,
['function salvarEditarForn', "razao_social:f.razao_social,cnpj_cpf:f.cnpj_cpf"],
['function openNovaCategoria']);

// ── Selects de frota/locação/lançamentos: só o banco ──
trocarEntre(html, 'frtFornecedoresLista + frtResolverFornecedorId',
`// Lista combinada: fornecedores cadastrados no banco (uuid) + lista do ERP (ids _erp_, sincronizados ao salvar)
function frtFornecedoresLista(){`,
`function frtModalVeiculoPosse(){`,
`// Fornecedores do banco: cadastro manual + espelho do ERP CENA (sincronizado no servidor). erp fica vazio.
function frtFornecedoresLista(){
  var db = _fornDB.length ? _fornDB.slice() : fornecedores.filter(function(f){return !f._erp;});
  function ordRS(a,b){return (a.razao_social||'').localeCompare(b.razao_social||'');}
  db.sort(function(a,b){
    var sa=a.status==='Ativo'?0:1, sb=b.status==='Ativo'?0:1;
    if(sa!==sb)return sa-sb;
    return ordRS(a,b);
  });
  return {db:db, erp:[]};
}

// IDs antigos da lista do ERP no navegador (_erp_<id>): o fornecedor já está na tabela pela sincronização
function frtResolverFornecedorId(fornId){
  if(!fornId) return Promise.resolve(null);
  if(String(fornId).indexOf('_erp_')!==0) return Promise.resolve(fornId);
  var erpId=parseInt(String(fornId).slice(5),10);
  if(!(erpId>0)) return Promise.reject(new Error('fornecedor do ERP inválido'));
  var loc=(_fornDB||[]).find(function(x){return Number(x.erp_id)===erpId && x.deleted_at==null;});
  if(loc) return Promise.resolve(loc.id);
  return Promise.resolve(sbFetch('fornecedores',{filters:['erp_id=eq.'+erpId,'deleted_at=is.null'],limit:1})).then(function(r){
    if(r&&r[0]&&r[0].id){
      if(!_fornDB.some(function(x){return x.id===r[0].id;}))_fornDB.push(r[0]);
      return r[0].id;
    }
    throw new Error('fornecedor do ERP ainda não sincronizado — use 🔄 Sincronizar em Cadastros > Fornecedores');
  });
}

`,
['localStorage.getItem(ERP.cache.key)', "sbInsert('fornecedores',novo)"],
['function frtModalVeiculoPosse']);

// ── Nada mais pode depender do cache ou da busca no navegador ──
for (const s of ['ERP.cache', 'cena_erp_forn_v6\'', 'erpFetchTodos', 'erpFetchPagina', 'erpNorm(', 'erpDedup(', 'erpCacheInfo', 'erpCacheValido', 'erpSalvarCache', 'erpInvalidarCache', '_erp_raw']) {
  const n = contar(html.txt, s);
  const permitido = s === "cena_erp_forn_v6'" ? 1 : 0;
  if (n !== permitido) throw new Error(`referência restante a ${s}: ${n}`);
}
console.log('ok  sem referências ao cache/busca do ERP no navegador');

// ── Versão ──
trocar(html, 'APP_VERSAO',
`  numero: '8.1.210',
  data:   '05/10/2026',
  build:  '20261005-1730',
  log: [
`,
`  numero: '8.1.212',
  data:   '06/10/2026',
  build:  '20261006-1900',
  log: [
    {v:'8.1.212', d:'06/10/2026', itens:[
      'Fornecedores: o cadastro do ERP CENA agora é gravado na tabela de fornecedores pelo servidor, todo dia às 03:00 e pelo botão 🔄 Sincronizar (só o que mudou desde a última vez). O navegador não busca mais no ERP nem guarda cópia local; os selects de lançamentos, frota e locação mostram a base completa do banco.',
      'Fornecedores do ERP aparecem com a etiqueta ERP: razão social, CNPJ/CPF, telefone, e-mail, cidade, UF e status vêm do ERP e só mudam lá; aqui dá para ajustar tipo e contato. Não é possível excluir fornecedor do ERP. Cadastros manuais com o mesmo CNPJ são vinculados ao ERP automaticamente; casos ambíguos ficam registrados para revisão. Dados bancários e PIX não são copiados.',
      'Sincronizar: perfis admin, diretoria, gestor e administrativo. SQL: supabase/migrations/20261006190000_fornecedores_erp_sync.sql e 20261006190100_fornecedores_erp_sync_cron.sql; Edge erp-fornecedores-sync.',
    ]},
`);

trocar(html, 'script ?v=', '?v=8.1.210"', '?v=8.1.212"', 7);
trocar(sw, 'SW_VERSION', "const SW_VERSION   = 'cena-8.1.210';", "const SW_VERSION   = 'cena-8.1.212';");

salvar(ARQ, html);
salvar(ARQ_SW, sw);
console.log('gravado: ' + ARQ + ' (' + (html.crlf ? 'CRLF' : 'LF') + '), ' + ARQ_SW + ' (' + (sw.crlf ? 'CRLF' : 'LF') + ')');
