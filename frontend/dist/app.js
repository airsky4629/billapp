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
  const viewTitleEl = $('view-title');
  const groupSummaryEl = $('group-summary');
  const filterSection = $('filter-section');

  let currentView = 'list'; // 'list' | 'week' | 'month'

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

  // 本周一至周日（周一为一周开始）
  function getWeekRange() {
    const d = new Date();
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const mon = new Date(d);
    mon.setDate(d.getDate() + diff);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return {
      start: mon.toISOString().slice(0, 10),
      end: sun.toISOString().slice(0, 10),
    };
  }

  // 本月 1 号至月末
  function getMonthRange() {
    const d = new Date();
    const y = d.getFullYear();
    const m = d.getMonth();
    const start = y + '-' + String(m + 1).padStart(2, '0') + '-01';
    const last = new Date(y, m + 1, 0);
    const end = y + '-' + String(last.getMonth() + 1).padStart(2, '0') + '-' + String(last.getDate()).padStart(2, '0');
    return { start, end };
  }

  function formatDayLabel(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const weekNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const w = weekNames[d.getDay()];
    return m + '月' + day + '日 ' + w;
  }

  function setView(view) {
    currentView = view;
    document.querySelectorAll('.view-tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
    if (view === 'week') {
      const r = getWeekRange();
      $('filter-start').value = r.start;
      $('filter-end').value = r.end;
      viewTitleEl.textContent = '本周 ' + r.start + ' ~ ' + r.end;
      viewTitleEl.classList.remove('hidden');
      filterSection.classList.add('hidden');
      groupSummaryEl.classList.remove('hidden');
    } else if (view === 'month') {
      const r = getMonthRange();
      $('filter-start').value = r.start;
      $('filter-end').value = r.end;
      const d = new Date();
      viewTitleEl.textContent = '本月 ' + d.getFullYear() + '年' + (d.getMonth() + 1) + '月';
      viewTitleEl.classList.remove('hidden');
      filterSection.classList.add('hidden');
      groupSummaryEl.classList.remove('hidden');
    } else {
      viewTitleEl.classList.add('hidden');
      groupSummaryEl.classList.add('hidden');
      filterSection.classList.remove('hidden');
    }
    loadRecords();
  }

  function renderGroupSummary(view, list) {
    const arr = Array.isArray(list) ? list : [];
    if (arr.length === 0 || (view !== 'week' && view !== 'month')) {
      groupSummaryEl.innerHTML = '';
      groupSummaryEl.classList.add('hidden');
      return;
    }
    groupSummaryEl.classList.remove('hidden');
    if (view === 'week') {
      const byDay = {};
      arr.forEach((r) => {
        const d = formatDate(r.record_date || r.created_at);
        if (!byDay[d]) byDay[d] = { income: 0, expense: 0, items: [] };
        byDay[d].items.push(r);
        if (r.type === 'income') byDay[d].income += Number(r.amount);
        else byDay[d].expense += Number(r.amount);
      });
      const days = Object.keys(byDay).sort();
      groupSummaryEl.innerHTML = '<h4 class="group-summary-title">按日汇总</h4>' + days.map((d) => {
        const g = byDay[d];
        const balance = g.income - g.expense;
        return '<div class="group-block"><div class="group-head">' + formatDayLabel(d) + '</div><div class="group-row"><span>收入</span><span class="amount income">+' + g.income.toFixed(2) + '</span></div><div class="group-row"><span>支出</span><span class="amount expense">-' + g.expense.toFixed(2) + '</span></div><div class="group-row"><span>结余</span><span class="amount balance">' + balance.toFixed(2) + '</span></div></div>';
      }).join('');
      return;
    }
    if (view === 'month') {
      const getWeekKey = (dateStr) => {
        const d = new Date(dateStr + 'T12:00:00');
        const day = d.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        const mon = new Date(d);
        mon.setDate(d.getDate() + diff);
        const sun = new Date(mon);
        sun.setDate(mon.getDate() + 6);
        const m1 = mon.getMonth() + 1;
        const d1 = mon.getDate();
        const m2 = sun.getMonth() + 1;
        const d2 = sun.getDate();
        return { key: mon.toISOString().slice(0, 10), label: m1 + '/' + d1 + ' - ' + m2 + '/' + d2 };
      };
      const byWeek = {};
      arr.forEach((r) => {
        const d = formatDate(r.record_date || r.created_at);
        const { key, label } = getWeekKey(d);
        if (!byWeek[key]) byWeek[key] = { label, income: 0, expense: 0 };
        if (r.type === 'income') byWeek[key].income += Number(r.amount);
        else byWeek[key].expense += Number(r.amount);
      });
      const weeks = Object.keys(byWeek).sort();
      groupSummaryEl.innerHTML = '<h4 class="group-summary-title">按周汇总</h4>' + weeks.map((k) => {
        const g = byWeek[k];
        const balance = g.income - g.expense;
        return '<div class="group-block"><div class="group-head">' + escapeHtml(g.label) + '</div><div class="group-row"><span>收入</span><span class="amount income">+' + g.income.toFixed(2) + '</span></div><div class="group-row"><span>支出</span><span class="amount expense">-' + g.expense.toFixed(2) + '</span></div><div class="group-row"><span>结余</span><span class="amount balance">' + balance.toFixed(2) + '</span></div></div>';
      }).join('');
    }
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
        if (currentView === 'week' || currentView === 'month') renderGroupSummary(currentView, list);
      })
      .catch((e) => {
        console.error('列表加载失败', e);
        renderRecords([]);
        if (currentView === 'week' || currentView === 'month') groupSummaryEl.classList.add('hidden');
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

  document.querySelectorAll('.view-tab').forEach((tab) => {
    tab.addEventListener('click', () => setView(tab.dataset.view));
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
