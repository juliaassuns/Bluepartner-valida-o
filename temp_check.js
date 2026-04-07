
    const API_BASE = '';

    // data caches
    let pedidosCache = [];
    let gdapPoolCache = [];
    let logsCache = [];

    // pedidos pagination
    let pedidosPage = 1;
    const pedidosPageSize = 25;
    let pedidosTotalPages = 1;

    // logs pagination
    let logsPage = 1;
    const logsPageSize = 10;

    // audit pagination
    let auditPage = 1;
    const auditPageSize = 25;

    let pedidosFilterTimer = null;

    const monthLabels = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

    function esc(str){
      const div = document.createElement('div');
      div.textContent = str == null ? '' : String(str);
      return div.innerHTML;
    }

    async function authFetch(url, opts = {}) {
      const res = await fetch(url, { ...opts, credentials: 'same-origin' });
      if (res.status === 401) {
        window.location.href = '/login';
        throw new Error('SESSION_EXPIRED');
      }
      return res;
    }

    // ===== NAV / SIDEBAR =====
    function openSidebar(){
      document.getElementById('sidebar').classList.add('open');
      document.getElementById('overlay').classList.add('show');
    }
    function closeSidebar(){
      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('overlay').classList.remove('show');
    }

    function gotoPage(page){
      document.querySelectorAll('.menu-item').forEach(i => i.classList.remove('active'));
      document.querySelector(`.menu-item[data-page="${page}"]`).classList.add('active');

      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.getElementById('page-' + page).classList.add('active');

      document.getElementById('topbarTitle').textContent =
        page === 'dashboard' ? 'Dashboard' :
        page === 'pedidos' ? 'Pedidos' :
        page === 'gdap' ? 'GDAP Pool' :
        page === 'licencas' ? 'Licenças' :
        page === 'historico' ? 'Histórico' :
        'Logs';

      closeSidebar();
    }

    // ===== MODAL: NOVO PEDIDO =====
    function openNewPedidoModal(){
      document.getElementById('newPedidoModal').classList.add('show');
      loadBiSugestoes();
    }
    function closeNewPedidoModal(){
      document.getElementById('newPedidoModal').classList.remove('show');
      document.getElementById('npCnpj').value = '';
      document.getElementById('npCliente').value = '';
      document.getElementById('npClienteGroup').style.display = 'none';
      document.getElementById('npCnpjStatus').style.display = 'none';
      document.getElementById('biSugestoesPanel').style.display = 'none';
      clearFileUpload();
    }

    // ===== MODAL: COMPARTILHAR PEDIDO =====
    const DEFAULT_EMAIL_SUBJECT = 'Validação de Parceria Microsoft — {CLIENTE}';
    const DEFAULT_EMAIL_BODY = `Prezado(a),

Somos parceiros Microsoft e precisamos realizar a validação de licenciamento da sua empresa.

Dados do pedido:
• Cliente: {CLIENTE}
• CNPJ: {CNPJ}
• Pedido: {PEDIDO_ID}

Para concluir a validação, por favor acesse o link abaixo e siga as instruções:

{LINK}

Caso tenha dúvidas, não hesite em nos contatar.

Atenciosamente,
Equipe BluePartner`;

    function openShareModal(pedidoData){
      const fullLink = window.location.origin + pedidoData.link;
      document.getElementById('sharePedidoId').textContent = pedidoData.pedidoId;
      document.getElementById('sharePedidoCliente').textContent = pedidoData.cliente + ' — ' + pedidoData.cnpj;
      document.getElementById('sharePedidoLink').value = fullLink;

      // Mostra resultado da proposta se houve upload
      const propostaInfo = document.getElementById('sharePropostaInfo');
      if (pedidoData.proposta && pedidoData.proposta.success) {
        propostaInfo.style.display = 'block';
        propostaInfo.innerHTML = `<div style="display:flex;align-items:center;gap:8px">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#16a34a" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          <span style="font-size:13px;color:#16a34a;font-weight:600">${pedidoData.proposta.imported} licença(s) importada(s) da proposta</span>
        </div>`;
      } else if (pedidoData.proposta && pedidoData.proposta.error) {
        propostaInfo.style.display = 'block';
        propostaInfo.innerHTML = `<div style="display:flex;align-items:center;gap:8px">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#dc2626" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
          <span style="font-size:13px;color:#dc2626">${esc(pedidoData.proposta.error)}</span>
        </div>`;
      } else {
        propostaInfo.style.display = 'none';
      }

      // Preenche template de e-mail
      document.getElementById('shareEmailSubject').value = DEFAULT_EMAIL_SUBJECT;
      document.getElementById('shareEmailBody').value = DEFAULT_EMAIL_BODY;

      // Fecha detalhes do email ao abrir
      document.getElementById('shareEmailDetails').removeAttribute('open');

      // Guarda dados para uso nos botões
      document.getElementById('sharePedidoModal')._data = {
        link: fullLink,
        cliente: pedidoData.cliente,
        cnpj: pedidoData.cnpj,
        pedidoId: pedidoData.pedidoId
      };

      document.getElementById('sharePedidoModal').classList.add('show');
    }

    function closeShareModal(){
      document.getElementById('sharePedidoModal').classList.remove('show');
    }

    function copyShareLink(){
      const input = document.getElementById('sharePedidoLink');
      navigator.clipboard.writeText(input.value).then(() => {
        const btn = input.nextElementSibling;
        const origText = btn.innerHTML;
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copiado!';
        btn.style.background = '#16a34a';
        setTimeout(() => { btn.innerHTML = origText; btn.style.background = ''; }, 2000);
      }).catch(() => {
        input.select();
        document.execCommand('copy');
      });
    }

    function _resolveTemplate(template, data){
      return template
        .replace(/\{CLIENTE\}/g, data.cliente || '')
        .replace(/\{CNPJ\}/g, data.cnpj || '')
        .replace(/\{PEDIDO_ID\}/g, data.pedidoId || '')
        .replace(/\{LINK\}/g, data.link || '');
    }

    function shareViaWhatsApp(){
      const data = document.getElementById('sharePedidoModal')._data;
      const msg = `Olá! Segue o link para validação de parceria Microsoft:\n\n` +
                  `Cliente: ${data.cliente}\nCNPJ: ${data.cnpj}\nPedido: ${data.pedidoId}\n\n` +
                  `Acesse aqui: ${data.link}`;
      window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
    }

    function shareViaEmail(){
      const data = document.getElementById('sharePedidoModal')._data;
      const subjectTemplate = document.getElementById('shareEmailSubject').value;
      const bodyTemplate = document.getElementById('shareEmailBody').value;
      const subject = _resolveTemplate(subjectTemplate, data);
      const body = _resolveTemplate(bodyTemplate, data);
      window.open('mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body), '_self');
    }

    // ===== FILE UPLOAD HELPERS =====
    let pendingFile = null;

    function handleFileSelect(input){
      if (input.files && input.files[0]) {
        setFilePreview(input.files[0]);
      }
    }

    function handleFileDrop(event){
      const files = event.dataTransfer.files;
      if (files && files[0]) {
        const ext = files[0].name.split('.').pop().toLowerCase();
        if (['pdf','docx','doc','xlsx','xls','csv'].includes(ext)) {
          setFilePreview(files[0]);
          // Sync to file input
          const dt = new DataTransfer();
          dt.items.add(files[0]);
          document.getElementById('npFileInput').files = dt.files;
        } else {
          alert('Formato não suportado. Use PDF, DOCX, XLSX, XLS ou CSV.');
        }
      }
    }

    function setFilePreview(file){
      pendingFile = file;
      document.getElementById('npUploadContent').style.display = 'none';
      document.getElementById('npFileSelected').style.display = 'block';
      document.getElementById('npFileName').textContent = file.name;
      const sizeMB = (file.size / 1024 / 1024).toFixed(2);
      document.getElementById('npFileSize').textContent = sizeMB + ' MB';
    }

    function clearFileUpload(){
      pendingFile = null;
      document.getElementById('npFileInput').value = '';
      document.getElementById('npUploadContent').style.display = 'block';
      document.getElementById('npFileSelected').style.display = 'none';
    }

    async function uploadPropostaForPedido(pedidoId){
      if (!pendingFile) return null;
      const formData = new FormData();
      formData.append('arquivo', pendingFile);
      try {
        const res = await authFetch(API_BASE + '/api/proposta/' + pedidoId, {
          method: 'POST',
          body: formData
        });
        const data = await res.json().catch(() => ({}));
        return data;
      } catch(e) {
        console.warn('Erro ao enviar proposta:', e);
        return null;
      }
    }

    // ===== BI SUGESTÕES =====
    async function loadBiSugestoes(){
      const panel = document.getElementById('biSugestoesPanel');
      const list = document.getElementById('biSugestoesList');
      try {
        const res = await authFetch(API_BASE + '/api/bi/sugestoes');
        const data = await res.json().catch(() => ({}));

        if (!data.configured || !data.sugestoes || data.sugestoes.length === 0) {
          panel.style.display = 'none';
          return;
        }

        list.innerHTML = data.sugestoes.map(s => {
          const pct = s.percentual;
          const barColor = pct < 50 ? '#e74c3c' : pct < 100 ? '#f39c12' : '#27ae60';
          return `
            <div style="display:flex;align-items:center;gap:12px;padding:8px 12px;background:var(--white);border-radius:8px;border:1px solid var(--border)">
              <div style="flex:1;min-width:0">
                <div style="font-weight:600;font-size:13px;color:var(--text)">${esc(s.revenda)}</div>
                <div style="font-size:11px;color:var(--muted);margin-top:2px">
                  Score: ${s.pontuacao} · Ranking: #${s.ranking} · Faltam <strong>${s.faltam}</strong> pedido(s)
                </div>
              </div>
              <div style="width:120px;flex-shrink:0">
                <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-bottom:3px">
                  <span>${s.realizados}/${s.meta}</span>
                  <span>${pct}%</span>
                </div>
                <div style="height:6px;background:#e9ecef;border-radius:3px;overflow:hidden">
                  <div style="width:${Math.min(pct,100)}%;height:100%;background:${barColor};border-radius:3px"></div>
                </div>
              </div>
            </div>`;
        }).join('');

        // Resumo
        if (data.resumo) {
          list.innerHTML += `
            <div style="font-size:11px;color:var(--muted);text-align:right;margin-top:4px">
              ${data.resumo.atingiram}/${data.resumo.total} revendas atingiram a meta
            </div>`;
        }

        panel.style.display = 'block';
      } catch(e) {
        panel.style.display = 'none';
        console.warn('BI sugestões indisponível:', e);
      }
    }

    // ===== CNPJ LOOKUP (autopreencher) =====
    function onlyDigits(v){ return String(v || '').replace(/\D/g, ''); }

    function formatCnpj(v){
      const d = onlyDigits(v).slice(0, 14);
      if (d.length <= 2) return d;
      if (d.length <= 5) return d.replace(/^(\d{2})(\d)/, '$1.$2');
      if (d.length <= 8) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d)/, '$1.$2.$3');
      if (d.length <= 12) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d)/, '$1.$2.$3/$4.$5');
      return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2}).*/, '$1.$2.$3/$4-$5');
    }

    let cnpjLookupTimer = null;

    async function lookupCnpjAndFill(){
      const cnpjInput = document.getElementById('npCnpj');
      const clienteInput = document.getElementById('npCliente');
      const clienteGroup = document.getElementById('npClienteGroup');
      const cnpjStatus = document.getElementById('npCnpjStatus');

      // formata enquanto digita
      const prev = cnpjInput.value;
      const formatted = formatCnpj(prev);
      if (formatted !== prev) cnpjInput.value = formatted;

      const cnpj = onlyDigits(cnpjInput.value);

      if (cnpj.length < 14) {
        clienteGroup.style.display = 'none';
        clienteInput.value = '';
        cnpjStatus.style.display = 'none';
        return;
      }

      cnpjStatus.style.display = 'block';
      cnpjStatus.textContent = 'Buscando razão social...';
      cnpjStatus.style.color = 'var(--muted)';

      const res = await authFetch(API_BASE + '/api/cnpj/' + encodeURIComponent(cnpj));
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.nome) {
        cnpjStatus.textContent = 'CNPJ não encontrado';
        cnpjStatus.style.color = '#e74c3c';
        clienteGroup.style.display = 'none';
        clienteInput.value = '';
        return;
      }

      cnpjStatus.style.display = 'none';
      clienteInput.value = data.nome;
      clienteGroup.style.display = 'block';
    }

    function onCnpjInputChanged(){
      clearTimeout(cnpjLookupTimer);
      cnpjLookupTimer = setTimeout(() => {
        lookupCnpjAndFill().catch(err => console.warn('Erro lookup CNPJ:', err));
      }, 500);
    }

    async function createPedidoFromModal(){
      const cliente = document.getElementById('npCliente').value.trim();
      const cnpj = document.getElementById('npCnpj').value.trim();

      // Coleta IDs das revendas selecionadas
      const checkedBoxes = document.querySelectorAll('#npRevendasContainer input[type="checkbox"]:checked');
      const revendaIds = Array.from(checkedBoxes).map(cb => parseInt(cb.value));

      if (!cliente || !cnpj){
        alert('Preencha Nome do Cliente e CNPJ.');
        return;
      }

      const res = await authFetch(API_BASE + '/api/pedidos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cliente, cnpj, revendas: revendaIds })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok){
        alert(data.error || 'Erro ao criar pedido');
        return;
      }

      // Upload da proposta se houver arquivo
      let propostaResult = null;
      if (pendingFile) {
        propostaResult = await uploadPropostaForPedido(data.pedidoId);
      }

      closeNewPedidoModal();
      document.getElementById('npCliente').value = '';
      document.getElementById('npCnpj').value = '';
      // Desmarca checkboxes
      document.querySelectorAll('#npRevendasContainer input[type="checkbox"]').forEach(cb => cb.checked = false);
      clearFileUpload();
      await loadAllData();
      gotoPage('pedidos');

      // Abre modal de compartilhamento
      openShareModal({
        pedidoId: data.pedidoId,
        cliente: data.cliente,
        cnpj: data.cnpj,
        link: data.link,
        proposta: propostaResult
      });
    }

    // ===== DATA LOADING =====
    let revendasAtivasCache = [];

    async function loadRevendasAtivas(){
      try {
        const res = await authFetch(API_BASE + '/api/revendas/ativas');
        const data = await res.json().catch(() => ({}));
        revendasAtivasCache = data.revendas || [];
        renderRevendasCheckboxes();
      } catch(e) { console.warn('Erro ao carregar revendas ativas:', e); }
    }

    function renderRevendasCheckboxes(){
      const container = document.getElementById('npRevendasContainer');
      if (!revendasAtivasCache.length) {
        container.innerHTML = '<span style="color:var(--muted);font-size:13px">Nenhuma revenda cadastrada</span>';
        return;
      }
      // Agrupa por categoria
      const categorias = {};
      revendasAtivasCache.forEach(r => {
        const cat = (r.categoria || '').toLowerCase();
        const label = cat === 'ingram' ? 'Ingram' : cat === 'tds' ? 'TDS' : 'Outras';
        if (!categorias[label]) categorias[label] = [];
        categorias[label].push(r);
      });
      const catOrder = ['Ingram', 'TDS', 'Outras'];
      const catColors = { 'Ingram': '#1D4ED8', 'TDS': '#92400E', 'Outras': '#64748b' };
      const catBgs = { 'Ingram': '#DBEAFE', 'TDS': '#FEF3C7', 'Outras': '#F1F5F9' };
      let html = '';
      catOrder.forEach(cat => {
        if (!categorias[cat]) return;
        html += `<div style="width:100%;margin-bottom:4px">`;
        html += `<span style="font-size:11px;font-weight:600;color:${catColors[cat]};background:${catBgs[cat]};padding:2px 8px;border-radius:6px;margin-bottom:4px;display:inline-block">${cat}</span>`;
        html += `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">`;
        categorias[cat].forEach(r => {
          html += `<label style="display:inline-flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;padding:4px 10px;border:1px solid var(--border);border-radius:8px;background:var(--white);user-select:none">
            <input type="checkbox" value="${r.id}" style="accent-color:var(--brand);cursor:pointer">
            ${esc(r.nome)}
          </label>`;
        });
        html += `</div></div>`;
      });
      container.innerHTML = html;
    }

    async function loadPedidos(){
      const search = (document.getElementById('pedidosSearch')?.value || '').trim();
      const status = (document.getElementById('pedidosStatusFilter')?.value || '').trim();
      const revenda = (document.getElementById('pedidosRevendaFilter')?.value || '').trim();
      const from = (document.getElementById('pedidosDateFrom')?.value || '').trim();
      const to = (document.getElementById('pedidosDateTo')?.value || '').trim();

      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (status) params.set('status', status);
      if (revenda) params.set('revenda', revenda);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      params.set('page', String(pedidosPage));
      params.set('pageSize', String(pedidosPageSize));

      const res = await authFetch(API_BASE + '/api/pedidos?' + params.toString());
      const data = await res.json().catch(() => ({}));
      pedidosCache = data.pedidos || [];
      pedidosTotalPages = data.totalPages || 1;

      // Update pagination UI
      const info = document.getElementById('pedidosPageInfo');
      const prevBtn = document.getElementById('pedidosPrevBtn');
      const nextBtn = document.getElementById('pedidosNextBtn');
      if (info) info.textContent = `Página ${data.page || pedidosPage} de ${pedidosTotalPages} (${data.total || 0} pedidos)`;
      if (prevBtn) prevBtn.disabled = pedidosPage <= 1;
      if (nextBtn) nextBtn.disabled = pedidosPage >= pedidosTotalPages;
    }

    function debouncePedidosFilter(){
      clearTimeout(pedidosFilterTimer);
      pedidosFilterTimer = setTimeout(() => { pedidosPage = 1; pedidosApplyFilters(); }, 400);
    }

    async function pedidosApplyFilters(){
      pedidosPage = 1;
      await loadPedidos();
      renderPedidosTable();
    }

    function pedidosPrevPage() { pedidosPage = Math.max(1, pedidosPage - 1); pedidosApplyFilters(); }
    function pedidosNextPage() { pedidosPage++; pedidosApplyFilters(); }

    async function exportarPedidosCSV(){
      const search = (document.getElementById('pedidosSearch')?.value || '').trim();
      const status = (document.getElementById('pedidosStatusFilter')?.value || '').trim();
      const revenda = (document.getElementById('pedidosRevendaFilter')?.value || '').trim();
      const from = (document.getElementById('pedidosDateFrom')?.value || '').trim();
      const to = (document.getElementById('pedidosDateTo')?.value || '').trim();

      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (status) params.set('status', status);
      if (revenda) params.set('revenda', revenda);
      if (from) params.set('from', from);
      if (to) params.set('to', to);

      try {
        const res = await authFetch(API_BASE + '/api/pedidos/exportar?' + params.toString());
        if (!res.ok) { alert('Erro ao exportar'); return; }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pedidos_${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } catch(e) { alert('Erro ao exportar: ' + e.message); }
    }

    async function loadGdapPool(){
      const res = await authFetch(API_BASE + '/api/gdap/pool');
      const data = await res.json().catch(() => ({}));
      gdapPoolCache = data.links || [];
    }

    async function loadLogs(){
      const pedidoId = (document.getElementById('logsPedidoFilter').value || '').trim();
      const from = (document.getElementById('logsDateFrom').value || '').trim();
      const to = (document.getElementById('logsDateTo').value || '').trim();

      const params = new URLSearchParams();
      if (pedidoId) params.set('pedidoId', pedidoId);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      params.set('page', String(logsPage));
      params.set('pageSize', String(logsPageSize));

      const res = await authFetch(API_BASE + '/api/logs?' + params.toString());
      const data = await res.json().catch(() => ({}));

      if (!res.ok){
        logsCache = [];
        renderLogsTable();
        console.warn('Erro ao carregar logs:', data.error);
        return;
      }

      logsCache = (data.logs || []).map(l => ({
        id: l.id ?? l.log_id ?? '',
        pedido_id: l.pedido_id ?? '',
        revenda: l.revenda ?? '',
        status: l.status ?? '',
        ip: l.ip ?? '',
        criado_em: l.criado_em ?? l.timestamp ?? ''
      }));

      // drive pagination from server
      document.getElementById('logsPageInfo').textContent = `Página ${data.page || 1} / ${data.totalPages || 1}`;
      document.getElementById('logsPrevBtn').disabled = (data.page || 1) <= 1;
      document.getElementById('logsNextBtn').disabled = (data.page || 1) >= (data.totalPages || 1);

      renderLogsTable(true);
    }

    async function loadDashboard(){
      const res = await authFetch(API_BASE + '/api/admin/dashboard');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return null;
      return data;
    }

    async function loadAllData(){
      await loadRevendasAtivas();
      await loadPedidos();
      await loadGdapPool();
      await loadLogs();
      const dash = await loadDashboard();
      renderDashboard(dash);

      renderPedidosTable();
      renderGdapTable();
      populateLicSelectPedido();

      // Populate revenda dropdown in pedidos filter
      const revendaSelect = document.getElementById('pedidosRevendaFilter');
      if (revendaSelect && revendaSelect.options.length <= 1) {
        (revendasAtivasCache || []).forEach(r => {
          const opt = document.createElement('option');
          opt.value = r.nome || r.id;
          opt.textContent = r.nome;
          revendaSelect.appendChild(opt);
        });
      }

      // Load audit log for Histórico page
      loadAuditLog();
    }

    // ===== DASHBOARD RENDER =====
    function renderDashboard(dash){
      // New metrics requested (server-driven)
      document.getElementById('mPedidosNoMes').textContent = dash?.pedidosNoMes ?? '--';
      document.getElementById('mClientes').textContent = dash?.clientes ?? '--';
      document.getElementById('mNoPrazo7Dias').textContent = dash?.usuariosNoPrazo7Dias ?? '--';
      document.getElementById('mEmRisco').textContent = dash?.usuariosEmRisco ?? '--';

      // keep existing widgets below (chart + recent pedidos)
      renderBarChart();
      renderRecentPedidos();
    }

    function renderBarChart(){
      // Conta pedidos por mês — sem separação por revenda (multi-revenda)
      const byMonth = Array.from({length:12}, () => 0);

      pedidosCache.forEach(p => {
        const dt = new Date(p.criado_em || p.atualizado_em || Date.now());
        const m = dt.getMonth();
        byMonth[m]++;
      });

      const maxVal = Math.max(1, ...byMonth);
      const wrap = document.getElementById('barChart');
      wrap.innerHTML = byMonth.map((count, idx) => {
        const h = Math.round((count / maxVal) * 120) + 6;
        return `
          <div class="bar-month">
            <div class="bar-stack" title="${monthLabels[idx]} • Pedidos: ${count}">
              <div class="bar ingram" style="height:${h}px"></div>
            </div>
            <div class="bar-label">${monthLabels[idx]}</div>
          </div>
        `;
      }).join('');
    }

    function renderRecentPedidos(){
      const recent = [...pedidosCache]
        .sort((a,b) => String(b.criado_em).localeCompare(String(a.criado_em)))
        .slice(0, 8);

      const tbody = document.getElementById('recentPedidosBody');
      if (!recent.length){
        tbody.innerHTML = `<tr><td colspan="5" style="color:var(--muted);font-weight:700;">Nenhum pedido</td></tr>`;
        return;
      }

      tbody.innerHTML = recent.map(p => {
        const dt = p.criado_em ? new Date(p.criado_em).toLocaleString('pt-BR') : '—';
        const st = renderPedidoStatusBadge(p.status);
        const rev = (p.revendas || []).map(r => r.nome).join(', ') || (p.revenda_nome || p.revenda || '—');
        return `
          <tr>
            <td><strong style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">${esc(p.pedido_id)}</strong></td>
            <td>${esc(p.cliente)}</td>
            <td>${esc(rev)}</td>
            <td>${st}</td>
            <td>${dt}</td>
          </tr>
        `;
      }).join('');
    }

    // ===== PEDIDOS TABLE =====
    function renderPedidoStatusBadge(status){
      const s = String(status || '').toUpperCase();
      if (s === 'VALIDADO') return `<span class="badge validado">VALIDADO</span>`;
      if (s === 'DIVERGENTE') return `<span class="badge divergente">DIVERGENTE</span>`;
      return `<span class="badge pending">PENDENTE</span>`;
    }

    function renderPedidosTable(){
      const q = (document.getElementById('pedidosSearch').value || '').toLowerCase().trim();
      let rows = [...pedidosCache];

      if (q){
        rows = rows.filter(p =>
          String(p.pedido_id || '').toLowerCase().includes(q) ||
          String(p.cliente || '').toLowerCase().includes(q) ||
          String(p.cnpj || '').toLowerCase().includes(q) ||
          String(p.revenda_nome || '').toLowerCase().includes(q) ||
          (p.revendas || []).some(r => r.nome.toLowerCase().includes(q))
        );
      }

      const tbody = document.getElementById('pedidosBody');
      if (!rows.length){
        tbody.innerHTML = `<tr><td colspan="7" style="color:var(--muted);font-weight:700;">Nenhum pedido encontrado</td></tr>`;
        return;
      }

      tbody.innerHTML = rows.map(p => {
        const dt = p.criado_em ? new Date(p.criado_em).toLocaleString('pt-BR') : '—';
        const rev = (p.revendas || []).map(r => r.nome).join(', ') || (p.revenda_nome || p.revenda || '—');
        const st = renderPedidoStatusBadge(p.status);
        return `
          <tr>
            <td><strong style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">${esc(p.pedido_id)}</strong></td>
            <td>${esc(p.cliente)}</td>
            <td>${esc(p.cnpj)}</td>
            <td>${esc(rev)}</td>
            <td>${st}</td>
            <td>${dt}</td>
            <td>
              <div class="table-actions">
                <button class="icon-btn" title="Histórico" onclick="openHistorico('${esc(p.pedido_id)}')">
                  <svg viewBox="0 0 24 24"><path d="M12 8v4l3 3"/><path d="M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5"/></svg>
                </button>
                <button class="icon-btn" title="Ver" onclick="viewPedido('${esc(p.pedido_id)}')">
                  <svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/></svg>
                </button>
                <button class="icon-btn" title="Comparar Licenças" onclick="compareLicencas('${esc(p.pedido_id)}')">
                  <svg viewBox="0 0 24 24"><path d="M8 21V3m8 18V3M4 7h4M4 17h4m8-10h4m-4 10h4"/></svg>
                </button>
                <button class="icon-btn" title="Excluir" onclick="deletePedido('${esc(p.pedido_id)}')">
                  <svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 16h10l1-16"/></svg>
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }

    async function viewPedido(pedidoId){
      // abre a tela de aceite (cliente)
      window.open(`/?pedidoId=${encodeURIComponent(pedidoId)}&token=`, '_blank');
      alert('Abrindo link do cliente. Se não abrir, gere/recupere o token do pedido e complete o link.');
    }

    async function compareLicencas(pedidoId){
      executarComparacao(pedidoId);
    }

    async function deletePedido(pedidoId){
      if (!confirm('Excluir pedido ' + pedidoId + '?')) return;
      const res = await authFetch(API_BASE + '/api/pedidos/' + encodeURIComponent(pedidoId), { method:'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok){
        alert(data.error || 'Erro ao excluir');
        return;
      }
      await loadAllData();
    }

    // ===== HISTÓRICO DO PEDIDO =====
    let currentHistPedidoId = null;

    async function openHistorico(pedidoId) {
      currentHistPedidoId = pedidoId;
      histPendingFile = null;
      const modal = document.getElementById('historicoPedidoModal');
      modal.classList.add('show');
      document.getElementById('histPedidoId').textContent = pedidoId;
      document.getElementById('histLoading').style.display = 'block';
      document.getElementById('histContent').style.display = 'none';
      // Reset upload area
      document.getElementById('histUploadContent').style.display = 'block';
      document.getElementById('histFileSelected').style.display = 'none';
      document.getElementById('histUploadLoading').style.display = 'none';
      document.getElementById('histUploadResult').style.display = 'none';
      document.getElementById('histFileInput').value = '';

      try {
        const res = await authFetch(API_BASE + '/api/pedidos/' + encodeURIComponent(pedidoId) + '/historico');
        const data = await res.json();
        document.getElementById('histLoading').style.display = 'none';

        if (!res.ok) {
          alert(data.error || 'Erro ao buscar histórico');
          closeHistoricoModal();
          return;
        }

        document.getElementById('histContent').style.display = 'block';
        renderHistorico(data);
      } catch (err) {
        document.getElementById('histLoading').style.display = 'none';
        alert('Erro de conexão: ' + err.message);
        closeHistoricoModal();
      }
    }

    function closeHistoricoModal() {
      document.getElementById('historicoPedidoModal').classList.remove('show');
      currentHistPedidoId = null;
    }

    function switchHistTab(tab) {
      document.querySelectorAll('.hist-tab').forEach(t => t.classList.remove('active'));
      document.querySelector(`.hist-tab[data-tab="${tab}"]`).classList.add('active');
      document.querySelectorAll('.hist-panel').forEach(p => p.style.display = 'none');
      if (tab === 'timeline') document.getElementById('histTabTimeline').style.display = 'block';
      else if (tab === 'licencas') document.getElementById('histTabLicencas').style.display = 'block';
      else if (tab === 'validacoes') document.getElementById('histTabValidacoes').style.display = 'block';
    }

    function renderHistorico(data) {
      const p = data.pedido;

      // Resumo
      document.getElementById('histCliente').textContent = p.cliente || '—';
      document.getElementById('histCnpj').textContent = p.cnpj || '—';
      document.getElementById('histStatus').innerHTML = renderPedidoStatusBadge(p.status);
      document.getElementById('histRevenda').textContent = p.revendaNome || '—';
      document.getElementById('histCriado').textContent = p.criadoEm ? new Date(p.criadoEm).toLocaleString('pt-BR') : '—';

      if (data.gdapInfo) {
        document.getElementById('histGdapInfo').style.display = 'block';
        document.getElementById('histGdapStatus').textContent = data.gdapInfo.relationshipId
          ? 'Relationship ID: ' + data.gdapInfo.relationshipId
          : 'Link manual configurado';
      } else {
        document.getElementById('histGdapInfo').style.display = 'none';
      }

      // Badges
      document.getElementById('histLicCount').textContent = data.totalLicencas;
      document.getElementById('histValCount').textContent = data.totalValidacoes;

      // Timeline
      const timelineEl = document.getElementById('histTimeline');
      if (!data.timeline.length) {
        timelineEl.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted);font-weight:600;">Nenhum evento registrado</div>';
      } else {
        timelineEl.innerHTML = data.timeline.map(item => {
          const dt = item.data ? new Date(item.data).toLocaleString('pt-BR') : '—';
          return `
            <div class="timeline-item">
              <div class="timeline-icon ${item.tipo}">${item.icone}</div>
              <div class="timeline-body">
                <div class="timeline-title">${esc(item.titulo)}</div>
                ${item.descricao ? '<div class="timeline-desc">' + esc(item.descricao) + '</div>' : ''}
                <div class="timeline-meta">
                  <span>🕐 ${dt}</span>
                  ${item.usuario ? '<span>👤 ' + esc(item.usuario) + '</span>' : ''}
                </div>
              </div>
            </div>
          `;
        }).join('');
      }

      // Licenças
      const licBody = document.getElementById('histLicBody');
      const licEmpty = document.getElementById('histLicEmpty');
      if (!data.licencas.length) {
        licBody.innerHTML = '';
        licEmpty.style.display = 'block';
      } else {
        licEmpty.style.display = 'none';
        licBody.innerHTML = data.licencas.map(l => `
          <tr>
            <td><strong>${esc(l.produto)}</strong></td>
            <td style="text-align:center;font-weight:600;">${l.qtd}</td>
            <td>${esc(l.duracao)}</td>
            <td>${esc(l.preco)}</td>
          </tr>
        `).join('');
      }

      // Validações
      const valBody = document.getElementById('histValBody');
      const valEmpty = document.getElementById('histValEmpty');
      if (!data.validacoes.length) {
        valBody.innerHTML = '';
        valEmpty.style.display = 'block';
      } else {
        valEmpty.style.display = 'none';
        valBody.innerHTML = data.validacoes.map(v => {
          const dt = v.criado_em ? new Date(v.criado_em).toLocaleString('pt-BR') : (v.timestamp || '—');
          const statusBadge = v.status === 'VALIDADO'
            ? '<span class="badge validado">VALIDADO</span>'
            : '<span class="badge pending">' + esc(v.status) + '</span>';
          const ua = (v.user_agent || '').substring(0, 60);
          return `
            <tr>
              <td style="white-space:nowrap;">${dt}</td>
              <td>${statusBadge}</td>
              <td style="font-family:monospace;font-size:0.8rem;">${esc(v.ip || '—')}</td>
              <td style="font-size:0.75rem;max-width:200px;overflow:hidden;text-overflow:ellipsis;" title="${esc(v.user_agent || '')}">${esc(ua)}</td>
            </tr>
          `;
        }).join('');
      }

      // Default to timeline tab
      switchHistTab('timeline');
    }

    function compareLicencasFromHist() {
      if (currentHistPedidoId) {
        closeHistoricoModal();
        executarComparacao(currentHistPedidoId);
      }
    }

    // ===== UPLOAD PROPOSTA NO HISTÓRICO =====
    let histPendingFile = null;

    function handleHistFileSelect(input) {
      if (input.files && input.files[0]) {
        setHistFilePreview(input.files[0]);
      }
    }

    function handleHistFileDrop(event) {
      const files = event.dataTransfer.files;
      if (files && files.length > 0) {
        const ext = files[0].name.split('.').pop().toLowerCase();
        if (['pdf','docx','doc','xlsx','xls','csv'].includes(ext)) {
          setHistFilePreview(files[0]);
          const dt = new DataTransfer();
          dt.items.add(files[0]);
          document.getElementById('histFileInput').files = dt.files;
        } else {
          alert('Formato não suportado. Use PDF, DOCX, XLSX, XLS ou CSV.');
        }
      }
    }

    function setHistFilePreview(file) {
      histPendingFile = file;
      document.getElementById('histUploadContent').style.display = 'none';
      document.getElementById('histFileSelected').style.display = 'block';
      document.getElementById('histUploadLoading').style.display = 'none';
      document.getElementById('histFileName').textContent = file.name;
      const sizeMB = (file.size / 1024 / 1024).toFixed(2);
      document.getElementById('histFileSize').textContent = sizeMB + ' MB';
    }

    function clearHistFileUpload() {
      histPendingFile = null;
      document.getElementById('histFileInput').value = '';
      document.getElementById('histUploadContent').style.display = 'block';
      document.getElementById('histFileSelected').style.display = 'none';
      document.getElementById('histUploadLoading').style.display = 'none';
    }

    async function uploadPropostaFromHist() {
      if (!histPendingFile || !currentHistPedidoId) return;
      const formData = new FormData();
      formData.append('arquivo', histPendingFile);

      document.getElementById('histFileSelected').style.display = 'none';
      document.getElementById('histUploadLoading').style.display = 'block';
      document.getElementById('histUploadResult').style.display = 'none';

      try {
        const res = await authFetch(API_BASE + '/api/proposta/' + currentHistPedidoId, {
          method: 'POST',
          body: formData
        });
        const data = await res.json().catch(() => ({}));

        document.getElementById('histUploadLoading').style.display = 'none';

        if (data.success) {
          const resultEl = document.getElementById('histUploadResult');
          resultEl.style.display = 'block';
          resultEl.style.background = '#f0fdf4';
          resultEl.style.borderColor = '#bbf7d0';
          resultEl.innerHTML = '✅ <strong>' + data.imported + ' itens</strong> importados com sucesso do arquivo <em>' + esc(histPendingFile.name) + '</em>';
          clearHistFileUpload();
          // Reload historico to show new licenses
          openHistoricoModal(currentHistPedidoId);
          switchHistTab('licencas');
          // Refresh pedidos list
          loadPedidos();
        } else {
          const resultEl = document.getElementById('histUploadResult');
          resultEl.style.display = 'block';
          resultEl.style.background = '#fef2f2';
          resultEl.style.borderColor = '#fecaca';
          resultEl.innerHTML = '❌ ' + esc(data.error || 'Erro ao processar arquivo');
          clearHistFileUpload();
        }
      } catch (e) {
        document.getElementById('histUploadLoading').style.display = 'none';
        const resultEl = document.getElementById('histUploadResult');
        resultEl.style.display = 'block';
        resultEl.style.background = '#fef2f2';
        resultEl.style.borderColor = '#fecaca';
        resultEl.innerHTML = '❌ Erro de conexão: ' + esc(e.message);
        clearHistFileUpload();
      }
    }

    // ===== GDAP TABLE =====
    function gdapStatusBadge(status){
      const s = String(status || '').toLowerCase();
      if (s === 'active') return `<span class="badge active">active</span>`;
      if (s === 'expired') return `<span class="badge expired">expired</span>`;
      return `<span class="badge gray">approvalPending</span>`;
    }

    function renderGdapTable(){
      const tbody = document.getElementById('gdapBody');
      if (!gdapPoolCache.length){
        tbody.innerHTML = `<tr><td colspan="6" style="color:var(--muted);font-weight:700;">Nenhum registro no pool</td></tr>`;
        return;
      }

      // The current DB table gdap_pool has: id, link, label, status, pedido_id, criado_em, usado_em.
      // We'll map into the requested columns.
      tbody.innerHTML = gdapPoolCache.map(l => {
        const relationshipId = l.relationship_id || l.gdap_relationship_id || l.id || '—';
        const displayName = l.label || '—';
        const status = l.relationship_status || l.status || 'approvalPending';
        const created = l.criado_em ? new Date(l.criado_em).toLocaleString('pt-BR') : '—';
        const cliente = l.pedido_id || '—';

        const showCompare = String(status).toLowerCase() === 'active';
        return `
          <tr>
            <td><strong style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">${esc(relationshipId)}</strong></td>
            <td>${esc(displayName)}</td>
            <td>${gdapStatusBadge(status)}</td>
            <td>${created}</td>
            <td>${esc(cliente)}</td>
            <td>
              <div class="table-actions">
                <button class="btn btn-muted" type="button" onclick="verificarGdapStatus('${esc(relationshipId)}')">
                  <svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"/></svg>
                  Verificar Status
                </button>
                ${showCompare ? `
                  <button class="btn btn-primary" type="button" onclick="compareGdapLicencas('${esc(relationshipId)}')">
                    <svg viewBox="0 0 24 24"><path d="M8 21V3m8 18V3M4 7h4M4 17h4m8-10h4m-4 10h4"/></svg>
                    Comparar Licenças
                  </button>
                ` : ``}
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }

    async function verificarGdapStatus(relationshipId){
      try {
        const res = await authFetch(API_BASE + '/api/gdap/status/' + encodeURIComponent(relationshipId));
        const data = await res.json();
        if (!res.ok) {
          alert('Erro: ' + (data.message || data.error));
          return;
        }
        const status = data.status || '—';
        const cliente = data.customer?.displayName || '—';
        const tenantId = data.customer?.tenantId || '—';
        const criado = data.createdDateTime ? new Date(data.createdDateTime).toLocaleString('pt-BR') : '—';
        alert(`Status GDAP:\n\nRelação: ${data.displayName || relationshipId}\nStatus: ${status}\nCliente: ${cliente}\nTenant ID: ${tenantId}\nCriado em: ${criado}`);
        // Reload pool to update status
        await loadGdapPool();
        renderGdapTable();
      } catch (err) {
        alert('Erro ao verificar: ' + err.message);
      }
    }

    async function compareGdapLicencas(relationshipId){
      // Buscar relação para pegar o tenantId do cliente
      try {
        const res = await authFetch(API_BASE + '/api/gdap/status/' + encodeURIComponent(relationshipId));
        const data = await res.json();
        if (!res.ok || !data.customer?.tenantId) {
          alert('Não foi possível obter o tenant ID do cliente para esta relação.');
          return;
        }
        // Navegar para a página de licenças e abrir o cliente
        gotoPage('licencas');
        verLicencasCliente(data.customer.tenantId, data.customer.displayName || 'Cliente');
      } catch (err) {
        alert('Erro: ' + err.message);
      }
    }

    // ===== LOGS TABLE (FILTER + PAGINATION) =====
    function renderLogsTable(serverDriven = false){
      const tbody = document.getElementById('logsBody');

      if (!logsCache.length){
        tbody.innerHTML = `<tr><td colspan="6" style="color:var(--muted);font-weight:700;">Nenhum log encontrado</td></tr>`;
        return;
      }

      tbody.innerHTML = logsCache.map(l => {
        const dt = l.criado_em ? new Date(l.criado_em).toLocaleString('pt-BR') : '—';
        const st = String(l.status || '').toUpperCase();
        return `
          <tr>
            <td>${esc(l.id)}</td>
            <td><strong style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">${esc(l.pedido_id)}</strong></td>
            <td>${esc(l.revenda)}</td>
            <td>${esc(st)}</td>
            <td>${esc(l.ip)}</td>
            <td>${dt}</td>
          </tr>
        `;
      }).join('');

      if (!serverDriven){
        document.getElementById('logsPageInfo').textContent = `Página ${logsPage}`;
        document.getElementById('logsPrevBtn').disabled = logsPage <= 1;
        document.getElementById('logsNextBtn').disabled = false;
      }
    }

    function logsApplyFilters(){
      logsPage = 1;
      loadLogs();
    }

    function logsPrevPage(){
      logsPage = Math.max(1, logsPage - 1);
      loadLogs();
    }
    function logsNextPage(){
      logsPage = logsPage + 1;
      loadLogs();
    }

    // ===== COMPARAÇÃO DE LICENÇAS (Pedido vs Portal) =====

    function populateLicSelectPedido() {
      const sel = document.getElementById('licSelectPedido');
      const current = sel.value;
      sel.innerHTML = '<option value="">— Selecione um pedido —</option>';
      (pedidosCache || []).forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.pedido_id;
        opt.textContent = `${p.pedido_id} — ${p.cliente} (${p.revenda_nome || p.revenda || '—'})`;
        sel.appendChild(opt);
      });
      if (current) sel.value = current;
    }

    function onSelectPedidoComparar() {
      const pedidoId = document.getElementById('licSelectPedido').value;
      const btn = document.getElementById('btnComparar');
      const btn3 = document.getElementById('btnCompararCompleto');
      const info = document.getElementById('licPedidoInfo');

      if (!pedidoId) {
        btn.disabled = true;
        btn3.disabled = true;
        info.style.display = 'none';
        document.getElementById('licComparacaoResultado').style.display = 'none';
        document.getElementById('licComparacaoCompleta').style.display = 'none';
        return;
      }

      btn.disabled = false;
      btn3.disabled = false;
      const p = pedidosCache.find(x => x.pedido_id === pedidoId);
      if (p) {
        info.style.display = 'block';
        document.getElementById('licInfoCliente').textContent = p.cliente || '—';
        document.getElementById('licInfoCnpj').textContent = p.cnpj || '—';
        document.getElementById('licInfoRevenda').textContent = p.revenda_nome || p.revenda || '—';
        document.getElementById('licInfoStatus').textContent = p.status || '—';
      }
    }

    async function executarComparacao(pedidoIdParam) {
      const pedidoId = pedidoIdParam || document.getElementById('licSelectPedido').value;
      if (!pedidoId) return;

      // Se veio de fora (botão na tabela pedidos), navegar para a página e selecionar
      if (pedidoIdParam) {
        gotoPage('licencas');
        await new Promise(r => setTimeout(r, 100));
        populateLicSelectPedido();
        document.getElementById('licSelectPedido').value = pedidoId;
        onSelectPedidoComparar();
      }

      document.getElementById('licLoading').style.display = 'block';
      document.getElementById('licComparacaoResultado').style.display = 'none';
      document.getElementById('licComparacaoCompleta').style.display = 'none';
      document.getElementById('licLoadingText').textContent = 'Consultando portal do cliente via GDAP...';

      try {
        const res = await authFetch(API_BASE + '/api/gdap/comparar/' + encodeURIComponent(pedidoId));
        const data = await res.json();
        document.getElementById('licLoading').style.display = 'none';

        if (!res.ok) {
          alert(data.error || data.message || 'Erro ao comparar');
          return;
        }

        renderComparacao(data);
      } catch (err) {
        document.getElementById('licLoading').style.display = 'none';
        alert('Erro de conexão: ' + err.message);
      }
    }

    function renderComparacao(data) {
      document.getElementById('licComparacaoResultado').style.display = 'block';

      // GDAP status alert
      const alert = document.getElementById('licGdapAlert');
      if (data.gdapStatus === 'ativo') {
        alert.style.display = 'block';
        alert.style.background = '#ecfdf5';
        alert.style.border = '1px solid #6ee7b7';
        alert.style.color = '#065f46';
        alert.innerHTML = '✅ <strong>GDAP ativo</strong> — Leitura do portal do cliente realizada com sucesso.' +
          (data.customerTenantId ? ' <span style="font-family:monospace;font-size:0.8rem;">Tenant: ' + esc(data.customerTenantId) + '</span>' : '');
      } else if (data.gdapStatus === 'pendente') {
        alert.style.display = 'block';
        alert.style.background = '#fffbeb';
        alert.style.border = '1px solid #fcd34d';
        alert.style.color = '#92400e';
        alert.innerHTML = '⏳ <strong>GDAP pendente</strong> — ' + esc(data.gdapMessage || 'Cliente ainda não aceitou o convite.');
      } else if (data.gdapStatus === 'sem_relacao') {
        alert.style.display = 'block';
        alert.style.background = '#fef3c7';
        alert.style.border = '1px solid #fbbf24';
        alert.style.color = '#92400e';
        alert.innerHTML = '⚠️ <strong>Sem GDAP</strong> — ' + esc(data.gdapMessage || 'Gere um link GDAP para este pedido primeiro.');
      } else if (data.gdapStatus === 'nao_configurado') {
        alert.style.display = 'block';
        alert.style.background = '#fef2f2';
        alert.style.border = '1px solid #fca5a5';
        alert.style.color = '#991b1b';
        alert.innerHTML = '❌ <strong>GDAP não configurado</strong> — Configure as variáveis GDAP no servidor.';
      } else if (data.gdapStatus === 'sem_licencas') {
        alert.style.display = 'block';
        alert.style.background = '#fef3c7';
        alert.style.border = '1px solid #fbbf24';
        alert.style.color = '#92400e';
        alert.innerHTML = '📋 ' + esc(data.message || 'Nenhuma licença cadastrada neste pedido.');
        document.getElementById('licComparacaoBody').innerHTML = '';
        document.getElementById('licExtrasPanel').style.display = 'none';
        return;
      } else {
        alert.style.display = 'block';
        alert.style.background = '#fef2f2';
        alert.style.border = '1px solid #fca5a5';
        alert.style.color = '#991b1b';
        alert.innerHTML = '❌ ' + esc(data.gdapMessage || 'Erro ao consultar portal.');
      }

      // Tabela de comparação
      const comparacao = data.comparacao || [];
      const tbody = document.getElementById('licComparacaoBody');

      if (!comparacao.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="color:var(--muted);font-weight:700;">Nenhuma licença para comparar</td></tr>';
      } else {
        tbody.innerHTML = comparacao.map(c => {
          let resultadoHtml = '';
          let rowBg = '';
          switch (c.resultado) {
            case 'ok':
              resultadoHtml = '<span style="color:#10b981;font-weight:700;">✅ Conferida</span>';
              rowBg = 'background:#f0fdf4;';
              break;
            case 'qtd_divergente':
              resultadoHtml = `<span style="color:#f59e0b;font-weight:700;">⚠️ Qtd divergente (portal: ${c.portalMatch?.total || 0})</span>`;
              rowBg = 'background:#fffbeb;';
              break;
            case 'suspensa':
              resultadoHtml = `<span style="color:#ef4444;font-weight:700;">🔴 Suspensa no portal</span>`;
              rowBg = 'background:#fef2f2;';
              break;
            case 'nao_encontrada':
              resultadoHtml = '<span style="color:#ef4444;font-weight:700;">❌ Não encontrada no portal</span>';
              rowBg = 'background:#fef2f2;';
              break;
            case 'gdap_indisponivel':
              resultadoHtml = '<span style="color:#6b7280;font-weight:600;">⏳ GDAP indisponível</span>';
              break;
            case 'gdap_nao_configurado':
              resultadoHtml = '<span style="color:#6b7280;font-weight:600;">— GDAP não configurado</span>';
              break;
            default:
              resultadoHtml = '<span style="color:var(--muted);">—</span>';
          }

          const portalSku = c.portalMatch ? skuFriendlyName(c.portalMatch.skuPartNumber) : '—';
          const portalStatus = c.portalMatch?.capabilityStatus || '—';
          const portalQtd = c.portalMatch ? c.portalMatch.total : '—';
          const statusColor = portalStatus === 'Enabled' ? '#10b981' : portalStatus === 'Suspended' ? '#ef4444' : '#6b7280';

          return `
            <tr style="${rowBg}">
              <td><strong>${esc(c.produto)}</strong></td>
              <td style="text-align:center;">${c.qtd || 1}</td>
              <td>${c.portalMatch ? '<strong>' + esc(portalSku) + '</strong><div style="font-size:0.75rem;color:var(--muted);font-family:monospace;">' + esc(c.portalMatch.skuPartNumber) + '</div>' : '<span style="color:var(--muted);">—</span>'}</td>
              <td><span style="color:${statusColor};font-weight:600;">${esc(portalStatus)}</span></td>
              <td style="text-align:center;">${portalQtd}</td>
              <td>${resultadoHtml}</td>
            </tr>
          `;
        }).join('');
      }

      // Licenças extras no portal que não foram pedidas
      const matchedSkus = new Set(comparacao.filter(c => c.portalMatch).map(c => c.portalMatch.skuPartNumber));
      const extras = (data.portal || []).filter(p => !matchedSkus.has(p.skuPartNumber));
      const extrasPanel = document.getElementById('licExtrasPanel');
      const extrasBody = document.getElementById('licExtrasBody');

      if (extras.length > 0 && data.gdapStatus === 'ativo') {
        extrasPanel.style.display = 'block';
        extrasBody.innerHTML = extras.map(p => {
          const statusColor = p.capabilityStatus === 'Enabled' ? '#10b981' : p.capabilityStatus === 'Suspended' ? '#f59e0b' : '#6b7280';
          return `
            <tr>
              <td>
                <strong>${esc(skuFriendlyName(p.skuPartNumber))}</strong>
                <div style="font-size:0.75rem;color:var(--muted);font-family:monospace;">${esc(p.skuPartNumber)}</div>
              </td>
              <td><span style="color:${statusColor};font-weight:600;">${esc(p.capabilityStatus)}</span></td>
              <td>${p.total}</td>
              <td>${p.consumed}</td>
              <td style="color:${p.available <= 0 ? '#ef4444' : '#10b981'};font-weight:700;">${p.available}</td>
            </tr>
          `;
        }).join('');
      } else {
        extrasPanel.style.display = 'none';
      }
    }

    // Mapeamento SKU → nome amigável
    function skuFriendlyName(sku) {
      const map = {
        'O365_BUSINESS_ESSENTIALS': 'Microsoft 365 Business Basic',
        'O365_BUSINESS_PREMIUM': 'Microsoft 365 Business Standard',
        'SPB': 'Microsoft 365 Business Premium',
        'ENTERPRISEPACK': 'Office 365 E3',
        'ENTERPRISEPREMIUM': 'Office 365 E5',
        'ENTERPRISEPREMIUM_NOPSTNCONF': 'Office 365 E5 (sem PSTN)',
        'DESKLESSPACK': 'Office 365 F1',
        'SPE_E3': 'Microsoft 365 E3',
        'SPE_E5': 'Microsoft 365 E5',
        'SPE_F1': 'Microsoft 365 F1',
        'FLOW_FREE': 'Power Automate Free',
        'POWER_BI_STANDARD': 'Power BI Free',
        'POWER_BI_PRO': 'Power BI Pro',
        'POWER_BI_PREMIUM_PER_USER': 'Power BI Premium Per User',
        'PROJECTPREMIUM': 'Project Plan 5',
        'PROJECTPROFESSIONAL': 'Project Plan 3',
        'VISIOCLIENT': 'Visio Plan 2',
        'ATP_ENTERPRISE': 'Microsoft Defender for Office 365 P1',
        'THREAT_INTELLIGENCE': 'Microsoft Defender for Office 365 P2',
        'EMSPREMIUM': 'Enterprise Mobility + Security E5',
        'EMS': 'Enterprise Mobility + Security E3',
        'EXCHANGESTANDARD': 'Exchange Online Plan 1',
        'EXCHANGEENTERPRISE': 'Exchange Online Plan 2',
        'MCOSTANDARD': 'Skype for Business Online Plan 2',
        'TEAMS_EXPLORATORY': 'Microsoft Teams Exploratory',
        'TEAMS_FREE': 'Microsoft Teams Free',
        'WIN_DEF_ATP': 'Microsoft Defender for Endpoint',
        'IDENTITY_THREAT_PROTECTION': 'Microsoft 365 E5 Security',
        'AAD_PREMIUM': 'Azure AD Premium P1',
        'AAD_PREMIUM_P2': 'Azure AD Premium P2',
        'RIGHTSMANAGEMENT': 'Azure Information Protection P1',
        'INTUNE_A': 'Microsoft Intune Plan 1',
        'SHAREPOINTSTANDARD': 'SharePoint Online Plan 1',
        'SHAREPOINTENTERPRISE': 'SharePoint Online Plan 2',
        'MCOIMP': 'Skype for Business Online Plan 1',
        'OFFICESUBSCRIPTION': 'Microsoft 365 Apps for Enterprise',
        'M365_F1': 'Microsoft 365 F1',
        'SMB_BUSINESS': 'Microsoft 365 Apps for Business',
        'SMB_BUSINESS_ESSENTIALS': 'Microsoft 365 Business Basic',
        'SMB_BUSINESS_PREMIUM': 'Microsoft 365 Business Standard',
        'Microsoft_365_Copilot': 'Microsoft 365 Copilot',
      };
      return map[sku?.toUpperCase()] || map[sku] || sku;
    }

    // ===== COMPARAÇÃO COMPLETA 3 VIAS =====

    async function executarComparacaoCompleta(pedidoIdParam) {
      const pedidoId = pedidoIdParam || document.getElementById('licSelectPedido').value;
      if (!pedidoId) return;

      if (pedidoIdParam) {
        gotoPage('licencas');
        await new Promise(r => setTimeout(r, 100));
        populateLicSelectPedido();
        document.getElementById('licSelectPedido').value = pedidoId;
        onSelectPedidoComparar();
      }

      document.getElementById('licLoading').style.display = 'block';
      document.getElementById('licComparacaoResultado').style.display = 'none';
      document.getElementById('licComparacaoCompleta').style.display = 'none';
      document.getElementById('licLoadingText').textContent = 'Consultando portal e distribuidor...';

      try {
        const res = await authFetch(API_BASE + '/api/gdap/comparar-completo/' + encodeURIComponent(pedidoId));
        const data = await res.json();
        document.getElementById('licLoading').style.display = 'none';

        if (!res.ok) {
          alert(data.error || data.message || 'Erro ao comparar');
          return;
        }

        renderComparacaoCompleta(data);
      } catch (err) {
        document.getElementById('licLoading').style.display = 'none';
        alert('Erro de conexão: ' + err.message);
      }
    }

    function renderComparacaoCompleta(data) {
      document.getElementById('licComparacaoCompleta').style.display = 'block';

      // Alerta GDAP
      const gdapAlert = document.getElementById('lic3GdapAlert');
      if (data.gdapStatus === 'ativo') {
        gdapAlert.style.background = '#ecfdf5'; gdapAlert.style.border = '1px solid #6ee7b7'; gdapAlert.style.color = '#065f46';
        gdapAlert.innerHTML = '✅ <strong>Portal (GDAP)</strong> — Dados do portal do cliente lidos com sucesso.';
      } else if (data.gdapStatus === 'nao_configurado') {
        gdapAlert.style.background = '#fef2f2'; gdapAlert.style.border = '1px solid #fca5a5'; gdapAlert.style.color = '#991b1b';
        gdapAlert.innerHTML = '❌ <strong>Portal (GDAP)</strong> — Não configurado.';
      } else if (data.gdapStatus === 'pendente') {
        gdapAlert.style.background = '#fffbeb'; gdapAlert.style.border = '1px solid #fcd34d'; gdapAlert.style.color = '#92400e';
        gdapAlert.innerHTML = '⏳ <strong>Portal (GDAP)</strong> — Aguardando aceitação do cliente.';
      } else {
        gdapAlert.style.background = '#fef3c7'; gdapAlert.style.border = '1px solid #fbbf24'; gdapAlert.style.color = '#92400e';
        gdapAlert.innerHTML = '⚠️ <strong>Portal (GDAP)</strong> — ' + esc(data.gdapMessage || 'Indisponível.');
      }

      // Alerta Distribuidor
      const distAlert = document.getElementById('lic3DistAlert');
      const distLabel = data.distribuidorCategoria === 'ingram' ? 'Ingram Micro' : data.distribuidorCategoria === 'tds' ? 'TD SYNNEX' : 'Distribuidor';
      document.getElementById('lic3DistHeader').textContent = distLabel;

      if (data.distribuidorStatus === 'ativo') {
        distAlert.style.background = '#ecfdf5'; distAlert.style.border = '1px solid #6ee7b7'; distAlert.style.color = '#065f46';
        distAlert.innerHTML = '✅ <strong>' + esc(distLabel) + '</strong> — Dados de assinaturas lidos com sucesso.';
      } else if (data.distribuidorStatus === 'nao_configurado') {
        distAlert.style.background = '#fef2f2'; distAlert.style.border = '1px solid #fca5a5'; distAlert.style.color = '#991b1b';
        distAlert.innerHTML = '❌ <strong>' + esc(distLabel) + '</strong> — API não configurada. ' + esc(data.distribuidorMessage || '');
      } else if (data.distribuidorStatus === 'sem_revenda') {
        distAlert.style.background = '#fef3c7'; distAlert.style.border = '1px solid #fbbf24'; distAlert.style.color = '#92400e';
        distAlert.innerHTML = '⚠️ <strong>Distribuidor</strong> — ' + esc(data.distribuidorMessage || 'Nenhuma revenda Ingram/TDS no pedido.');
      } else {
        distAlert.style.background = '#fef2f2'; distAlert.style.border = '1px solid #fca5a5'; distAlert.style.color = '#991b1b';
        distAlert.innerHTML = '❌ <strong>' + esc(distLabel) + '</strong> — ' + esc(data.distribuidorMessage || 'Erro.');
      }

      // Tabela principal
      const comparacao = data.comparacao || [];
      const tbody = document.getElementById('lic3ComparacaoBody');

      if (!comparacao.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="color:var(--muted);font-weight:700;">Nenhuma licença para comparar</td></tr>';
        return;
      }

      tbody.innerHTML = comparacao.map(c => {
        // Resultado geral
        let resultadoHtml = '';
        let rowBg = '';
        switch (c.resultadoGeral) {
          case 'ok':
            resultadoHtml = '<span style="color:#10b981;font-weight:700;">✅ OK (3 vias)</span>';
            rowBg = 'background:#f0fdf4;';
            break;
          case 'parcial_portal':
            resultadoHtml = '<span style="color:#3b82f6;font-weight:700;">🔵 OK Portal</span>';
            rowBg = 'background:#eff6ff;';
            break;
          case 'parcial_distribuidor':
            resultadoHtml = '<span style="color:#8b5cf6;font-weight:700;">🟣 OK Dist.</span>';
            rowBg = 'background:#f5f3ff;';
            break;
          case 'qtd_divergente':
            resultadoHtml = '<span style="color:#f59e0b;font-weight:700;">⚠️ Qtd diverge</span>';
            rowBg = 'background:#fffbeb;';
            break;
          case 'suspensa':
            resultadoHtml = '<span style="color:#ef4444;font-weight:700;">🔴 Suspensa</span>';
            rowBg = 'background:#fef2f2;';
            break;
          case 'nao_encontrada':
            resultadoHtml = '<span style="color:#ef4444;font-weight:700;">❌ Não encontrada</span>';
            rowBg = 'background:#fef2f2;';
            break;
          default:
            resultadoHtml = '<span style="color:#6b7280;font-weight:600;">⏳ Pendente</span>';
            break;
        }

        // Portal
        const portalSku = c.portalMatch ? skuFriendlyName(c.portalMatch.skuPartNumber) : '—';
        const portalQtd = c.portalMatch ? c.portalMatch.total : '—';
        let portalStatusIcon = '';
        if (c.resultadoPortal === 'ok') portalStatusIcon = '✅';
        else if (c.resultadoPortal === 'qtd_divergente') portalStatusIcon = '⚠️';
        else if (c.resultadoPortal === 'suspensa') portalStatusIcon = '🔴';
        else if (c.resultadoPortal === 'nao_encontrada') portalStatusIcon = '❌';
        else portalStatusIcon = '—';

        // Distribuidor
        const distName = c.distribuidorMatch ? (c.distribuidorMatch.productName || c.distribuidorMatch.skuPartNumber) : '—';
        const distQtd = c.distribuidorMatch ? c.distribuidorMatch.quantity : '—';
        let distStatusIcon = '';
        if (c.resultadoDist === 'ok') distStatusIcon = '✅';
        else if (c.resultadoDist === 'qtd_divergente') distStatusIcon = '⚠️';
        else if (c.resultadoDist === 'suspensa') distStatusIcon = '🔴';
        else if (c.resultadoDist === 'nao_encontrada') distStatusIcon = '❌';
        else distStatusIcon = '—';

        return `
          <tr style="${rowBg}">
            <td><strong>${esc(c.produto)}</strong></td>
            <td style="text-align:center;font-weight:600;">${c.qtd || 1}</td>
            <td>${portalStatusIcon} ${c.portalMatch ? '<strong>' + esc(portalSku) + '</strong><div style="font-size:0.7rem;color:var(--muted);font-family:monospace;">' + esc(c.portalMatch.skuPartNumber) + '</div>' : '<span style="color:var(--muted);">—</span>'}</td>
            <td style="text-align:center;">${portalQtd}</td>
            <td>${distStatusIcon} ${c.distribuidorMatch ? '<strong>' + esc(distName) + '</strong><div style="font-size:0.7rem;color:var(--muted);font-family:monospace;">' + esc(c.distribuidorMatch.skuPartNumber || '') + '</div>' : '<span style="color:var(--muted);">—</span>'}</td>
            <td style="text-align:center;">${distQtd}</td>
            <td>${resultadoHtml}</td>
          </tr>
        `;
      }).join('');

      // Extras do portal não matching
      const matchedPortalSkus = new Set(comparacao.filter(c => c.portalMatch).map(c => c.portalMatch.skuPartNumber));
      const extrasPortal = (data.portal || []).filter(p => !matchedPortalSkus.has(p.skuPartNumber));

      const matchedDistSkus = new Set(comparacao.filter(c => c.distribuidorMatch).map(c => c.distribuidorMatch.skuPartNumber));
      const extrasDist = (data.distribuidor || []).filter(d => !matchedDistSkus.has(d.skuPartNumber));

      const extrasPanel = document.getElementById('lic3ExtrasPanel');
      const hasExtras = (extrasPortal.length > 0 && data.gdapStatus === 'ativo') || (extrasDist.length > 0 && data.distribuidorStatus === 'ativo');

      extrasPanel.style.display = hasExtras ? 'block' : 'none';

      // Portal extras
      const portalExtrasDiv = document.getElementById('lic3ExtrasPortal');
      if (extrasPortal.length > 0 && data.gdapStatus === 'ativo') {
        portalExtrasDiv.style.display = 'block';
        document.getElementById('lic3ExtrasPortalBody').innerHTML = extrasPortal.map(p => {
          const sc = p.capabilityStatus === 'Enabled' ? '#10b981' : '#f59e0b';
          return `<tr>
            <td><strong>${esc(skuFriendlyName(p.skuPartNumber))}</strong><div style="font-size:0.7rem;color:var(--muted);font-family:monospace;">${esc(p.skuPartNumber)}</div></td>
            <td><span style="color:${sc};font-weight:600;">${esc(p.capabilityStatus)}</span></td>
            <td>${p.total}</td><td>${p.consumed}</td>
            <td style="color:${p.available<=0?'#ef4444':'#10b981'};font-weight:700;">${p.available}</td>
          </tr>`;
        }).join('');
      } else {
        portalExtrasDiv.style.display = 'none';
      }

      // Distribuidor extras
      const distExtrasDiv = document.getElementById('lic3ExtrasDist');
      if (extrasDist.length > 0 && data.distribuidorStatus === 'ativo') {
        distExtrasDiv.style.display = 'block';
        document.getElementById('lic3ExtrasDistTitle').textContent = distLabel;
        document.getElementById('lic3ExtrasDistBody').innerHTML = extrasDist.map(d => {
          const ds = (d.status || '').toLowerCase();
          const dColor = ['active','ativo','enabled'].includes(ds) ? '#10b981' : '#f59e0b';
          return `<tr>
            <td><strong>${esc(d.productName || d.skuPartNumber)}</strong></td>
            <td style="font-family:monospace;font-size:0.8rem;">${esc(d.skuPartNumber)}</td>
            <td style="text-align:center;">${d.quantity}</td>
            <td><span style="color:${dColor};font-weight:600;">${esc(d.status)}</span></td>
          </tr>`;
        }).join('');
      } else {
        distExtrasDiv.style.display = 'none';
      }
    }

    // CSS animation for spinner
    if (!document.getElementById('spinStyle')) {
      const style = document.createElement('style');
      style.id = 'spinStyle';
      style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
      document.head.appendChild(style);
    }

    // ===== GLOBAL SEARCH =====
    function globalSearchGo(){
      const q = (document.getElementById('globalSearch')?.value || '').trim();
      if (!q) return;
      // Navigate to Pedidos page and apply search
      gotoPage('pedidos');
      const searchInput = document.getElementById('pedidosSearch');
      if (searchInput) { searchInput.value = q; }
      pedidosPage = 1;
      loadPedidos().then(() => renderPedidosTable());
    }

    // ===== AUDIT LOG =====
    async function loadAuditLog(){
      const acao = (document.getElementById('auditAcaoFilter')?.value || '').trim();
      const params = new URLSearchParams();
      if (acao) params.set('acao', acao);
      params.set('page', String(auditPage));
      params.set('pageSize', String(auditPageSize));

      const res = await authFetch(API_BASE + '/api/audit-log?' + params.toString());
      const data = await res.json().catch(() => ({}));
      const body = document.getElementById('auditBody');
      if (!res.ok || !data.logs?.length){
        body.innerHTML = '<tr><td colspan="6" style="color:var(--muted);font-weight:700;">Nenhum registro encontrado</td></tr>';
        return;
      }

      body.innerHTML = data.logs.map(l => {
        const dt = l.criado_em ? new Date(l.criado_em).toLocaleString('pt-BR') : '—';
        const acaoBadge = {
          'CRIAR_PEDIDO': '<span class="badge badge-success">Criar Pedido</span>',
          'EDITAR_PEDIDO': '<span class="badge badge-warning">Editar Pedido</span>',
          'EXCLUIR_PEDIDO': '<span class="badge badge-danger">Excluir Pedido</span>',
          'EXPORTAR_PEDIDOS': '<span class="badge badge-muted">Exportar</span>',
        }[l.acao] || `<span class="badge">${esc(l.acao)}</span>`;

        let detalhes = '';
        if (l.detalhes) {
          try {
            const d = JSON.parse(l.detalhes);
            detalhes = Object.entries(d).map(([k,v]) => `<b>${esc(k)}:</b> ${esc(String(v))}`).join('<br>');
          } catch { detalhes = esc(l.detalhes); }
        }

        return `<tr>
          <td style="white-space:nowrap;">${dt}</td>
          <td>${esc(l.usuario || '—')}</td>
          <td>${acaoBadge}</td>
          <td>${esc(l.entidade || '—')}</td>
          <td>${esc(l.entidade_id || '—')}</td>
          <td style="font-size:12px;max-width:300px;word-break:break-all;">${detalhes || '—'}</td>
        </tr>`;
      }).join('');

      // pagination
      const totalPages = data.totalPages || 1;
      const info = document.getElementById('auditPageInfo');
      const prevBtn = document.getElementById('auditPrevBtn');
      const nextBtn = document.getElementById('auditNextBtn');
      if (info) info.textContent = `Página ${data.page || auditPage} de ${totalPages}`;
      if (prevBtn) prevBtn.disabled = auditPage <= 1;
      if (nextBtn) nextBtn.disabled = auditPage >= totalPages;
    }

    function auditPrevPage() { auditPage = Math.max(1, auditPage - 1); loadAuditLog(); }
    function auditNextPage() { auditPage++; loadAuditLog(); }

    // ===== INIT =====
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape'){
        closeNewPedidoModal();
        closeSidebar();
      }
    });

    function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

    // initial load — auth já é validada pelo servidor via sessão
    loadAllData().catch(err => {
      if (err.message !== 'SESSION_EXPIRED') {
        console.error('Erro ao carregar dados:', err);
      }
    });
  