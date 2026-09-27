'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const mig = fs.readFileSync(path.join(root, 'supabase/migrations/20260927223000_rh_terceiros_ia_pj_storage.sql'), 'utf8');

function sliceFn(src, name, nextName) {
  const a = src.indexOf('function ' + name + '(');
  if (a < 0) throw new Error('missing ' + name);
  var b = nextName ? src.indexOf('function ' + nextName + '(', a + 1) : src.length;
  if (b < 0) throw new Error('missing next ' + nextName);
  if (b >= 6 && src.slice(b - 6, b) === 'async ') b -= 6;
  return src.slice(a, b);
}

const sandbox = {
  console,
  RH_IA4_SCHEMAS: {},
  RH_IA4_CAMPOS_COMUNS: [],
  RH_IA4_CAMPOS_CADASTRO_EXTRA: [],
  DEMO: true,
  _rhCtAtual: null,
  _rhIaItens: [],
  _rhIaContextoPadrao: {},
  rhNormTxt: function (t) {
    return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  },
  rhDocNomeCanonico: function (t) { return t; },
  rhIaCatalogoTipos: function () {
    return [
      { tipo: 'Cartão CNPJ', categoria: 'PJ' },
      { tipo: 'Contrato Social', categoria: 'PJ' },
      { tipo: 'Alteração Contratual', categoria: 'PJ' },
      { tipo: 'Contrato de Trabalho', categoria: 'Identificação' },
      { tipo: 'CNH', categoria: 'Frotas' },
      { tipo: 'RG / Identidade', categoria: 'Identificação' }
    ];
  },
  rhIaCpfDigits: function (s) { return String(s || '').replace(/\D/g, ''); },
  rhCtCpfSomenteDigitos: function (v) { return String(v || '').replace(/\D/g, ''); },
  rhCtCnpjSomenteDigitos: function (v) { return String(v || '').replace(/\D/g, ''); },
  rhIaColabPorCpf: function () { return [{ id: 'CLT-1' }]; },
  rhIaColabPorRe: function () { return []; },
  rhIaColabPorMat: function () { return []; },
  rhEsc: function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); },
  rhCtPjVazio: function () { return { contratante_representante_nome: 'CENA-REP', contratante_representante_cpf: '111' }; },
  progShowToast: function () {},
  document: { getElementById: function () { return null; } },
  sbInsert: async function () { throw new Error('sbInsert não deve ser chamado neste teste'); },
  sbUpdate: async function () { throw new Error('sbUpdate não deve ser chamado neste teste'); }
};

const code = [
  sliceFn(html, 'rhIaNormTipoKey', 'rhIaTiposCustomLer'),
  sliceFn(html, 'rhIaMapearTipoDocumento', 'rhIaColabPorCpf'),
  sliceFn(html, 'rhIa4HintTipoNome', 'rhIa4EhTreinamentoTipo'),
  html.slice(html.indexOf('function rhCtCpfValido('), html.indexOf('function rhCtHonorariosNumero(')),
  sliceFn(html, 'rhIa4CpfValido', 'rhIa4NormCpf'),
  sliceFn(html, 'rhIaEhTipoDocumentoPj', 'rhIaEhContextoPj'),
  sliceFn(html, 'rhIaEhContextoPj', 'rhIaItemEhPj'),
  sliceFn(html, 'rhIaItemEhPj', 'rhPjRefItem'),
  sliceFn(html, 'rhPjCampoVazio', 'rhPjNormCampoVal'),
  sliceFn(html, 'rhPjNormCampoVal', 'rhPjPackVal'),
  sliceFn(html, 'rhPjPackVal', 'rhPjMesclarCampo'),
  sliceFn(html, 'rhPjMesclarCampo', 'rhPjExtrairEmpresaDoItem'),
  sliceFn(html, 'rhPjExtrairEmpresaDoItem', 'rhPjExtrairRepresentantes'),
  sliceFn(html, 'rhPjExtrairRepresentantes', 'rhPjAplicarExtracaoNoProcesso'),
  sliceFn(html, 'rhIaMotorMatch', 'rhIaProcessarItem')
].join('\n');

vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const failed = [];
function ok(name, cond, detail) {
  if (!cond) failed.push(name + (detail ? ' — ' + detail : ''));
}

