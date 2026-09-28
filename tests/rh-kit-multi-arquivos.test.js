'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

function sliceFn(src, name) {
  let a = src.indexOf('\nasync function ' + name + '(');
  if (a < 0) a = src.indexOf('\nfunction ' + name + '(');
  if (a < 0) throw new Error('missing ' + name);
  const re = /\n(?:async function |function |var )/g;
  re.lastIndex = a + 2;
  const m = re.exec(src);
  return src.slice(a, m ? m.index : src.length);
}

const failed = [];
function ok(name, cond, detail) {
  if (!cond) failed.push(name + (detail ? ' — ' + detail : ''));
}

function novoSandbox(extra) {
  const sb = Object.assign({
    DEMO: false,
    _rhCtKit: [],
    _rhCtAtual: { id: 'ct1' },
    _rhKitExtrasColOk: null,
    usuarioLogado: { nome: 'RH Teste' },
    toasts: [],
    progShowToast: function (m, t) { sb.toasts.push([m, t || '']); },
    rhRenderAssistente: function () {},
    rhKitFlush: async function () { sb.flushes = (sb.flushes || 0) + 1; },
    rhCtTipoEq: function (a, b) { return String(a || '').toLowerCase() === String(b || '').toLowerCase(); },
    rhCtFindItem: function (t) { return (sb._rhCtKit || []).find(function (x) { return sb.rhCtTipoEq(x.tipo_documento, t); }) || null; },
    rhEsc: function (s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
      });
    }
  }, extra || {});
  vm.createContext(sb);
  vm.runInContext(
    ['rhKitExtrasLista', 'rhKitArqEhImagem', 'rhKitArquivosDoItem', 'rhKitExtrasMiniHtml',
      'rhKitAdicionarExtra', 'rhCtAnexarKitArquivos', 'rhCtKitAplicarArquivoNoTipo'].map(function (n) { return sliceFn(html, n); }).join('\n'),
    sb
  );
  return sb;
}

// Helpers
(function () {
  const sb = novoSandbox();
  ok('lista vazia', sb.rhKitExtrasLista({}).length === 0);
  ok('lista json string', sb.rhKitExtrasLista({ arquivos_extras: '[{"url":"u1","nome":"a.jpg"}]' }).length === 1);
  ok('lista json inválido', sb.rhKitExtrasLista({ arquivos_extras: '{x' }).length === 0);
  ok('lista ignora sem url', sb.rhKitExtrasLista({ arquivos_extras: [{ nome: 'x' }, { url: 'u' }] }).length === 1);
  const it = { tipo_documento: 'RG', arquivo_url: 'p.jpg', arquivo_nome: 'p.jpg', arquivos_extras: [{ url: 'e1.jpg', nome: 'e1.jpg' }, { url: 'e2.pdf', nome: 'e2.pdf' }] };
  ok('arquivos do item = principal + extras', sb.rhKitArquivosDoItem(it).length === 3);
  const mini = sb.rhKitExtrasMiniHtml(it, 'RG');
  ok('mini mostra total', mini.indexOf('3 arquivos neste item') >= 0, mini);
  ok('mini abre índice 1 e 2', mini.indexOf(",1)") >= 0 && mini.indexOf(",2)") >= 0);
  ok('mini pdf sem img', mini.indexOf('>PDF<') >= 0);
})();

