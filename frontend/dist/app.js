(function () {
  const API_BASE = ''; // 同源，由 nginx 代理 /api 到 backend
  let token = localStorage.getItem('token');
  let currentUsername = localStorage.getItem('username') || '';

  const $ = (id) => document.getElementById(id);
  const loginPage = $('login-page');
  const mainPage = $('main-page');
  const loginForm = $('login-form');
  const registerForm = $('register-form');
  const authMsg = $('auth-msg');
  const navUsername = $('nav-username');
  const logoutBtn = $('logout-btn');
  const recordList = $('record-list');
  const listEmpty = $('list-empty');
  const modal = $('modal');
  const recordForm = $('record-form');
  const modalTitle = $('modal-title');
  const modalCancel = $('modal-cancel');

  function showPage(showMain) {
    loginPage.classList.toggle('hidden', showMain);
    mainPage.classList.toggle('hidden', !showMain);
  }

  function setAuthMessage(text) {
    authMsg.textContent = text || '';
  }

  function api(url, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return fetch((API_BASE || '') + url, { ...options, headers }).then((res) => {
      const contentType = res.headers.get('content-type');
      const isJson = contentType && contentType.includes('application/json');
      const body = isJson ? res.json() : res.text();
      return body.then((data) => {
        if (res.ok) return data;
        const err = new Error(data.message || data || '请求失败');
        err.code = data.code;
        err.data = data;
        throw err;
      });
    });
  }

  function formatDate(v) {
    if (!v) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return s.slice(0, 10);
  }

  function renderRecords(list) {
    recordList.innerHTML = '';
    const arr = Array.isArray(list) ? list : [];
    if (arr.length === 0) {
      listEmpty.classList.remove('hidden');
      return;
    }
    listEmpty.classList.add('hidden');
    arr.forEach((r) => {
      const li = document.createElement('li');
      const dateStr = formatDate(r.record_date || r.created_at);
      li.innerHTML = `
        <span>
          <span class="type ${r.type}">${r.type === 'income' ? '收入' : '支出'}</span>
          <span class="category">${escapeHtml(r.category || '')}</span>
          <span class="date">${dateStr}</span>
          ${r.note ? '<br><span class="note" style="font-size:0.85rem;opacity:0.8">' + escapeHtml(r.note) + '</span>' : ''}
        </span>
        <span>
          <span class="amount ${r.type}">${r.type === 'income' ? '+' : '-'}${Number(r.amount).toFixed(2)}</span>
          <button type="button" class="del" data-id="${r.id}">删除</button>
        </span>
      `;
      li.querySelector('.del').addEventListener('click', () => deleteRecord(r.id));
      recordList.appendChild(li);
    });
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function loadSummary() {
    const start = $('filter-start').value;
    const end = $('filter-end').value;
    let url = '/api/summary';
    if (start || end) url += '?' + new URLSearchParams({ startDate: start || '', endDate: end || '' }).toString();
    api(url)
      .then((d) => {
        $('sum-income').textContent = (d.income || 0).toFixed(2);
        $('sum-expense').textContent = (d.expense || 0).toFixed(2);
        $('sum-balance').textContent = (d.balance || 0).toFixed(2);
      })
      .catch(() => {});
  }

  function loadRecords() {
    const start = $('filter-start').value;
    const end = $('filter-end').value;
    const type = $('filter-type').value;
    const params = new URLSearchParams({ page: 1, pageSize: 50 });
    if (start) params.set('startDate', start);
    if (end) params.set('endDate', end);
    if (type) params.set('type', type);
    api('/api/records?' + params.toString())
      .then((d) => {
        const list = Array.isArray(d && d.list) ? d.list : [];
        renderRecords(list);
      })
      .catch((e) => {
        console.error('列表加载失败', e);
        renderRecords([]);
      });
    loadSummary();
  }

  function deleteRecord(id) {
    if (!confirm('确定删除这条记录？')) return;
    api('/api/records/' + id, { method: 'DELETE' })
      .then(() => loadRecords())
      .catch((e) => alert(e.message || '删除失败'));
  }

  function openModal(type) {
    recordForm.querySelector('[name="type"]').value = type;
    modalTitle.textContent = type === 'income' ? '记收入' : '记支出';
    recordForm.querySelector('[name="amount"]').value = '';
    recordForm.querySelector('[name="category"]').value = '';
    recordForm.querySelector('[name="note"]').value = '';
    recordForm.querySelector('[name="record_date"]').value = new Date().toISOString().slice(0, 10);
    modal.classList.remove('hidden');
  }

  function closeModal() {
    modal.classList.add('hidden');
  }

  function initMainPage() {
    navUsername.textContent = currentUsername || '用户';
    const today = new Date().toISOString().slice(0, 10);
    const firstDay = today.slice(0, 8) + '01';
    $('filter-start').value = firstDay;
    $('filter-end').value = today;
    loadRecords();
  }

  // 登录
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    setAuthMessage('');
    const username = loginForm.username.value.trim();
    const password = loginForm.password.value;
    api('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) })
      .then((d) => {
        token = d.token;
        currentUsername = d.username;
        localStorage.setItem('token', token);
        localStorage.setItem('username', currentUsername);
        setAuthMessage('');
        showPage(true);
        initMainPage();
      })
      .catch((e) => setAuthMessage(e.message || '登录失败'));
  });

  // 注册
  registerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    setAuthMessage('');
    const username = registerForm.username.value.trim();
    const password = registerForm.password.value;
    api('/api/register', { method: 'POST', body: JSON.stringify({ username, password }) })
      .then((d) => {
        token = d.token;
        currentUsername = d.username;
        localStorage.setItem('token', token);
        localStorage.setItem('username', currentUsername);
        setAuthMessage('');
        showPage(true);
        initMainPage();
      })
      .catch((e) => setAuthMessage(e.message || '注册失败'));
  });

  $('logout-btn').addEventListener('click', () => {
    token = '';
    currentUsername = '';
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    showPage(false);
    setAuthMessage('');
  });

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const t = tab.dataset.tab;
      document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
      tab.classList.add('active');
      loginForm.classList.toggle('hidden', t !== 'login');
      registerForm.classList.toggle('hidden', t !== 'register');
      setAuthMessage('');
    });
  });

  $('add-income').addEventListener('click', () => openModal('income'));
  $('add-expense').addEventListener('click', () => openModal('expense'));
  $('filter-btn').addEventListener('click', loadRecords);
  modalCancel.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  recordForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(recordForm);
    const body = {
      type: fd.get('type'),
      amount: parseFloat(fd.get('amount')),
      category: fd.get('category') || '其他',
      note: fd.get('note') || '',
      record_date: fd.get('record_date'),
    };
    api('/api/records', { method: 'POST', body: JSON.stringify(body) })
      .then(() => { closeModal(); loadRecords(); })
      .catch((e) => alert(e.message || '保存失败'));
  });

  if (token) {
    api('/api/me')
      .then(() => { showPage(true); initMainPage(); })
      .catch(() => { token = ''; localStorage.removeItem('token'); showPage(false); });
  } else {
    showPage(false);
  }
})();
