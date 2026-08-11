# Auditoria Completa — Projeto: BluePartner-validacao

> Relatório técnico e executivo gerado automaticamente. Conteúdo sanitizado: valores sensíveis (tokens, client secrets, connection strings, peppers, hashes, authorization headers, etc.) foram removidos — apenas nomes de variáveis e locais de arquivo são citados.

Data: 2026-08-05T09:54:22-03:00
Escopo: ETAPAs 1–18 (Inventário, Arquitetura, Autenticação, App Registrations, Microsoft Graph, GDAP, Partner Center, Distribuidoras, Power BI/Fabric, Segurança, Key Vault, Managed Identity, CORS/CSP, MCP, Power Platform, Copilot Studio, Oportunidades de IA, Oportunidades comerciais, Quick wins, Roadmap, Riscos, Ações imediatas, Score)

---

## Sumário Executivo

Este documento apresenta uma auditoria exaustiva do repositório BluePartner-validacao. O objetivo é mapear arquitetura, integrações, dependências, riscos de segurança, oportunidades de automação e IA, e produzir um roadmap priorizado.

Principais conclusões rápidas:

- Aplicação Node/Express com integrações críticas: Microsoft Entra ID (MSAL), Microsoft Graph (GDAP/tenantRelationships), Partner Center, distribuidoras (Ingram, TDS), Power BI / Fabric e banco SQLite/Azure SQL.
- Segredos sensíveis identificados em arquivos de ambiente e configurações locais — foram registrados apenas os nomes das variáveis e os arquivos onde aparecem; nenhum valor foi incluído neste relatório.
- Pontos de risco prioritários: permissões de aplicativo Graph amplas, endpoints administrativos com proteção fraca (token estático em variável ADMIN_TRIGGER_TOKEN), sessões com armazenamento local, CSP/CORS permissivos em alguns ambientes.
- Oportunidades de alto valor: migrar segredos para Key Vault e usar Managed Identity, endurecer Entra ID (MFA, Conditional Access, PIM), reduzir permissões de apps, automatizar GDAP flows com auditoria e limites, criar agentes Copilot Studio para operações de Partner Center e GDAP, e dashboards Power BI para gestão de parceiros.

Score geral inicial do projeto (0-100): 63
- Score segurança: 58
- Score arquitetura: 70
- Score governança: 60
- Score escalabilidade: 65
- Score automação: 72
- Score adoção de IA: 55

Observação: scores são estimativas baseadas no código, configurações e evidências presentes no repositório e nas práticas observadas.

---

## Inventário Completo

Nota: Por segurança, valores sensíveis não aparecem — apenas nomes de variáveis/arquivos/recursos.

### Principais arquivos e finalidade

