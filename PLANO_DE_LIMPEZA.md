# PLANO_DE_LIMPEZA

Classificação feita com base no diagnóstico do projeto real. O objetivo aqui é reduzir o núcleo ao fluxo principal sem alterar comportamento.

Legenda:
- PRODUÇÃO: faz parte do runtime atual ou é essencial para o funcionamento atual.
- ARQUIVAR: não entra no runtime atual, mas tem lógica potencialmente útil para GDAP, Microsoft, Ingram ou TD SYNNEX, ou ainda suporta testes/utilitários.
- REMOVER: há evidência de que não é usado e não sustenta o fluxo atual.
- ANALISAR MANUALMENTE: há dúvida, dado sensível, artefato de ambiente ou item que merece decisão humana.

## Tabela de classificação

| Arquivo | Status atual | Motivo | É chamado pelo runtime? | É chamado por alguma rota? | É chamado por alguma página HTML? | Pode ser removido? | Pode ser arquivado? | Deve permanecer? |
|---|---|---|---|---|---|---|---|---|
| package.json | PRODUÇÃO | Define ponto de entrada, scripts e dependências do app | Sim | Sim | Não | Não | Não | Sim |
| package-lock.json | PRODUÇÃO | Congela dependências instaladas | Sim | Não | Não | Não | Não | Sim |
| web.config | PRODUÇÃO | Roteamento e execução no Azure/IISNode | Sim | Não | Não | Não | Não | Sim |
| src/server.js | PRODUÇÃO | Servidor principal do runtime atual | Sim | Sim | Sim | Não | Não | Sim |
| src/db.js | PRODUÇÃO | Banco principal do runtime | Sim | Sim | Sim | Não | Não | Sim |
| src/middlewares/auth.js | PRODUÇÃO | Middleware de sessão e papel | Sim | Sim | Sim | Não | Não | Sim |
| src/routes/auth.js | PRODUÇÃO | Login, callback, logout e sessão | Sim | Sim | Sim | Não | Não | Sim |
| src/routes/pedidos.js | PRODUÇÃO | Criação, resolução pública e CRUD de pedidos | Sim | Sim | Sim | Não | Não | Sim |
| src/routes/validar.js | PRODUÇÃO | Registro da validação pública | Sim | Sim | Sim | Não | Não | Sim |
| src/routes/api.js | PRODUÇÃO | Endpoints administrativos e de apoio | Sim | Sim | Sim | Não | Não | Sim |
| src/gdap.js | PRODUÇÃO | Integração GDAP usada pelo fluxo de pedidos | Sim | Sim | Indireto | Não | Não | Sim |
| src/lib/crypto.js | PRODUÇÃO | Helper de comparação segura | Sim | Sim | Indireto | Não | Não | Sim |
| public/index.html | PRODUÇÃO | Landing page pública principal | Sim | Sim | Sim | Não | Não | Sim |
| public/login.html | PRODUÇÃO | Tela de autenticação Microsoft | Sim | Sim | Sim | Não | Não | Sim |
| public/admin.html | PRODUÇÃO | Painel administrativo principal | Sim | Sim | Sim | Não | Não | Sim |
| public/superadmin.html | PRODUÇÃO | Área de superadmin | Sim | Sim | Sim | Não | Não | Sim |
| public/privacidade.html | PRODUÇÃO | Página institucional | Sim | Não | Sim | Não | Não | Sim |
| public/termos.html | PRODUÇÃO | Página institucional | Sim | Não | Sim | Não | Não | Sim |
| public/css/bluepartner-ui.css | PRODUÇÃO | Estilo da landing page pública | Sim | Não | Sim | Não | Não | Sim |
| public/css/login.css | PRODUÇÃO | Estilo da tela de login | Sim | Não | Sim | Não | Não | Sim |
| public/js/login.js | PRODUÇÃO | Comportamento mínimo da tela de login | Sim | Não | Sim | Não | Não | Sim |
| data/bluepartner.db | PRODUÇÃO | Banco SQLite do ambiente atual | Sim | Sim | Indireto | Não | Não | Sim |

