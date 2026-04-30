// Show error message if redirected with error param
(function(){
  const params = new URLSearchParams(window.location.search);
  if (params.has('error')) {
    const errorEl = document.getElementById('loginError');
    const msgEl = document.getElementById('loginErrorMsg');
    const msg = params.get('error');
    if (msg === 'unauthorized') msgEl.textContent = 'Acesso negado. Você não tem permissão para acessar o sistema.';
    else if (msg === 'expired') msgEl.textContent = 'Sua sessão expirou. Faça login novamente.';
    else msgEl.textContent = 'Falha na autenticação. Tente novamente.';
    errorEl.classList.add('show');
  }
})();
