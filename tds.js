/**
 * Módulo TD SYNNEX — Integração com API StreamOne Ion
 * 
 * Lê assinaturas/licenças do cliente na plataforma TD SYNNEX (StreamOne Ion).
 * Requer credenciais de API no .env (TDS_*)
 * 
 * Documentação: https://developer.tdsynnex.com/
 */

const axios = require('axios');

// ===== CONFIGURAÇÃO =====
const TDS_BASE_URL = process.env.TDS_BASE_URL || 'https://api.streamonecloud.net';

let cachedToken = null;
let tokenExpiresAt = 0;

// ===== VERIFICAR CONFIGURAÇÃO =====
function isTdsConfigured() {
    return !!(
        process.env.TDS_CLIENT_ID &&
        process.env.TDS_CLIENT_SECRET
    );
}

// ===== OBTER TOKEN =====
async function getTdsToken() {
    if (cachedToken && Date.now() < tokenExpiresAt - 60000) {
        return cachedToken;
    }

    const tokenUrl = process.env.TDS_TOKEN_URL || `${TDS_BASE_URL}/oauth/token`;

    const resp = await axios.post(tokenUrl, new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.TDS_CLIENT_ID,
        client_secret: process.env.TDS_CLIENT_SECRET,
    }).toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    cachedToken = resp.data.access_token;
    tokenExpiresAt = Date.now() + (resp.data.expires_in || 3600) * 1000;
    return cachedToken;
}

// ===== HEADERS =====
async function getHeaders() {
    const token = await getTdsToken();
    return {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
    };
}

// ===== LISTAR ASSINATURAS DO CLIENTE =====
/**
 * Lista as assinaturas ativas de um cliente na TD SYNNEX / StreamOne Ion.
 * 
 * @param {string} customerId - ID do cliente na TDS (reseller customer ID ou tenant domain)
 * @returns {Array} Lista de assinaturas { skuPartNumber, productName, quantity, status, ... }
 */
async function getTdsSubscriptions(customerId) {
    if (!isTdsConfigured()) {
        throw new Error('TD SYNNEX não configurada. Defina TDS_CLIENT_ID e TDS_CLIENT_SECRET no .env');
    }

    const headers = await getHeaders();

    // Endpoint de assinaturas — ajustar conforme documentação real da StreamOne Ion API
    const url = `${TDS_BASE_URL}/v1/customers/${encodeURIComponent(customerId)}/subscriptions`;

    console.log(`[TDS] Buscando assinaturas do cliente ${customerId}...`);

    const resp = await axios.get(url, { headers });
    const subscriptions = resp.data?.data || resp.data?.subscriptions || resp.data || [];

    return subscriptions.map(sub => ({
        subscriptionId: sub.id || sub.subscriptionId,
        skuPartNumber: sub.skuPartNumber || sub.sku || sub.offerName || '',
        productName: sub.productName || sub.offerDisplayName || sub.name || '',
        quantity: sub.quantity || sub.seatCount || sub.licenseCount || 0,
        status: sub.status || sub.state || 'Unknown',
        billingCycle: sub.billingCycle || sub.billingFrequency || '',
        startDate: sub.startDate || sub.createdDate || '',
        endDate: sub.endDate || sub.commitmentEndDate || '',
        autoRenew: sub.autoRenewEnabled || sub.autoRenew || false,
    }));
}

// ===== BUSCAR PEDIDOS DO CLIENTE =====
/**
 * Lista os pedidos recentes de um cliente na TD SYNNEX.
 * 
 * @param {string} customerId - ID do cliente na TDS
 * @returns {Array} Lista de pedidos { orderId, products[], status, createdDate }
 */
async function getTdsOrders(customerId) {
    if (!isTdsConfigured()) {
        throw new Error('TD SYNNEX não configurada. Defina TDS_CLIENT_ID e TDS_CLIENT_SECRET no .env');
    }

    const headers = await getHeaders();
    const url = `${TDS_BASE_URL}/v1/customers/${encodeURIComponent(customerId)}/orders`;

    console.log(`[TDS] Buscando pedidos do cliente ${customerId}...`);

    const resp = await axios.get(url, { headers });
    const orders = resp.data?.data || resp.data?.orders || resp.data || [];

    return orders.map(order => ({
        orderId: order.id || order.orderId,
        status: order.status || order.state || 'Unknown',
        createdDate: order.createdDate || order.createdAt || '',
        totalAmount: order.totalAmount || order.total || 0,
        products: (order.lineItems || order.products || order.items || []).map(item => ({
            skuPartNumber: item.skuPartNumber || item.sku || '',
            productName: item.productName || item.name || '',
            quantity: item.quantity || 0,
            unitPrice: item.unitPrice || item.price || 0,
        })),
    }));
}

// ===== NORMALIZAR PARA FORMATO DE COMPARAÇÃO =====
/**
 * Converte assinaturas TDS para formato padronizado de comparação.
 * 
 * @param {string} customerId - ID do cliente na TDS
 * @returns {Array} [{ skuPartNumber, productName, quantity, status }]
 */
async function getTdsLicencasNormalizadas(customerId) {
    const subs = await getTdsSubscriptions(customerId);

    return subs.map(s => ({
        skuPartNumber: s.skuPartNumber,
        productName: s.productName,
        quantity: s.quantity,
        status: s.status,
        source: 'tds',
    }));
}

module.exports = {
    isTdsConfigured,
    getTdsToken,
    getTdsSubscriptions,
    getTdsOrders,
    getTdsLicencasNormalizadas,
};
