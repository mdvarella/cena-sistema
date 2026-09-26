# _shared consolidado — DOCUSIGN-RECOVERY-3

Origem dos comportamentos (ZIPs implantados, sem inventar):

| Item | Export de origem | Decisão Recovery-3 |
|---|---|---|
| JWT Grant RS256 + scopes | create/status **e** webhook/download (iguais) | Mantido |
| `dsAuthBase` (URL token) | ambos | Mantido com `https://` |
| claim `aud` | ambos usavam URL completa | **Corrigido:** hostname sem protocolo (docs oficiais) |
| HMAC hex | create + status (4701 B) | Aceito **além** do Base64 |
| HMAC Base64 verify | webhook + download (4996 B) — Connect vivo | Aceito **além** do hex |
| HMAC secret ausente | ambos fail-open | **Corrigido:** fail-closed |
| Bucket / Dossiê constants | só webhook/download | Mantido |
| `finalizarEnvelopeDocusign` | webhook + download (hash idêntico) | Mantido + **não** sobrescreve `hash_sha256` |
| `DOCUSIGN_ACCESS_TOKEN` | ambos | Legado; fluxo oficial **não** usa |
| `dsBaseUri` / na4 | ambos fixavam na4 em produção | **DEMO:** demo ou userinfo. **PRODUÇÃO:** `DOCUSIGN_BASE_URI` ou userinfo; sem na4 universal |

Não apagar `supabase/functions/_from-zips/` — é o export bruto.
