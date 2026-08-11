// dashboard.js - comportamento da sidebar recolhível e acessível
(function(){
  const TOGGLE_KEY = 'bp_sidebar_collapsed_v2';
  const sidebar = document.getElementById('sidebar');
  const toggle = document.getElementById('sidebarToggle');
  const main = document.getElementById('main');
  const navItems = Array.from(document.querySelectorAll('.nav-item'));

  function isCollapsed(){ return document.body.classList.contains('sidebar-collapsed'); }

  function setCollapsed(collapsed, save=true){
    if(collapsed) document.body.classList.add('sidebar-collapsed');
    else document.body.classList.remove('sidebar-collapsed');
    if(save) localStorage.setItem(TOGGLE_KEY, collapsed ? '1' : '0');
    if(toggle) toggle.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
  }

  function updateToggleIcon(){
    if(!toggle) return;
    const svg = toggle.querySelector('svg');
    if(!svg) return;
    svg.style.transform = isCollapsed() ? 'rotate(180deg)' : 'rotate(0deg)';
  }

  function init(){
    if(!toggle) return;
    // Restore state
    const saved = localStorage.getItem(TOGGLE_KEY);
    setCollapsed(saved === '1', false);
    updateToggleIcon();

    toggle.addEventListener('click', () => {
      setCollapsed(!isCollapsed());
      updateToggleIcon();
    });

    // Allow keyboard toggle with Enter/Space
    toggle.addEventListener('keydown', (e) => {
      if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle.click(); }
    });

    // set data-tooltip attributes for collapsed hover labels
    navItems.forEach(item => {
      const label = item.querySelector('.nav-label');
      if(label) item.setAttribute('data-tooltip', label.textContent.trim());
      // keyboard navigation: focus changes active visual state
      item.addEventListener('click', (e)=>{
        navItems.forEach(i=>i.classList.remove('active'));
        item.classList.add('active');
        // update topbar title if exists
        const topbarTitle = document.querySelector('.topbar-title');
        if(topbarTitle) topbarTitle.textContent = label ? label.textContent.trim() : '';
        e.preventDefault();
      });
    });

    // Handle small screens: make sidebar overlay
    const mq = window.matchMedia('(max-width:900px)');
    function handleSmall(e){
      if(e.matches){
        // mobile
        document.body.classList.remove('sidebar-collapsed');
        // allow hamburger to toggle a class that slides sidebar in
        const hamburger = document.getElementById('hamburger');
        if(hamburger){
          hamburger.addEventListener('click', ()=>{
            document.body.classList.toggle('sidebar-open-mobile');
            const expanded = document.body.classList.contains('sidebar-open-mobile');
            hamburger.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            if(expanded) sidebar.style.transform = 'translateX(0)';
            else sidebar.style.transform = '';
          });
        }
      } else {
        document.body.classList.remove('sidebar-open-mobile');
        sidebar.style.transform = '';
      }
    }
    handleSmall(mq);
    mq.addEventListener('change', handleSmall);
  }

  document.addEventListener('DOMContentLoaded', init);
})();