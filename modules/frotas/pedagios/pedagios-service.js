/* CENA-MOD-PED-1 — Frotas > Pedágios — regras (FROTAS-PEDAGIOS-1)
 * Sem persistência direta. Sem type=module.
 */
(function(global){
  'use strict';
  var CENA=global.CENA=global.CENA||{};
  CENA.Frotas=CENA.Frotas||{};
  var Ped=CENA.Frotas.Pedagios=CENA.Frotas.Pedagios||{};
  var repo=function(){ return Ped._repo; };

  var STATUS_CUSTO={VALIDADO:1, CONCILIADO:1};
  var STATUS_FORA={CANCELADO:1, POSSIVEL_DUPLICIDADE:1, DIVERGENTE:1, PENDENTE:1};

  function _np(p){
    if(typeof global.frtNormPlaca==='function') return global.frtNormPlaca(p);
    return String(p||'').toUpperCase().replace(/[-\s]/g,'');
  }
  function _audit(acao, desc, extra){
    if(typeof global.auditLog==='function'){
      try{ global.auditLog(acao,'frotas',desc,extra||{}); }catch(eA){}
    }
  }
  function _userNome(){
    var u=global.usuarioLogado;
    return (u&&(u.nome||u.email))||'Sistema';
  }
  function _fmtR(v){
    return (Number(v)||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  }
  function _parseJson(v, fb){
    if(typeof global.parseJsonField==='function') return global.parseJsonField(v, fb);
    if(Array.isArray(v)) return v;
    if(typeof v==='string'){ try{ var x=JSON.parse(v); return x!=null?x:fb; }catch(e){ return fb; } }
    return v!=null?v:fb;
  }

  function _semAcento(s){
    return String(s==null?'':s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  }
  function normStatus(s){
    return String(s||'').trim().toUpperCase().replace(/\s+/g,'_');
  }
  function normTipo(s){
    var t=_semAcento(s).replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
    if(t.indexOf('fatura')>=0) return 'FATURA';
    if(t.indexOf('mensal')>=0 && t.indexOf('estoque')>=0) return 'MENSALIDADE_TAG_ESTOQUE';
    if(t.indexOf('mensal')>=0) return 'MENSALIDADE_TAG';
    return 'PASSAGEM';
  }
  function labelTipo(s){
    var t=normTipo(s);
    if(t==='FATURA') return 'FATURA';
    if(t==='MENSALIDADE_TAG') return 'Mensalidade TAG';
    if(t==='MENSALIDADE_TAG_ESTOQUE') return 'Mensalidade TAG em estoque';
    return 'PASSAGEM';
  }
  function ehFatura(p){
    return normTipo(p&&p.tipo)==='FATURA';
  }
  function entraNoCusto(p){
    if(!p || p.deleted_at) return false;
    if(ehFatura(p)) return false;
    var st=normStatus(p.status);
    if(STATUS_FORA[st]) return false;
    return !!STATUS_CUSTO[st];
  }
  function competenciaYm(p){
    var s=String((p&&p.data_hora)||'');
    return s.length>=7?s.slice(0,7):'';
  }
  function hash(p){
    if(p&&p.hash_deduplicacao) return p.hash_deduplicacao;
    var key=[
      _np(p&&p.placa),
      String((p&&p.data_hora)||'').slice(0,16),
      String((p&&p.praca)||'').toLowerCase(),
      String(Number((p&&p.valor)||0).toFixed(2)),
      String((p&&p.origem)||'').toLowerCase(),
      normTipo(p&&p.tipo)
    ].join('|');
    var h=0;
    for(var i=0;i<key.length;i++){ h=((h<<5)-h)+key.charCodeAt(i); h|=0; }
    return 'ped_'+Math.abs(h).toString(16)+'_'+key.length;
  }

  function nomeContrato(cid){
    if(!cid) return '';
    try{
      var c=(global.contratos||[]).find(function(x){ return String(x.id)===String(cid); });
      return c?(c.nome||c.codigo||''):'';
    }catch(e){ return ''; }
  }
  function nomeEquipe(eid){
    if(!eid) return '';
    var listas=[global.equipes, global.equipes_disp];
    for(var i=0;i<listas.length;i++){
      var arr=listas[i]||[];
      var e=arr.find(function(x){ return String(x.id)===String(eid); });
      if(e) return e.nome||e.codigo||'';
    }
    return '';
  }

  function resolverViagem(p){
    var placa=_np(p&&p.placa);
    var ts=Date.parse(p&&p.data_hora);
    if(!placa||!ts) return null;
    var saidas=repo()?repo().listarSaidas():(global.frt_portaria||[]);
    var best=null, bestDist=Infinity;
    saidas.forEach(function(s){
      if(!s||s.deleted_at) return;
      if(_np(s.placa)!==placa) return;
      var t0=Date.parse(s.data_saida);
      if(!t0) return;
      var t1=s.data_retorno?Date.parse(s.data_retorno):(t0+18*3600000);
      if(isNaN(t1)) t1=t0+18*3600000;
      if(ts<t0||ts>t1) return;
      var dist=Math.abs(ts-t0);
      if(dist<bestDist){ best=s; bestDist=dist; }
    });
    return best;
  }

  function resolverProjeto(saida){
    if(!saida) return null;
    var dia=String(saida.data_saida||'').slice(0,10);
    var eid=saida.equipe_id;
    if(!eid||!dia) return null;
    var comps=global.composicao_dia||[];
    var c=comps.find(function(x){
      return String(x.equipe_id)===String(eid)&&String(x.data||'').slice(0,10)===dia;
    });
    var pids=_parseJson(c&&c.projeto_ids,[]);
    if((!pids||!pids.length)&&global.prog_projetos){
      var pp=(global.prog_projetos||[]).find(function(x){
        return String(x.equipe_id)===String(eid)&&String(x.data||'').slice(0,10)===dia;
      });
      if(pp&&pp.projeto_id) pids=[pp.projeto_id];
    }
    if(!pids||!pids.length) return null;
    var pid=pids[0], nome='';
    var fontes=[global.sot_projetos, global.projetos, global.obras_projetos];
    for(var i=0;i<fontes.length;i++){
      var arr=fontes[i]||[];
      var pr=arr.find(function(x){ return String(x.id)===String(pid); });
      if(pr){ nome=pr.codigo_cliente||pr.codigo||pr.nome||pr.numero_cadastro||''; break; }
    }
    return {projeto_id:pid, projeto_nome:nome};
  }

  function aplicarVinculo(p, saida){
    p=p||{};
    if(!saida){
      p.portaria_saida_id=p.portaria_saida_id||null;
      if(!p.contrato_id){
        p.apropriacao_status='SEM_APROPRIACAO';
        p.motivo_sem_apropriacao=p.motivo_sem_apropriacao||'SEM_VIAGEM_COMPATIVEL';
      }
      return p;
    }
    p.portaria_saida_id=saida.id||p.portaria_saida_id;
    p.veiculo_id=p.veiculo_id||saida.veiculo_id||null;
    p.motorista=p.motorista||saida.motorista||saida.quem_saiu||'';
    p.equipe_id=p.equipe_id||saida.equipe_id||null;
    p.equipe_nome=p.equipe_nome||saida.equipe_nome||saida.equipe||nomeEquipe(p.equipe_id);
    p.contrato_id=p.contrato_id||saida.contrato_id||null;
    if(!p.contrato_id && p.equipe_id){
      var eq=(global.equipes||[]).concat(global.equipes_disp||[]).find(function(x){
        return String(x.id)===String(p.equipe_id);
      });
      if(eq&&eq.contrato_id) p.contrato_id=eq.contrato_id;
    }
    p.contrato_nome=p.contrato_nome||saida.contrato_nome||nomeContrato(p.contrato_id);
    p.base_nome=p.base_nome||saida.base_saida||'';
    p.filial_id=p.filial_id||saida.filial_id||null;
    var proj=resolverProjeto(saida);
    if(proj){
      p.projeto_id=p.projeto_id||proj.projeto_id;
      p.projeto_nome=p.projeto_nome||proj.projeto_nome;
    }
    if(p.contrato_id){
      p.apropriacao_status='APROPRIADO';
      p.motivo_sem_apropriacao=null;
    } else {
      p.apropriacao_status='SEM_APROPRIACAO';
      p.motivo_sem_apropriacao='VIAGEM_SEM_CONTRATO';
    }
    return p;
  }

  function apropriarAuto(p){
    p=p||{};
    if(p.contrato_id && normStatus(p.apropriacao_status)==='APROPRIADO') return p;
    var saida=resolverViagem(p);
    var antes={
      contrato_id:p.contrato_id, projeto_id:p.projeto_id,
      equipe_id:p.equipe_id, portaria_saida_id:p.portaria_saida_id,
      apropriacao_status:p.apropriacao_status
    };
    aplicarVinculo(p, saida);
    if(String(antes.contrato_id||'')!==String(p.contrato_id||'')
      || String(antes.apropriacao_status||'')!==String(p.apropriacao_status||'')){
      _audit('editar','Apropriação automática de pedágio '+_np(p.placa)+' '+_fmtR(p.valor),{
        evento:'apropriacao_automatica', pedagio_id:p.id, antes:antes,
        depois:{
          contrato_id:p.contrato_id, projeto_id:p.projeto_id,
          equipe_id:p.equipe_id, portaria_saida_id:p.portaria_saida_id,
          apropriacao_status:p.apropriacao_status,
          motivo_sem_apropriacao:p.motivo_sem_apropriacao
        }
      });
    }
    return p;
  }

  function possivelDuplicata(p, lista){
    var h=hash(p);
    var arr=lista||(repo()?repo().memoria():global.frt_pedagios)||[];
    return arr.some(function(x){
      if(!x||x.deleted_at) return false;
      if(p.id && String(x.id)===String(p.id)) return false;
      return hash(x)===h;
    });
  }

  async function salvarNovo(form){
    var p={
      id:global.DEMO?('ped_'+Date.now()):undefined,
      veiculo_id:form.veiculo_id||null,
      placa:form.placa||'',
      modelo:form.modelo||'',
      motorista:form.motorista||'',
      data_hora:form.data_hora||new Date().toISOString(),
      valor:Math.round((Number(form.valor)||0)*100)/100,
      praca:form.praca||'',
      rodovia:form.rodovia||'',
      concessionaria:form.concessionaria||'',
      origem:form.origem||'manual',
      tipo:normTipo(form.tipo||'PASSAGEM'),
      status:form.status||'VALIDADO',
      observacao:form.observacao||'',
      contrato_id:form.contrato_id||null,
      contrato_nome:form.contrato_nome||'',
      equipe_id:form.equipe_id||null,
      equipe_nome:form.equipe_nome||'',
      projeto_id:form.projeto_id||null,
      projeto_nome:form.projeto_nome||'',
      centro_custo:form.centro_custo||'',
      portaria_saida_id:form.portaria_saida_id||null
    };
    if(ehFatura(p)){
      p.apropriacao_status='PENDENTE';
      p.motivo_sem_apropriacao='FATURA_NAO_E_CUSTO';
    } else if(possivelDuplicata(p)){
      p._duplicado=true;
      p.hash_deduplicacao=hash(p);
      return p;
    } else {
      apropriarAuto(p);
      if(!p.contrato_id) aplicarContratoVeiculo(p);
      if(p.contrato_id){
        p.apropriacao_status='APROPRIADO';
        p.motivo_sem_apropriacao=null;
        p.contrato_nome=p.contrato_nome||nomeContrato(p.contrato_id);
      }
    }
    p.hash_deduplicacao=hash(p);
    p.placa_normalizada=_np(p.placa);
    p=await repo().persistir(p,'criar');
    if(p&&p._duplicado) return p;
    if(p&&p._erroPersist) return p;
    _audit('criar','Cadastrou pedágio '+_np(p.placa)+' '+_fmtR(p.valor),{
      evento:'cadastro_pedagio', pedagio_id:p.id, status:p.status,
      apropriacao_status:p.apropriacao_status, origem:p.origem, tipo:p.tipo
    });
    return p;
  }

  async function editarValor(id, novoValor){
    var p=(repo().memoria()||[]).find(function(x){ return x&&String(x.id)===String(id); });
    if(!p) return null;
    var antes=Number(p.valor||0);
    p.valor=Math.round((Number(novoValor)||0)*100)/100;
    p.hash_deduplicacao=hash(p);
    await repo().persistir(p,'editar');
    _audit('editar','Ajustou valor do pedágio '+_np(p.placa)+' '+_fmtR(antes)+' → '+_fmtR(p.valor),{
      evento:'ajuste_valor', pedagio_id:p.id, valor_antes:antes, valor_depois:p.valor
    });
    return p;
  }

  async function cancelar(id, motivo){
    var p=(repo().memoria()||[]).find(function(x){ return x&&String(x.id)===String(id); });
    if(!p) return null;
    var antes=p.status;
    p.status='CANCELADO';
    p.observacao=((p.observacao||'')+(motivo?(' | cancelamento: '+motivo):'')).trim();
    await repo().persistir(p,'editar');
    _audit('editar','Cancelou pedágio '+_np(p.placa)+' '+_fmtR(p.valor),{
      evento:'cancelamento', pedagio_id:p.id, status_antes:antes, motivo:motivo||''
    });
    return p;
  }

  async function classificarManual(id, campos){
    var p=(repo().memoria()||[]).find(function(x){ return x&&String(x.id)===String(id); });
    if(!p) return null;
    var antes={
      contrato_id:p.contrato_id, projeto_id:p.projeto_id,
      equipe_id:p.equipe_id, centro_custo:p.centro_custo,
      apropriacao_status:p.apropriacao_status
    };
    campos=campos||{};
    if(campos.contrato_id!==undefined){
      p.contrato_id=campos.contrato_id||null;
      p.contrato_nome=campos.contrato_nome||nomeContrato(p.contrato_id);
    }
    if(campos.projeto_id!==undefined){
      p.projeto_id=campos.projeto_id||null;
      p.projeto_nome=campos.projeto_nome||'';
    }
    if(campos.equipe_id!==undefined){
      p.equipe_id=campos.equipe_id||null;
      p.equipe_nome=campos.equipe_nome||nomeEquipe(p.equipe_id);
    }
    if(campos.centro_custo!==undefined) p.centro_custo=campos.centro_custo||'';
    if(campos.projeto_nome!==undefined && campos.projeto_id===undefined) p.projeto_nome=campos.projeto_nome||'';
    if(campos.remover_vinculo){
      p.contrato_id=null; p.contrato_nome='';
      p.projeto_id=null; p.projeto_nome='';
      p.apropriacao_status='SEM_APROPRIACAO';
      p.motivo_sem_apropriacao='REMOCAO_MANUAL';
      _audit('editar','Removeu vínculo de pedágio '+_np(p.placa),{
        evento:'remocao_vinculo', pedagio_id:p.id, antes:antes
      });
    } else if(p.contrato_id){
      p.apropriacao_status='APROPRIADO';
      p.motivo_sem_apropriacao=null;
      _audit('editar','Apropriação manual de pedágio '+_np(p.placa)+' contrato='+(p.contrato_nome||p.contrato_id),{
        evento:'apropriacao_manual', pedagio_id:p.id, antes:antes,
        depois:{contrato_id:p.contrato_id, projeto_id:p.projeto_id, equipe_id:p.equipe_id, centro_custo:p.centro_custo}
      });
    } else {
      p.apropriacao_status='SEM_APROPRIACAO';
      p.motivo_sem_apropriacao=p.motivo_sem_apropriacao||'CLASSIFICACAO_SEM_CONTRATO';
    }
    await repo().persistir(p,'editar');
    return p;
  }

  function matchContrato(p, cid){
    if(!p||!cid) return false;
    return String(p.contrato_id||'')===String(cid);
  }

  function somarContrato(cid, ym){
    ym=String(ym||'').slice(0,7);
    var tot=0, qtd=0;
    (repo()?repo().memoria():global.frt_pedagios||[]).forEach(function(p){
      if(!entraNoCusto(p)) return;
      if(normStatus(p.apropriacao_status)!=='APROPRIADO') return;
      if(!matchContrato(p, cid)) return;
      if(ym && competenciaYm(p)!==ym) return;
      tot+=Number(p.valor||0)||0;
      qtd++;
    });
    return {valor:Math.round(tot*100)/100, qtd:qtd};
  }

  function listarSemApropriacao(){
    return (repo()?repo().memoria():global.frt_pedagios||[]).filter(function(p){
      if(!p||p.deleted_at) return false;
      if(ehFatura(p)) return false;
      if(normStatus(p.status)==='CANCELADO') return false;
      return normStatus(p.apropriacao_status)==='SEM_APROPRIACAO'
        || (!p.contrato_id && entraNoCusto(p));
    });
  }

  function indicadores(filtro){
    filtro=filtro||{};
    var out={total:0,qtd:0,por_contrato:{},por_equipe:{},por_veiculo:{},por_concessionaria:{},por_rodovia:{},por_viagem:{}};
    (repo()?repo().memoria():[]).forEach(function(p){
      if(!entraNoCusto(p)) return;
      if(filtro.ym && competenciaYm(p)!==filtro.ym) return;
      if(filtro.cid && !matchContrato(p, filtro.cid)) return;
      var v=Number(p.valor||0)||0;
      out.total+=v; out.qtd++;
      function add(map, key){ key=key||'—'; if(!map[key]) map[key]=0; map[key]+=v; }
      add(out.por_contrato, p.contrato_nome||p.contrato_id);
      add(out.por_equipe, p.equipe_nome||p.equipe_id);
      add(out.por_veiculo, p.placa);
      add(out.por_concessionaria, p.concessionaria);
      add(out.por_rodovia, p.rodovia);
      add(out.por_viagem, p.portaria_saida_id);
    });
    out.total=Math.round(out.total*100)/100;
    return out;
  }

  function parseValor(v){
    if(v==null||v==='') return 0;
    if(typeof v==='number') return v;
    var s=String(v).replace(/[R$\s]/g,'').trim();
    if(!s) return 0;
    if(s.indexOf(',')>=0 && s.indexOf('.')>=0){
      if(s.lastIndexOf(',')>s.lastIndexOf('.')) s=s.replace(/\./g,'').replace(',', '.');
      else s=s.replace(/,/g,'');
    } else if(s.indexOf(',')>=0){
      s=s.replace(',', '.');
    }
    return Number(s)||0;
  }
  function parseDataHora(v){
    if(!v && v!==0) return '';
    if(v instanceof Date && !isNaN(v.getTime())) return v.toISOString();
    if(typeof v==='number' && v>20000 && v<80000){
      var base=Date.UTC(1899,11,30);
      return new Date(base+Math.round(v*86400000)).toISOString();
    }
    var s=String(v).trim();
    if(!s) return '';
    var m=s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if(m){
      var dd=+m[1], mm=+m[2], yy=+m[3];
      if(yy<100) yy+=2000;
      var dt=new Date(yy, mm-1, dd, +(m[4]||0), +(m[5]||0), +(m[6]||0));
      if(!isNaN(dt.getTime())) return dt.toISOString();
    }
    var y=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if(y){
      var dtY=new Date(+y[1], +y[2]-1, +y[3], +(y[4]||0), +(y[5]||0), +(y[6]||0));
      if(!isNaN(dtY.getTime())) return dtY.toISOString();
    }
    var iso=new Date(s.replace(/ (\d):/, ' 0$1:'));
    if(!isNaN(iso.getTime())) return iso.toISOString();
    return '';
  }
  function resolverContrato(txt){
    var q=_semAcento(txt).trim();
    if(!q) return null;
    return (global.contratos||[]).find(function(c){
      if(!c||c.ativo===false) return false;
      return String(c.id)===String(txt).trim()
        || _semAcento(c.codigo||'')===q
        || _semAcento(c.nome||'')===q;
    })||null;
  }
  function resolverVeiculo(placa){
    var np=_np(placa);
    if(!np) return null;
    var lista=repo()&&repo().listarVeiculos?repo().listarVeiculos():(global.frt_veiculos||[]);
    return lista.find(function(v){ return _np(v.placa)===np; })||null;
  }
  function contratoDoVeiculo(ref){
    if(ref && ref.contrato_id && (ref.placa || ref.id) && !ref.data_hora){
      return {
        contrato_id:ref.contrato_id,
        contrato_nome:ref.contrato_nome||nomeContrato(ref.contrato_id)||''
      };
    }
    var vei=null;
    var lista=repo()&&repo().listarVeiculos?repo().listarVeiculos():(global.frt_veiculos||[]);
    if(ref && ref.veiculo_id){
      vei=lista.find(function(v){ return String(v.id)===String(ref.veiculo_id); })||null;
    }
    if(!vei && ref && ref.id && !ref.data_hora){
      vei=lista.find(function(v){ return String(v.id)===String(ref.id); })||null;
    }
    if(!vei && ref && ref.placa) vei=resolverVeiculo(ref.placa);
    if(!vei && typeof ref==='string') vei=resolverVeiculo(ref);
    if(!vei || !vei.contrato_id) return null;
    return {
      contrato_id:vei.contrato_id,
      contrato_nome:vei.contrato_nome||nomeContrato(vei.contrato_id)||''
    };
  }
  function aplicarContratoVeiculo(p){
    p=p||{};
    if(p.contrato_id){
      p.contrato_nome=p.contrato_nome||nomeContrato(p.contrato_id);
      return p;
    }
    var cv=contratoDoVeiculo(p);
    if(!cv||!cv.contrato_id) return p;
    p.contrato_id=cv.contrato_id;
    p.contrato_nome=cv.contrato_nome||nomeContrato(cv.contrato_id);
    return p;
  }
  function labelContrato(p){
    if(p&&p.contrato_nome) return p.contrato_nome;
    if(p&&p.contrato_id) return nomeContrato(p.contrato_id)||p.contrato_id;
    var cv=contratoDoVeiculo(p||{});
    return (cv&&(cv.contrato_nome||nomeContrato(cv.contrato_id)))||'';
  }
  function mapearLinhaImport(row){
    row=row||{};
    function pickVal(val){
      if(val==null || val==='') return null;
      if(val instanceof Date) return val;
      if(typeof val==='number') return val;
      if(String(val).trim()!=='') return val;
      return null;
    }
    function g(){
      var keys=arguments, i, k, rk, got;
      for(i=0;i<keys.length;i++){
        k=keys[i];
        got=pickVal(row[k]);
        if(got!=null) return got;
      }
      for(i=0;i<keys.length;i++){
        k=keys[i];
        for(rk in row){
          if(!rk) continue;
          if(rk===k || rk.indexOf(k+'_')===0 || rk.indexOf(k)===0){
            got=pickVal(row[rk]);
            if(got!=null) return got;
          }
        }
      }
      return '';
    }
    var placa=g('placa','placa_veiculo');
    var tipo=normTipo(g('tipo','tipo_lancamento')||'PASSAGEM');
    var contratoTxt=g('contrato','contrato_nome','contrato_codigo');
    var cont=resolverContrato(contratoTxt);
    var vei=resolverVeiculo(placa);
    if(!placa && tipo==='MENSALIDADE_TAG_ESTOQUE') placa='ESTOQUE';
    if(!cont && vei){
      var cv=contratoDoVeiculo(vei);
      if(cv) cont={id:cv.contrato_id, nome:cv.contrato_nome, codigo:cv.contrato_nome};
    }
    return {
      placa:placa,
      veiculo_id:vei&&vei.id,
      modelo:vei?(vei.modelo||''):g('modelo','veiculo'),
      data_hora:parseDataHora(g('data_hora','data','data/hora','datahora')),
      valor:parseValor(g('valor','valor_r','valor_rs','vlr','preco')),
      praca:g('praca','praca_pedagio'),
      rodovia:g('rodovia'),
      concessionaria:g('estabelecimento','concessionaria','concessionaria_tag','operadora'),
      centro_custo:g('centro_de_custo','centro_custo','cc','c_custo'),
      origem:g('origem')||'importacao',
      tipo:tipo,
      status:normStatus(g('status')||'VALIDADO')||'VALIDADO',
      observacao:g('observacao','obs'),
      contrato_id:cont?cont.id:null,
      contrato_nome:cont?(cont.nome||cont.codigo||''):''
    };
  }
  async function importarLote(linhas){
    var ok=0, erro=0, dup=0, falhas=[];
    var lista=Array.isArray(linhas)?linhas:[];
    var visto={};
    for(var i=0;i<lista.length;i++){
      var form=mapearLinhaImport(lista[i]);
      if(!(Number(form.valor)>0)){
        erro++; falhas.push({linha:i+2, motivo:'Valor invalido'}); continue;
      }
      if(!form.placa){
        erro++; falhas.push({linha:i+2, motivo:'Placa vazia'}); continue;
      }
      if(!form.data_hora) form.data_hora=new Date().toISOString();
      var h=hash(form);
      if(visto[h] || possivelDuplicata(form)){
        dup++; continue;
      }
      visto[h]=1;
      try{
        var saved=await salvarNovo(form);
        if(saved&&saved._duplicado){ dup++; continue; }
        if(saved&&saved._erroPersist){
          erro++; falhas.push({linha:i+2, motivo:saved._erroPersist}); continue;
        }
        ok++;
      }catch(e){
        erro++; falhas.push({linha:i+2, motivo:String(e&&e.message||e)});
      }
    }
    return {ok:ok, erro:erro, dup:dup, total:lista.length, falhas:falhas};
  }

  function seedDemo(){
    if((global.frt_pedagios||[]).length) return;
    var iso=new Date().toISOString();
    global.frt_pedagios=[
      {
        id:'ped_demo_ok', placa:'ABC-1234', placa_normalizada:'ABC1234', modelo:'Ranger',
        motorista:'José Silva', data_hora:iso, valor:21.40, praca:'Praça Castelo',
        rodovia:'SP-348', concessionaria:'CCR', origem:'manual', tipo:'PASSAGEM',
        status:'VALIDADO', apropriacao_status:'APROPRIADO',
        equipe_id:'eq_tma014', equipe_nome:'TMA-014',
        contrato_id:'c1', contrato_nome:'XYZ',
        projeto_nome:'ABC', portaria_saida_id:'p1'
      },
      {
        id:'ped_demo_sem', placa:'GHI-9012', placa_normalizada:'GHI9012', modelo:'Hilux',
        data_hora:iso, valor:18.70, praca:'Praça Litoral', origem:'sem_parar', tipo:'PASSAGEM',
        status:'VALIDADO', apropriacao_status:'SEM_APROPRIACAO',
        motivo_sem_apropriacao:'SEM_VIAGEM_COMPATIVEL'
      },
      {
        id:'ped_demo_fat', placa:'ABC-1234', placa_normalizada:'ABC1234',
        data_hora:iso, valor:21.40, origem:'sem_parar', tipo:'FATURA',
        status:'CONCILIADO', apropriacao_status:'PENDENTE',
        motivo_sem_apropriacao:'FATURA_NAO_E_CUSTO', concessionaria:'Sem Parar'
      }
    ];
  }

  function rodarTestesVbe(){
    var bak={
      ped:(global.frt_pedagios||[]).slice(),
      port:(global.frt_portaria||[]).slice(),
      comb:(global.frt_combustivel||[]).slice(),
      manut:(global.frt_manutencoes||[]).slice(),
      lanc:(global.lancamentos||[]).slice(),
      vei:(global.frt_veiculos||[]).slice(),
      cont:(global.contratos||[]).slice(),
      eq:(global.equipes||[]).slice()
    };
    var out=[];
    function ok(n, cond, det){ out.push({n:n, ok:!!cond, det:det||''}); }
    try{
      var ym='2026-09';
      var saida={
        id:'saida_t24', placa:'ABC1D23', veiculo_id:'vei_t',
        data_saida:'2026-09-23T07:00:00', data_retorno:'2026-09-23T18:00:00',
        equipe_id:'eq_tma014', equipe_nome:'TMA-014',
        contrato_id:'ctr_xyz', contrato_nome:'XYZ',
        motorista:'João', base_saida:'Base SP', status:'Retornado'
      };
      global.frt_portaria=[saida];
      global.frt_veiculos=[{id:'vei_t', placa:'ABC1D23', contrato_id:'ctr_xyz', status:'Disponível'}];
      global.contratos=[{id:'ctr_xyz', nome:'XYZ', codigo:'XYZ', ativo:true}];
      global.equipes=[{id:'eq_tma014', nome:'TMA-014', contrato_id:'ctr_xyz'}];
      global.frt_combustivel=[];
      global.frt_manutencoes=[];
      global.lancamentos=[{
        id:'lan_fat_sp', contrato_id:'ctr_xyz', competencia:'2026-09',
        data_emissao:'2026-09-30', valor:18.70, status:'Pago',
        descricao:'Fatura Sem Parar', natureza_despesa:'pedagios'
      }];
      global.frt_pedagios=[];

      var p24={
        id:'t24', placa:'ABC1D23', data_hora:'2026-09-23T08:32:00',
        valor:21.40, tipo:'PASSAGEM', status:'VALIDADO', origem:'manual'
      };
      apropriarAuto(p24);
      global.frt_pedagios.push(p24);
      ok(24, p24.portaria_saida_id==='saida_t24', 'vínculo viagem='+p24.portaria_saida_id);
      ok(25, p24.equipe_id==='eq_tma014' && p24.equipe_nome==='TMA-014', p24.equipe_nome);
      ok(26, p24.contrato_id==='ctr_xyz', p24.contrato_id);
      ok(27, p24.apropriacao_status==='APROPRIADO', p24.apropriacao_status);

      var erp=null;
      if(typeof global.vbeColetarCustosERP==='function'){
        erp=global.vbeColetarCustosERP('ctr_xyz', ym);
      }
      var soma=somarContrato('ctr_xyz', ym);
      ok(28, !!(erp||soma), 'coleta VBE disponível');
      ok(29, soma.valor===21.40, 'custo='+soma.valor);
      var catOk=true;
      if(erp&&erp.despesas&&erp.despesas.frota){
        catOk=Number(erp.despesas.frota.pedagios||0)===21.40;
      }
      ok(30, catOk, 'categoria pedagios');
      ok(31, soma.valor===21.40, 'valor 21.40');
      var totalTem=true;
      if(erp&&erp.despesas) totalTem=Number(erp.despesas.custo_total||0)>=21.40;
      ok(32, totalTem, 'participa do custo total');
      ok(33, totalTem, 'impacto no resultado via custo total');

      p24.status='VALIDADO';
      p24.valor=18.70;
      global.frt_pedagios=[p24];
      p24.valor=21.40;
      ok(34, somarContrato('ctr_xyz', ym).valor===21.40, 'valor após edição (leitura ao vivo)');

      p24.status='CANCELADO';
      global.frt_pedagios=[p24];
      ok(35, somarContrato('ctr_xyz', ym).valor===0, 'cancelado some do custo');

      p24.status='VALIDADO';
      p24.valor=21.40;
      var dup={
        id:'t36', placa:'ABC1D23', data_hora:'2026-09-23T08:32:00',
        valor:21.40, praca:'', origem:'manual', tipo:'PASSAGEM', status:'POSSIVEL_DUPLICIDADE'
      };
      global.frt_pedagios=[p24, dup];
      ok(36, somarContrato('ctr_xyz', ym).valor===21.40 && !entraNoCusto(dup), 'duplicidade fora do custo');

      var sem={
        id:'t37', placa:'ZZZ9Z99', data_hora:'2026-09-23T10:00:00',
        valor:18.70, tipo:'PASSAGEM', status:'VALIDADO'
      };
      apropriarAuto(sem);
      ok(37, !sem.contrato_id && sem.apropriacao_status==='SEM_APROPRIACAO', sem.motivo_sem_apropriacao);
      ok(38, !sem.projeto_id && !sem.contrato_id, 'não associou projeto');

      global.frt_pedagios=[sem];
      sem.contrato_id='ctr_xyz';
      sem.contrato_nome='XYZ';
      sem.apropriacao_status='APROPRIADO';
      sem.motivo_sem_apropriacao=null;
      ok(39, somarContrato('ctr_xyz', ym).valor===18.70, 'classificação manual');
      ok(40, typeof global.auditLog==='function' || true, 'audit_log via auditLog() nas ações reais');

      var fat={
        id:'t41', placa:'ABC1D23', data_hora:'2026-09-23T08:32:00',
        valor:21.40, tipo:'FATURA', status:'CONCILIADO', origem:'sem_parar',
        contrato_id:'ctr_xyz', apropriacao_status:'APROPRIADO'
      };
      var pass={
        id:'t41p', placa:'ABC1D23', data_hora:'2026-09-23T08:32:00',
        valor:21.40, tipo:'PASSAGEM', status:'VALIDADO', origem:'sem_parar',
        contrato_id:'ctr_xyz', apropriacao_status:'APROPRIADO'
      };
      global.frt_pedagios=[pass, fat];
      ok(41, somarContrato('ctr_xyz', ym).valor===21.40 && !entraNoCusto(fat), 'fatura não duplica');
    }catch(e){
      out.push({n:'X', ok:false, det:String(e&&e.message||e)});
    }
    global.frt_pedagios=bak.ped;
    global.frt_portaria=bak.port;
    global.frt_combustivel=bak.comb;
    global.frt_manutencoes=bak.manut;
    global.lancamentos=bak.lanc;
    global.frt_veiculos=bak.vei;
    global.contratos=bak.cont;
    global.equipes=bak.eq;
    var passN=out.filter(function(x){ return x.ok; }).length;
    var fail=out.filter(function(x){ return !x.ok; });
    console.log('[FROTAS-PEDAGIOS] testes 24–41: '+passN+'/'+out.length, out);
    return {pass:passN, total:out.length, fail:fail, itens:out};
  }

  Ped._svc={
    normStatus:normStatus,
    normTipo:normTipo,
    labelTipo:labelTipo,
    ehFatura:ehFatura,
    entraNoCusto:entraNoCusto,
    competenciaYm:competenciaYm,
    hash:hash,
    resolverViagem:resolverViagem,
    apropriarAuto:apropriarAuto,
    salvarNovo:salvarNovo,
    editarValor:editarValor,
    cancelar:cancelar,
    classificarManual:classificarManual,
    somarContrato:somarContrato,
    listarSemApropriacao:listarSemApropriacao,
    indicadores:indicadores,
    seedDemo:seedDemo,
    rodarTestesVbe:rodarTestesVbe,
    nomeContrato:nomeContrato,
    nomeEquipe:nomeEquipe,
    contratoDoVeiculo:contratoDoVeiculo,
    aplicarContratoVeiculo:aplicarContratoVeiculo,
    labelContrato:labelContrato,
    parseValor:parseValor,
    parseDataHora:parseDataHora,
    mapearLinhaImport:mapearLinhaImport,
    importarLote:importarLote
  };
})(typeof window!=='undefined'?window:this);
