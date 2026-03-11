const { initDatabase, dbGet, dbRun } = require('./db');

const SEED_REVENDAS = [
    { nome: 'Ingram Micro', partner_id: '', link_base: '' },
    { nome: 'TD SYNNEX', partner_id: '', link_base: '' }
];

const SEED_DATA = [
    {
        pedido_id: 'PED12345',
        token: 'xyz789abcd',
        cliente: 'Contoso Brasil Tecnologia Ltda',
        cnpj: '12.345.678/0001-90',
        revendas_nomes: ['Ingram Micro'],
        licencas: [
            { produto: 'Microsoft 365 Business Premium', qtd: 15, duracao: '12 meses NCE', preco: 'R$ 8.250,00/ano' },
            { produto: 'Microsoft Defender for Business', qtd: 15, duracao: '12 meses NCE', preco: 'R$ 2.700,00/ano' },
            { produto: 'Power BI Pro', qtd: 5, duracao: '12 meses NCE', preco: 'R$ 3.000,00/ano' }
        ]
    },
    {
        pedido_id: 'PED67890',
        token: 'abc123defg',
        cliente: 'Fabrikam Serviços Digitais S.A.',
        cnpj: '98.765.432/0001-10',
        revendas_nomes: ['TD SYNNEX'],
        licencas: [
            { produto: 'Microsoft 365 E3', qtd: 50, duracao: '12 meses NCE', preco: 'R$ 45.000,00/ano' },
            { produto: 'Azure AD Premium P2', qtd: 50, duracao: '12 meses NCE', preco: 'R$ 12.000,00/ano' }
        ]
    },
    {
        pedido_id: 'PED11111',
        token: 'mnop456qrs',
        cliente: 'Northwind Traders Brasil',
        cnpj: '55.666.777/0001-33',
        revendas_nomes: ['Ingram Micro', 'TD SYNNEX'],
        licencas: [
            { produto: 'Microsoft 365 Business Basic', qtd: 100, duracao: '12 meses NCE', preco: 'R$ 18.000,00/ano' },
            { produto: 'Microsoft Teams Phone Standard', qtd: 30, duracao: '12 meses NCE', preco: 'R$ 10.800,00/ano' },
            { produto: 'Exchange Online Plan 2', qtd: 10, duracao: '12 meses NCE', preco: 'R$ 4.200,00/ano' },
            { produto: 'Microsoft Intune Plan 1', qtd: 100, duracao: '12 meses NCE', preco: 'R$ 9.600,00/ano' }
        ]
    }
];

async function seed() {
    console.log('🔧 Inicializando banco de dados...');
    await initDatabase();

    // Seed revendas
    const revendaIdMap = {};
    for (const rv of SEED_REVENDAS) {
        const existing = await dbGet('SELECT id FROM revendas WHERE nome = ?', [rv.nome]);
        if (existing) {
            revendaIdMap[rv.nome] = existing.id;
            console.log(`  ⏭️  Revenda "${rv.nome}" já existe (id=${existing.id}), pulando.`);
        } else {
            const res = await dbRun(
                'INSERT INTO revendas (nome, partner_id, link_base, ativo) VALUES (?, ?, ?, 1)',
                [rv.nome, rv.partner_id, rv.link_base]
            );
            revendaIdMap[rv.nome] = res.lastID;
            console.log(`  ✅ Revenda "${rv.nome}" criada (id=${res.lastID})`);
        }
    }

    for (const pedido of SEED_DATA) {
        const existing = await dbGet('SELECT id FROM pedidos WHERE pedido_id = ?', [pedido.pedido_id]);
        if (existing) {
            console.log(`  ⏭️  Pedido ${pedido.pedido_id} já existe, pulando.`);
            continue;
        }

        const revenda_nome = pedido.revendas_nomes.join(', ');
        await dbRun(
            'INSERT INTO pedidos (pedido_id, token, cliente, cnpj, revenda, revenda_nome) VALUES (?, ?, ?, ?, ?, ?)',
            [pedido.pedido_id, pedido.token, pedido.cliente, pedido.cnpj, pedido.revendas_nomes[0] || '', revenda_nome]
        );

        // Insert junction records
        for (const rNome of pedido.revendas_nomes) {
            const rid = revendaIdMap[rNome];
            if (rid) {
                await dbRun('INSERT OR IGNORE INTO pedido_revendas (pedido_id, revenda_id) VALUES (?, ?)', [pedido.pedido_id, rid]);
            }
        }

        // Insert licenças
        for (const lic of pedido.licencas) {
            await dbRun(
                'INSERT INTO licencas (pedido_id, produto, qtd, duracao, preco) VALUES (?, ?, ?, ?, ?)',
                [pedido.pedido_id, lic.produto, lic.qtd, lic.duracao, lic.preco]
            );
        }

        console.log(`  ✅ Pedido ${pedido.pedido_id} inserido (${pedido.licencas.length} licenças, revendas: ${revenda_nome})`);
    }

    console.log('\n🎉 Seed concluído! Pedidos de teste disponíveis:');
    console.log('');
    SEED_DATA.forEach(p => {
        console.log(`  📋 ${p.pedido_id} → http://localhost:3000/?pedidoId=${p.pedido_id}&token=${p.token}`);
    });
    console.log('');

    process.exit(0);
}

seed().catch(err => {
    console.error('❌ Erro no seed:', err);
    process.exit(1);
});
