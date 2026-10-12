'use strict';
// ETAPA 1.5b-2 — WL na operação, em projeto estruturado (espelho do TESTE 1 — das123):
// F4 medição (rótulo por atividade_id; seletor distingue linhas de mesmo código), F5 seletores (Reserva, adicional,
// De Para, diário PLPT com sot_wl carregada; wl_id/ft/kit no JSON da requisição), F6 nova requisição (rótulo na
// descrição), F7 retirados/adicionais pela linha exata, F1 validação do campo (projeto, atividade certa, ambíguo não
// soma; criação continua desligada) e F8 Jornada (sem "Importar lista" em projeto com WL).
const fs = require('fs');
const path = require('path');
const S = require('./helpers/wl-operacao-sandbox');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const jornada = fs.readFileSync(path.join(raiz, 'modules', 'projetos', 'jornada', 'jornada-actions.js'), 'utf8').replace(/\r\n/g, '\n');
const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 500) : '')); }
const tick = () => new Promise(r => setImmediate(r));
const semComent = s => s.replace(/\/\/[^\n]*/g, '');
const PW = S.PW, PL = S.PL, W1 = S.W1, W2 = S.W2;
const R_W1_SERV = 'WL 1 · FT I · KIT S-654321';
const R_W2_SERV = 'WL 2 · FT I · KIT S-654321';
const R_W1_FIO = 'WL 1 · FT I · KIT NK-AMAR';
const R_W2_FIO = 'WL 2 · FT I · KIT NK-AMAR';

