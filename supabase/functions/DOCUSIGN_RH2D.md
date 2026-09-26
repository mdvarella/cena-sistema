# DocuSign Edge Functions — ERP CENA RH-2D

## Deploy controlado Recovery-3

Somente estas Edges (nesta ordem). Sem frontend. Sem envelope.

```bash
supabase functions deploy docusign-create-envelope
supabase functions deploy docusign-envelope-status
supabase functions deploy docusign-download-completed
supabase functions deploy docusign-webhook --no-verify-jwt
```

Webhook Connect permanece público (HMAC via `DOCUSIGN_CONNECT_SECRET`, fail-closed).

Não incluir `rh-documento-assinado-url` neste passo (fora do Recovery-3).

Após o deploy: **somente** diagnóstico — `POST docusign-envelope-status` `{ "acao": "diagnostico" }` com sessão RH. Sem create-envelope.

## Secrets (Vault — NUNCA no frontend)

Conferência Dashboard 26/09/2026 (nomes apenas):

| Secret | Dashboard | Uso |
|--------|-----------|-----|
| `DOCUSIGN_INTEGRATION_KEY` | PRESENTE | Integration Key (JWT Grant) |
| `DOCUSIGN_USER_ID` | PRESENTE | Usuário impersonado |
| `DOCUSIGN_PRIVATE_KEY` | PRESENTE | RSA PEM da assertion |
| `DOCUSIGN_ACCOUNT_ID` | PRESENTE | Account ID |
| `DOCUSIGN_AMBIENTE` | PRESENTE | `DEMO` ou `PRODUCAO` |
| `DOCUSIGN_SMS_ENABLED` | PRESENTE | SMS da conta |
| `DOCUSIGN_CONNECT_SECRET` | PRESENTE | HMAC Connect (obrigatório) |
| `DOCUSIGN_BASE_URI` | AUSENTE | Opcional; obter via userinfo |
| `DOCUSIGN_ACCESS_TOKEN` | AUSENTE | Legado. **Não criar.** Fora do fluxo oficial. |

## Webhook URL

`https://<PROJECT_REF>.supabase.co/functions/v1/docusign-webhook`

DocuSign Connect → JSON → eventos sent/delivered/completed/declined/voided/expired.

## SQL

Aplicar manualmente: `SQLS/sql_rh_assinatura_digital_kits_fase_2d.sql`

Bucket privado (PDF/certificado finais): `SQLS/sql_rh_assinatura_digital_bucket_privado_fase_2d.sql` — cria `cena-rh-assinados` com `public=false`. Não altera `cena-docs`.

Marcar em `rh_assinatura_digital_config`: `ativo`, `ambiente`, `sms_disponivel`, `conta_rotulo` (sem secrets).