| Arquivo | Status atual | Motivo | É chamado pelo runtime? | É chamado por alguma rota? | É chamado por alguma página HTML? | Pode ser removido? | Pode ser arquivado? | Deve permanecer? |
|---|---|---|---|---|---|---|---|---|
| server.js | ARQUIVAR | Wrapper legado que só reexporta src/server | Não | Não | Não | Sim | Sim | Não |
| db.js | ARQUIVAR | Wrapper legado para src/db | Não | Não | Não | Sim | Sim | Não |
| gdap.js | ARQUIVAR | Wrapper legado para src/gdap | Não | Não | Não | Sim | Sim | Não |
| README.md | ARQUIVAR | Documentação útil, não entra no runtime | Não | Não | Não | Não | Sim | Não |
| REDEPLOY_AGORA.md | ARQUIVAR | Guia operacional, não entra no runtime | Não | Não | Não | Não | Sim | Não |
| src/db-mssql.js | ARQUIVAR | Integração alternativa útil para Azure SQL, mas fora do fluxo ativo | Não | Não | Não | Não | Sim | Não |
| src/fabric.js | ARQUIVAR | Integração Microsoft/Fabric potencialmente útil | Não | Não | Não | Não | Sim | Não |
| src/ingram.js | ARQUIVAR | Integração Ingram potencialmente útil | Não | Não | Não | Não | Sim | Não |
| src/tds.js | ARQUIVAR | Integração TD SYNNEX potencialmente útil | Não | Não | Não | Não | Sim | Não |
| src/admincenter.js | ARQUIVAR | Integração Microsoft Admin Center potencialmente útil | Não | Não | Não | Não | Sim | Não |
| src/bi.js | ARQUIVAR | Lógica de BI pontuação útil, mas fora do runtime atual | Não | Não | Não | Não | Sim | Não |
| src/lib/cache.js | ARQUIVAR | Helper de cache usado por módulos arquiváveis | Não | Não | Não | Não | Sim | Não |
| src/lib/distributor-client.js | ARQUIVAR | Cliente genérico usado por integrações arquiváveis | Não | Não | Não | Não | Sim | Não |
| src/lib/license-compare-3way.js | ARQUIVAR | Comparador de licenças útil para GDAP/distribuidores | Não | Não | Não | Não | Sim | Não |
| src/seed.js | ARQUIVAR | Seed de dados útil para ambiente local e testes | Não | Não | Não | Não | Sim | Não |
| src/routes/gdapRoutes.js | ARQUIVAR | Tem lógica útil de GDAP, mas não está montado no runtime atual | Não | Não | Não | Não | Sim | Não |
| src/routes/revendasRoutes.js | ARQUIVAR | Gestão de revendas útil, porém fora do runtime atual | Não | Não | Não | Não | Sim | Não |
| src/routes/usuariosRoutes.js | ARQUIVAR | Gestão de usuários útil, porém fora do runtime atual | Não | Não | Não | Não | Sim | Não |
| src/routes/fabricRoutes.js | ARQUIVAR | Integração Fabric útil, mas não montada | Não | Não | Não | Não | Sim | Não |
| src/routes/onelakeRoutes.js | ARQUIVAR | Integração OneLake útil, mas não montada | Não | Não | Não | Não | Sim | Não |
| src/routes/licencasRoutes.js | ARQUIVAR | CRUD de licenças útil para admin, mas não montado | Não | Não | Não | Não | Sim | Não |
| src/routes/consolidated.js | ARQUIVAR | Consolidação multi-fonte útil, porém fora do runtime atual | Não | Não | Não | Não | Sim | Não |
| src/routes/distributors.js | ARQUIVAR | Adaptador multi-distribuidor útil, mas não montado | Não | Não | Não | Não | Sim | Não |
| public/dashboard.html | ARQUIVAR | Página exemplo/experimental sem uso no fluxo principal | Não | Não | Não | Não | Sim | Não |
| public/css/dashboard.css | ARQUIVAR | Estilo da página exemplo | Não | Não | Não | Não | Sim | Não |
| public/js/dashboard.js | ARQUIVAR | Comportamento da página exemplo | Não | Não | Não | Não | Sim | Não |
| public/js/admin.js | ARQUIVAR | Helper de admin consolidado, mas não carregado por HTML atual | Não | Não | Não | Não | Sim | Não |
| tests/api.test.js | ARQUIVAR | Testes úteis para validar o runtime, mas não fazem parte da produção | Não | Não | Não | Não | Sim | Não |
| tests/db.test.js | ARQUIVAR | Testes úteis para validar o banco, mas não fazem parte da produção | Não | Não | Não | Não | Sim | Não |
| tests/setup.js | ARQUIVAR | Suporte dos testes | Não | Não | Não | Não | Sim | Não |
| tests/globalSetup.js | ARQUIVAR | Suporte dos testes | Não | Não | Não | Não | Sim | Não |
| tests/globalTeardown.js | ARQUIVAR | Suporte dos testes | Não | Não | Não | Não | Sim | Não |
| scripts/list-pedidos.js | ARQUIVAR | Utilitário manual de consulta do banco | Não | Não | Não | Não | Sim | Não |
| scripts/discover-fabric.js | ARQUIVAR | Utilitário manual para descoberta Fabric/Power BI | Não | Não | Não | Não | Sim | Não |
| scripts/setup_prod_gdap.ps1 | ARQUIVAR | Script operacional para GDAP em produção | Não | Não | Não | Não | Sim | Não |
| setup-adminagents.js | ARQUIVAR | Utilitário manual para AdminAgents/GDAP | Não | Não | Não | Não | Sim | Não |
| validate-setup.ps1 | ARQUIVAR | Script operacional de validação do ambiente | Não | Não | Não | Não | Sim | Não |
| .azure/config | ARQUIVAR | Configuração de deploy/ambiente, não é runtime | Não | Não | Não | Não | Sim | Não |
| .vscode/settings.json | ARQUIVAR | Configuração de IDE | Não | Não | Não | Não | Sim | Não |
| .vscode/mcp.json | ARQUIVAR | Configuração de IDE | Não | Não | Não | Não | Sim | Não |

