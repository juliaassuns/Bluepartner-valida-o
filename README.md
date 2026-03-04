# 🔵 BluePartner - Validação de Licenças Microsoft CSP

Sistema de link único com dupla função para validação de licenças Microsoft CSP.  
O cliente valida as licenças, aceita o relacionamento como Administrador de Licenças no Partner Center, e é redirecionado para o link da revenda (Ingram Micro ou TD SYNNEX).

---

## 📋 Fluxo do Sistema

```
Cliente recebe link único via WhatsApp/email/Teams
        ↓
Abre landing page com resumo das licenças
        ↓
Marca checkbox de aceite + clica "Confirmar"
        ↓
[1] Abre Partner Center (nova aba) → Administrador de Licenças
[2] POST /api/validar → Log completo (IP, timestamp, revenda)
[3] Após 3s → Redirect para link da revenda (Ingram ou TDS)
```

---

## 🚀 Setup Local (10 minutos)

### Pré-requisitos
- Node.js >= 18
- npm

### Instalação

```bash
# 1. Instalar dependências
npm install

# 2. Popular banco com dados de teste
npm run seed

# 3. Iniciar servidor
npm start
```

**Ou em um comando:**

```bash
npm run setup && npm start
```

### URLs de Teste

Após iniciar, acesse no navegador:

| Pedido | Revenda | URL |
|--------|---------|-----|
| PED12345 | Ingram | `http://localhost:3000/?pedidoId=PED12345&token=xyz789abcd&revenda=ingram` |
| PED67890 | TDS | `http://localhost:3000/?pedidoId=PED67890&token=abc123defg&revenda=tds` |
| PED11111 | Ingram | `http://localhost:3000/?pedidoId=PED11111&token=mnop456qrs&revenda=ingram` |

> 💡 Em produção, o formato da URL será:  
> `https://bluepartner.link/PED12345/xyz789abcd?revenda=ingram`

---

## 🧩 Arquitetura

```
bluepartner-validacao/
├── public/
│   └── index.html          # Landing page (HTML + CSS + JS inline)
├── server.js                # Express backend (API + SPA fallback)
├── db.js                    # SQLite setup + helpers promisificados
├── seed.js                  # Dados de teste
├── package.json             # Dependências e scripts
├── vercel.json              # Deploy config (Vercel)
├── .env                     # Variáveis de ambiente
├── .env.example             # Template de variáveis
├── .gitignore
├── data/
│   └── bluepartner.db       # SQLite (auto-criado)
└── README.md
```

---

## 📡 API Endpoints

### `GET /api/pedido/:pedidoId/:token`

Retorna dados do pedido após validar token.

**Response 200:**
```json
{
  "cliente": "Contoso Brasil Tecnologia Ltda",
  "cnpj": "12.345.678/0001-90",
  "pedidoId": "PED12345",
  "revenda": "ingram",
  "status": "PENDENTE",
  "licencas": [
    {
      "produto": "Microsoft 365 Business Premium",
      "qtd": 15,
      "duracao": "12 meses NCE",
      "preco": "R$ 8.250,00/ano"
    }
  ]
}
```

**Response 404:** Token inválido ou pedido não encontrado.

---

### `POST /api/validar`

Registra log completo da validação.

**Body:**
```json
{
  "pedidoId": "PED12345",
  "token": "xyz789abcd",
  "revenda": "ingram",
  "timestamp": "2026-02-12T15:30:00.000Z",
  "status": "VALIDADO"
}
```

**Response 200:**
```json
{
  "success": true,
  "logId": 1,
  "message": "Validação registrada com sucesso"
}
```

> IP e User-Agent são capturados automaticamente do request.

---

### `GET /api/logs/:pedidoId`

Lista logs de validação (uso interno).

### `GET /api/pedidos`

Lista todos os pedidos (uso interno/admin).

---

## 🔗 Links Configurados

### Partner Center (BluePartner - Administrador de Licenças)
- Configurar em `public/index.html` → `CONFIG.PARTNER_CENTER_LINK`
- Permissão: **Administrador de Licenças** (sem revenue, sem pontuação)

### Revendas (Relacionamento de Revendedor)

| Revenda | Partner ID |
|---------|-----------|
| **Ingram Micro** | `4e3ecce0-5bc3-42d1-a51e-3357bbbf721e` |
| **TD SYNNEX** | `34851c42-87d2-423d-8fac-537b0e6f133b` |

Links completos hardcoded no frontend com `?invType=ResellerRelationship&DAP=true`.

---

## 📧 Template de E-mail

```
Olá [Cliente],

Clique no link único abaixo para validar suas licenças Microsoft:

🔗 https://bluepartner.link/PED12345/xyz789abcd?revenda=ingram

São apenas 60 segundos e estará finalizado!

Atenciosamente,
Equipe BluePartner
```

---

## 📱 Mobile-First

A landing page é 100% responsiva e otimizada para:
- ✅ WhatsApp (link preview)
- ✅ Microsoft Teams
- ✅ E-mail (Gmail, Outlook)
- ✅ Navegadores mobile (Chrome, Safari)

---

## 🏗️ Deploy (Vercel)

```bash
# Instalar Vercel CLI
npm i -g vercel

# Deploy
vercel

# Produção
vercel --prod
```

> ⚠️ **Nota:** SQLite em Vercel é efêmero (serverless). Para produção persistente, considere:
> - Turso (SQLite edge)
> - PlanetScale / Supabase (MySQL/Postgres)
> - Ou deploy em VPS (DigitalOcean, Railway)

---

## 🛠️ Scripts NPM

| Comando | Descrição |
|---------|-----------|
| `npm start` | Inicia servidor (porta 3000) |
| `npm run dev` | Inicia com auto-reload (Node 18+) |
| `npm run seed` | Popula banco com dados de teste |
| `npm run setup` | install + seed em um comando |
| `npm run logs` | Exibe logs de validação no terminal |
| `npm run pedidos` | Lista pedidos cadastrados |
| `npm run reset` | Apaga banco e re-popula |

---

## 🔒 Segurança

- Tokens únicos por pedido (validação server-side)
- Sanitização de parâmetros (regex alfanumérico)
- CORS configurável
- IP logging automático (suporta proxy reverso)
- Sem dados sensíveis expostos na URL (token é hash)

---

## 📊 Monitoramento

Todos os aceites são logados permanentemente com:
- `pedidoId` - Identificador do pedido
- `token` - Token usado
- `revenda` - Ingram ou TDS
- `timestamp` - Data/hora ISO 8601
- `ip` - IP do cliente
- `userAgent` - Navegador/dispositivo
- `status` - VALIDADO

Consulte logs via API (`GET /api/logs/:pedidoId`) ou terminal (`npm run logs`).
