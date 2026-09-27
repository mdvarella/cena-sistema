# DOCUSIGN-RECOVERY-6.0 — Fechamento da homologação DEMO

Homologação ponta a ponta encerrada em 26/09/2026 (ambiente **DEMO**).  
Este documento descreve o estado recuperado. **Não é autorização de promoção para PRODUÇÃO.**

Não contém valores de secrets, chaves, tokens, HMAC, JWT ou senhas.

## Arquitetura final

```
ERP CENA (index.html, motor DOC-CORE)
        │  sessão Auth JWT + perfil RH (usuarios_sistema)
        ▼
docusign-create-envelope     → JWT Grant → DocuSign DEMO /envelopes
docusign-envelope-status     → status | void | acao=diagnostico
docusign-download-completed  → fallback de finalização (não usado no happy path)
docusign-webhook             → Connect HMAC → finalizarEnvelopeDocusign
        │
        ▼
rh_documento_envelopes
rh_contratacao_documentos_gerados   (hash_sha256 = HTML gerado, imutável)
bucket cena-rh-assinados            (PDF assinado + certificado)
rh_colaborador_documentos           (Dossiê, referencia_modulo RH-ASSINATURA-DIGITAL)
```

Motor documental (classe, nunca por documento/usuário):

- tokens de negócio `[[TOKEN]]` resolvidos e snapshotados;
- markers técnicos `[[DS_*]]` reconhecidos, **não** resolvidos, **não** entram em `snapshot_tokens`, permanecem literais no HTML congelado.

## JWT Grant

Fluxo oficial: RS256, scopes `signature` + `impersonation`.  
`aud` = hostname do auth (sem `https://`).  
Token obtido em runtime; **não** existe `DOCUSIGN_ACCESS_TOKEN` no fluxo oficial.  
Diagnóstico: `POST docusign-envelope-status` `{ "acao": "diagnostico" }` → userinfo. Sem create de envelope.

## Secrets esperados (somente nomes)

| Nome | Papel |
|------|--------|
| `DOCUSIGN_INTEGRATION_KEY` | Integration Key (JWT Grant) |
| `DOCUSIGN_USER_ID` | Usuário impersonado |
| `DOCUSIGN_PRIVATE_KEY` | RSA PEM da assertion |
| `DOCUSIGN_ACCOUNT_ID` | Account ID |
| `DOCUSIGN_AMBIENTE` | `DEMO` ou `PRODUCAO` |
| `DOCUSIGN_SMS_ENABLED` | SMS da conta |
| `DOCUSIGN_CONNECT_SECRET` | HMAC Connect (fail-closed se ausente) |
| `DOCUSIGN_BASE_URI` | Opcional; userinfo pode fornecer |

`DOCUSIGN_ACCESS_TOKEN`: legado. **Não criar.** Fora do fluxo oficial.

## Contrato de âncoras técnicas DS_*

```
[[DS_ASSINATURA_EMPREGADO]]
[[DS_ASSINATURA_EMPRESA]]
[[DS_ASSINATURA_TESTEMUNHA]]
[[DS_DATA_ASSINATURA]]
```

`[[DATA_ASSINATURA]]` permanece token de negócio (preenchimento de contrato). Não é âncora DocuSign.

Exigência no create: somente papéis **enviados** + `[[DS_DATA_ASSINATURA]]`.

| Papel | Âncoras |
|-------|---------|
| EMPREGADO | `DS_ASSINATURA_EMPREGADO` + `DS_DATA_ASSINATURA` |
| EMPRESA | `DS_ASSINATURA_EMPRESA` + `DS_DATA_ASSINATURA` |
| TESTEMUNHA | `DS_ASSINATURA_TESTEMUNHA` + `DS_DATA_ASSINATURA` |

## Fluxo de criação

1. Documento `APROVADO_PARA_ASSINATURA` (DOC-CORE).
2. `docusign-create-envelope` com destinatários reais (homologação: 1× EMPREGADO).
3. Persistência local `pending-<documento_id>` / `ENVIANDO`, depois `provider_envelope_id` DocuSign e `ENVIADO`.
4. Documento → `AGUARDANDO_ASSINATURA`.
5. `conteudo_html`, `snapshot_tokens` e `hash_sha256` **não** são recalculados.

## Idempotência

- Envelope ativo (provider id real, não `pending-`) → `409 envelope_ativo_existente`. Sem segundo create.
- `pending-` reutilizado se a chamada anterior parou antes do provider.
- Eventos Connect: `provider_event_id` único; duplicata ignorada.
- `finalizarEnvelopeDocusign` é idempotente se PDF/hash/Dossiê já existirem.

## Connect / HMAC

URL: `https://qxexyghcennllrmjqafg.supabase.co/functions/v1/docusign-webhook`  
`verify_jwt=false`. HMAC no raw body (`X-DocuSign-Signature-1`), hex **ou** Base64. Fail-closed.

