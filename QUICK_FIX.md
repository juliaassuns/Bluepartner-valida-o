# 🔧 QUICK FIX - BluePartner Dados Não Persistem

## ✅ Para DESENVOLVIMENTO (Já Funciona)
```bash
npm start
# Usa SQLite local: ./data/bluepartner.db
```

## ⚠️ Para PRODUÇÃO (Azure App Service)

### OPÇÃO 1: SQL Server Persistente (⭐ Recomendado)

**1. No Portal do Azure:**
- App Service > Configuration > Application Settings
- Adicionar essas 3 variáveis:

```
NODE_ENV = production
AZURE_SQL_CONNECTION_STRING = Server=tcp:YOUR_SERVER.database.windows.net,1433;Initial Catalog=bluepartner;User ID=admin;Password=SenhaForte123!@#;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;
SESSION_SECRET = (gere com: openssl rand -hex 32)
```

**2. Na Azure CLI (se preferir):**
```bash
az webapp config appsettings set \
  --resource-group rg-bluepartner \
  --name bluepartner-validacao \
  --settings \
    NODE_ENV=production \
    AZURE_SQL_CONNECTION_STRING="Server=tcp:YOUR_SERVER.database.windows.net,1433;Initial Catalog=bluepartner;User ID=admin;Password=SenhaForte123!@#;Encrypt=True;TrustServerCertificate=False;" \
    SESSION_SECRET="$(openssl rand -hex 32)"
```

**3. Fazer deploy:**
```bash
az webapp up --name bluepartner-validacao --resource-group rg-bluepartner --runtime "NODE:20-lts"
```

**4. Verificar:**
```bash
# Ver logs
az webapp log tail --name bluepartner-validacao --resource-group rg-bluepartner

# Procurar por: "[DB] ✅ Conectado ao SQL Server"
```

### OPÇÃO 2: Managed Identity (Mais Seguro - Sem Senhas)

**1. Habilitar Managed Identity:**
```bash
az webapp identity assign \
  --resource-group rg-bluepartner \
  --name bluepartner-validacao \
  --identities SystemAssigned
```

**2. Connection String sem senha:**
```
Server=tcp:YOUR_SERVER.database.windows.net,1433;Initial Catalog=bluepartner;Authentication=Active Directory Default;Encrypt=True;TrustServerCertificate=False;
```

**3. Configurar Azure SQL para aceitar a identidade:**
```sql
-- Conectar como SQL Admin
CREATE USER [bluepartner-validacao] FROM EXTERNAL PROVIDER;
ALTER ROLE db_owner ADD MEMBER [bluepartner-validacao];
```

## 🧪 Testar

```bash
# Criar um pedido
curl -X POST https://seu-app.azurewebsites.net/api/pedidos \
  -H "Content-Type: application/json" \
  -d '{"cliente":"Teste","cnpj":"12.345.678/0001-90"}'

# Listar pedidos (deve mostrar o criado acima mesmo após redeploy!)
curl https://seu-app.azurewebsites.net/api/pedidos

# Verificar saúde
curl https://seu-app.azurewebsites.net/api/health
```

## 🔍 Verificar qual DB está em uso

Olhar nos logs da App Service:
- ✅ `[DB] ✅ Conectado ao SQL Server` = OK, usando SQL Server
- ⚠️  `[DB] Usando SQLite` = Fallback (não vai persistir em produção)

## 🚨 Se os dados ainda sumirem após redeploy

1. ✅ Confirmar `AZURE_SQL_CONNECTION_STRING` está definida:
```bash
az webapp config appsettings list \
  --resource-group rg-bluepartner \
  --name bluepartner-validacao \
  --query "[?name=='AZURE_SQL_CONNECTION_STRING'].value" -o tsv
```

2. ✅ Confirmar `NODE_ENV=production`:
```bash
az webapp config appsettings list \
  --resource-group rg-bluepartner \
  --name bluepartner-validacao \
  --query "[?name=='NODE_ENV'].value" -o tsv
```

3. ✅ Ver logs completos:
```bash
az webapp log tail \
  --name bluepartner-validacao \
  --resource-group rg-bluepartner \
  --provider application
```

4. ✅ Testar conexão ao SQL Server diretamente:
```bash
sqlcmd -S "YOUR_SERVER.database.windows.net" \
  -U "admin" \
  -P "SenhaForte123!@#" \
  -d "bluepartner" \
  -Q "SELECT COUNT(*) FROM pedidos"
```

## 📚 Documentação Completa

Ver: `DEPLOY_PRODUCTION.md`

---

**Resumo:** O app agora detecta automaticamente o banco a usar. Em produção, configure `AZURE_SQL_CONNECTION_STRING` e seus dados persistirão! 🎉
