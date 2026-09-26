# DocuSign Edge Functions — ERP CENA RH-2D

## Deploy

```bash
supabase functions deploy docusign-create-envelope
supabase functions deploy docusign-envelope-status
supabase functions deploy docusign-download-completed
supabase functions deploy rh-documento-assinado-url
supabase functions deploy docusign-webhook --no-verify-jwt
```

`rh-documento-assinado-url` exige JWT (NÃO usar `--no-verify-jwt`). Signed URL: 90 segundos, bucket `cena-rh-assinados`.

Webhook Connect deve ser público (HMAC via `DOCUSIGN_CONNECT_SECRET`).

## Secrets (Vault / Function secrets — NUNCA no frontend)

| Secret | Uso |
|--------|-----|
| `DOCUSIGN_INTEGRATION_KEY` | Integration Key (OAuth JWT Grant) |
| `DOCUSIGN_USER_ID` | GUID do usuário impersonado |
| `DOCUSIGN_PRIVATE_KEY` | RSA private key PEM (JWT assertion) |
| `DOCUSIGN_ACCOUNT_ID` | Account ID |
| `DOCUSIGN_BASE_URI` | Opcional; senão demo/prod default |
| `DOCUSIGN_AMBIENTE` | `DEMO` ou `PRODUCAO` (default DEMO) |
| `DOCUSIGN_SMS_ENABLED` | `true` só se a conta tiver SMS |
| `DOCUSIGN_CONNECT_SECRET` | HMAC Connect (recomendado) |
| `DOCUSIGN_ACCESS_TOKEN` | Opcional: token estático só para smoke test |
| `SUPABASE_SERVICE_ROLE_KEY` | Já padrão nas Edge |

## Webhook URL

`https://<PROJECT_REF>.supabase.co/functions/v1/docusign-webhook`

DocuSign Connect → JSON → eventos sent/delivered/completed/declined/voided/expired.

## SQL

Aplicar manualmente: `SQLS/sql_rh_assinatura_digital_kits_fase_2d.sql`

Bucket privado (PDF/certificado finais): `SQLS/sql_rh_assinatura_digital_bucket_privado_fase_2d.sql` — cria `cena-rh-assinados` com `public=false`. Não altera `cena-docs`.

Marcar em `rh_assinatura_digital_config`: `ativo`, `ambiente`, `sms_disponivel`, `conta_rotulo` (sem secrets).
