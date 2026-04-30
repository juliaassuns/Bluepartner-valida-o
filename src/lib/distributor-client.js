const axios = require('axios');

function toArray(value) {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    return [value];
}

function pickFirst(obj, keys, fallback) {
    for (const key of keys) {
        if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') {
            return obj[key];
        }
    }
    return fallback;
}

function createDistributorClient(config) {
    const {
        providerLabel,
        source,
        defaultBaseUrl,
        baseUrlEnv,
        tokenUrlEnv,
        clientIdEnv,
        clientSecretEnv,
    } = config;

    let cachedToken = null;
    let tokenExpiresAt = 0;

    function getEnv(name) {
        return process.env[name] || '';
    }

    function getBaseUrl() {
        return getEnv(baseUrlEnv) || defaultBaseUrl;
    }

    function getTokenUrl() {
        return getEnv(tokenUrlEnv) || `${getBaseUrl()}/oauth/token`;
    }

    function isConfigured() {
        return !!(getEnv(clientIdEnv) && getEnv(clientSecretEnv));
    }

    function assertConfigured() {
        if (!isConfigured()) {
            throw new Error(
                `${providerLabel} não configurada. Defina ${clientIdEnv} e ${clientSecretEnv} no .env`
            );
        }
    }

    async function getToken() {
        if (cachedToken && Date.now() < tokenExpiresAt - 60000) {
            return cachedToken;
        }

        assertConfigured();

        const payload = new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: getEnv(clientIdEnv),
            client_secret: getEnv(clientSecretEnv),
        }).toString();

        const resp = await axios.post(getTokenUrl(), payload, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });

        cachedToken = resp.data.access_token;
        tokenExpiresAt = Date.now() + (resp.data.expires_in || 3600) * 1000;
        return cachedToken;
    }

    async function getHeaders() {
        const token = await getToken();
        return {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
        };
    }

    async function listSubscriptions(customerId) {
        assertConfigured();
        const headers = await getHeaders();
        const url = `${getBaseUrl()}/v1/customers/${encodeURIComponent(customerId)}/subscriptions`;

        console.log(`[${source.toUpperCase()}] Buscando assinaturas do cliente ${customerId}...`);
        const resp = await axios.get(url, { headers });
        const rawList = pickFirst(resp.data || {}, ['data', 'subscriptions'], resp.data);

        return toArray(rawList).map((sub) => ({
            subscriptionId: pickFirst(sub, ['id', 'subscriptionId'], ''),
            skuPartNumber: pickFirst(sub, ['skuPartNumber', 'sku', 'offerName'], ''),
            productName: pickFirst(sub, ['productName', 'offerDisplayName', 'name'], ''),
            quantity: Number(pickFirst(sub, ['quantity', 'seatCount', 'licenseCount'], 0)) || 0,
            status: pickFirst(sub, ['status', 'state'], 'Unknown'),
            billingCycle: pickFirst(sub, ['billingCycle', 'billingFrequency'], ''),
            startDate: pickFirst(sub, ['startDate', 'createdDate'], ''),
            endDate: pickFirst(sub, ['endDate', 'commitmentEndDate'], ''),
            autoRenew: !!pickFirst(sub, ['autoRenewEnabled', 'autoRenew'], false),
        }));
    }

    async function listOrders(customerId) {
        assertConfigured();
        const headers = await getHeaders();
        const url = `${getBaseUrl()}/v1/customers/${encodeURIComponent(customerId)}/orders`;

        console.log(`[${source.toUpperCase()}] Buscando pedidos do cliente ${customerId}...`);
        const resp = await axios.get(url, { headers });
        const rawList = pickFirst(resp.data || {}, ['data', 'orders'], resp.data);

        return toArray(rawList).map((order) => ({
            orderId: pickFirst(order, ['id', 'orderId'], ''),
            status: pickFirst(order, ['status', 'state'], 'Unknown'),
            createdDate: pickFirst(order, ['createdDate', 'createdAt'], ''),
            totalAmount: Number(pickFirst(order, ['totalAmount', 'total'], 0)) || 0,
            products: toArray(pickFirst(order, ['lineItems', 'products', 'items'], [])).map((item) => ({
                skuPartNumber: pickFirst(item, ['skuPartNumber', 'sku'], ''),
                productName: pickFirst(item, ['productName', 'name'], ''),
                quantity: Number(pickFirst(item, ['quantity'], 0)) || 0,
                unitPrice: Number(pickFirst(item, ['unitPrice', 'price'], 0)) || 0,
            })),
        }));
    }

    async function getNormalizedLicenses(customerId) {
        const subscriptions = await listSubscriptions(customerId);
        return subscriptions.map((sub) => ({
            skuPartNumber: sub.skuPartNumber,
            productName: sub.productName,
            quantity: sub.quantity,
            status: sub.status,
            source,
        }));
    }

    return {
        isConfigured,
        getToken,
        getHeaders,
        listSubscriptions,
        listOrders,
        getNormalizedLicenses,
    };
}

module.exports = { createDistributorClient };
