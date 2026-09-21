# Arquitetura do BluePartner Validação

## Visão geral

Este projeto é um backend em Node.js + Express para validar pedidos de licenciamento Microsoft CSP, gerar links públicos de confirmação e gerenciar autenticação administrativa com Microsoft Entra ID.

O fluxo principal é:

1. O cliente recebe um link único com pedidoId + token.
2. A landing page pública exibe dados do pedido e solicita aceite.
3. O usuário valida a licença e envia o POST para /api/validar.
4. O sistema registra o log, atualiza o status do pedido e redireciona para a revenda.
5. A área administrativa usa autenticação com sessão e papéis (admin/superadmin).

---

## Estrutura por camada

### 1) Camada de entrada / runtime

- [src/server.js](../src/server.js)
  - monta o Express
  - ativa CORS, Helmet, rate limit, sessões e logging
  - valida produção vs desenvolvimento
  - registra rotas públicas e administrativas
  - inicializa o banco em background

- [package.json](../package.json)
  - scripts do projeto
  - dependências principais
  - ponto de entrada: src/server.js

### 2) Camada de dados

- [src/db.js](../src/db.js)
  - cria e conecta ao SQLite
  - define tabelas: pedidos, licencas, logs, revendas, usuarios, gdap_pool, audit_log
  - executa migrações e índices
  - exporta helpers promisificados: dbGet, dbAll, dbRun

### 3) Camada de autenticação

- [src/middlewares/auth.js](../src/middlewares/auth.js)
  - requireAuth: exige sessão ativa
  - requireRole: exige papel permitido

- [src/routes/auth.js](../src/routes/auth.js)
  - login com Microsoft Entra ID
  - callback OAuth
  - valida email/grupos permitidos
  - cria sessão do usuário
  - logout
  - endpoint /auth/me

### 4) Fluxo público de validação

- [src/routes/pedidos.js](../src/routes/pedidos.js)
  - cria pedidos
  - cria token público do pedido
  - associa revendas
  - usa pool GDAP ou link padrão
  - resolve dados públicos do pedido
  - suporta batch de criação

- [src/routes/validar.js](../src/routes/validar.js)
  - valida token do pedido
  - compara CNPJ do pedido com o enviado
  - grava log em logs
  - atualiza status do pedido para VALIDADO

- [src/lib/crypto.js](../src/lib/crypto.js)
  - hash e comparação segura de tokens públicos

- [src/lib/validation.js](../src/lib/validation.js)
  - validação de CNPJ

### 5) API administrativa

- [src/routes/api.js](../src/routes/api.js)
  - dashboard administrativo
  - CNPJ lookup via provedores externos
  - listagem de revendas ativas
  - GDAP pool
  - logs e audit log
  - health checks
  - integrações (integration-health)

- [src/routes/licencasRoutes.js](../src/routes/licencasRoutes.js)
  - CRUD de licenças por pedido
  - listagem, criação e remoção
  - porém não está montado no servidor principal em [src/server.js](../src/server.js)

- [src/routes/usuariosRoutes.js](../src/routes/usuariosRoutes.js)
  - gestão de usuários
  - útil para admin/superadmin, mas não montada no runtime atual

- [src/routes/revendasRoutes.js](../src/routes/revendasRoutes.js)
  - gestão de revendas
  - útil para administração, mas não montada no runtime atual

### 6) Frontend

- [public/index.html](../public/index.html)
  - landing page pública do fluxo de validação

- [public/login.html](../public/login.html)
  - tela de login do painel administrativo

- [public/admin.html](../public/admin.html)
  - painel do admin

- [public/superadmin.html](../public/superadmin.html)
  - painel do superadmin

- [public/privacidade.html](../public/privacidade.html)
- [public/termos.html](../public/termos.html)

---

## Fluxo real do sistema

### A. Fluxo público de validação

- URL pública: pedidoId + token + revenda
- O backend verifica se o pedido existe e se o token bate com o hash armazenado.
- Exibe dados do cliente, CNPJ e licenças.
- O usuário confirma a ação.
- O cliente é redirecionado para o Partner Center para conceder permissão de licença.
- O sistema registra a validação em logs e atualiza status.
- Em seguida, envia para o link da revenda.

### B. Fluxo administrativo

- Usuário acessa /login
- Entra via Microsoft Entra ID
- A sessão define nome, email e role
- O sistema verifica se o usuário está cadastrado em usuarios
- Se tiver papel permitido, entra em /admin ou /superadmin
- APIs administrativas entregam dashboard, revendas, logs e integrações

