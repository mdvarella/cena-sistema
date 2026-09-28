'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function sliceFn(src, name, nextName) {
  const a = src.indexOf('function ' + name + '(');
  if (a < 0) throw new Error('missing ' + name);
  var b = src.indexOf('function ' + nextName + '(', a + 1);
  if (b < 0) throw new Error('missing next ' + nextName);
  return src.slice(a, b);
}

const sandbox = {
  _rhSelCandEntByCand: {},
  _rhSelPendByVaga: {},
  DEMO: true,
  rhEsc: function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
};
vm.createContext(sandbox);
vm.runInContext(
  sliceFn(html, 'rhSelFmtDt', 'rhSelCandStatusLabel') +
  sliceFn(html, 'rhSelCandTestesRespondidos', 'rhSelCandidatosRenderLista'),
  sandbox
);

const failed = [];
function ok(name, cond, detail) {
  if (!cond) failed.push(name + (detail ? ' — ' + detail : ''));
}

function alerta(c, cid) {
  return sandbox.rhSelCandAlertaRespostasHtml(c, cid || '1');
}

ok('Mauricio: ID + testes em andamento', !!alerta({
  status: 'TESTES_EM_ANDAMENTO',
  identificacao_concluida_em: '2026-09-28',
  testes_iniciados_em: '2026-09-28'
}));

sandbox._rhSelCandEntByCand['1'] = [{ status: 'AGENDADA', agendada_para: '2026-09-30T14:00:00' }];
ok('some amarelo após agendar', !alerta({
  status: 'ENTREVISTA_AGENDADA',
  identificacao_concluida_em: '2026-09-28',
  testes_concluidos_em: '2026-09-28'
}, '1'));
ok('chip data/hora no lugar', /Agendada/.test(sandbox.rhSelCandAlertaAgendaHtml('1')));
ok('ativa detectada', !!sandbox.rhSelCandEntrevistaAtiva('1'));

sandbox._rhSelCandEntByCand['2'] = [];
ok('ainda amarelo sem entrevista', !!alerta({
  status: 'TESTES_EM_ANDAMENTO',
  identificacao_concluida_em: '2026-09-28',
  testes_iniciados_em: '2026-09-28'
}, '2'));

ok('vaga rascunho', /Publicar vaga/.test(sandbox.rhSelVagaAvisoHtml({ status: 'RASCUNHO' })));
ok('vaga aberta sem candidato', /convidar candidato/.test(sandbox.rhSelVagaAvisoHtml({ id: 'v1', status: 'ABERTA' })));

sandbox._rhSelPendByVaga.v2 = {
  cands: [{
    id: 'c1', vaga_id: 'v2', nome: 'Mauricio',
    identificacao_concluida_em: '2026-09-28',
    testes_iniciados_em: '2026-09-28',
    status: 'TESTES_EM_ANDAMENTO'
  }],
  ents: []
};
ok('vaga precisa agendar', /Agendar entrevista/.test(sandbox.rhSelVagaAvisoHtml({ id: 'v2', status: 'ABERTA' })));

sandbox._rhSelPendByVaga.v3 = {
  cands: [{
    id: 'c2', vaga_id: 'v3', nome: 'Luana',
    identificacao_concluida_em: '2026-09-28',
    testes_concluidos_em: '2026-09-28',
    status: 'ENTREVISTA_AGENDADA'
  }],
  ents: [{ candidatura_id: 'c2', vaga_id: 'v3', status: 'AGENDADA', agendada_para: '2026-10-01T09:30:00' }]
};
ok('vaga mostra data agendada', /Entrevista/.test(sandbox.rhSelVagaAvisoHtml({ id: 'v3', status: 'ABERTA' })));

ok('esconde botao se ativa', html.includes('if(pode && elegivel && !ativaEnt)'));
ok('toast ja tem entrevista', html.includes('Já tem entrevista marcada'));
ok('coluna proximo passo', html.includes('<th>Próximo passo</th>'));
ok('versao 8.1.159', /numero: '8.1.159'/.test(html));

if (failed.length) {
  console.error('FAIL\n' + failed.join('\n'));
  process.exit(1);
}
console.log('ok rh-sel-alerta-respostas + entrevista unica');