| Arquivo | Status atual | Motivo | É chamado pelo runtime? | É chamado por alguma rota? | É chamado por alguma página HTML? | Pode ser removido? | Pode ser arquivado? | Deve permanecer? |
|---|---|---|---|---|---|---|---|---|
| ingram.js | REMOVER | Está vazio e não há evidência de uso | Não | Não | Não | Sim | Não | Não |
| src/temp_check.js | REMOVER | Cópia temporária/duplicada do front, sem chamada real | Não | Não | Não | Sim | Não | Não |
| app-logs-fresh.zip | REMOVER | Artefato gerado, não faz parte do código | Não | Não | Não | Sim | Não | Não |
| app-logs-latest.zip | REMOVER | Artefato gerado, não faz parte do código | Não | Não | Não | Sim | Não | Não |
| app-logs-now.zip | REMOVER | Artefato gerado, não faz parte do código | Não | Não | Não | Sim | Não | Não |
| app-logs.zip | REMOVER | Artefato gerado, não faz parte do código | Não | Não | Não | Sim | Não | Não |
| bluepartner-logs.zip | REMOVER | Artefato gerado, não faz parte do código | Não | Não | Não | Sim | Não | Não |
| deploy.zip | REMOVER | Artefato de deploy, não faz parte do código | Não | Não | Não | Sim | Não | Não |
| jest-output-full.txt | REMOVER | Saída de teste gerada, não é fonte | Não | Não | Não | Sim | Não | Não |
| jest-output.txt | REMOVER | Saída de teste gerada, não é fonte | Não | Não | Não | Sim | Não | Não |
| test-results.txt | REMOVER | Saída de teste gerada, não é fonte | Não | Não | Não | Sim | Não | Não |
| webapp-logs-latest.zip | REMOVER | Artefato gerado, não faz parte do código | Não | Não | Não | Sim | Não | Não |
| webapp-logs.zip | REMOVER | Artefato gerado, não faz parte do código | Não | Não | Não | Sim | Não | Não |
| webapp_logs.zip | REMOVER | Artefato gerado, não faz parte do código | Não | Não | Não | Sim | Não | Não |
| data/bluepartner.db-shm | REMOVER | Arquivo temporário do SQLite, gerado em runtime | Não | Não | Não | Sim | Não | Não |
| data/bluepartner.db-wal | REMOVER | Arquivo temporário do SQLite, gerado em runtime | Não | Não | Não | Sim | Não | Não |

| Arquivo | Status atual | Motivo | É chamado pelo runtime? | É chamado por alguma rota? | É chamado por alguma página HTML? | Pode ser removido? | Pode ser arquivado? | Deve permanecer? |
|---|---|---|---|---|---|---|---|---|
| .env | ANALISAR MANUALMENTE | Contém segredos e configurações reais do ambiente | Sim | Sim | Sim | Não | Não | Sim |
| .env.production | ANALISAR MANUALMENTE | Contém configuração sensível de produção | Sim | Sim | Sim | Não | Não | Sim |
| .env.production_backup | ANALISAR MANUALMENTE | Backup sensível de produção | Não | Não | Não | Não | Não | Sim |
| .env.example | ANALISAR MANUALMENTE | Template de configuração, útil para operação | Não | Não | Não | Não | Não | Sim |
| .gitignore | ANALISAR MANUALMENTE | Configuração do repositório, não é runtime | Não | Não | Não | Não | Não | Sim |
| data/bluepartner.db | ANALISAR MANUALMENTE | Banco é essencial, mas depende de política de retenção local | Sim | Sim | Indireto | Não | Não | Sim |
| data/sessions/ | ANALISAR MANUALMENTE | Sessões de autenticação, runtime stateful | Sim | Sim | Sim | Não | Não | Sim |
| data/uploads/ | ANALISAR MANUALMENTE | Uploads podem ser necessários ao fluxo de proposta/histórico | Não | Não | Não | Não | Não | Sim |
| logs/deployments/ | ANALISAR MANUALMENTE | Logs operacionais; úteis para diagnóstico | Não | Não | Não | Não | Não | Opcional |
| app-logs/deployments/ | ANALISAR MANUALMENTE | Logs operacionais; úteis para diagnóstico | Não | Não | Não | Não | Não | Opcional |
| app-logs/LogFiles/ | ANALISAR MANUALMENTE | Logs operacionais; úteis para diagnóstico | Não | Não | Não | Não | Não | Opcional |
| et --hard 408ff74 | ANALISAR MANUALMENTE | Arquivo estranho/artefato de workspace sem contexto claro | Não | Não | Não | Talvez | Não | Não |

