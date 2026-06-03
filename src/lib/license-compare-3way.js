/**
 * License comparison (3-way) helpers to match what public/admin.html expects.
 *
 * Expected row fields (per requested license):
 * - produto: original string stored in licencas.produto
 * - qtd: requested quantity
 * - portalMatch: matched portal subscription (Graph subscribedSkus normalized by src/gdap.js)
 * - distribuidorMatch: matched distributor subscription (normalized by src/ingram.js/src/tds.js)
 * - resultadoPortal: 'ok' | 'qtd_divergente' | 'suspensa' | 'nao_encontrada'
 * - resultadoDist: 'ok' | 'qtd_divergente' | 'suspensa' | 'nao_encontrada'
 * - resultadoGeral: 'ok' | 'parcial_portal' | 'parcial_distribuidor' | 'qtd_divergente' | 'suspensa' | 'nao_encontrada'
 */

const SKU_FRIENDLY_NAME_MAP = {
  O365_BUSINESS_ESSENTIALS: 'Microsoft 365 Business Basic',
  O365_BUSINESS_PREMIUM: 'Microsoft 365 Business Standard',
  SPB: 'Microsoft 365 Business Premium',
  ENTERPRISEPACK: 'Office 365 E3',
  ENTERPRISEPREMIUM: 'Office 365 E5',
  ENTERPRISEPREMIUM_NOPSTNCONF: 'Office 365 E5 (sem PSTN)',
  DESKLESSPACK: 'Office 365 F1',
  SPE_E3: 'Microsoft 365 E3',
  SPE_E5: 'Microsoft 365 E5',
  SPE_F1: 'Microsoft 365 F1',
  FLOW_FREE: 'Power Automate Free',
  POWER_BI_STANDARD: 'Power BI Free',
  POWER_BI_PRO: 'Power BI Pro',
  POWER_BI_PREMIUM_PER_USER: 'Power BI Premium Per User',
  PROJECTPREMIUM: 'Project Plan 5',
  PROJECTPROFESSIONAL: 'Project Plan 3',
  VISIOCLIENT: 'Visio Plan 2',
  ATP_ENTERPRISE: 'Microsoft Defender for Office 365 P1',
  THREAT_INTELLIGENCE: 'Microsoft Defender for Office 365 P2',
  EMSPREMIUM: 'Enterprise Mobility + Security E5',
  EMS: 'Enterprise Mobility + Security E3',
  EXCHANGESTANDARD: 'Exchange Online Plan 1',
  EXCHANGEENTERPRISE: 'Exchange Online Plan 2',
  MCOSTANDARD: 'Skype for Business Online Plan 2',
  TEAMS_EXPLORATORY: 'Microsoft Teams Exploratory',
  TEAMS_FREE: 'Microsoft Teams Free',
  WIN_DEF_ATP: 'Microsoft Defender for Endpoint',
  IDENTITY_THREAT_PROTECTION: 'Microsoft 365 E5 Security',
  AAD_PREMIUM: 'Azure AD Premium P1',
  AAD_PREMIUM_P2: 'Azure AD Premium P2',
  RIGHTSMANAGEMENT: 'Azure Information Protection P1',
  INTUNE_A: 'Microsoft Intune Plan 1',
  SHAREPOINTSTANDARD: 'SharePoint Online Plan 1',
  SHAREPOINTENTERPRISE: 'SharePoint Online Plan 2',
  MCOIMP: 'Skype for Business Online Plan 1',
  OFFICESUBSCRIPTION: 'Microsoft 365 Apps for Enterprise',
  M365_F1: 'Microsoft 365 F1',
  SMB_BUSINESS: 'Microsoft 365 Apps for Business',
  SMB_BUSINESS_ESSENTIALS: 'Microsoft 365 Business Basic',
  SMB_BUSINESS_PREMIUM: 'Microsoft 365 Business Standard',
  Microsoft_365_Copilot: 'Microsoft 365 Copilot',
};