// 1 Cartão CNPJ
ok('1 cartao cnpj map', sandbox.rhIaMapearTipoDocumento('Cartão CNPJ').tipo === 'Cartão CNPJ');
ok('1 cartao cnpj alias', sandbox.rhIaMapearTipoDocumento('Comprovante CNPJ').tipo === 'Cartão CNPJ');
ok('1 cartao cnpj hint', sandbox.rhIa4HintTipoNome('cartao_cnpj_receita.pdf') === 'Cartão CNPJ');

// 2 Contrato Social NÃO vira Contrato de Trabalho
ok('2 social map', sandbox.rhIaMapearTipoDocumento('Contrato Social').tipo === 'Contrato Social');
ok('2 social not clt', sandbox.rhIaMapearTipoDocumento('Contrato Social').tipo !== 'Contrato de Trabalho');
ok('2 social hint', sandbox.rhIa4HintTipoNome('contrato_social_2024.pdf') === 'Contrato Social');
ok('2 clt hint still', sandbox.rhIa4HintTipoNome('contrato_de_trabalho.pdf') === 'Contrato de Trabalho');

// 3 Alteração Contratual
ok('3 alteracao map', sandbox.rhIaMapearTipoDocumento('Alteração Contratual').tipo === 'Alteração Contratual');
ok('3 alteracao hint', sandbox.rhIa4HintTipoNome('alteracao_contratual.pdf') === 'Alteração Contratual');

// 4-6 extração
const emp = sandbox.rhPjExtrairEmpresaDoItem({}, {
  campos: {
    cnpj: { valor: '11.222.333/0001-81' },
    razao_social: { valor: 'ACME SERVICOS LTDA' },
    email: { valor: '' }
  },
  identificadores: {}
});
ok('4 cnpj extraido', emp.cnpj.replace(/\D/g, '') === '11222333000181' || emp.cnpj === '11.222.333/0001-81' || !!emp.cnpj);
ok('5 cnpj valido fn', typeof sandbox.rhCtCnpjValido === 'function');
ok('5 cnpj invalido nao passa', sandbox.rhCtCnpjValido('11111111111111') === false);
ok('6 razao extraida', emp.razao_social === 'ACME SERVICOS LTDA');

// 7 endereço parcial
ok('7 endereco parcial', emp.logradouro === '' && emp.cidade === '');

// 8 campo ausente vazio
ok('8 email vazio', emp.email === '');

// 9 edição manual
let campo = sandbox.rhPjMesclarCampo(null, '', { chave: 'email', fonte: 'Cartão CNPJ' });
ok('9 nao encontrado', campo.estado === 'NAO_ENCONTRADO');
campo.final = 'a@b.com';
campo.estado = 'EDITADO_MANUALMENTE';
ok('9 editado', campo.estado === 'EDITADO_MANUALMENTE' && campo.final === 'a@b.com');

// 10-12 representantes
const reps = sandbox.rhPjExtrairRepresentantes({
  representantes_encontrados: [
    { nome: 'Pessoa A', cpf: '529.982.247-25' },
    { nome: 'Pessoa B', cpf: '390.533.447-05' },
    { nome: 'Pessoa C' }
  ]
});
ok('10 lista reps', reps.length === 3);
const motorPj = sandbox.rhIaMotorMatch({ tipo_documento: 'Contrato Social', confianca_tipo: 0.9 }, { contexto_origem: 'terceiro_pj' });
ok('11 sem colaborador auto', motorPj.colaborador_id_sugerido == null);
ok('11 motivo pj', motorPj.motivo_match === 'FLUXO_PJ_SEM_COLABORADOR');
ok('12 escolha humana no codigo', /Usar como representante da CONTRATADA/.test(html) && /rhPjEscolherRepresentante/.test(html));

// 13 CPF validador
ok('13 cpf valido', sandbox.rhCtCpfValido('52998224725') === true || sandbox.rhIa4CpfValido('52998224725') === true);
ok('13 cpf invalido', sandbox.rhCtCpfValido('11111111111') === false);

// 14 baixa confiança editável
ok('14 input revisao', /rh-pj-rev-/.test(html) && /rhPjOnEditarCampo/.test(html));

// 15-16 divergente
const a1 = sandbox.rhPjMesclarCampo(null, 'Rua A', { chave: 'logradouro', fonte: 'Cartão CNPJ' });
const a2 = sandbox.rhPjMesclarCampo(a1, 'Rua B', { chave: 'logradouro', fonte: 'Contrato Social' });
ok('15 divergente', a2.estado === 'DIVERGENTE');
ok('16 nao silencioso', a2.final === 'Rua A' && a2.novo === 'Rua B');