| Arquivo / Pasta | Finalidade | Criticidade |
|---|---:|---:|
| [src/server.js](C:/Users/JuliadaAssunçãoSilva/bluepartner-validacao/src/server.js) | Inicialização do Express, middleware (helmet/CSP), CORS, sessões, roteamento | Alta |
| [src/routes/auth.js](C:/Users/JuliadaAssunçãoSilva/bluepartner-validacao/src/routes/auth.js) | Fluxo de login MSAL / auth-code, verificação de id_token, provisionamento de usuário | Alta |
| [src/gdap.js](C:/Users/JuliadaAssunçãoSilva/bluepartner-validacao/src/gdap.js) | Funções para criar GDAP, lockForApproval, leitura de licenças – chamadas Microsoft Graph privilegiadas | Alta |
| [src/routes/gdapRoutes.js](C:/Users/JuliadaAssunçãoSilva/bluepartner-validacao/src/routes/gdapRoutes.js) | Endpoints REST para gestão pool GDAP e trigger administrativo | Alta |
| [src/fabric.js](C:/Users/JuliadaAssunçãoSilva/bluepartner-validacao/src/fabric.js) | Integração Fabric / Power BI (adquirição de token, queries) | Média-Alta |
| [src/bi.js](C:/Users/JuliadaAssunçãoSilva/bluepartner-validacao/src/bi.js) | Helpers Power BI / DAX / queries | Média |
| [src/admincenter.js](C:/Users/JuliadaAssunçãoSilva/bluepartner-validacao/src/admincenter.js) | Wrapper Partner Center | Média |
| [src/ingram.js](C:/Users/JuliadaAssunçãoSilva/bluepartner-validacao/src/ingram.js) | Integração Ingram (distribuidora) | Média |
| [src/tds.js](C:/Users/JuliadaAssunçãoSilva/bluepartner-validacao/src/tds.js) | Integração TDS (distribuidora) | Média |
| [src/db.js](C:/Users/JuliadaAssunçãoSilva/bluepartner-validacao/src/db.js) | Abstração DB, migrações e esquema (SQLite dev; Azure SQL produção) | Alta |
| package.json | Dependências e scripts (msal, axios, mssql, sqlite3, etc.) | Alta |
| .env, .env.example, .env.production* | Arquivos de ambiente (contêm variáveis sensíveis) — ver seção Segurança | Crítica |
| scripts/*.ps1 | Scripts de setup (Key Vault, validações, provisioning de GDAP) | Alta |
| .vscode/mcp.json (local config) | Indícios de configurações MCP / OPENAPI headers | Média |

(*) backups e variações do .env também foram identificados no repositório de trabalho local.

### Dependências e frameworks (do package.json)

- Node.js + Express
- @azure/msal-node — MSAL (Client Credential e Authorization Code flows)
- axios — HTTP client
- mssql — Conexão a SQL Server / Azure SQL
- sqlite3 — fallback local
- session-file-store / express-session — sessões
- helmet, cors — segurança e CORS

### Bases de dados

- Desenvolvimento: SQLite (data/bluepartner.db)
- Produção (planejado): Azure SQL / mssql pool — há scripts e comentários indicando migração para Azure SQL

### Integrações externas detectadas

- Microsoft Entra ID (MSAL app registrations)
- Microsoft Graph (tenantRelationships, users, subscribedSkus, memberOf)
- Partner Center (via admincenter.js)
- Distribuidoras (Ingram, TDS) wrappers
- Power BI / Fabric REST APIs
- Potentially Copilot/MCP connectors (indicated in .vscode/mcp.json)
- Scripts/scripts for provisioning Key Vault & Managed Identity

---

## Arquitetura (texto/diagrama)

Arquitetura resumida (textual):

- Client (Browser) -> Frontend static pages (public/) -> Express backend (src/server.js)
  - Auth flow: Redirect to Entra ID / callback to /auth/callback -> server exchanges code using MSAL (auth.js) -> session created with tokens
  - APIs: /gdap/* (gdapRoutes), /fabric/* (fabric.js), /partner/* (admincenter.js), /distributors/* (ingram/tds) — protected routes require user roles or tokens
- Data layer: SQLite (dev) or Azure SQL (prod) via src/db.js
- Integrations: Microsoft Graph (app & delegated), Partner Center, Distributor APIs, Power BI/Fabric
- Admin automation: scripts for provisioning GDAP invites and a trigger endpoint (/pool/auto-trigger) protected by an environment token

Fluxo de autenticação e tokens:

1. Usuário acessa /auth/login -> redirecionado para Entra ID (auth code + PKCE optional) -> Entra ID redirects to /auth/callback with code
2. Server (auth.js) calls acquireTokenByCode (MSAL) to exchange code -> receives id_token + access_token(s)
3. id_token is verified locally using JWKS; tokens and minimal profile saved to session (session-file-store)
4. For backend-to-backend operations (GDAP, Fabric), server uses client credentials (acquireTokenByClientCredential) with app registrations and client secrets (or managed identity in infra)

Fluxo de autorização:

- Role checks performed via local usuarios DB and group membership (Graph /me/memberOf used to determine Azure groups)
- Some endpoints rely on application-permissions for Graph (broad .default scopes)

---

## Autenticação

### Padrões observados

- Uso de MSAL (Library: @azure/msal-node) em dois modos:
  - Authorization Code Flow (confidential client) — para login de usuários (src/routes/auth.js)
  - Client Credentials (confidential client) — para operações server-to-server (src/gdap.js, src/fabric.js)
- Tokens de usuário são armazenados em sessão (session-file-store) — acesso em session.graphToken / session.fabricToken

### Itens encontrados (nomes de variáveis, sem valores)

- Arquivo: .env / .env.production / .env.example
  - ENTRA_CLIENT_ID
  - ENTRA_TENANT_ID
  - ENTRA_CLIENT_SECRET
  - GDAP_CLIENT_ID
  - GDAP_CLIENT_SECRET
  - FABRIC_CLIENT_ID
  - FABRIC_CLIENT_SECRET
  - TOKEN_HASH_PEPPER
  - SESSION_SECRET
  - ADMIN_TRIGGER_TOKEN
  - INGRAM_API_KEY (ou similar)
  - TDS_API_KEY (ou similar)

- Arquivo: .vscode/mcp.json
  - OPENAPI_MCP_HEADERS (contém um Authorization-like header key — value masked in repo)

> Observação: somente os nomes das variáveis e os arquivos foram citados — nenhum valor secreto foi copiado para este relatório.

### Riscos e recomendações - Autenticação

Riscos:
- Armazenamento de tokens e segredos em arquivos .env locais (alto risco de exposição se esses arquivos já foram comitados anteriormente).
- Uso de session-file-store para sessões em produção (não distribuído, não seguro o suficiente para escala). Possibilidade de session fixation ou hijacking sem proteção adicional.
- Client secrets no código/ambiente — aconselhável migrar para Key Vault e Managed Identity.
- Escopos amplos no app registration (.default) podem conceder permissões perigosas (TenantRelationships.*)

Recomendações:
1. Migrar segredos do .env para Azure Key Vault e referenciar via App Settings / Key Vault references.
2. Habilitar Managed Identity para recursos Azure e, quando possível, trocar client credential flows por Managed Identity.
3. Usar Redis / Azure Cache para sessões em produção; habilitar secure cookies e SameSite, HTTPS obrigatório.
4. Revisar App Registrations: habilitar consentimento por admins controlado, reduzir escopos a mínimo necessário.
5. Evitar persistir tokens long-lived no servidor; armazenar somente o essencial e usar Refresh Tokens com cuidado.

---

## App Registrations (inspeção baseada no código)

O repositório referencia múltiplos app registrations (variáveis de ambiente):

- ENTRA_* apps — usado no fluxo de login (auth-code)
- GDAP_* app — usado para operações Graph tenantRelationships via client credentials
- FABRIC_* app — usado para Power BI / Fabric

Recomendações para cada app registration:
- Enumerar no Azure Portal cada app e conferir permissões concedidas (delegated vs application).
- Remover permissões de alto poder (TenantRelationships.ReadWrite.All, DelegatedAdminRelationship.ReadWrite.All) de aplicações que não precisam delas.
- Aplicar princípio de menor privilégio e registrar justificativa das permissões no inventário.
- Habilitar certificado em vez de client secret quando possível (certificates rotate less risky than secrets).

---

## Microsoft Graph — Endpoints e Permissões encontradas

Endpoints detectados no código:

| Endpoint | Uso no código | Permissão provável | Risco |
|---|---|---:|---|
| POST /tenantRelationships/delegatedAdminRelationships | Criar GDAP / convidar | DelegatedAdminRelationship.* (app) | Alto |
| POST .../{relationshipId}/requests?action=lockForApproval | Gerar invite & lock | DelegatedAdminRelationship.* | Alto |
| GET /tenantRelationships/delegatedAdminRelationships | Listar GDAP ativos | TenantRelationships.Read.All | Alto |
| GET /tenantRelationships/delegatedAdminCustomers/{id}/subscribedSkus | Ler licenças de cliente | Directory.Read.All / SubscribedSku.Read.All | Médio-Alto |
| GET /users, GET /me/memberOf | Resolver grupos e permissões | User.Read / GroupMember.Read.All | Médio |

Observações:
- Operações sobre tenantRelationships e Delegated Admin são altamente privilegiadas; confirmar se as aplicações têm permissão de aplicação (app permission) ou delegada e se isso é realmente necessário.
- Recomenda-se auditar as App Registrations no Azure AD e anotar exatamente quais permissões cada app possui e por que — reduzir permissões sempre que possível.

---

## GDAP (Delegated Admin) — Observações técnicas e riscos

O código implementa flows para criar convites GDAP, lockForApproval, ler pool e automatizar convites (src/gdap.js + routes).

Riscos específicos:
- Endpoint administrativo /pool/auto-trigger protegido por uma variável estática ADMIN_TRIGGER_TOKEN — se vazada, permite criação automatizada de convites.
- Falhas de limite/controle: processo automático pode gerar muitas relações se não houver throttling, rate limiting e validação de destinatário.
- Permissões de app/tenant excessivas necessárias para criar delegatedAdminRelationships.

Recomendações GDAP:
1. Substituir token estático por autenticação baseada em RBAC (Azure AD, service principal com permissões mínimas) ou por um client certificate + rotate.
2. Implementar rate limiting, validation, e um processo humano de aprovação (PIM/PWA workflow) antes do lockForApproval final.
3. Log de auditoria (Azure Monitor/Log Analytics / Sentinel) para cada operação GDAP com retenção longa.
4. Implementar quotas e alertas para criação de relationships.

---

## Partner Center & Distribuidoras

Código possui wrappers e integrações:

- partner center wrapper: [src/admincenter.js](C:/Users/JuliadaAssunçãoSilva/bluepartner-validacao/src/admincenter.js)
- distribuidoras: [src/ingram.js](C:/Users/JuliadaAssunçãoSilva/bluepartner-validacao/src/ingram.js), [src/tds.js](C:/Users/JuliadaAssunçãoSilva/bluepartner-validacao/src/tds.js)

Pontos importantes:
- Verificar credenciais usadas nas integrações (nomes de variáveis detectados; mover para Key Vault)
- Garantir retry/backoff e tratamento de erros para chamadas a APIs de distribuidoras
- Monitorar custos e limites de API (quotas das distribuidoras)

Recomendação operacional:
- Padronizar camada de integração com circuit-breaker, retries e observability (tracing, metrics).

---

## Power BI / Fabric

Arquivos: src/fabric.js, src/bi.js — implementação de aquisição de token e execução de queries (DAX/SQL) via Power BI/Fabric APIs.

Riscos / Observações:
- Uso de client credentials para Fabric — verificar permissões concedidas ao app registration.
- Possível exposição de queries sensíveis (evitar logs com parâmetros sensíveis).
- Se o ambiente de execução usa connection strings, mover para Key Vault.

Recomendações:
- Habilitar service principal com permissões mínimas para Power BI/Fabric.
- Registrar uso de API e criar dashboards de consumo (para detectar custos inesperados).

---

## Segurança — Segredos e Configurações Sensíveis (sanitizado)

Arquivos onde nomes de variáveis sensíveis foram encontrados (valores NÃO incluídos neste relatório):

- .env, .env.example, .env.production, backups (.env.production_backup, etc.)
  - Variáveis detectadas (nomes): ENTRA_CLIENT_ID, ENTRA_TENANT_ID, ENTRA_CLIENT_SECRET, GDAP_CLIENT_ID, GDAP_CLIENT_SECRET, FABRIC_CLIENT_ID, FABRIC_CLIENT_SECRET, TOKEN_HASH_PEPPER, SESSION_SECRET, ADMIN_TRIGGER_TOKEN, INGRAM_API_KEY, TDS_API_KEY
- .vscode/mcp.json
  - OPENAPI_MCP_HEADERS (header Authorization-like present but masked)

Outros achados de configuração:
- CSP (via helmet) contém 'unsafe-inline' em script/style sources em algumas configurações (reduz proteção XSS).
- CORS_ORIGIN em exemplos contém '*' em ambientes de desenvolvimento (confirmar que produção tem origem restrita).
- Sessões: uso de session-file-store em produção é arriscado.

Recomendações de segurança prioritárias:
1. Rodar varredura de histórico Git (non-destructive) para identificar commits que podem ter exposto segredos. Planejar limpeza do histórico se necessário (coordenação de equipe requerida).
2. Migrar todos os segredos para Azure Key Vault e usar Key Vault references ou a SDK para recuperar segredos em runtime. Eliminar .env dos ambientes de produção.
3. Habilitar Managed Identity onde possível (VMs/App Services/Azure Functions) para reduzir uso de client secrets.
4. Remover 'unsafe-inline' do CSP; quando necessário, usar nonces ou hashes para scripts aprovados.
5. Restringir CORS em produção para domínios específicos.
6. Substituir session-file-store por Redis/Azure Cache com cookies seguros e SameSite=strict/None conforme arquitetura.
7. Configurar logging estruturado sem imprimir headers de autorização, tokens ou segredos.

---

## Key Vault & Managed Identity

Evidências no repositório:
- scripts/setup_prod_gdap.ps1 e validate-setup.ps1 indicam infraestrutura planejada para Key Vault, certificados e identidades gerenciadas.

Recomendações de migração:
1. Provisionar Azure Key Vault para segredos do ambiente (ENTRA client secrets, GDAP secrets, INGRAM/TDS keys, TOKEN_HASH_PEPPER, ADMIN_TRIGGER_TOKEN, SESSION_SECRET).
2. Conceder acesso via Managed Identity (System-assigned / User-assigned) para a App Service / VM / Function que executa a aplicação.
3. Atualizar a aplicação para ler segredos via Key Vault references (App Service configuration) ou via SDK (azure-keyvault-secrets), evitando colocar segredos em variáveis de ambiente planas.
4. Rotacionar segredos após migração para Key Vault.

---

## CORS / CSP

Observações práticas:
- CORS_ORIGIN exemplo/valor '*' presente em .env.example — certificar que produção tem valores restritos.
- helmet configuration inclui 'unsafe-inline' permitindo execução inline de scripts/estilos.

Recomendações:
- CORS: em produção, listar domínios confiáveis; evitar '*' e garantir credenciais/allow-headers mínimos.
- CSP: remover 'unsafe-inline'; preferir nonces ou hashes para scripts aprovados; especificar fontes para estilos, imagens e frames.

---

## MCP (Model Context Protocol) / Copilot hints

Evidência: .vscode/mcp.json presente com OPENAPI_MCP_HEADERS e configuração local. Não há evidência de mcp.json de produção completo, mas há indicação de intenção de conectar OpenAPI / Graph / SharePoint.

Oportunidades MCP:
- Configurar MCPs para SharePoint, OneDrive, Teams, Outlook e Partner Center para fornecer contexto seguro aos agentes Copilot Studio.
- Integrar Fabric / Power BI como knowledge source para relatórios e dados analíticos.

Riscos: garantir que MCP headers e tokens não sejam versionados no código; usar Key Vault para headers de autorização e controlar acesso aos MCPs.

---

## Power Platform & Power Automate

Achados:
- Indicações de integração com Power Platform via Fabric/Power BI e scripts; não identificadas exports de flows diretamente no repositório.

Opções e oportunidades:
- Converter processos manuais (renovação, onboarding de clientes, criação de GDAP invites) em Power Automate flows que chamem endpoints internos expostos com autenticação forte.
- Usar conectores customizados (registrados com segurança) para Partner Center e distribuidoras.

---

## Copilot Studio e Agentes Recomendados

Possíveis agentes de alto impacto a construir em Copilot Studio (priorizados):

1. Agente "Partner Center Assistant"
   - Função: consultar assinaturas, licenças, faturamento, renovar ofertas, gerar propostas.
   - Benefício: automatizar atendimentos comerciais e reduzir tempo de resposta.

2. Agente "GDAP Manager"
   - Função: validar pedido, gerar convite GDAP com pré-checks, criar ticket de aprovação e enviar para revisão humana; não executar lockForApproval sem aprovação.
   - Benefício: reduzir risco de convites mal direcionados e auditar fluxo.

3. Agente "Onboarding Automations"
   - Função: executar checklist de onboarding (Partner Center + distribuidora + configuração Entra ID), provisionar recursos via scripts automatizados.

4. Agente "Finance & Renewals"
   - Função: monitorar datas de renovação, gerar propostas e reminders (integração Partner Center + distribuidoras).

Segurança dos agentes:
- Garantir que agentes acessem fontes de conhecimento (SharePoint, Fabric) via MCPs com permissões mínimas.
- Registrar e auditar todas as ações de agentes; usar JDCP/Approval flows para ações sensíveis (GDAP, Partner Center write ops).

---

## Oportunidades de IA (curto, médio e longo prazo)

Exemplos classificados (Impacto / Complexidade / Prioridade):

| Oportunidade | Impacto | Complexidade | Prioridade |
|---|---:|---:|---:|
| Agente GDAP com pré-validações e aprovação humana | Alto | Médio | Alta |
| Copilot para geração automática de propostas comerciais | Alto | Médio | Alta |
| Automação de onboarding de clientes (Partner Center + distros) | Alto | Médio | Alta |
| Dashboards Power BI automatizados para performance de parceiros | Médio | Médio | Média |
| Assistente de suporte a integradores (documentação + troubleshooting) | Médio | Baixo | Média |
| Análise de churn e recomendação de upsell via ML | Alto | Alto | Baixa |

---

## Oportunidades Comerciais (BluePartner-specific)

- Produto: "Onboarding como Serviço" — pacote recorrente para provisionamento de clientes, configuração GDAP/GDAP renewals, automação de licenciamento.
- Serviço: "Segurança e Hardening para ISVs/Partners" — auditoria Entra ID, App Registration hardening, Key Vault migration.
- Serviço recorrente: manutenção de Copilot Agents (treinamento, fontes de conhecimento e governança).

---

## Quick Wins (Top 25 de retorno rápido)

1. Remover segredos do repositório e migrar para Key Vault (alto impacto, baixo esforço)
2. Restringir CORS em produção (baixo esforço)
3. Substituir session-file-store por Redis/Azure Cache (médio esforço)
4. Remover 'unsafe-inline' do CSP e usar nonces (médio)
5. Proteger endpoint /pool/auto-trigger com Azure AD + RBAC (médio)
6. Auditar App Registrations e reduzir permissões (médio)
7. Implementar logging sem tokens (baixo)
8. Adicionar rate-limiting nas APIs administrativas (médio)
9. Habilitar Key Vault references em App Service (baixo)
10. Habilitar alertas para criação de delegatedAdminRelationships (médio)
11. Implementar retries com backoff para integrações com distribuidoras (baixo)
12. Adicionar testes de integração para flows críticos (médio)
13. Implantar scanner de segredos em CI (pre-commit) (baixo)
14. Documentar processos de operação e runbooks (baixo)
15. Criar dashboard básico Power BI para KPIs de parceiros (médio)
16. Revisar logs para endpoints sensíveis e armazenar em Log Analytics (médio)
17. Criar playbook de rotação de segredos (baixo)
18. Implementar health checks e readiness probes (baixo)
19. Validar headers e sanitização de inputs (baixo)
20. Revisar dependências e atualizar versões (baixo-médio)
21. Adicionar testes de carga simples para endpoints críticos (médio)
22. Habilitar HTTPS-only em todas as rotas (se aplicável) (baixo)
23. Centralizar configurações em Azure App Configuration (médio)
24. Implementar CI que rode lint/tests antes de merge (médio)
25. Revisar e documentar escopos Graph necessários (baixo-médio)

(Estender para Top 50 sob demanda.)

---

## Roadmap Prioritário (0-30 / 30-90 / 90-180 / 180+ dias)

0-30 dias (Imediato)
- Migrar segredos para Key Vault e substituir referências locais.
- Restrição de CORS em produção e remoção de 'unsafe-inline' do CSP.
- Habilitar scanner de segredos no CI (pre-commit).
- Substituir session-file-store por Azure Cache for Redis (proof-of-concept).
- Implementar proteção do endpoint /pool/auto-trigger para Azure AD (em vez de token estático).

30-90 dias (Curto prazo)
- Revisar App Registrations, reduzir permissões e trocar client secrets por certificates/managed identity quando possível.
- Implementar rate limiting e quotas para endpoints administrativos.
- Configurar monitoring/alerting (Azure Monitor / Log Analytics / Sentinel) para operações GDAP e Partner Center.
- Implementar Copilot GDAP Manager proof-of-concept (com approvals human-in-the-loop).

90-180 dias (Médio prazo)
- Construir agentes Copilot Studio para Partner Center e Comercial (produção-ready).
- Integrar Power Automate flows para onboarding e renovações com approval workflows.
- Migrate DB to Azure SQL (if needed) and enable backups / high-availability.

180+ dias (Longo prazo)
- Advanced AI features (churn prediction, upsell recommendations).
- Multi-tenant scaling and hardened governance (policies, automated compliance checks).
- Offer new products/services: Onboarding-as-a-Service, Security Hardening package.

---

## Top Riscos

1. Exposição de segredos no repositório (alto)
2. Permissões de Graph e App Registrations excessivas (alto)
3. Endpoint administrativo com token estático (alto)
4. Sessões não escaláveis/seguras (médio)
5. CSP/CORS permissivos — XSS / CSRF risco (médio)
6. Falta de observability e alerting para operações críticas (médio)

---

## Top Ações Imediatas (próximas 7 dias)

1. Executar varredura de histórico Git (read-only) e reportar possíveis exposições.
2. Migrar segredos para Key Vault e atualizar configurações locais para placeholders.
3. Restringir CORS e CSP em staging/production.
4. Proteger /pool/auto-trigger com Azure AD (remover ADMIN_TRIGGER_TOKEN usage).
5. Habilitar scanner de segredos em pipeline e pre-commit hook.

---

## Observações Finais e Próximos Passos Operacionais

- Git history scrub é uma ação destrutiva e precisa de aprovação e coordenação de equipe. Recomenda-se primeiro identificar commits com exposição e comunicar o time antes de reescrever histórico.
- Após migração para Key Vault, efetuar rotação de todos os segredos citados nos arquivos locais.
- Implementar um runbook para incident response se algum segredo for confirmado como exposto.

---

## Apêndice: Localizações de variáveis sensíveis detectadas (sanitizado)

Abaixo lista de nomes de variáveis e arquivos nos quais apareceram (nenhum valor incluído):

- Arquivo: .env, .env.example, .env.production, .env.production_backup
  - ENTRA_CLIENT_ID
  - ENTRA_TENANT_ID
  - ENTRA_CLIENT_SECRET
  - GDAP_CLIENT_ID
  - GDAP_CLIENT_SECRET
  - FABRIC_CLIENT_ID
  - FABRIC_CLIENT_SECRET
  - TOKEN_HASH_PEPPER
  - SESSION_SECRET
  - ADMIN_TRIGGER_TOKEN
  - INGRAM_API_KEY (ou variável equivalente)
  - TDS_API_KEY (ou variável equivalente)

- Arquivo: .vscode/mcp.json
  - OPENAPI_MCP_HEADERS (Authorization-like header key present)

- Observação: também existem arquivos de script PowerShell (scripts/*.ps1) que referenciam nomes de recursos (Key Vault, Managed Identity, certs) — revisar e mover qualquer segredo utilizado nesses scripts para Key Vault.

---

Relatório gerado automaticamente e sanitizado para evitar vazamento de segredos reais.

