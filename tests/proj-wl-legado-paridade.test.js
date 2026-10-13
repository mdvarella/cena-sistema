'use strict';
// ETAPA 1.5b-2 — paridade do projeto LEGADO (sem WL): as mesmas telas e ações produzem exatamente a mesma saída antes
// (main 5a7d0ed = 8.1.218) e depois da 1.5b-2. Antes = arquivos lidos do git; depois = arquivos do disco.
// Cobre medição, adicionar itens, Reserva + envio + modal de adicional, liberação de adicional, retirados, aba Campo
// do PLPT (nova reserva e confirmação), envio da reserva do PLPT, De Para, modais de lançamento, nova requisição,
// validação do campo e Jornada.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const S = require('./helpers/wl-operacao-sandbox');

const raiz = path.join(__dirname, '..');
const BASE = process.env.WL_PARIDADE_BASE || '5a7d0ed';
const lerGit = arq => execFileSync('git', ['show', BASE + ':' + arq], { cwd: raiz, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const norm = s => s.replace(/\r\n/g, '\n');

const antes = { html: norm(lerGit('index.html')), jornada: norm(lerGit('modules/projetos/jornada/jornada-actions.js')) };
const depois = {
  html: norm(fs.readFileSync(path.join(raiz, 'index.html'), 'utf8')),
  jornada: norm(fs.readFileSync(path.join(raiz, 'modules', 'projetos', 'jornada', 'jornada-actions.js'), 'utf8'))
};

const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 600) : '')); }
const tick = () => new Promise(r => setImmediate(r));
const PL = S.PL;

const CENARIOS = {
  async medicao(v) {
    const t = S.montar(v.html, v.jornada);
    t.sb.sot_med_itens.push({ id: 'i1', medicao_id: 'med1', atividade_id: 'a1', codigo: '100', descricao: 'POSTE', unidade: 'UN', qtd_executada: 2, qtd_medida: 2, valor_unitario: 10 },
      { id: 'i2', medicao_id: 'med1', atividade_id: 'a3', codigo: '200', descricao: 'CABO', unidade: 'M', qtd_executada: 30, qtd_medida: 30, valor_unitario: 2 });
    const med = { id: 'med1', projeto_id: PL, status: 'rascunho' };
    return [t.sb.sotRenderMedicaoBody(med, PL, false), t.sb.sotRenderMedicaoBody(med, PL, true)];
  },
  async adicionarItens(v) {
    const t = S.montar(v.html, v.jornada);
    t.sb.sot_med_itens.push({ id: 'i1', medicao_id: 'med1', atividade_id: 'a1' });
    t.sb.sotAdicionarItensMedicao('med1', PL);
    return t.log.modal;
  },
  async reservaEEnvio(v) {
    const t = S.montar(v.html, v.jornada, { rodarTimeouts: true });
    const cont = t.el('sot-tab-content');
    t.sb.sotRenderTabReserva(PL, cont);
    const ids = (t.sb._sotReservaItensMats || []).map(m => m.id);
    t.el('sot-rsv-chk-0').checked = true; t.el('sot-rsv-qtd-0').value = '3';
    t.el('sot-rsv-chk-2').checked = true; t.el('sot-rsv-qtd-2').value = '50';
    t.el('sot-rsv-equipe').value = 'eq1'; t.el('sot-rsv-data').value = '2026-10-12'; t.el('sot-rsv-obs').value = 'obs';
    t.el('sot-adic-reserva-ok'); t.el('sot-adic-mot-0').value = 'Outro'; t.el('sot-adic-just-0').value = 'precisa';
    t.sb.sotEnviarRequisicao(PL);
    if (typeof t.els['sot-adic-reserva-ok'].onclick === 'function') t.els['sot-adic-reserva-ok'].onclick();
    return { html: cont.innerHTML, ids, modal: t.log.modal, persistir: t.log.persistir, toast: t.log.toast };
  },
  async liberarAdicional(v) {
    const req = { id: 'r1', status: 'Adicional pendente de aprovação', itens: JSON.stringify([
      { mat_id: 'm1', codigo: '324894', nome: 'FIO AL', adicional_pendente: true, adicional_id: 'ad1', qtd_prevista: 1, qtd_adicional: 2 },
      { mat_id: 'm2', codigo: '324894', nome: 'FIO AL', adicional_pendente: true, adicional_id: 'ad2', qtd_prevista: 1, qtd_adicional: 1 },
      { mat_id: 'm3', codigo: '999', nome: 'ALCA', adicional_pendente: true, adicional_id: 'ad3', qtd_prevista: 1, qtd_adicional: 1 }]) };
    const t = S.montar(v.html, v.jornada, { sbFetch: () => [req] });
    t.sb.sotLiberarRequisicoesAdicional(PL, 'FIO AL', '324894', 'ad1');
    await tick(); await tick();
    return t.log.update;
  },
  async retirados(v) {
    const t = S.montar(v.html, v.jornada);
    const pj = { _requisicoes: [{ status: 'Em campo', itens: JSON.stringify([{ mat_id: 'm1', codigo: '324894', qtd_ret: 3 }, { codigo: '999', qtd_ret: 1 }]) }] };
    const mapa = t.sb.plptMateriaisRetiradosMap(PL, pj);
    return { mapa, qtd: t.d.materiais.filter(m => m.projeto_id === PL).map(m => t.sb.plptMatRetiradoQtd(m, mapa)) };
  },
  async campoPlpt(v) {
    const t = S.montar(v.html, v.jornada);
    const sot = t.d.projetos[0];
    const novaReserva = t.sb.plptBuildAbaCampo(PL, { _requisicoes: [] }, false, sot);
    const dispIds = (t.sb._plptReservaItensDisp || []).map(m => m.id);
    const reqCampo = { id: 'rc1', status: 'Em campo', itens: JSON.stringify([{ mat_id: 'm1', codigo: '324894', nome: 'FIO AL', unidade: 'M', qtd_ret: 3 }]) };
    const campo = t.sb.plptBuildAbaCampo(PL, { _requisicoes: [reqCampo] }, true, sot);
    return { novaReserva, dispIds, campo };
  },
  async reservaInline(v) {
    const t = S.montar(v.html, v.jornada);
    t.sb._plptDiario.projetoAtivo = { _requisicoes: [], _materiais: [], _atividades: [] };
    t.sb.plptBuildAbaCampo(PL, t.sb._plptDiario.projetoAtivo, false, t.d.projetos[0]);
    t.el('rsv-chk-0').checked = true; t.el('rsv-qtd-0').value = '2';
    t.el('rsv-chk-2').checked = true; t.el('rsv-qtd-2').value = '1';
    t.el('rsv-data-inline').value = '2026-10-12'; t.el('rsv-inline-status');
    t.sb.plptEnviarReservaInline();
    await tick();
    return t.log.insert.map(x => { const p = Object.assign({}, x.p); delete p.criado_em; return { t: x.t, p }; });
  },
  async dePara(v) {
    const t = S.montar(v.html, v.jornada);
    t.sb._plptDiario.projetoAtivo = { projeto_id: PL, _materiais: t.d.materiais.filter(m => m.projeto_id === PL), _atividades: t.d.atividades.filter(a => a.projeto_id === PL), _adicionais: [] };
    t.sb.plptGerarDePara(PL);
    return t.log.modal;
  },
  async modaisLancamento(v) {
    const t = S.montar(v.html, v.jornada);
    t.sb._plptDiario.projetoAtivo = { _requisicoes: [], _materiais: t.d.materiais.filter(m => m.projeto_id === PL), _atividades: t.d.atividades.filter(a => a.projeto_id === PL) };
    t.sb.plptLancarMaterial(PL, 0); t.sb.plptLancarAtividade(PL, 1);
    t.sb._plptDiario.projetoAtivo = { _requisicoes: [], _materiais: [], _atividades: [{ id: 'a9', projeto_id: PL, codigo: '9', descricao: 'NOVA', qtd_prevista: 1 }] };
    t.sb.plptLancarViabilidadeAtividade(PL, 0);
    return { modal: t.log.modal, toast: t.log.toast };
  },
  async novaRequisicao(v) {
    const t = S.montar(v.html, v.jornada);
    t.el('nrm-cont').value = 'c1'; t.el('nrm-proj').value = PL; t.el('nrm-mat-sel');
    t.sb.nrmAtualizarMateriais();
    return t.els['nrm-mat-sel'].innerHTML;
  },
  async validacao(v) {
    const t = S.montar(v.html, v.jornada);
    t.el('sot-validacoes-campo');
    const rows = [
      { id: 'l1', codigo: '100', tipo: 'executado', descricao: 'POSTE', qtd: 1, unidade: 'UN', encarregado_nome: 'Zé', data: '2026-10-12' },
      { id: 'l2', codigo: 'XYZ', tipo: 'viabilizado', descricao: 'OUTRO', qtd: 2, unidade: 'UN', encarregado_nome: 'Zé', data: '2026-10-12' },
      { id: 'l3', codigo: '777', tipo: 'executado', descricao: 'NOVO', qtd: 3, unidade: 'UN', encarregado_nome: 'Zé', data: '2026-10-12' }
    ];
    t.sb.sotRenderListaValidacoes(PL, rows);
    const lista = t.els['sot-validacoes-campo'].innerHTML;
    t.sb._sotLancamentosPend = rows.slice();
    t.el('val-qtd-l1').value = '1';
    t.sb.sotValidarLancamento('l1', PL, true);
    t.el('val-qtd-l3').value = '3';
    t.sb.sotValidarLancamento('l3', PL, true);
    const a1 = t.sb.sot_atividades.find(a => a.id === 'a1');
    // id temporário da atividade criada usa Date.now() ('sa'+tempo): normalizado para comparar
    return { lista, update: t.log.update.map(u => ({ t: u.t, f: String(u.f).replace(/\.sa\d+$/, '.saX'), p: Object.assign({}, u.p, { validado_em: u.p.validado_em ? 'X' : undefined }) })),
      insert: t.log.insert, a1: a1.qtd_executada, confirm: t.log.confirm, toast: t.log.toast };
  },
  async jornada(v) {
    const t = S.montar(v.html, v.jornada);
    const base = { fases: [], contexto: { atividades: { known: true } }, resumo: { qtd: 0 } };
    const r = [t.sb.jornadaObterProximaAcao({ id: PL }, base)];
    t.sb.jornadaExecutarAcao({ id: 'importar_lista' }, { id: PL });
    return r;
  }
};

(async () => {
  for (const nome of Object.keys(CENARIOS)) {
    let a, d;
    try { a = await CENARIOS[nome](antes); } catch (e) { a = 'ERRO: ' + e.message; }
    try { d = await CENARIOS[nome](depois); } catch (e) { d = 'ERRO: ' + e.message; }
    const ja = JSON.stringify(a), jd = JSON.stringify(d);
    ok('legado idêntico antes × depois: ' + nome, ja === jd && !/^"ERRO/.test(ja), ja === jd ? ja.slice(0, 300) : { antes: ja.slice(0, 400), depois: jd.slice(0, 400) });
    ok('cenário exercita a tela: ' + nome, ja.length > 40, ja.slice(0, 200));
  }
  if (failed.length) {
    console.log(`proj-wl-legado-paridade: FALHOU ${failed.length}/${total}`);
    for (const f of failed) console.log('  - ' + f);
    process.exit(1);
  }
  console.log(`proj-wl-legado-paridade: OK (${total} verificações, base ${BASE})`);
})().catch(e => { console.error(e); process.exit(1); });
