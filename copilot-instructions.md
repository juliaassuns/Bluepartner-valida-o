---
description: "BluePartner - Rapid tenant integration and GDAP deployment automation"
applyTo:
  - "**/*.js"
  - "**/*.json"
  - ".env*"
  - "*.md"
capabilities:
  - "azure-integration"
  - "gdap-setup"
  - "deployment-automation"
  - "troubleshooting"
---

# BluePartner Copilot Configuration

This file configures GitHub Copilot's behavior when working on the BluePartner project.

## Agent Activation Patterns

The agent activates when:
- User asks about **Azure AD setup** for BluePartner
- User requests help with **GDAP relationship** configuration
- User needs to **deploy** to Azure App Service
- User encounters **errors** in `.env` or database connectivity
- User needs a **checklist** for tenant onboarding

## Knowledge Base Files

The agent references:
- `.instructions.md` - Detailed technical checklist and troubleshooting guide
- `.prompt.md` - Agent persona and communication style
- `DEPLOY_PRODUCTION.md` - Azure deployment guide
- `README.md` - Project overview and quick start
- `CHECKLIST_DEPLOY_TI.md` - Operational checklist
- `.env.example` - Template for environment variables

## Tool Restrictions

**Always allowed:**
- ✅ Read `.env.example` and `.env` (for diagnostic purposes)
- ✅ Run `npm` commands for setup/testing
- ✅ Suggest edits to documentation
- ✅ Provide Azure/PowerShell commands

**Requires explicit approval:**
- ⚠️ Creating new database migrations
- ⚠️ Modifying authentication flow
- ⚠️ Changing GDAP request logic

**Never do:**
- ❌ Run destructive commands (`rm`, `delete`, `drop`) without explicit yes/no confirmation
- ❌ Suggest storing secrets in `.env` committed to git
- ❌ Skip test validation before recommending production deploy

## Diagnostic Commands

When user reports issues, suggest these in order:

```bash
# 1. Check Node/npm
node --version && npm --version

# 2. Validate dependencies
npm list | grep -E "(express|mssql|@azure|jose)"

# 3. Check database
npm run pedidos

# 4. Review logs
npm run logs

# 5. Run test suite
npm test

# 6. Test local API
curl http://localhost:3000/api/health

# 7. Check Azure CLI
az --version && az account show
```

## Workflow: "Integrate into my tenant"

When user requests this, follow this strict order:

### Phase 1: Local Verification (5 min)
```
1. Check Node 18+, npm
2. npm install && npm run seed
3. npm start (verify http://localhost:3000 works)
4. npm test (all tests pass)
```

### Phase 2: Azure AD Setup (10 min)
```
1. Create app registration in Entra ID
   - App type: Web app
   - Redirect URIs: http://localhost:3000 (dev), https://[app-service-name].azurewebsites.net (prod)
   - API Permissions: Microsoft Graph → DelegatedAdminRelationship.Read.All, Calendars.Read
2. Create client secret (copy immediately)
3. Copy to .env: AZURE_AD_CLIENT_ID, AZURE_AD_CLIENT_SECRET, AZURE_AD_TENANT_ID
4. Test locally: npm start, verify auth flow
```

### Phase 3: GDAP & Partner Center (15 min)
```
1. Go to Partner Center → Admin agents & resellers → Relationships
2. Create invitation for test customer
3. Get GDAP_RELATIONSHIP_ID from invitation
4. Add to .env: GDAP_RELATIONSHIP_ID, GDAP_CUSTOMER_ID
5. Verify via API: curl http://localhost:3000/api/gdap/status
```

### Phase 4: Azure Infrastructure (20 min)
```
1. Create Azure SQL Database (see DEPLOY_PRODUCTION.md)
2. Get connection string
3. Create resource group + App Service (Node 20 LTS)
4. Add .env vars: AZURE_SQL_CONNECTION_STRING, SESSION_SECRET, CORS_ORIGIN
5. Deploy: az webapp up --name bluepartner-validacao --resource-group rg-bluepartner
```

### Phase 5: Validation & Monitoring (10 min)
```
1. Test production endpoint
2. Verify logs via https://[app-service-name].scm.azurewebsites.net/api/logs/stream
3. Set up Application Insights + alerting
4. Final smoke test with test customer link
```

## Common User Intents & Responses

| Intent | Response Pattern | Tools Used |
|--------|-----------------|-----------|
| "Help me set up in Azure" | → Run Phase 1-4 workflow above | npm, az CLI, PowerShell |
| "My GDAP isn't working" | → Check env vars → Run diagnostic → Suggest Partner Center fix | curl, npm run logs |
| "Deploy to production" | → Validate setup → Run DEPLOY_PRODUCTION.md checklist → az deploy | az, npm test |
| "I got [specific error]" | → Interpret error → Provide root cause → Fix command | File reads, npm run |
| "What endpoints exist?" | → Show API contract from README → Provide curl examples | File reads |
| "Troubleshoot database issue" | → Check connection string → Run npm run pedidos → Suggest retry logic | npm, file reads |

## Response Format Guidelines

**When providing setup steps:**
- Use numbered lists for sequential tasks
- Use code blocks with `powershell` tag (user is on Windows)
- Bold **critical values** like `AZURE_AD_CLIENT_ID`
- Provide validation commands at each step

**When explaining errors:**
- Explain the ROOT CAUSE (not just the symptom)
- Suggest the SIMPLEST FIX first
- Offer a DIAGNOSTIC COMMAND to verify the fix worked

**When recommending deployment:**
- Always require user to have run `npm test` locally first
- Require `.env.production` to be reviewed before pushing
- Require backup of existing Azure SQL (if upgrading)
- Show exact `az` command to copy-paste

## File Edits

If suggesting code changes:
- Always provide 3-5 lines of context before/after the change
- Use `.js` language tag in code blocks
- Include brief explanation of why the change is needed
- Suggest testing command after change

## Security Checklist

Before recommending "DEPLOY TO PRODUCTION", ensure:
- [ ] `.env.production` exists and has valid values (no defaults from `.example`)
- [ ] `SESSION_SECRET` is min 64 random characters
- [ ] Secrets are NOT in git (verify `.gitignore` includes `.env`)
- [ ] CORS_ORIGIN matches production domain exactly
- [ ] Azure SQL Database exists and is accessible
- [ ] Application Insights is enabled for monitoring
- [ ] GDAP relationship is established with intended customer(s)
- [ ] Rate limiting is set to production levels
- [ ] All `npm test` pass (zero failures)

---

**Last Updated**: May 2026  
**Maintainer**: BluePartner DevOps  
**Version**: 1.0
