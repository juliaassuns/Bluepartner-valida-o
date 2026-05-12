// =================================================================================
// BluePartner Admin - Lógica do Frontend
// =================================================================================

document.addEventListener('DOMContentLoaded', () => {
    // Inicializa a página de licenças
    setupLicencasPage();
});


// =================================================================================
// SEÇÃO DE LICENÇAS CONSOLIDADAS
// =================================================================================

function setupLicencasPage() {
    const searchButton = document.getElementById('consolidated-search-btn');
    const customerIdInput = document.getElementById('consolidated-customer-id');

    if (searchButton && customerIdInput) {
        searchButton.addEventListener('click', fetchConsolidatedLicenses);
        customerIdInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                fetchConsolidatedLicenses();
            }
        });
    }
}

async function fetchConsolidatedLicenses() {
    const customerIdInput = document.getElementById('consolidated-customer-id');
    const customerId = customerIdInput.value.trim();

    if (!customerId) {
        showToast('Por favor, insira um ID de Cliente.', 'warning');
        return;
    }

    const resultsContainer = document.getElementById('consolidated-results');
    const loadingIndicator = document.getElementById('consolidated-loading');
    const metaInfo = document.getElementById('consolidated-meta');

    // Limpa resultados anteriores e mostra o loading
    resultsContainer.innerHTML = '';
    metaInfo.style.display = 'none';
    loadingIndicator.style.display = 'block';

    try {
        const response = await fetch(`/api/consolidated/licenses?customerId=${customerId}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Falha ao buscar os dados.');
        }

        // Esconde o loading
        loadingIndicator.style.display = 'none';

        // Mostra informações da fonte (API ou Cache)
        metaInfo.style.display = 'block';
        document.getElementById('meta-source').textContent = data.source === 'cache' ? 'Cache' : 'API (Tempo Real)';
        document.getElementById('meta-customer-id').textContent = data.customerId;
        
        // Renderiza os resultados
        renderConsolidatedResults(data, resultsContainer);

    } catch (error) {
        loadingIndicator.style.display = 'none';
        resultsContainer.innerHTML = `
            <div class="compare-notice compare-notice--error">
                <div class="compare-notice-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </div>
                <div>
                    <div class="compare-notice-title">Erro na Requisição</div>
                    <div class="compare-notice-text">${error.message}</div>
                </div>
            </div>`;
        showToast(error.message, 'error');
    }
}

function renderConsolidatedResults(data, container) {
    const { licenses, errors } = data;

    // Renderiza erros da API se houver algum
    if (errors && errors.length > 0) {
        const errorHtml = errors.map(err => `
            <div class="compare-notice compare-notice--warning">
                <div class="compare-notice-icon">!</div>
                <div>
                    <div class="compare-notice-title">Falha na Fonte: ${err.source}</div>
                    <div class="compare-notice-text">${err.message}</div>
                </div>
            </div>
        `).join('');
        container.innerHTML += errorHtml;
    }

    // Renderiza as licenças de cada fonte
    const sources = ['admincenter', 'ingram', 'tds'];
    let hasLicenses = false;

    sources.forEach(sourceName => {
        if (licenses[sourceName] && licenses[sourceName].length > 0) {
            hasLicenses = true;
            const sourceData = licenses[sourceName];
            const sourceTitle = sourceName.charAt(0).toUpperCase() + sourceName.slice(1);

            const tableHtml = `
                <div class="compare-block">
                    <h3 class="compare-section-title">${sourceTitle} (${sourceData.length} licenças)</h3>
                    <div class="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>Produto</th>
                                    <th>SKU</th>
                                    <th>Quantidade</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${sourceData.map(license => `
                                    <tr>
                                        <td>
                                            <div class="compare-cell-main">${license.productName || 'N/A'}</div>
                                        </td>
                                        <td>
                                            <div class="compare-cell-sub">${license.skuPartNumber || 'N/A'}</div>
                                        </td>
                                        <td>${license.quantity}</td>
                                        <td>
                                            <span class="badge ${getLicenseStatusClass(license.status)}">
                                                ${license.status || 'N/A'}
                                            </span>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
            container.innerHTML += tableHtml;
        }
    });

    if (!hasLicenses && errors.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24"><path d="M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z"/></svg>
                <div class="empty-title">Nenhuma Licença Encontrada</div>
                <div class="empty-desc">Não foram encontradas licenças para este cliente em nenhuma das fontes de dados configuradas.</div>
            </div>
        `;
    }
}

function getLicenseStatusClass(status) {
    if (!status) return 'gray';
    const s = status.toLowerCase();
    if (s === 'active' || s === 'ativo') return 'active';
    if (s === 'expired' || s === 'expirado') return 'expired';
    return 'gray';
}


// =================================================================================
// UTILS (Toast, Navegação, etc.)
// =================================================================================

// Função para mostrar notificações (toast)
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const iconSvg = {
        info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
        success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4 12 14.01l-3-3"/></svg>',
        warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01"/></svg>',
        error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6m0-6 6 6"/></svg>'
    };

    toast.innerHTML = `${iconSvg[type] || ''} ${message}`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-out');
        toast.addEventListener('animationend', () => toast.remove());
    }, 4000);
}

// Navegação entre páginas
function gotoPage(pageId) {
    // Esconde todas as páginas
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    // Mostra a página alvo
    const targetPage = document.getElementById(`page-${pageId}`);
    if (targetPage) {
        targetPage.classList.add('active');
    }

    // Atualiza o menu
    document.querySelectorAll('.menu-item').forEach(item => item.classList.remove('active'));
    const targetMenuItem = document.querySelector(`.menu-item[data-page="${pageId}"]`);
    if (targetMenuItem) {
        targetMenuItem.classList.add('active');
    }

    // Atualiza o título da topbar
    const topbarTitle = document.getElementById('topbarTitle');
    if (topbarTitle && targetMenuItem) {
        topbarTitle.textContent = targetMenuItem.textContent.trim();
    }

    // Fecha a sidebar em modo mobile
    if (window.innerWidth <= 780) {
        closeSidebar();
    }
}

// Funções da sidebar para mobile
function openSidebar() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('overlay').classList.add('show');
}

function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('overlay').classList.remove('show');
}
