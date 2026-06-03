Security Checklist & Rotation Steps

This document contains immediate security actions required before deploying to production, and a short message you can send to your Admins/Global Admins.

1) Immediately rotate committed secrets
- The repo contained sensitive values that have been redacted locally. Rotate the following secrets now:
  - ENTRA_CLIENT_SECRET (App Registration)
  - GDAP_CLIENT_SECRET (if any)
  - SESSION_SECRET
- Steps:
  - In Azure Portal > App Registrations > Your App > Certificates & secrets: create a new client secret and copy it.
  - In Azure Key Vault: store the new secret and reference it from App Service using `@Microsoft.KeyVault(SecretUri=...)`.
  - In App Service > Configuration: set necessary settings (ENTRA_*, GDAP_*, AZURE_SQL_CONNECTION_STRING). Do not paste secrets into source files.

2) Use Key Vault / App Settings / Managed Identity in production
- Do NOT store secrets in `.env` or in source control.
- Prefer Managed Identity for Azure SQL (Authentication=Active Directory Default) and Key Vault references for client secrets.

3) Session store recommendation
- Replace `session-file-store` in production with Azure Cache for Redis or a managed session provider.
- Example: set `REDIS_URL` in App Service and configure `connect-redis` in code.

4) CSP and inline scripts
- Remove inline JS from `public/*.html` and move to external JS files. Set `ALLOW_UNSAFE_INLINE_SCRIPTS=false` in production.
- If temporarily enabled for demo/testing, ensure `ALLOW_UNSAFE_INLINE_SCRIPTS=true` only in ephemeral environments.

5) Quick admin message (copy/paste)
---
Assunto: Liberação mínima necessária para integração BluePartner

Pessoal,

Para finalizar a integração do BluePartner com o tenant precisamos de uma ação de um Global Admin:
- Conceder consent (Admin consent) para a Application permission `TenantRelationships.ReadWrite.All` na App Registration do parceiro (ou executar o admin consent via portal).
- Se possível, subir o novo client secret ou criar um certificado e armazená-lo em Key Vault. O App Service usará Key Vault references.

Obs: já removemos valores sensíveis do repositório e precisamos que os segredos atuais sejam rotacionados.

Obrigado,
Equipe BluePartner
---

6) Post-rotation verification
- After rotating secrets, verify:
  - App Service can obtain secrets via Key Vault references
  - `SESSION_SECRET` is set and >=64 chars
  - Health endpoint `/api/health` returns 200


