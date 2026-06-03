# BluePartner - Quick Start Guide for Copilot Agent

Este guia é **para o agente Copilot** usar como referência rápida quando o usuário pede ajuda.

## 🚀 Se o usuário disser: "Ajuda, quero integrar isso na minha tenant"

**Responda com esta sequência:**

```
1. ✅ Validar setup local (5 min)
2. 🔐 Configurar Azure AD (10 min)  
3. 🤝 Estabelecer GDAP (15 min)
4. 🗄️  Provisionar Azure SQL (20 min)
5. ☁️  Deploy em App Service (15 min)
6. 🧪 Testes e-2-e (10 min)
```

### Passo 1️⃣ : Validar Setup Local

**Comando para o usuário rodar:**

```powershell
.\validate-setup.ps1
```

Se falhar, forneça:
- Versão Node requerida: >= 18.0.0
- Comando: `node --version`
- Fix: `npm install && npm run seed`

**Validações críticas:**
- [ ] Node 18+
- [ ] npm 8+  
- [ ] `.env` arquivo existe
- [ ] `node_modules/` existe
- [ ] `data/bluepartner.db` existe (ou será criado com `npm run seed`)

---

### Passo 2️⃣ : Azure AD App Registration

**Ação**: Criar aplicação no Entra ID para OAuth2

**Link**: https://entra.microsoft.com/

**Passos:**
1. Entra ID → App registrations → New registration
2. Nome: `bluepartner-validacao`
3. Supported account types: "Accounts in this organizational directory only"
4. Redirect URI: `http://localhost:3000` (dev), `https://bluepartner-validacao.azurewebsites.net/` (prod later)
5. Copy `Application (client) ID` → .env `AZURE_AD_CLIENT_ID`
6. Copy `Directory (tenant) ID` → .env `AZURE_AD_TENANT_ID`
7. Certificates & secrets → New client secret → Copy value → .env `AZURE_AD_CLIENT_SECRET`
8. API Permissions → Add → Microsoft Graph → Delegated → `DelegatedAdminRelationship.Read.All`
9. Grant admin consent

**Validação:**
```bash
npm start
# Abrir http://localhost:3000 no navegador
# Verificar se login redireciona corretamente
```

---

### Passo 3️⃣ : GDAP Relationship (Partner Center)

**Ação**: Criar convite de delegação para cliente teste

**Link**: https://partner.microsoft.com/

**Passos:**
1. Partner Center → Account → Admin agents and resellers
2. Create invitation for a reseller or customer
3. Select "Granular delegated admin privileges"
4. Choose "License Administrator" role  
5. Provide customer tenant ID
6. Send invite → Copy `Relationship ID` da resposta
7. .env: `GDAP_RELATIONSHIP_ID=<relationship-id>`
8. .env: `GDAP_CUSTOMER_ID=<customer-tenant-id>`

**Validação:**
```bash
curl http://localhost:3000/api/gdap/status
# Deve retornar: { "relationship_id": "...", "status": "active" }
```

---

### Passo 4️⃣ : Azure SQL Database

**Ação**: Criar banco de dados para produção (SQLite é apenas dev)

**Link**: https://portal.azure.com/

**Passos:**
1. Portal → Azure SQL → Create SQL database
2. Server: Create new
   - Name: `bluepartner-sql-prod`
   - Location: East US
   - Authentication: Managed Identity (recomendado) ou SQL user
3. Database: Name `bluepartner_db`
4. Compute + storage: Basic tier (suficiente para teste)
5. ✅ Create
6. Após criação, ir a Connection strings
7. Copy ADO.NET connection string
8. .env: `AZURE_SQL_CONNECTION_STRING=Server=bluepartner-sql-prod.database.windows.net;...`

**Validação:**
```bash
# Após deploy (próximo passo)
npm run pedidos  # Deve conectar ao Azure SQL
```

---

### Passo 5️⃣ : Deploy em App Service

**Ação**: Publicar em Azure App Service

**Pre-requisito**: Azure CLI instalado  
`choco install azure-cli` ou `winget install Microsoft.AzureCLI`

**Passos:**

```powershell
# 1. Login no Azure
az login

# 2. Criar resource group (se não existir)
az group create --name rg-bluepartner --location eastus

# 3. Deploy via az webapp up
az webapp up `
  --name bluepartner-validacao `
  --resource-group rg-bluepartner `
  --runtime "NODE:20-lts" `
  --sku B1

# 4. Setar variáveis de ambiente
az webapp config appsettings set `
  --resource-group rg-bluepartner `
  --name bluepartner-validacao `
  --settings `
    NODE_ENV=production `
    AZURE_AD_CLIENT_ID="<app-id>" `
    AZURE_AD_CLIENT_SECRET="<secret>" `
    AZURE_AD_TENANT_ID="<tenant-id>" `
    AZURE_SQL_CONNECTION_STRING="<connection-string>" `
    SESSION_SECRET="<random-64-chars>" `
    CORS_ORIGIN="https://bluepartner-validacao.azurewebsites.net"

# 5. Verificar status
az webapp show --resource-group rg-bluepartner --name bluepartner-validacao
```

**Validação:**
```bash
# Testar endpoint de produção
curl https://bluepartner-validacao.azurewebsites.net/api/health
# Resposta esperada: { "status": "ok" }
```

---

### Passo 6️⃣ : Testes E2E

**Ação**: Validar fluxo completo (link → validação → redirect)

**Testes locais:**
```bash
npm test                # Todos
npm run test:api       # Apenas API
npm run test:db        # Apenas DB
```

**Testes de produção:**
1. Gerar link teste: `https://bluepartner-validacao.azurewebsites.net/?pedidoId=PED12345&token=xyz789&revenda=ingram`
2. Abrir no navegador → Validar renderização
3. Marcar checkbox → Clicar "Confirmar"
4. Verificar Partner Center redirect
5. Checar logs: `npm run logs`

---

## 🆘 Se Algo Quebrou...

| Erro | Diagnóstico | Fix |
|------|-------------|-----|
| "Cannot find module" | `node_modules` faltando | `npm install` |
| "ENOENT: no such file or directory" | `.env` faltando ou incorreto | `cp .env.example .env` + preencher vars |
| "401 Unauthorized GDAP" | Token/secret expirado | Renovar secret em Azure AD |
| "Connection timeout DB" | Connection string inválida | Testar: `npm run pedidos` |
| "CORS error no redirect" | CORS_ORIGIN mismatch | Verificar domínio exato em .env |

---

## 📋 Checklist Final

Antes de chamar de "completo":

- [ ] `npm test` passa (0 falhas)
- [ ] `npm start` funciona localmente
- [ ] `.env` preenchido (sem defaults)
- [ ] Azure AD app criado e secrets no lugar
- [ ] GDAP relationship estabelecido
- [ ] Azure SQL provisioned (ou fallback SQLite em dev)
- [ ] `az webapp up` executado com sucesso
- [ ] `curl https://[app-name].azurewebsites.net/api/health` retorna 200
- [ ] Link de teste funciona ponta-a-ponta

---

**Dica para Agente**: Se o usuário ficar preso em qualquer fase, rode:
```bash
.\validate-setup.ps1  # Local check
# + diagnóstico específico (npm run logs, curl, etc.)
```

Isso quase sempre aponta a raiz do problema em 30 segundos.