`envelope-completed` dispara finalização.  
`recipient-completed` ≠ conclusão do envelope.

## Finalização

`finalizarEnvelopeDocusign`:

- baixa PDF combinado + certificado;
- grava `cena-rh-assinados`;
- `hash_documento_final` = SHA-256 do PDF (64 hex);
- **não** sobrescreve `hash_sha256` do HTML;
- Dossiê em `rh_colaborador_documentos`;
- documento → `ASSINADO` e, com colaborador, `ARQUIVADO_DOSSIE`.

## Hash HTML vs hash PDF

| Campo | Artefato |
|-------|----------|
| `hash_sha256` | HTML congelado na geração (DOC-CORE) |
| `hash_documento_final` | PDF assinado DocuSign |

São hashes distintos e ambos obrigatórios. O HTML original deve permanecer intacto após a assinatura.

## Dossiê

`referencia_modulo` = `RH-ASSINATURA-DIGITAL`  
`referencia_id` = `documento_gerado_id`  
Sem colaborador: `precisa_arquivar_dossie=true` e o documento fica `ASSINADO`.

## Edges homologadas (projeto `qxexyghcennllrmjqafg`)

| Função | Versão | JWT | Papel |
|--------|--------|-----|-------|
| `docusign-create-envelope` | v4 ACTIVE | sim | Criar envelope |
| `docusign-envelope-status` | v3 ACTIVE | sim | Status, void, **diagnostico** |
| `docusign-download-completed` | v4 ACTIVE | sim | Fallback de download/finalização |
| `docusign-webhook` | v5 ACTIVE | não | Connect + HMAC + finalização |

`docusign-diagnostico-recovery` era Edge temporária de recuperação OAuth. **Removida em Recovery-6.1** (projeto e pasta local). Diagnóstico oficial permanece em `docusign-envelope-status` `{ "acao": "diagnostico" }`. DEMO homologado. PRODUÇÃO ainda **não** homologada.

## Homologação DEMO (26/09/2026)

| Item | Valor |
|------|--------|
| Modelo | CTR-CLT-TESTE **v3** (somente homologação; não promover a produtivo) |
| CTR-CLT-CENA | **não alterado** |
| documento_gerado_id | `c538b97c-8d3b-4e70-9dbf-53429b7a0833` |
| envelope local | `062a980c-9580-4cc2-a1f0-f29105996acd` |
| provider envelope | `97f02de7-5f38-83d4-805d-5bbfe09c1a1a` |
| Recipient | EMPREGADO / EMAIL / homologação |
| status_envelope | COMPLETED |
| status_documento | ARQUIVADO_DOSSIE |
| hash HTML | `f85c124dbc39355610b234ec696f33a01fff37deb6123247aab07843f9788194` |
| hash PDF | `b2f8318423f9525d76cff5bb6d4a4cef6b564c22e19c572ac09d3a1e60f0d73d` |
| PDF | `rh/docusign/62f1002e-f452-4ab6-a31d-bd91a2a0367c/062a980c-9580-4cc2-a1f0-f29105996acd/assinado.pdf` |
| Certificado | sim |
| Dossiê | sim (`a21c89c4-d8cd-4693-9698-816ca4288f2c`) |

Documentos históricos **intactos** (não regenerar, não âncorar):

- `46883cae-d059-4939-8ddf-d82d5b9621fb` (CTR-CLT-CENA v1, hash legado `err_*`)
- `c963d403-ff4a-4464-b8ab-3c44f1956ba1` (CTR-CLT-TESTE v1, hash legado `err_*`)

## Produção (não executar nesta fase)

Não alterar agora: `DOCUSIGN_AMBIENTE`, `DOCUSIGN_ACCOUNT_ID`, `DOCUSIGN_BASE_URI`, Integration Key, User ID, Private Key, Connect, HMAC.

Lista futura DEMO → PRODUÇÃO (checklist, sem execução):

1. Conta DocuSign **produção** distinta (IK, User ID, consentimento JWT, Account ID).
2. Private key de produção no Vault (nome igual; valor novo).
3. `DOCUSIGN_AMBIENTE=PRODUCAO` e Account ID de produção.
4. `DOCUSIGN_BASE_URI` de produção (ou userinfo de produção).
5. Connect de produção apontando para o webhook; HMAC de produção no Vault.
6. Nova versão **publicada** de modelo operacional com `DS_*` (não usar CTR-CLT-TESTE; não alterar histórico).
7. Homologação controlada em produção (um envelope, um recipient) antes de uso geral.
8. Confirmar `acao=diagnostico` em PRODUÇÃO antes do primeiro envelope.

## Git no fechamento

Branch `feature/docusign-recovery`. Motor DS_* no commit `4dcd7d5`.  
Recovery-6.1: limpeza da Edge temporária + documentação. Sem merge em `main` neste fechamento.
