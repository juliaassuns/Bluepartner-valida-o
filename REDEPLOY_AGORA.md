# 🚀 REDEPLOY IMEDIATO - BluePartner Validação

## ✅ O Problema
- `web.config` estava com configuração incorreta (rewrite para IIS)
- Isso impedia o Node.js Express de responder

## ✅ A Solução
- Corrigi o `web.config` para funcionar corretamente com Node.js no Azure

---

## 📋 PASSO 1: Verificar Environment Variables no Azure

Antes de fazer deploy, CONFIRME que estas variáveis estão setadas no Azure App Service:

```
NODE_ENV = production
PORT = 3000
CORS_ORIGIN = https://seu-dominio.com

SESSION_SECRET = [valor aleatório seguro - obrigatório]

ENTRA_TENANT_ID = [seu-tenant-id]
ENTRA_CLIENT_ID = [seu-client-id]
ENTRA_CLIENT_SECRET = [seu-client-secret]
ENTRA_REDIRECT_URI = https://seu-dominio.com/auth/callback

GDAP_TENANT_ID = [seu-tenant-id-csp]
GDAP_CLIENT_ID = [seu-client-id-csp]
GDAP_CLIENT_SECRET = [seu-client-secret-csp]
GDAP_PARTNER_NAME = Blue Partner

INGRAM_CLIENT_ID = [seu-ingram-id]
INGRAM_CLIENT_SECRET = [seu-ingram-secret]

TDS_CLIENT_ID = [seu-tds-id]
TDS_CLIENT_SECRET = [seu-tds-secret]

BOOTSTRAP_SUPERADMIN_EMAILS = seu-email@empresa.com

[OPCIONAL - Para Azure SQL]
AZURE_SQL_CONNECTION_STRING = Server=tcp:seu-servidor.database.windows.net,1433;Initial Catalog=bluepartner;User ID=user;Password=pass;Encrypt=True;
```

### Como adicionar no Azure Portal:
1. Acesse: Azure Portal → App Services → bluepartner-validacao → Settings → Configuration
2. Clique em "+ New application setting"
3. Adicione cada variável

---

## 📋 PASSO 2: Deploy via Azure CLI (Recomendado)

```bash
# Estar na pasta do projeto
cd c:\Users\JuliadaAssunçãoSilva\bluepartner-validacao

# Fazer deploy
az webapp up --name bluepartner-validacao --resource-group rg-bluepartner --runtime "NODE:20-lts"
```

**OU via PowerShell:**

```powershell
# Compactar projeto
Compress-Archive -Path .\* -DestinationPath deploy.zip -Force

# Upload para Azure
az webapp deployment source config-zip --resource-group rg-bluepartner --name bluepartner-validacao --src deploy.zip
```

---

## 📋 PASSO 3: Via Azure Portal (Mais Lento)

1. Abra Azure Portal
2. App Services → bluepartner-validacao
3. Deployment Center → Redeploy
4. OU: Acesse Kudu (bluePartner-validacao.scm.azurewebsites.net)
5. CMD → Acesse `/home/site/wwwroot` e delete tudo
6. Upload um novo ZIP

---

## 🔍 PASSO 4: Verificar se Funcionou

Após deploy, aguarde **2-3 minutos** para o App Service reiniciar.

### Testes:

```bash
# 1. Verificar se a app está respondendo
curl https://bluepartner-validacao.azurewebsites.net/

# 2. Verificar status HTTP
curl -I https://bluepartner-validacao.azurewebsites.net/

# 3. Ver logs em tempo real
az webapp log tail --resource-group rg-bluepartner --name bluepartner-validacao
```

---

## 🚨 Se Continuar Não Funcionando

### Debug:
1. **Ver logs do Azure:**
   ```bash
   az webapp log tail --resource-group rg-bluepartner --name bluepartner-validacao
   ```

2. **Verificar Health da app:**
   ```bash
   az webapp show --name bluepartner-validacao --resource-group rg-bluepartner --query "state"
   ```

3. **Reiniciar a app:**
   ```bash
   az webapp restart --name bluepartner-validacao --resource-group rg-bluepartner
   ```

4. **Verificar arquivo web.config** (deve estar correto agora)

---

## 📝 Checklist Final

- [ ] Todas as 15+ env vars estão setadas no Azure Portal
- [ ] `web.config` foi corrigido (✅ já fiz isso)
- [ ] Deploy foi feito com sucesso
- [ ] Aguardou 2-3 minutos para reiniciar
- [ ] Testou a URL: https://bluepartner-validacao.azurewebsites.net/
- [ ] Vê logs com: `az webapp log tail ...`

---

## ⚡ Comando Rápido Total

Se tudo acima já está pronto:

```bash
cd c:\Users\JuliadaAssunçãoSilva\bluepartner-validacao && az webapp up --name bluepartner-validacao --resource-group rg-bluepartner --runtime "NODE:20-lts"
```

