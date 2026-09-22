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
  - CRUD de licenças por pedido (listagem, criação, remoção)

- [src/routes/usuariosRoutes.js](../src/routes/usuariosRoutes.js)
  - CRUD de usuários (listar, criar, editar role/ativo, deletar) — usado pelo painel superadmin

- [src/routes/revendasRoutes.js](../src/routes/revendasRoutes.js)
  - CRUD de revendas (listar, ativas, criar, editar, deletar, importar, dashboard) — usado pelos painéis admin e superadmin

- [src/routes/gdapRoutes.js](../src/routes/gdapRoutes.js)
  - status e comparação de licenças GDAP, gestão do pool GDAP (usado pelos painéis admin e superadmin)
  - `/comparar-completo/:pedidoId` é uma verificação manual opcional (proposta vs Graph via app GDAP vs
    distribuidor Ingram/TDS) para conferência no painel admin. Não bloqueia nem altera o status do
    pedido — a validação real do pedido é o aceite do link de GDAP pelo cliente (fluxo público,
    ver seção "Fluxo público de validação"). Falha ou ausência de configuração do Ingram/TDS/Graph
    aqui não deve ser tratada como pedido inválido.

- [src/routes/fabricRoutes.js](../src/routes/fabricRoutes.js) e [src/routes/onelakeRoutes.js](../src/routes/onelakeRoutes.js)
  - integração Microsoft Fabric/OneLake (status, sync de revendas, exploração de workspaces/lakehouses) — usado pelo painel superadmin

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
- [src/routes/gdapRoutes.js](../src/routes/gdapRoutes.js)
- [src/routes/usuariosRoutes.js](../src/routes/usuariosRoutes.js)
- [src/routes/revendasRoutes.js](../src/routes/revendasRoutes.js)
- [src/routes/licencasRoutes.js](../src/routes/licencasRoutes.js)
- [src/routes/fabricRoutes.js](../src/routes/fabricRoutes.js)
- [src/routes/onelakeRoutes.js](../src/routes/onelakeRoutes.js)
- [public/index.html](../public/index.html)
- [public/login.html](../public/login.html)
- [public/admin.html](../public/admin.html)
- [public/superadmin.html](../public/superadmin.html)

Esses módulos formam o núcleo funcional que realmente roda.

> **Nota (2026-09-21):** uma limpeza anterior havia arquivado gdapRoutes, usuariosRoutes,
> revendasRoutes, licencasRoutes, fabricRoutes e onelakeRoutes por parecerem "não montados",
> mas admin.js/superadmin.html já chamavam esses endpoints em produção — as telas
> correspondentes estavam quebradas (404) sem que isso fosse percebido. Todos foram
> remontados após confirmar uso real pelo frontend. Ver commits `1cf5e17` e `e1bcabf`.

---

## O que está inativo ou auxiliar

Estas rotas não têm nenhuma chamada correspondente em `public/` (verificado por busca no
frontend) e continuam arquivadas em `archive/legacy/`:

- [archive/legacy/consolidated.js](../archive/legacy/consolidated.js)
- [archive/legacy/distributors.js](../archive/legacy/distributors.js)

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
- src/routes/usuariosRoutes.js
- src/routes/revendasRoutes.js
- src/routes/licencasRoutes.js
- src/routes/gdapRoutes.js
- src/routes/fabricRoutes.js
- src/routes/onelakeRoutes.js
- src/lib/integration-health.js
- src/gdap.js
- src/fabric.js
- public/

### Módulos complementares (sem uso confirmado no frontend)

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

- A estrutura se parece com um projeto em expansão, mas sem uma separação formal entre núcleo e extensões.
- Há duplicação de papéis e integração em arquivos que poderiam ser classificados melhor.
- Uma limpeza anterior (2026-08-11) arquivou rotas achando que não tinham uso, sem checar
  se o frontend já as chamava — isso quebrou telas em produção silenciosamente (ver nota acima).
  Antes de arquivar qualquer rota, sempre confirmar com uma busca em `public/` por chamadas
  ao endpoint correspondente.
- A suíte de testes (`tests/api.test.js`) cobre alguns endpoints que nunca foram implementados
  neste repositório (paginação/busca em `/api/pedidos`, `/api/pedido-completo`, `/historico`,
  `/exportar`, `PUT`/`DELETE` de pedidos, `/api/bi/status`) — não é dívida técnica recente,
  é escopo pendente de decisão.

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
