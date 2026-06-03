# Checklist de Deploy em Produção - Time de TI

Objetivo: executar o deploy do BluePartner em produção com autenticação Entra ID, integração GDAP, variáveis de ambiente e testes de aceite.

Referências internas:
- DEPLOY_PRODUCTION.md
- .env.production
- .env.example

---

## 1. Pré-requisitos (Go/No-Go)

- [ ] Assinatura Azure com permissões para App Service, SQL Database e Entra ID.
- [ ] Domínio de produção definido (exemplo: https://portal.suaempresa.com).
- [ ] Time responsável com acesso a logs e suporte para janela de deploy.
- [ ] Plano de rollback aprovado.

Critério Go:
- Todos os itens acima concluídos.

---

## 2. Entra ID - App Registration de Login (painel Admin/Superadmin)

## 2.1 Criar aplicação

- [ ] Criar App Registration para login do portal.
- [ ] Definir Redirect URI de produção: https://SEU_DOMINIO/auth/callback
- [ ] Habilitar ID tokens e Access tokens na configuração de autenticação.

## 2.2 Permissões mínimas (delegated)

- [ ] openid
- [ ] profile
- [ ] email
- [ ] User.Read

Opcional para acesso a recursos de Fabric/Power BI com token delegado:
- [ ] Dataset.Read.All
- [ ] Workspace.Read.All

## 2.3 Controle de acesso

- [ ] Definir usuários permitidos por e-mail (ENTRA_ALLOWED_USER_EMAILS) ou por grupos (ENTRA_ALLOWED_GROUP_IDS).
- [ ] Validar que os superadmins estão cadastrados na tabela de usuários.

Saída esperada:
- Tenant ID, Client ID e Client Secret disponíveis para variáveis ENTRA_.

---

## 3. Entra ID - App Registration GDAP/Graph

## 3.1 Criar aplicação GDAP

- [ ] Criar App Registration dedicada para chamadas Microsoft Graph de GDAP.
- [ ] Gerar Client Secret com validade adequada (recomendado 12 meses ou política corporativa).

## 3.2 Permissões de aplicação (Application)

- [ ] Conceder permissões necessárias para criação/consulta de delegated admin relationships.
- [ ] Conceder permissões necessárias para leitura de assinaturas/licenças do cliente via fluxo GDAP.
- [ ] Executar Grant admin consent após adicionar permissões.

Observação:
- A combinação exata pode variar por tenant e política. A confirmação final é pelos testes de aceite da seção 8.

Saída esperada:
- Tenant ID, Client ID e Client Secret disponíveis para variáveis GDAP_.

---

## 4. Banco de dados (Azure SQL)

- [ ] Criar Azure SQL Server e Azure SQL Database.
- [ ] Configurar firewall para permitir acesso do App Service.
- [ ] Definir connection string em AZURE_SQL_CONNECTION_STRING.
- [ ] Validar se NODE_ENV está como production.

Opcional recomendado:
- [ ] Usar Managed Identity no lugar de senha em connection string.

---

## 5. Variáveis de ambiente - Produção

Fonte base: .env.production

## 5.1 Obrigatórias para subir o portal

- [ ] NODE_ENV=production
- [ ] PORT
- [ ] CORS_ORIGIN (domínio de produção)
- [ ] SESSION_SECRET (forte, 64+ chars)
- [ ] AZURE_SQL_CONNECTION_STRING

## 5.2 Obrigatórias para login Entra

- [ ] ENTRA_TENANT_ID
- [ ] ENTRA_CLIENT_ID
- [ ] ENTRA_CLIENT_SECRET
- [ ] ENTRA_REDIRECT_URI=https://SEU_DOMINIO/auth/callback

## 5.3 Obrigatórias para GDAP

- [ ] GDAP_TENANT_ID
- [ ] GDAP_CLIENT_ID
- [ ] GDAP_CLIENT_SECRET
- [ ] GDAP_PARTNER_NAME

## 5.4 Recomendadas para operação

- [ ] BOOTSTRAP_SUPERADMIN_EMAILS
- [ ] TOKEN_HASH_PEPPER (se não definido, usa SESSION_SECRET)

## 5.5 Integrações opcionais

Ingram:
- [ ] INGRAM_CLIENT_ID
- [ ] INGRAM_CLIENT_SECRET

TD SYNNEX:
- [ ] TDS_CLIENT_ID
- [ ] TDS_CLIENT_SECRET

Fabric/Power BI/OneLake:
- [ ] FABRIC_SQL_SERVER
- [ ] FABRIC_SQL_DATABASE
- [ ] FABRIC_WORKSPACE_ID
- [ ] POWERBI_WORKSPACE_ID
- [ ] POWERBI_DATASET_ID
- [ ] FABRIC_TENANT_ID / FABRIC_CLIENT_ID / FABRIC_CLIENT_SECRET (opcional, se não reutilizar ENTRA_)

---

## 6. Publicação da aplicação

- [ ] Aplicar variáveis no App Service (Configuration > Application settings).
- [ ] Fazer deploy do build/aplicação para o App Service.
- [ ] Reiniciar App Service após configuração.
- [ ] Confirmar healthcheck operacional.

Checklist técnico rápido pós-subida:
- [ ] Endpoint de health responde 200.
- [ ] Login em /login redireciona corretamente para Entra ID.
- [ ] Sessão é criada e mantém navegação em /admin e /superadmin.

---

## 7. Smoke Test (10 minutos)

- [ ] Abrir /login e autenticar com usuário autorizado.
- [ ] Abrir /admin e navegar Dashboard, Pedidos, GDAP Pool, Licenças, Logs, Histórico.
- [ ] Abrir /superadmin e validar acesso restrito por role.
- [ ] Criar pedido de teste e verificar persistência no banco.
- [ ] Validar que toasts/erros não quebram layout.

Critério Go:
- Nenhum erro crítico de navegação, login ou persistência.

---

## 8. Testes de Aceite Funcional (Entra + GDAP + Licenças)

## 8.1 Login e autorização

- [ ] Usuário não cadastrado recebe bloqueio de acesso.
- [ ] Usuário cadastrado com role admin entra em /admin.
- [ ] Usuário cadastrado com role superadmin entra em /superadmin.

## 8.2 GDAP Pool

- [ ] Carregamento da lista de links GDAP.
- [ ] Auto-gerar links GDAP funciona sem erro.
- [ ] Status GDAP retorna configurado quando variáveis estão corretas.

## 8.3 Comparação de licenças

- [ ] Tela de Licenças carrega sem quebrar layout.
- [ ] Comparação simples retorna resultado (ou mensagem de configuração pendente).
- [ ] Comparação 3 vias retorna portal + distribuidor quando configurados.
- [ ] Mensagens de erro aparecem de forma controlada (sem tela branca).

## 8.4 Distribuidores

- [ ] Ingram Micro configurado e consultável (quando credenciais disponíveis).
- [ ] TD SYNNEX configurado e consultável (quando credenciais disponíveis).

## 8.5 BI/Fabric

- [ ] Status de Fabric no Superadmin responde corretamente.
- [ ] Sincronização de revendas (quando habilitada) executa sem erro.

---

## 9. Segurança e Operação

- [ ] SESSION_SECRET rotacionado e armazenado em cofre corporativo.
- [ ] Secrets ENTRA_/GDAP_ armazenados em cofre corporativo.
- [ ] Logs de aplicação habilitados e acessíveis pelo time.
- [ ] Alertas básicos de indisponibilidade configurados.

---

## 10. Go/No-Go Final

Marcar Go apenas se todos os itens abaixo estiverem OK:

- [ ] Login Entra em produção funcional.
- [ ] Banco persistente funcional (sem perda entre restart/deploy).
- [ ] GDAP Pool e comparação de licenças funcionais.
- [ ] Perfis de acesso (admin/superadmin) validados.
- [ ] Sem erro crítico visual (tela branca/layout quebrado).
- [ ] Plano de rollback testado/documentado.

Resultado:
- [ ] GO para produção
- [ ] NO-GO (descrever pendências)

Pendências encontradas:

1. 
2. 
3. 

Responsável técnico:

Nome:
Data:
