# 🚀 Guia de Deploy - BluePartner para Produção (Azure)

## ⚠️ PROBLEMA DIAGNOSTICADO

O banco de dados **SQLite não persiste em produção** no Azure App Service porque:
1. ❌ Arquivo local é efêmero (apagado a cada redeploy)
2. ❌ Não há variável `AZURE_SQL_CONNECTION_STRING` configurada
3. ❌ App sempre cria um banco vazio ao iniciar

## ✅ SOLUÇÃO: SQL Server Persistente

### Passo 1: Criar Azure SQL Database

```bash
# Login no Azure
az login

# Criar resource group
az group create --name rg-bluepartner --location eastus

# Criar SQL Server
az sql server create \
  --resource-group rg-bluepartner \
  --name bluepartner-sqlserver \
  --admin-user dbadmin \
  --admin-password 'SenhaForte123!@#'

# Criar banco de dados
az sql db create \
  --resource-group rg-bluepartner \
  --server bluepartner-sqlserver \
  --name bluepartner \
  --edition Standard \
  --capacity 10
```

### Passo 2: Configurar Firewall

```bash
# Permitir acesso do Azure App Service
az sql server firewall-rule create \
  --resource-group rg-bluepartner \
  --server bluepartner-sqlserver \
  --name AllowAzure \
  --start-ip-address 0.0.0.0 \
  --end-ip-address 0.0.0.0
```

### Passo 3: Obter Connection String

```bash
# Gerar connection string
az sql db show-connection-string \
  --client sqlcmd \
  --resource-group rg-bluepartner \
  --server bluepartner-sqlserver \
  --name bluepartner
```

**Resultado esperado:**
```
Server=tcp:bluepartner-sqlserver.database.windows.net,1433;Initial Catalog=bluepartner;Persist Security Info=False;User ID=dbadmin;Password=<password>;MultipleActiveResultSets=False;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;
```

### Passo 4: Adicionar Variáveis de Ambiente no Azure App Service

**Via Azure CLI:**
```bash
az webapp config appsettings set \
  --resource-group rg-bluepartner \
  --name bluepartner-validacao \
  --settings \
    NODE_ENV=production \
    AZURE_SQL_CONNECTION_STRING="Server=tcp:bluepartner-sqlserver.database.windows.net,1433;Initial Catalog=bluepartner;User ID=dbadmin;Password=SenhaForte123!@#;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;" \
    SESSION_SECRET="$(openssl rand -hex 32)"
```

**Ou no Portal do Azure:**
1. App Service > Settings > Configuration
2. Application Settings
3. Adicionar:
   - `NODE_ENV` = `production`
   - `AZURE_SQL_CONNECTION_STRING` = sua connection string
   - `SESSION_SECRET` = seu valor seguro

### Passo 5: Deploy

```bash
# Fazer deploy
az webapp up \
  --name bluepartner-validacao \
  --resource-group rg-bluepartner \
  --runtime "NODE:20-lts"
```

### Passo 6: Verificar Logs

```bash
# Ver logs em tempo real
az webapp log tail --name bluepartner-validacao --resource-group rg-bluepartner

# Verificar saúde da app
curl https://bluepartner-validacao.azurewebsites.net/api/health
```

## 🔒 Alternativa Segura: Managed Identity (Recomendado)

Em vez de armazenar senha na connection string, use Managed Identity:

### 1. Habilitar Managed Identity
```bash
az webapp identity assign \
  --resource-group rg-bluepartner \
  --name bluepartner-validacao \
  --identities SystemAssigned
```

### 2. Conceder Permissões ao SQL Server
```bash
# Obter Object ID da app
OBJECT_ID=$(az webapp identity show \
  --resource-group rg-bluepartner \
  --name bluepartner-validacao \
  --query principalId -o tsv)

# Usar Azure AD admin do SQL
# 1. Conectar como SQL admin
# 2. Executar:
# CREATE USER [bluepartner-validacao] FROM EXTERNAL PROVIDER;
# ALTER ROLE db_owner ADD MEMBER [bluepartner-validacao];
```

### 3. Connection String com Managed Identity
```
Server=tcp:bluepartner-sqlserver.database.windows.net,1433;Initial Catalog=bluepartner;Authentication=Active Directory Default;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;
```

## ✅ Testar após Deploy

```bash
# 1. Criar um novo pedido
curl -X POST https://bluepartner-validacao.azurewebsites.net/api/pedidos \
  -H "Content-Type: application/json" \
  -d '{"cliente":"Teste","cnpj":"12345678000190"}'

# 2. Listar pedidos
curl https://bluepartner-validacao.azurewebsites.net/api/pedidos

# 3. Ver logs do banco
az webapp log tail --name bluepartner-validacao --resource-group rg-bluepartner
```

## 🔄 Rollback para SQLite (Desenvolvimento)

Se precisar voltar para desenvolvimento:
```bash
# Remover AZURE_SQL_CONNECTION_STRING
az webapp config appsettings delete \
  --resource-group rg-bluepartner \
  --name bluepartner-validacao \
  --setting-names AZURE_SQL_CONNECTION_STRING

# Mudar para NODE_ENV=development
az webapp config appsettings set \
  --resource-group rg-bluepartner \
  --name bluepartner-validacao \
  --settings NODE_ENV=development
```

## 📊 Monitoramento

```bash
# Ativar Application Insights
az webapp config appsettings set \
  --resource-group rg-bluepartner \
  --name bluepartner-validacao \
  --settings APPINSIGHTS_INSTRUMENTATIONKEY="seu-key"

# Ver métricas
az monitor app-insights metrics show \
  --resource-group rg-bluepartner \
  --app bluepartner-insights \
  --metric RequestsCount
```

## 🐛 Troubleshooting

### App não conecta ao SQL
```bash
# Ver logs
az webapp log tail --name bluepartner-validacao --resource-group rg-bluepartner

# Verificar string de conexão
az webapp config appsettings list \
  --resource-group rg-bluepartner \
  --name bluepartner-validacao \
  --query "[?name=='AZURE_SQL_CONNECTION_STRING']"
```

### Timeout de conexão
- Verificar firewall do SQL: `az sql server firewall-rule list ...`
- Aumentar `Connection Timeout` na string (padrão: 30s)

### Dados desaparecendo entre deploys
- Confirmar que `AZURE_SQL_CONNECTION_STRING` está definido
- Verificar que `NODE_ENV=production`
- Checar logs: `[DB] ✅ Conectado ao SQL Server`

