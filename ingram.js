/**
 * Módulo Ingram Micro — Integração com API Ingram Micro Cloud
 * 
 * Lê assinaturas/licenças do cliente na plataforma Ingram Micro.
 * Requer credenciais de API no .env (INGRAM_*)
 * 
 * Documentação: https://developer.ingrammicrocloud.com/
 */

const axios = require('axios');

// ===== CONFIGURAÇÃO =====
const INGRAM_BASE_URL = process.env.INGRAM_BASE_URL || 'https://api.ingrammicrocloud.com';

let cachedToken = null;
let tokenExpiresAt = 0;

// ===== VERIFICAR CONFIGURAÇÃO =====
function isIngramConfigured() {
    return !!(
        process.env.INGRAM_CLIENT_ID &&
        process.env.INGRAM_CLIENT_SECRET
    );
}

// ===== OBTER TOKEN =====
async function getIngramToken() {
    if (cachedToken && Date.now() < tokenExpiresAt - 60000) {
        return cachedToken;
    }

    const tokenUrl = process.env.INGRAM_TOKEN_URL || `${INGRAM_BASE_URL}/oauth/token`;

    const resp = await axios.post(tokenUrl, new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.INGRAM_CLIENT_ID,
        client_secret: process.env.INGRAM_CLIENT_SECRET,
    }).toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    cachedToken = resp.data.access_token;
    tokenExpiresAt = Date.now() + (resp.data.expires_in || 3600) * 1000;
    return cachedToken;
}

// ===== HEADERS =====
async function getHeaders() {
    const token = await getIngramToken();
    return {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
    };
}

// ===== LISTAR ASSINATURAS DO CLIENTE =====
/**
 * Lista as assinaturas ativas de um cliente na Ingram Micro.
 * 
 * @param {string} customerId - ID do cliente na Ingram (reseller customer ID ou tenant domain)
 * @returns {Array} Lista de assinaturas { skuPartNumber, productName, quantity, status, ... }
 */
async function getIngramSubscriptions(customerId) {
    if (!isIngramConfigured()) {
        throw new Error('Ingram Micro não configurada. Defina INGRAM_CLIENT_ID e INGRAM_CLIENT_SECRET no .env');
    }

    const headers = await getHeaders();

    // Endpoint de assinaturas — ajustar conforme documentação real da API Ingram
    const url = `${INGRAM_BASE_URL}/v1/customers/${encodeURIComponent(customerId)}/subscriptions`;

    console.log(`[INGRAM] Buscando assinaturas do cliente ${customerId}...`);

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
 * Lista os pedidos recentes de um cliente na Ingram Micro.
 * 
 * @param {string} customerId - ID do cliente na Ingram
 * @returns {Array} Lista de pedidos { orderId, products[], status, createdDate }
 */
async function getIngramOrders(customerId) {
    if (!isIngramConfigured()) {
        throw new Error('Ingram Micro não configurada. Defina INGRAM_CLIENT_ID e INGRAM_CLIENT_SECRET no .env');
    }

    const headers = await getHeaders();
    const url = `${INGRAM_BASE_URL}/v1/customers/${encodeURIComponent(customerId)}/orders`;

    console.log(`[INGRAM] Buscando pedidos do cliente ${customerId}...`);

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
 * Converte assinaturas Ingram para formato padronizado de comparação.
 * 
 * @param {string} customerId - ID do cliente na Ingram
 * @returns {Array} [{ skuPartNumber, productName, quantity, status }]
 */
async function getIngramLicencasNormalizadas(customerId) {
    const subs = await getIngramSubscriptions(customerId);

    return subs.map(s => ({
        skuPartNumber: s.skuPartNumber,
        productName: s.productName,
        quantity: s.quantity,
        status: s.status,
        source: 'ingram',
    }));
}

module.exports = {
    isIngramConfigured,
    getIngramToken,
    getIngramSubscriptions,
    getIngramOrders,
    getIngramLicencasNormalizadas,
};