## PLANO_DE_LIMPEZA

### FASE 1 - Remover imediatamente
- ingram.js: está vazio e não há evidência de uso.
- src/temp_check.js: cópia temporária/duplicada, sem chamada real.
- app-logs*.zip, bluepartner-logs.zip, deploy.zip, webapp-logs*.zip: artefatos gerados de deploy/logs, sem valor funcional.
- jest-output*.txt e test-results.txt: saídas geradas de execução, não são fonte.
- data/bluepartner.db-shm e data/bluepartner.db-wal: arquivos temporários do SQLite.

### FASE 2 - Arquivar
- server.js, db.js e gdap.js da raiz: wrappers legados que só reexportam os módulos de src.
- README.md e REDEPLOY_AGORA.md: documentação útil, mas fora do núcleo mínimo.
- src/db-mssql.js: alternativa de produção para Azure SQL, ainda potencialmente útil.
- src/fabric.js, src/ingram.js, src/tds.js, src/admincenter.js: integrações úteis para Microsoft e distribuidores, mas fora do runtime atual.
- src/bi.js: lógica útil para BI, mas não entra no fluxo principal.
- src/routes/gdapRoutes.js, src/routes/revendasRoutes.js, src/routes/usuariosRoutes.js, src/routes/fabricRoutes.js, src/routes/onelakeRoutes.js, src/routes/licencasRoutes.js, src/routes/consolidated.js, src/routes/distributors.js: rotas úteis, porém não montadas no servidor atual.
- public/dashboard.html, public/css/dashboard.css, public/js/dashboard.js: página exemplo sem uso no fluxo principal.
- public/js/admin.js: helper órfão, útil apenas se o admin consolidado voltar a ser carregado.
- tests/*: úteis para validação, mas não fazem parte do núcleo de produção.
- scripts/*, setup-adminagents.js, validate-setup.ps1: utilitários manuais de operação e suporte.
- .azure/config, .vscode/settings.json, .vscode/mcp.json: suporte de ambiente/IDE, não são runtime.

### FASE 3 - Consolidar duplicados
- server.js da raiz com src/server.js: manter apenas o runtime de src e tratar a raiz como compatibilidade temporária.
- db.js da raiz com src/db.js: mesmo papel, hoje apenas wrapper.
- gdap.js da raiz com src/gdap.js: mesmo papel, hoje apenas wrapper.
- public/js/admin.js com public/admin.html: a lógica de admin consolidado está espalhada entre HTML inline e esse helper órfão.
- public/dashboard.html com public/js/dashboard.js: ambos representam um dashboard exemplo separado do núcleo.
- src/fabric.js, src/bi.js e src/routes/fabricRoutes.js/onelakeRoutes.js: há sobreposição entre integração e exposição de rotas.
- src/ingram.js, src/tds.js, src/admincenter.js e src/routes/distributors.js/consolidated.js: módulos paralelos com responsabilidade semelhante.

### FASE 4 - Revisar manualmente
- .env, .env.production, .env.production_backup e .env.example: contêm segredos, variáveis e políticas de ambiente.
- data/bluepartner.db: banco é essencial, mas a política de retenção e seed precisa ser confirmada antes de qualquer limpeza.
- data/sessions/ e data/uploads/: podem conter estado de uso real ou arquivos necessários ao fluxo.
- logs/deployments/, app-logs/deployments/, app-logs/LogFiles/: podem ser úteis para investigação operacional.
- et --hard 408ff74: artefato sem contexto suficiente.
- public/admin.html e public/superadmin.html: são produção hoje, mas dependem de endpoints que não estão todos montados no runtime atual; revisar antes de qualquer corte.
- src/routes/* não montados: têm potencial útil e não devem ser descartados sem validação do fluxo administrativo futuro.