const SKU_FRIENDLY_NAME_REVERSE = Object.entries(SKU_FRIENDLY_NAME_MAP).reduce((acc, [sku, friendly]) => {
  acc[friendly] = sku;
  return acc;
}, {});

function normalizeRequestedSkuPartNumber(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return raw;

  if (SKU_FRIENDLY_NAME_MAP[raw]) return raw;

  const reverse = SKU_FRIENDLY_NAME_REVERSE[raw];
  if (reverse) return reverse;

  // Not a known friendly name and not an exact SKU key: assume it's already a SKUPartNumber.
  return raw;
}

function getPortalResultado(portalMatch, requestedQtd) {
  if (!portalMatch) return 'nao_encontrada';

  const portalTotal = Number(portalMatch.total ?? 0);
  const reqQtd = Number(requestedQtd ?? 0);

  if (portalTotal !== reqQtd) return 'qtd_divergente';

  const capability = String(portalMatch.capabilityStatus ?? '').toLowerCase();
  if (capability === 'enabled' || capability === 'active') return 'ok';
  if (capability === 'suspended') return 'suspensa';

  // Unknown capability: treat as suspended to be conservative.
  return 'suspensa';
}

function getDistResultado(distMatch, requestedQtd) {
  if (!distMatch) return 'nao_encontrada';

  const distQtd = Number(distMatch.quantity ?? 0);
  const reqQtd = Number(requestedQtd ?? 0);

  if (distQtd !== reqQtd) return 'qtd_divergente';

  const status = String(distMatch.status ?? '').toLowerCase();
  if (['active', 'ativo', 'enabled'].includes(status)) return 'ok';
  if (['suspended', 'suspensa'].includes(status)) return 'suspensa';

  // Unknown status: treat as suspended to be conservative.
  return 'suspensa';
}

function getResultadoGeral(resultadoPortal, resultadoDist) {
  if (resultadoPortal === 'suspensa' || resultadoDist === 'suspensa') return 'suspensa';
  if (resultadoPortal === 'qtd_divergente' || resultadoDist === 'qtd_divergente') return 'qtd_divergente';

  const portalOk = resultadoPortal === 'ok';
  const distOk = resultadoDist === 'ok';
  const portalMissing = resultadoPortal === 'nao_encontrada';
  const distMissing = resultadoDist === 'nao_encontrada';

  if (portalOk && distOk) return 'ok';
  if (portalMissing && distOk) return 'parcial_portal';
  if (portalOk && distMissing) return 'parcial_distribuidor';
  if (portalMissing && distMissing) return 'nao_encontrada';

  // Fallback (should be rare with the strict mapping above)
  return 'nao_encontrada';
}

function buildComparisonRows({ requestedLicenses, portalLicenses, distributorLicenses }) {
  const portalBySku = new Map();
  for (const p of portalLicenses || []) {
    if (!p?.skuPartNumber) continue;
    portalBySku.set(String(p.skuPartNumber), p);
  }

  const distBySku = new Map();
  for (const d of distributorLicenses || []) {
    if (!d?.skuPartNumber) continue;
    distBySku.set(String(d.skuPartNumber), d);
  }

  const comparacao = (requestedLicenses || []).map((l) => {
    const requestedSku = normalizeRequestedSkuPartNumber(l.produto);
    const qtd = Number(l.qtd ?? 1) || 1;

    const portalMatch = portalBySku.get(requestedSku) || null;
    const distMatch = distBySku.get(requestedSku) || null;

    const resultadoPortal = getPortalResultado(portalMatch, qtd);
    const resultadoDist = getDistResultado(distMatch, qtd);

    const resultadoGeral = getResultadoGeral(resultadoPortal, resultadoDist);

    return {
      produto: l.produto,
      qtd,
      portalMatch,
      distribuidorMatch: distMatch,
      resultadoPortal,
      resultadoDist,
      resultadoGeral,
    };
  });

  return comparacao;
}

module.exports = {
  normalizeRequestedSkuPartNumber,
  buildComparisonRows,
};