// Várias fotos num item sem arquivo: 1ª vira principal, demais extras
(async function () {
  const sb = novoSandbox({ _rhKitExtrasColOk: true });
  sb._rhCtKit = [{ tipo_documento: 'Comprovante de residência', status_kit: 'Pendente' }];
  sb.rhUploadArquivoContratacao = async function (f) { return 'https://x/' + f.name; };
  sb.rhKitExtrasColunaDisponivel = async function () { return sb._rhKitExtrasColOk; };
  sb.rhCtAnexarKitArquivo = async function (tipo, f, opts) {
    const it = sb.rhCtFindItem(tipo);
    it.arquivo_url = 'https://x/' + f.name; it.arquivo_nome = f.name; it.status_kit = 'Recebido';
    sb.primOpts = opts;
    return true;
  };
  await sb.rhCtAnexarKitArquivos('Comprovante de residência', [{ name: 'a.jpg' }, { name: 'b.jpg' }, { name: 'c.jpg' }]);
  const it = sb._rhCtKit[0];
  ok('multi: principal a.jpg', it.arquivo_nome === 'a.jpg');
  ok('multi: principal sem finalizar', sb.primOpts && sb.primOpts.semFinalizar === true);
  ok('multi: 2 extras', sb.rhKitExtrasLista(it).length === 2, JSON.stringify(it.arquivos_extras));
  ok('multi: flush único', sb.flushes === 1, String(sb.flushes));

  // Item já com arquivo: nova foto soma
  await sb.rhCtAnexarKitArquivos('Comprovante de residência', [{ name: 'd.jpg' }]);
  ok('soma: 3 extras', sb.rhKitExtrasLista(it).length === 3);
  ok('soma: principal mantido', it.arquivo_nome === 'a.jpg');

  // Sem coluna no banco: só principal e aviso
  const sb2 = novoSandbox({ _rhKitExtrasColOk: false });
  sb2._rhCtKit = [{ tipo_documento: 'RG', status_kit: 'Pendente' }];
  sb2.rhKitExtrasColunaDisponivel = async function () { return false; };
  sb2.rhCtAnexarKitArquivo = async function (tipo, f) { const i = sb2.rhCtFindItem(tipo); i.arquivo_url = f.name; i.arquivo_nome = f.name; return true; };
  sb2.rhUploadArquivoContratacao = async function () { throw new Error('não deveria subir'); };
  await sb2.rhCtAnexarKitArquivos('RG', [{ name: 'f.jpg' }, { name: 'v.jpg' }]);
  ok('sem coluna: sem extras', sb2.rhKitExtrasLista(sb2._rhCtKit[0]).length === 0);
  ok('sem coluna: avisa migração', sb2.toasts.some(function (t) { return /20260928160000_rh_kit_arquivos_extras/.test(t[0]); }));
})().then(function () {
  // IA "Confirmar no kit": soma ao item quando já tem outro arquivo
  const sb = novoSandbox({ _rhKitExtrasColOk: true });
  sb._rhCtKit = [
    { tipo_documento: 'Comprovante de residência', arquivo_url: 'u/prim.jpg', arquivo_nome: 'prim.jpg', status_kit: 'Recebido' },
    { tipo_documento: 'RG', arquivo_url: 'u/rg.jpg', arquivo_nome: 'rg.jpg', status_kit: 'Recebido', arquivos_extras: [{ url: 'u/novo.jpg', nome: 'novo.jpg' }] }
  ];
  sb.rhCtKitAplicarArquivoNoTipo('Comprovante de residência', { arquivo_url: 'u/novo.jpg', arquivo_nome: 'novo.jpg', ia_item_id: 'ia1' });
  const comp = sb._rhCtKit[0], rg = sb._rhCtKit[1];
  ok('IA: principal mantido', comp.arquivo_url === 'u/prim.jpg');
  ok('IA: vira extra', sb.rhKitExtrasLista(comp).length === 1 && sb.rhKitExtrasLista(comp)[0].ia_item_id === 'ia1');
  ok('IA: sai do extra de outro item', sb.rhKitExtrasLista(rg).length === 0);

  sb.rhCtKitAplicarArquivoNoTipo('Comprovante de residência', { arquivo_url: 'u/staging-prim.jpg', arquivo_nome: 'prim.jpg', ia_item_id: 'ia2' });
  ok('IA: releitura do mesmo arquivo substitui principal', comp.arquivo_url === 'u/staging-prim.jpg' && sb.rhKitExtrasLista(comp).length === 1);

  const sb3 = novoSandbox({ _rhKitExtrasColOk: false });
  sb3._rhCtKit = [{ tipo_documento: 'RG', arquivo_url: 'u/a.jpg', arquivo_nome: 'a.jpg', status_kit: 'Recebido' }];
  sb3.rhCtKitAplicarArquivoNoTipo('RG', { arquivo_url: 'u/b.jpg', arquivo_nome: 'b.jpg', ia_item_id: 'x' });
  ok('IA sem coluna: comportamento antigo (substitui)', sb3._rhCtKit[0].arquivo_url === 'u/b.jpg');

  // Estático
  const camKit = sliceFn(html, 'rhCtAbrirCameraKit');
  ok('câmera do kit em lote', /mode:'lote'/.test(camKit) && /rhCtAnexarKitArquivos\(tipo, files\)/.test(camKit));
  ok('input de arquivo do kit múltiplo', /<input type="file" multiple accept="image\/\*,application\/pdf,\.pdf"[^>]*onchange="rhCtAnexarKit\(this\)"/.test(html));
  const persist = sliceFn(html, 'rhPersistirKitSnapshot');
  ok('persist só manda extras com coluna confirmada', /var comExtras=await rhKitExtrasColunaDisponivel\(\);[\s\S]*sbDelete/.test(persist) && /if\(comExtras\)/.test(persist));
  ok('persist refaz insert sem extras se falhar', /if\(!insKit && comExtras\)/.test(persist));
  ok('whitelist tem arquivos_extras', /'ia_item_id','arquivos_extras'\]/.test(html));
  const recusa = sliceFn(html, 'rhKitConfirmarRecusa');
  ok('recusa limpa extras', (recusa.match(/arquivos_extras=\[\]/g) || []).length === 2);
  const painel = sliceFn(html, 'rhCtDocsEtapaHtml');
  const iCam = painel.indexOf('rhCtIaAbrirCameraLote()'), iSel = painel.indexOf('Selecionar arquivos</button>');
  ok('Entrada Inteligente: Tirar fotos antes de Selecionar arquivos', iCam > 0 && iSel > iCam);
  const lote = sliceFn(html, 'rhCtIaAbrirCameraLote');
  ok('Entrada Inteligente: câmera sem tipo/linha', /mode:'lote'/.test(lote) && !/tipo_documento|kit_tipo/.test(lote));
  const receber = sliceFn(html, 'rhCtIaReceberFotosLote');
  ok('fotos vão para staging e IA', /rhCtIaEnviarStaging\(\)/.test(receber) && /rhCtIaProcessarRecebidosDoProcesso\(\)/.test(receber));
  const proc = sliceFn(html, 'rhCtIaProcessarRecebidosDoProcesso');
  ok('IA processa só itens deste processo', /rhCtIaItensDoProcesso\(\)/.test(proc) && !/rhIaProcessarPendentes/.test(proc));
  ok('IA não vincula sozinha', !/rhIaGravarProcessoDaFila|rhCtKitAplicarArquivoNoTipo/.test(proc + receber));
  const fin = sliceFn(html, 'rhIaFinalizarGrupoCamera');
  ok('lote sem grupo_documento_id', /_rhIaCam\.mode!=='lote'\) \? grupoId : null/.test(fin));
  ok('versão 8.1.162 no changelog', /\{v:'8\.1\.162'/.test(html) && /'cena-8\.1\.\d+'/.test(sw));

  if (failed.length) {
    console.error('FALHOU:\n- ' + failed.join('\n- '));
    process.exit(1);
  }
  console.log('rh-kit-multi-arquivos: OK');
}).catch(function (e) { console.error(e); process.exit(1); });