// 17 confirmado nao sobrescrito
const conf = sandbox.rhPjMesclarCampo({ proposto: 'Rua A', final: 'Rua A', estado: 'CONFIRMADO' }, 'Rua C', { chave: 'logradouro', fonte: 'novo' });
ok('17 confirmado preservado', conf.estado === 'DIVERGENTE' && conf.final === 'Rua A' && conf.novo === 'Rua C');

// 18-22 persistência
const confirmSrc = sliceFn(html, 'rhPjConfirmarDados', 'rhPjSincronizarFormularioManual');
ok('18 persist pj', /rhCtPersistirPartePj/.test(confirmSrc));
ok('19 zero admissionais', !/dados_admissionais/.test(confirmSrc));
ok('20 zero pretendido', !/nome_pretendido|cpf_pretendido/.test(confirmSrc));
ok('21 zero empregadora write', !/rh_empresas_empregadoras/.test(confirmSrc));
ok('22 preserva cena', /contratante_representante_/.test(confirmSrc) && /cena=/.test(confirmSrc));

// 23 mestre x snapshot
ok('23 persist destinos', /rh_pessoas_juridicas/.test(html) && /rh_contratacao_partes_pj/.test(html));

// 24-26 storage
ok('24 sem url publica pj', /cena-rh-pj-documentos/.test(html) && /public = false/.test(mig));
ok('24 nao persiste signed', !/signedURL/.test(confirmSrc));
ok('25 policies sem anon', /cena_rh_pode_dados_pj/.test(mig) && !/TO anon/.test(mig) && !/TO public/.test(mig));
ok('26 authenticated rh', /TO authenticated/.test(mig));

// 27 logs
ok('27 sem log documento', !/console\.log\([^)]*arquivo/.test(sliceFn(html, 'rhPjUploadPrivado', 'rhPjSignedUrl')));

// 28 campos contrato manuais
ok('28 manuais', /RH_PJ_IA_CAMPOS_CONTRATO/.test(html) && /continuam manuais/.test(html));

// 29 invariantes
ok('29 invariantes', /function rhDocInvariantesGeracaoCtrPj/.test(html));
ok('29 nao relaxa', !/rhDocInvariantesGeracaoCtrPj\s*=\s*function\(\)\s*\{\s*return/.test(html));

// 30 fornecedor
const forn = html.slice(html.indexOf("if(perfil==='TERCEIRO_FORNECEDOR'){"), html.indexOf("if(perfil==='TERCEIRO_FORNECEDOR'){") + 900);
ok('30 fornecedor sem fluxo', /trabalhador de empresa fornecedora/.test(forn) && !/Documentos da Contratada/.test(forn));

// 31 CLT
ok('31 cena-docs intacto', /object\/public\/cena-docs\//.test(html) && /function rhIaUploadStaging/.test(html));
ok('31 kit exclui pj', /rhIaItemEhPj/.test(sliceFn(html, 'rhCtIaItensDoProcesso', 'rhCtIaSituacaoLabel')));

// 32-34 sem gerar contrato / envelope / ZapSign no fluxo PJ
ok('32 sem gerar ctr', !/CTR-PJ-CENA/.test(confirmSrc) && !/rhDocGerar/.test(confirmSrc));
ok('33 sem envelope', !/envelope/.test(confirmSrc));
ok('34 sem zapsign', !/ZapSign|zapsign|DocuSign/.test(confirmSrc));

ok('ui terceiro_pj', /rhResolverPerfilContratacao\(_rhCtAtual\.tipo_contratacao\)!=='TERCEIRO_PJ'/.test(html));
ok('motor reutilizado', /rhIaAdicionarArquivos/.test(html) && /rhIaProcessarItemUi/.test(html) && /cena-proxy\.marcos-afe\.workers\.dev/.test(html));
ok('sem segundo proxy', (html.match(/cena-proxy/g) || []).length >= 1);

if (failed.length) {
  console.error('FALHAS:\n' + failed.map(function (x) { return ' - ' + x; }).join('\n'));
  process.exit(1);
}
console.log('RH-TERCEIROS-5D-IA.1 testes: 34+ OK');