// ── Estáticos ───────────────────────────────────────────────────
const i0 = html.indexOf('// ── Etapa 1.5b-2: WL na medição');
const i1 = html.indexOf('// ── Etapa 1.5b-1: selo WL nos cards');
const bloco = html.slice(i0, i1);
ok('bloco 1.5b-2 presente no bloco WL', i0 > 0 && i1 > i0);
ok('ES5 no bloco 1.5b-2', !/\blet\s|\bconst\s|=>|`/.test(semComent(bloco)));
const tocadas = ['sotRenderMedicaoBody', 'sotAdicionarItensMedicao', 'sotRenderTabReserva', 'sotEnviarRequisicao', 'sotAbrirModalAdicionalReserva',
  'sotLiberarRequisicoesAdicional', 'plptMatRetiradoQtd', 'plptBuildAbaCampo', 'plptEnviarReservaInline', 'plptGerarDePara', 'plptLancarMaterial',
  'plptLancarAtividade', 'nrmAtualizarMateriais', 'sotRenderListaValidacoes', 'sotValidarLancamento'].map(n => S.fnTexto(html, n)).join('\n');
ok('ES5 nas funções alteradas', !/\blet\s|\bconst\s|=>|`/.test(semComent(tocadas)));
ok('nada grava em sot_wl pela tela', !/sb(Insert|Update|Delete)\(\s*'sot_wl'/.test(html));
ok('criação de lançamento do campo continua sem chamador', (html.match(/dbAbrirLancamentoAtividades\(/g) || []).length === 1);
ok('sem consulta por projeto_id em sot_lancamentos_campo (coluna não existe; sem migration)',
  !/sot_lancamentos_campo'[^)]*projeto_id=eq/.test(html));
ok('diário PLPT carrega WLs antes de desenhar', /return plptWlCarregar\(pj, projId\)\.then\(function\(\)\{ _plptRenderProjetoDetalhe\(projId\); \}\)/.test(html));
ok('aprovação do adicional repassa o id do adicional', /sotLiberarRequisicoesAdicional\(projId, descricao, codigoSap\|\|'', adicId\)/.test(html));

(async () => {
  // ── F4 Medição ────────────────────────────────────────────────
  let t = S.montar(html, jornada);
  t.sb.sot_med_itens.push({ id: 'i1', medicao_id: 'm', atividade_id: 'w1a', codigo: 'I-654321', descricao: 'SERVIÇO', qtd_medida: 1 },
    { id: 'i2', medicao_id: 'm', atividade_id: 'w2a', codigo: 'I-654321', descricao: 'SERVIÇO', qtd_medida: 1 },
    { id: 'i3', medicao_id: 'm', atividade_id: 'nao-existe', codigo: 'X', descricao: 'ÓRFÃO', qtd_medida: 1 });
  let h = t.sb.sotRenderMedicaoBody({ id: 'm', projeto_id: PW, status: 'rascunho' }, PW, false);
  ok('F4 medição: cada item mostra WL/FT/KIT da sua atividade', h.indexOf(R_W1_SERV) > 0 && h.indexOf(R_W2_SERV) > 0 && h.indexOf(R_W1_SERV) < h.indexOf(R_W2_SERV));
  ok('F4 medição: item sem atividade conhecida fica sem rótulo', (h.match(/🔒 WL/g) || []).length === 2);
  t.sb.sotAdicionarItensMedicao('m', PW);
  const sel = t.log.modal[0];
  const opts = [...sel.matchAll(/<option value="(w[^"]+)"[^>]*>([^<]+)</g)].map(m => [m[1], m[2]]);
  ok('F4 adicionar: ordem por WL (WL 1 antes da WL 2)', JSON.stringify(opts.map(o => o[0])) === JSON.stringify(['w1a', 'w1b', 'w2a']), opts);
  ok('F4 adicionar: linhas de mesmo código ficam distinguíveis', opts[0][1] !== opts[2][1] && opts[0][1].indexOf(R_W1_SERV) > 0 && opts[2][1].indexOf(R_W2_SERV) > 0, opts);

  // ── F5 Reserva (SOT) ──────────────────────────────────────────
  t = S.montar(html, jornada, { rodarTimeouts: true });
  const cont = t.el('sot-tab-content');
  t.sb.sotRenderTabReserva(PW, cont);
  const ids = t.sb._sotReservaItensMats.map(m => m.id);
  ok('F5 reserva: por WL e sem descritivo (retirada FT=R)', JSON.stringify(ids) === JSON.stringify(['mw1', 'mw2']), ids);
  ok('F5 reserva: rótulo WL/FT/KIT nas linhas', cont.innerHTML.indexOf(R_W1_FIO) > 0 && cont.innerHTML.indexOf(R_W2_FIO) > cont.innerHTML.indexOf(R_W1_FIO));
  t.el('sot-rsv-chk-0').checked = true; t.el('sot-rsv-qtd-0').value = '2';
  t.el('sot-rsv-chk-1').checked = true; t.el('sot-rsv-qtd-1').value = '50';
  t.el('sot-rsv-equipe').value = 'eq1';
  t.el('sot-adic-reserva-ok'); t.el('sot-adic-just-0').value = 'precisa';
  t.sb.sotEnviarRequisicao(PW);
  ok('F5 adicional da reserva: modal mostra a WL da linha', /🔒 WL 2 · FT I · KIT NK-AMAR/.test(t.log.modal[0] || ''), t.log.modal);
  t.els['sot-adic-reserva-ok'].onclick();
  const itens = (t.log.persistir[0] || {}).itens || [];
  ok('F5 requisição: wl_id/ft/kit gravados no JSON de cada item', itens.length === 2 && itens[0].mat_id === 'mw1' && itens[0].wl_id === W1
    && itens[0].ft === 'I' && itens[0].kit === 'NK-AMAR' && itens[1].wl_id === W2, itens);

  // ── F5 Diário PLPT ────────────────────────────────────────────
  t = S.montar(html, jornada, { sbFetch: (tb) => (tb === 'sot_wl' ? S.WLS : []) });
  let pj = { _atividades: t.d.atividades.filter(a => a.projeto_id === PW), _materiais: t.d.materiais.filter(m => m.projeto_id === PW && !m.somente_descritivo) };
  await t.sb.plptWlCarregar(pj, PW);
  ok('F5 PLPT: carrega sot_wl do projeto uma vez', t.log.fetch.filter(f => f.t === 'sot_wl').length === 1
    && t.log.fetch[0].f.indexOf('projeto_id=eq.' + PW) >= 0 && t.log.fetch[0].f.indexOf('cancelada_em=is.null') >= 0);
  ok('F5 PLPT: atividades e materiais ordenados por WL', JSON.stringify(pj._atividades.map(a => a.id)) === JSON.stringify(['w1a', 'w1b', 'w2a'])
    && JSON.stringify(pj._materiais.map(m => m.id)) === JSON.stringify(['mw1', 'mw2']));
  ok('F5 PLPT: mapa de WLs do projeto', pj._wls[W1] && pj._wls[W1].codigo === '1' && pj._wls[W2].codigo === '2');
  const tl = S.montar(html, jornada);
  const pjl = { _atividades: tl.d.atividades.filter(a => a.projeto_id === PL), _materiais: tl.d.materiais.filter(m => m.projeto_id === PL) };
  const ordemAntes = pjl._materiais.map(m => m.id).join();
  await tl.sb.plptWlCarregar(pjl, PL);
  ok('F5 PLPT legado: nenhuma chamada nova e ordem intacta', !tl.log.fetch.length && pjl._materiais.map(m => m.id).join() === ordemAntes);

  // rótulo no diário mesmo sem o detalhe aberto (contexto WL de outro projeto)
  t = S.montar(html, jornada, { wlCtx: false });
  t.sb._plptDiario.projetoAtivo = Object.assign(pj, { _requisicoes: [] });
  t.sb.plptLancarMaterial(PW, 1); t.sb.plptLancarAtividade(PW, 2);
  ok('F5 PLPT: modais de lançamento com WL/FT/KIT (pelo mapa do diário)', t.log.modal[0].indexOf(R_W2_FIO) > 0 && t.log.modal[1].indexOf(R_W2_SERV) > 0);
  const camp = t.sb.plptBuildAbaCampo(PW, { _wls: pj._wls, _requisicoes: [{ id: 'rq', status: 'Em campo', itens: JSON.stringify([
    { mat_id: 'mw2', codigo: '324894', nome: 'FIO AL', qtd_ret: 2, wl_id: W2, ft: 'I', kit: 'NK-AMAR' }, { mat_id: 'm1', codigo: '1', nome: 'SEM WL', qtd_ret: 1 }]) }] }, true, {});
  ok('F5 PLPT campo: item da requisição com WL mostra o rótulo; sem WL não', camp.indexOf(R_W2_FIO) > 0 && (camp.match(/🔒 WL/g) || []).length === 1);
  t = S.montar(html, jornada);
  t.sb._plptDiario.projetoAtivo = { _requisicoes: [], _materiais: [], _atividades: [], _wls: pj._wls };   // ainda sem viabilidade
  const nova = t.sb.plptBuildAbaCampo(PW, t.sb._plptDiario.projetoAtivo, false, {});
  ok('F5 PLPT nova reserva: sem descritivo, por WL, com rótulo', JSON.stringify(t.sb._plptReservaItensDisp.map(m => m.id)) === JSON.stringify(['mw1', 'mw2'])
    && nova.indexOf(R_W1_FIO) > 0 && nova.indexOf('FIO AL RETIRADO') < 0);
  t.el('rsv-chk-1').checked = true; t.el('rsv-qtd-1').value = '2'; t.el('rsv-inline-status');
  t.sb.plptEnviarReservaInline();
  await tick();
  const itensInline = t.log.insert[0] ? JSON.parse(t.log.insert[0].p.itens) : [];
  ok('F5 PLPT envio: wl_id/ft/kit no item', itensInline.length === 1 && itensInline[0].mat_id === 'mw2' && itensInline[0].wl_id === W2 && itensInline[0].kit === 'NK-AMAR', itensInline);

  // ── F5 De Para ────────────────────────────────────────────────
  t = S.montar(html, jornada);
  t.sb._plptDiario.projetoAtivo = { projeto_id: PW, _materiais: pj._materiais, _atividades: pj._atividades, _adicionais: [] };
  t.sb.plptGerarDePara(PW);
  const dp = t.log.modal[0];
  ok('F5 De Para: WL/FT/KIT na tabela e no texto copiado', dp.indexOf('🔒 ' + R_W1_FIO) > 0 && dp.indexOf('FIO AL | ' + R_W2_FIO + ' | DE:') > 0
    && dp.indexOf('SERVIÇO | ' + R_W1_SERV + ' | DE:') > 0, dp.slice(dp.indexOf('<textarea'), dp.indexOf('<textarea') + 600));

  // ── F6 Nova requisição ────────────────────────────────────────
  t = S.montar(html, jornada);
  t.el('nrm-cont').value = 'c1'; t.el('nrm-proj').value = PW; t.el('nrm-mat-sel');
  t.sb.nrmAtualizarMateriais();
  const nrm = t.els['nrm-mat-sel'].innerHTML;
  ok('F6 nova requisição: descrição leva WL/FT/KIT; sem descritivo', nrm.indexOf('data-desc="FIO AL · ' + R_W1_FIO + '"') > 0
    && nrm.indexOf('data-desc="FIO AL · ' + R_W2_FIO + '"') > 0 && nrm.indexOf('RETIRADO') < 0, nrm);

  // ── F7 Retirados e adicionais ─────────────────────────────────
  t = S.montar(html, jornada);
  const mapa = t.sb.plptMateriaisRetiradosMap(PW, { _requisicoes: [{ status: 'Em campo', itens: JSON.stringify([{ mat_id: 'mw1', codigo: '324894', qtd_ret: 3 }]) }] });
  const mw = id => t.d.materiais.find(m => m.id === id);
  ok('F7 retirado: só a linha exata da WL acende', t.sb.plptMatRetiradoQtd(mw('mw1'), mapa) === 3 && t.sb.plptMatRetiradoQtd(mw('mw2'), mapa) === 0);
  ok('F7 retirado: legado continua por código', t.sb.plptMatRetiradoQtd(mw('m2'), mapa) === 3);
  const req = { id: 'r1', status: 'Adicional pendente de aprovação', itens: JSON.stringify([
    { mat_id: 'mw1', codigo: '324894', nome: 'FIO AL', adicional_pendente: true, adicional_id: 'ad1', wl_id: W1, qtd_prevista: 1, qtd_adicional: 2 },
    { mat_id: 'mw2', codigo: '324894', nome: 'FIO AL', adicional_pendente: true, adicional_id: 'ad2', wl_id: W2, qtd_prevista: 1, qtd_adicional: 1 }]) };
  t = S.montar(html, jornada, { sbFetch: () => [req] });
  t.sb.sotLiberarRequisicoesAdicional(PW, 'FIO AL', '324894', 'ad1');
  await tick(); await tick();
  const lib = t.log.update[0] ? JSON.parse(t.log.update[0].p.itens) : [];
  ok('F7 adicional: libera só a linha do adicional aprovado', lib.length === 2 && lib[0].adicional_pendente === false && lib[1].adicional_pendente === true
    && t.log.update[0].p.status === undefined, { lib, upd: t.log.update });
  t = S.montar(html, jornada, { sbFetch: () => [req] });
  t.sb.sotLiberarRequisicoesAdicional(PW, 'FIO AL', '324894');
  await tick(); await tick();
  ok('F7 adicional: sem id do adicional, linha com WL não é liberada por descrição', !t.log.update.length);

  // ── F1 Validação do campo ─────────────────────────────────────
  t = S.montar(html, jornada);
  t.el('sot-validacoes-campo');
  const rows = [
    { id: 'v1', codigo: 'I-654321', tipo: 'executado', descricao: 'SERVIÇO', qtd: 1, unidade: 'UN', encarregado_nome: 'Zé' },
    { id: 'v2', codigo: 'I-777', tipo: 'executado', descricao: 'ÚNICO', qtd: 1, unidade: 'UN', encarregado_nome: 'Zé', atividade_id: 'w1b' },
    { id: 'v3', codigo: 'I-654321', tipo: 'executado', descricao: 'SERVIÇO', qtd: 1, unidade: 'UN', encarregado_nome: 'Zé', projeto_id: 'outro' },
    { id: 'v4', codigo: 'I-654321', tipo: 'executado', descricao: 'SERVIÇO', qtd: 1, unidade: 'UN', encarregado_nome: 'Zé', projeto_id: PW }
  ];
  t.sb.sotRenderListaValidacoes(PW, rows);
  const lv = t.els['sot-validacoes-campo'].innerHTML;
  ok('F1 lista: filtra pelo projeto (sem vínculo em projeto com WL ou de outro projeto não aparece)',
    lv.indexOf('id="val-v2"') >= 0 && lv.indexOf('id="val-v4"') >= 0 && lv.indexOf('id="val-v1"') < 0 && lv.indexOf('id="val-v3"') < 0);
  ok('F1 lista: lançamento com atividade mostra a WL dela', lv.indexOf('WL 1 · FT I · KIT S-777') > 0);
  t.sb._sotLancamentosPend = rows.slice();
  t.el('val-qtd-v2').value = '2';
  t.sb.sotValidarLancamento('v2', PW, true);
  const upd = t.log.update.filter(u => u.t === 'sot_atividades');
  ok('F1 aprovar: soma na atividade do lançamento (id)', upd.length === 1 && upd[0].f === 'id=eq.w1b' && upd[0].p.qtd_executada === 2, upd);
  const nAntes = t.log.update.length;
  t.el('val-qtd-v4').value = '1';
  t.sb.sotValidarLancamento('v4', PW, true);
  ok('F1 aprovar: código em mais de uma WL não soma e avisa', t.log.update.length === nAntes && !t.log.insert.length
    && /existe em 2 linhas de WL/.test(t.log.toast.join('|')) && !t.log.confirm.length, t.log.toast);
  t.sb.sotValidarLancamento('v3', PW, true);
  ok('F1 aprovar: lançamento de outro projeto não soma', t.log.update.length === nAntes && /não pertence/.test(t.log.toast.join('|')));
  t = S.montar(html, jornada);
  t.sb._sotLancamentosPend = [{ id: 'v5', codigo: 'NOVO', tipo: 'executado', qtd: 1, projeto_id: PW }];
  t.sb.sotValidarLancamento('v5', PW, true);
  ok('F1 aprovar: sem atividade em projeto com WL não cria atividade', !t.log.insert.length && !t.log.update.length && /🔒/.test(t.log.toast.join('|')), t.log.toast);

  // ── F8 Jornada ────────────────────────────────────────────────
  t = S.montar(html, jornada);
  const est = w => ({ fases: [], contexto: { atividades: { known: true }, wlEstado: w }, resumo: { qtd: 0 } });
  const semWl = { fases: [], contexto: { atividades: { known: true } }, resumo: { qtd: 0 } };
  ok('F8 pendente: sugere Aplicar estrutura', t.sb.jornadaObterProximaAcao({ id: 'x' }, est('ESTRUTURA_PENDENTE')).id === 'aplicar_estrutura');
  ok('F8 estruturado: não sugere Importar lista', t.sb.jornadaObterProximaAcao({ id: 'x' }, est('ESTRUTURADO')).id === 'estrutura_wl');
  ok('F8 conciliação e legado: Importar lista como antes', t.sb.jornadaObterProximaAcao({ id: 'x' }, est('EM_CONCILIACAO')).id === 'importar_lista'
    && t.sb.jornadaObterProximaAcao({ id: 'x' }, est('LEGADO_SEM_WL')).id === 'importar_lista' && t.sb.jornadaObterProximaAcao({ id: PL }, semWl).id === 'importar_lista');
  ok('F8 sem wlEstado no contexto: usa o estado do detalhe do projeto', t.sb.jornadaObterProximaAcao({ id: PW }, semWl).id === 'estrutura_wl');
  ok('F8 com atividades: Jornada segue as regras de antes', t.sb.jornadaObterProximaAcao({ id: PW }, { fases: [], contexto: { atividades: { known: true } }, resumo: { qtd: 2 } }).id !== 'importar_lista');
  let aba = null;
  t.sb.sotMostrarTab = x => { aba = x; };
  t.sb.sotImportarAtividades = () => { aba = 'importou'; };
  t.sb.jornadaExecutarAcao({ id: 'aplicar_estrutura' }, { id: PW });
  ok('F8 botão Aplicar estrutura abre a aba 📥 LMS', aba === 'lms');

  if (failed.length) {
    console.log(`proj-wl-operacao-ui: FALHOU ${failed.length}/${total}`);
    for (const f of failed) console.log('  - ' + f);
    process.exit(1);
  }
  console.log(`proj-wl-operacao-ui: OK (${total} verificações)`);
})().catch(e => { console.error(e); process.exit(1); });