---

## O que está ativo hoje

Atualmente, o runtime principal do projeto é composto por:

- [src/server.js](../src/server.js)
- [src/db.js](../src/db.js)
- [src/middlewares/auth.js](../src/middlewares/auth.js)
- [src/routes/auth.js](../src/routes/auth.js)
- [src/routes/pedidos.js](../src/routes/pedidos.js)
- [src/routes/validar.js](../src/routes/validar.js)
- [src/routes/api.js](../src/routes/api.js)
- [public/index.html](../public/index.html)
- [public/login.html](../public/login.html)
- [public/admin.html](../public/admin.html)
- [public/superadmin.html](../public/superadmin.html)

Esses módulos formam o núcleo funcional que realmente roda.

---

## O que está inativo ou auxiliar

Há uma série de arquivos e rotas que parecem úteis, mas não estão montados no runtime atual. Exemplos:

- [src/routes/licencasRoutes.js](../src/routes/licencasRoutes.js)
- [src/routes/usuariosRoutes.js](../src/routes/usuariosRoutes.js)
- [src/routes/revendasRoutes.js](../src/routes/revendasRoutes.js)
- [src/routes/gdapRoutes.js](../src/routes/gdapRoutes.js)
- [src/routes/fabricRoutes.js](../src/routes/fabricRoutes.js)
- [src/routes/onelakeRoutes.js](../src/routes/onelakeRoutes.js)
- [src/routes/consolidated.js](../src/routes/consolidated.js)
- [src/routes/distributors.js](../src/routes/distributors.js)

Essas rotas podem representar um segundo nível de desenvolvimento ou módulos de expansão, mas no estado atual não fazem parte do caminho principal do sistema.

---

## Organização recomendada

### Núcleo de produção

Manter como foco principal:

- src/server.js
- src/db.js
- src/middlewares/
- src/routes/auth.js
- src/routes/pedidos.js
- src/routes/validar.js
- src/routes/api.js
- public/

### Módulos complementares

Mover ou arquivar em uma pasta separada apenas se a intenção for manter funcionalidade futura:

- src/routes/usuariosRoutes.js
- src/routes/revendasRoutes.js
- src/routes/licencasRoutes.js
- src/routes/gdapRoutes.js
- src/routes/fabricRoutes.js
- src/routes/onelakeRoutes.js
- src/lib/integration-health.js
- src/gdap.js
- src/fabric.js
- src/ingram.js
- src/tds.js

### Arquivos legados e utilitários

- wrappers na raiz: server.js, db.js, gdap.js
- artifacts de log e deploy
- testes em tests/
- scripts de operação em scripts/

---

## Diagnóstico estrutural

### Pontos fortes

- Separação clara entre frontend, backend e banco.
- Autenticação centralizada por middleware.
- Schema de banco bem organizado.
- Lógica pública e administrativa claramente separada.
- Monitoramento e logging já presentes.

### Pontos de melhoria

- Há excesso de módulos paralelos que não entram no runtime atual.
- Algumas rotas ficam “prontas” mas não montadas.
- A estrutura se parece com um projeto em expansão, mas sem uma separação formal entre núcleo e extensões.
- Há duplicação de papéis e integração em arquivos que poderiam ser classificados melhor.

---

## Recomendação de organização final

A estrutura ideal para este projeto seria:

```text
src/
  app/
    server.js
    config/
    db/
    auth/
    routes/
      public/
      admin/
      integrations/
  core/
    validation/
    crypto/
    security/
  modules/
    gdap/
    revendas/
    usuarios/
    licencas/
  legacy/
    archive/
public/
  landing/
  admin/
  auth/
```

Em outras palavras: manter o “núcleo que roda” pequeno e explícito, e deixar extensões e experimentos em uma área separada.

---

## Resumo executivo

O projeto é um sistema de validação pública de licenças Microsoft CSP com painel administrativo protegido por Microsoft Entra ID. O fluxo principal está estável e bem definido. O problema estrutural não é funcional, mas organizacional: há muita lógica em expansão e vários módulos úteis que não estão montados nem documentados como “não ativos”.

A melhor organização é separar:

- produção principal
- módulos auxiliares
- módulos legado/arquivados
- utilitários e scripts

Isso reduz ruído e deixa o código mais fácil de manter.
