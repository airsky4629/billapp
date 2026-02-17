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
  const calendarWrap = $('calendar-wrap');
  const filterSection = $('filter-section');
  const periodNav = $('period-nav');
  const periodLabel = $('period-label');
  const periodPrev = $('period-prev');
  const periodNext = $('period-next');
  const filterTypeBtn = $('filter-type-btn');
  const filterTypeInput = $('filter-type');
  const typePickerModal = $('type-picker-modal');
  const pickerCancel = $('picker-cancel');
  const recordDateInput = $('record-date');
  const datePickerModal = $('date-picker-modal');
  const datePickerCancel = $('date-picker-cancel');
  const datePickerOk = $('date-picker-ok');
  const dateWheelYear = $('date-wheel-year');
  const dateWheelMonth = $('date-wheel-month');
  const dateWheelDay = $('date-wheel-day');
  const categoryBtn = $('category-btn');
  const categoryPickerModal = $('category-picker-modal');
  const categoryPickerCancel = $('category-picker-cancel');

  let currentView = 'list'; // 'list' | 'week' | 'month' | 'year' | 'day'
  let calendarWeekStart = null; // Date 周一
  let calendarMonth = null;   // { y, m }
  let calendarYear = null;    // number
  let calendarDay = null;     // string YYYY-MM-DD

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

  function toLocalDateStr(d) {
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    return y + '-' + String(m).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }

  function getThisWeekMonday() {
    const d = new Date();
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
  }

  function getWeekRangeFromMonday(mon) {
    const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
    return { start: toLocalDateStr(mon), end: toLocalDateStr(sun) };
  }

  function getMonthRangeFromYM(y, m) {
    const start = y + '-' + String(m).padStart(2, '0') + '-01';
    const last = new Date(y, m, 0);
    return { start, end: toLocalDateStr(last) };
  }

  function getYearRange(y) {
    return { start: y + '-01-01', end: y + '-12-31' };
  }

  function formatDayLabel(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    const weekNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + weekNames[d.getDay()];
  }

  function setView(view) {
    try {
      currentView = view;
      var tabs = document.querySelectorAll('.view-tab');
      if (tabs.length) tabs.forEach(function(t) { t.classList.toggle('active', t.dataset.view === view); });
      var filterStart = $('filter-start');
      var filterEnd = $('filter-end');
      var filterDates = $('filter-dates');
      if (filterSection) filterSection.classList.remove('hidden');
      if (view === 'list') {
        if (calendarWrap) calendarWrap.classList.add('hidden');
        if (periodNav) periodNav.classList.add('hidden');
        if (filterDates) filterDates.classList.add('hidden');
        loadRecords();
        return;
      }
      if (filterDates) filterDates.classList.add('hidden');
      if (periodNav) periodNav.classList.toggle('hidden', view !== 'year');
      if (calendarWrap) calendarWrap.classList.remove('hidden');
      var r;
      var now = new Date();
      if (view === 'week') {
        if (!calendarWeekStart) calendarWeekStart = getThisWeekMonday();
        r = getWeekRangeFromMonday(calendarWeekStart);
        if (filterStart) filterStart.value = r.start;
        if (filterEnd) filterEnd.value = r.end;
        if (periodLabel) periodLabel.textContent = r.start + ' 周';
      } else if (view === 'month') {
        if (!calendarMonth) calendarMonth = { y: now.getFullYear(), m: now.getMonth() + 1 };
        r = getMonthRangeFromYM(calendarMonth.y, calendarMonth.m);
        if (filterStart) filterStart.value = r.start;
        if (filterEnd) filterEnd.value = r.end;
        if (periodLabel) periodLabel.textContent = calendarMonth.y + '年' + calendarMonth.m + '月';
      } else if (view === 'year') {
        if (!calendarYear) calendarYear = now.getFullYear();
        r = getYearRange(calendarYear);
        if (filterStart) filterStart.value = r.start;
        if (filterEnd) filterEnd.value = r.end;
        if (periodLabel) periodLabel.textContent = calendarYear + '年';
      } else if (view === 'day') {
        if (!calendarDay) calendarDay = toLocalDateStr(now);
        if (filterStart) filterStart.value = calendarDay;
        if (filterEnd) filterEnd.value = calendarDay;
        if (periodLabel) periodLabel.textContent = calendarDay;
      }
      loadRecords();
    } catch (e) {
      console.error('setView error', e);
      if (filterSection) filterSection.classList.remove('hidden');
      if (calendarWrap) calendarWrap.classList.add('hidden');
      if (periodNav) periodNav.classList.add('hidden');
    }
  }

  function renderWeekCalendar(list) {
    if (!calendarWrap) return;
    var arr = Array.isArray(list) ? list : [];
    var byDay = {};
    for (var i = 0; i < 7; i++) {
      var d = new Date(calendarWeekStart.getFullYear(), calendarWeekStart.getMonth(), calendarWeekStart.getDate() + i);
      var key = toLocalDateStr(d);
      byDay[key] = { income: 0, expense: 0, dateStr: key };
    }
    arr.forEach(function(r) {
      var key = formatDate(r.record_date || r.created_at);
      if (byDay[key]) {
        if (r.type === 'income') byDay[key].income += Number(r.amount);
        else byDay[key].expense += Number(r.amount);
      }
    });
    var weekNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    var html = '<div class="cal-week"><div class="cal-week-head">';
    for (var i = 0; i < 7; i++) {
      var d = new Date(calendarWeekStart.getFullYear(), calendarWeekStart.getMonth(), calendarWeekStart.getDate() + i);
      var key = toLocalDateStr(d);
      var cell = byDay[key] || { income: 0, expense: 0, dateStr: key };
      html += '<div class="cal-week-cell clickable" data-date="' + key + '"><span class="cal-d">' + (d.getMonth() + 1) + '/' + d.getDate() + '</span><span class="cal-w">' + weekNames[i] + '</span><span class="cal-inc">+' + (cell.income || 0).toFixed(0) + '</span><span class="cal-exp">-' + (cell.expense || 0).toFixed(0) + '</span></div>';
    }
    html += '</div></div>';
    calendarWrap.innerHTML = html;
    calendarWrap.classList.remove('hidden');
    calendarWrap.querySelectorAll('.cal-week-cell.clickable').forEach(function(el) {
      el.addEventListener('click', function() {
        var dateStr = el.getAttribute('data-date');
        if (dateStr) {
          calendarDay = dateStr;
          setView('day');
        }
      });
    });
  }

  function renderMonthCalendar(list) {
    if (!calendarWrap) return;
    var arr = Array.isArray(list) ? list : [];
    var y = calendarMonth.y;
    var m = calendarMonth.m;
    var first = new Date(y, m - 1, 1);
    var last = new Date(y, m, 0);
    var byDay = {};
    for (var d = 1; d <= last.getDate(); d++) {
      var key = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      byDay[key] = { income: 0, expense: 0 };
    }
    arr.forEach(function(r) {
      var key = formatDate(r.record_date || r.created_at);
      if (byDay[key]) {
        if (r.type === 'income') byDay[key].income += Number(r.amount);
        else byDay[key].expense += Number(r.amount);
      }
    });
    var startDow = first.getDay();
    var startBlank = startDow === 0 ? 6 : startDow - 1;
    var html = '<div class="cal-month"><div class="cal-month-row cal-month-head"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>';
    var row = [];
    for (var i = 0; i < startBlank; i++) row.push('<div class="cal-day empty"></div>');
    for (var d = 1; d <= last.getDate(); d++) {
      var key = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      var cell = byDay[key] || { income: 0, expense: 0 };
      var incText = cell.income ? ('+' + (cell.income || 0).toFixed(0)) : '';
      var expText = cell.expense ? ('-' + (cell.expense || 0).toFixed(0)) : '';
      row.push(
        '<div class="cal-day clickable" data-date="' + key + '">' +
          '<span class="cal-n">' + d + '</span>' +
          '<span class="cal-inc">' + incText + '</span>' +
          '<span class="cal-exp">' + expText + '</span>' +
        '</div>'
      );
      if (row.length === 7) { html += '<div class="cal-month-row">' + row.join('') + '</div>'; row = []; }
    }
    if (row.length) { while (row.length < 7) row.push('<div class="cal-day empty"></div>'); html += '<div class="cal-month-row">' + row.join('') + '</div>'; }
    html += '</div>';
    calendarWrap.innerHTML = html;
    calendarWrap.classList.remove('hidden');
    calendarWrap.querySelectorAll('.cal-day.clickable').forEach(function(el) {
      el.addEventListener('click', function() {
        var dateStr = el.getAttribute('data-date');
        if (dateStr) {
          var d = new Date(dateStr + 'T12:00:00');
          var day = d.getDay();
          var diff = day === 0 ? -6 : 1 - day;
          calendarWeekStart = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
          setView('week');
        }
      });
    });
  }

  function renderYearCalendar(list) {
    if (!calendarWrap) return;
    var arr = Array.isArray(list) ? list : [];
    var byMonth = {};
    for (var mo = 1; mo <= 12; mo++) byMonth[mo] = { income: 0, expense: 0 };
    arr.forEach(function(r) {
      var key = formatDate(r.record_date || r.created_at);
      var mo = parseInt(key.slice(5, 7), 10);
      if (byMonth[mo]) {
        if (r.type === 'income') byMonth[mo].income += Number(r.amount);
        else byMonth[mo].expense += Number(r.amount);
      }
    });
    var html = '<div class="cal-year">';
    for (var mo = 1; mo <= 12; mo++) {
      var g = byMonth[mo];
      var incTxt = g.income ? ('+' + (g.income || 0).toFixed(0)) : '';
      var expTxt = g.expense ? ('-' + (g.expense || 0).toFixed(0)) : '';
      html += '<div class="cal-year-card clickable" data-month="' + mo + '"><div class="cal-year-title">' + mo + '月</div><div class="cal-year-row"><span class="amount income">' + incTxt + '</span></div><div class="cal-year-row"><span class="amount expense">' + expTxt + '</span></div></div>';
    }
    html += '</div>';
    calendarWrap.innerHTML = html;
    calendarWrap.classList.remove('hidden');
    calendarWrap.querySelectorAll('.cal-year-card.clickable').forEach(function(el) {
      el.addEventListener('click', function() {
        var month = parseInt(el.getAttribute('data-month'), 10);
        if (month >= 1 && month <= 12) {
          calendarMonth = { y: calendarYear, m: month };
          setView('month');
        }
      });
    });
  }

  function renderDayCalendar(list) {
    if (!calendarWrap) return;
    var arr = Array.isArray(list) ? list : [];
    var dayRecords = arr.filter(function(r) {
      var key = formatDate(r.record_date || r.created_at);
      return key === calendarDay;
    });
    var income = 0, expense = 0;
    dayRecords.forEach(function(r) {
      if (r.type === 'income') income += Number(r.amount);
      else expense += Number(r.amount);
    });
    var balance = income - expense;
    var html = '<div class="cal-day-view">';
    html += '<div class="cal-day-summary"><div class="cal-day-item"><span class="label">收入</span><span class="amount income">' + income.toFixed(2) + '</span></div>';
    html += '<div class="cal-day-item"><span class="label">支出</span><span class="amount expense">' + expense.toFixed(2) + '</span></div>';
    html += '<div class="cal-day-item"><span class="label">结余</span><span class="amount balance">' + balance.toFixed(2) + '</span></div></div>';
    if (dayRecords.length === 0) {
      html += '<p class="empty">该日暂无记录</p>';
    } else {
      html += '<ul class="cal-day-list">';
      dayRecords.forEach(function(r) {
        html += '<li class="cal-day-record"><span class="type ' + r.type + '">' + (r.type === 'income' ? '收入' : '支出') + '</span><span class="category">' + escapeHtml(r.category || '') + '</span><span class="amount ' + r.type + '">' + (r.type === 'income' ? '+' : '-') + Number(r.amount).toFixed(2) + '</span></li>';
      });
      html += '</ul>';
    }
    html += '</div>';
    calendarWrap.innerHTML = html;
    calendarWrap.classList.remove('hidden');
  }

  function renderCalendar(view, list) {
    if (view === 'week' && calendarWeekStart) renderWeekCalendar(list);
    else if (view === 'month' && calendarMonth) renderMonthCalendar(list);
    else if (view === 'year' && calendarYear) renderYearCalendar(list);
    else if (view === 'day' && calendarDay) renderDayCalendar(list);
    else if (calendarWrap) { calendarWrap.innerHTML = ''; calendarWrap.classList.add('hidden'); }
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
      const typeText = r.type === 'income' ? '收入' : '支出';
      const amountText = (r.type === 'income' ? '+' : '-') + Number(r.amount).toFixed(2);
      const noteText = escapeHtml(r.note || '');
      li.innerHTML = `
        <span class="rec-date">${dateStr}</span>
        <span class="rec-type type ${r.type}">${typeText}</span>
        <span class="rec-amount amount ${r.type}">${amountText}</span>
        <span class="rec-note">${noteText}</span>
        <button type="button" class="del" data-id="${r.id}">删除</button>
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
    if (currentView === 'list') {
      let url = '/api/summary';
      api(url)
        .then((d) => {
          $('sum-income').textContent = (d.income || 0).toFixed(2);
          $('sum-expense').textContent = (d.expense || 0).toFixed(2);
          $('sum-balance').textContent = (d.balance || 0).toFixed(2);
        })
        .catch(() => {});
      return;
    }
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
    var filterStart = $('filter-start');
    var filterEnd = $('filter-end');
    var start = filterStart ? filterStart.value : '';
    var end = filterEnd ? filterEnd.value : '';
    var type = (filterTypeInput && filterTypeInput.value) || '';
    var pageSize = currentView === 'year' ? 500 : 100;
    var params = new URLSearchParams({ page: 1, pageSize: pageSize });
    if (currentView !== 'list') {
      if (start) params.set('startDate', start);
      if (end) params.set('endDate', end);
    }
    if (type) params.set('type', type);
    api('/api/records?' + params.toString())
      .then(function(d) {
        var list = Array.isArray(d && d.list) ? d.list : [];
        if (currentView === 'day') {
          renderRecords(list);
          renderCalendar(currentView, list);
        } else {
          renderRecords(list);
          if (currentView === 'week' || currentView === 'month' || currentView === 'year') renderCalendar(currentView, list);
        }
      })
      .catch(function(e) {
        console.error('列表加载失败', e);
        renderRecords([]);
        if ((currentView === 'week' || currentView === 'month' || currentView === 'year' || currentView === 'day') && calendarWrap) calendarWrap.classList.add('hidden');
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
    recordForm.querySelector('[name="record_date"]').value = toLocalDateStr(new Date());
    if (categoryBtn) {
      // 分类输入框本身就是触发器（readonly input）
      if ('value' in categoryBtn) categoryBtn.value = '';
    }
    modal.classList.remove('hidden');
  }

  function closeModal() {
    modal.classList.add('hidden');
  }

  // 日期选择滚轮（年 / 月 / 日）
  const DATE_WHEEL_ITEM_HEIGHT = 44;
  let datePickerY = null;
  let datePickerM = null;
  let datePickerD = null;
  let yearValues = [];
  let monthValues = [];
  let dayValues = [];

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function parseYMD(s) {
    const m = String(s || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) return null;
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const d = parseInt(m[3], 10);
    if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return { y, m: mo, d };
  }

  function daysInMonth(y, m) {
    return new Date(y, m, 0).getDate(); // m: 1-12
  }

  function setWheel(el, values, selectedValue, format) {
    if (!el) return 0;
    el.innerHTML = values.map(v => (
      `<div class="date-wheel-item" data-value="${v}">${format ? format(v) : v}</div>`
    )).join('');
    const idx = Math.max(0, values.indexOf(selectedValue));
    el.scrollTop = idx * DATE_WHEEL_ITEM_HEIGHT;
    updateWheelSelected(el, idx);
    return idx;
  }

  function updateWheelSelected(el, idx) {
    if (!el) return;
    const items = el.querySelectorAll('.date-wheel-item');
    items.forEach((it, i) => it.classList.toggle('selected', i === idx));
  }

  function snapWheel(el, values) {
    if (!el || !values || !values.length) return null;
    const maxIdx = values.length - 1;
    let idx = Math.round(el.scrollTop / DATE_WHEEL_ITEM_HEIGHT);
    if (idx < 0) idx = 0;
    if (idx > maxIdx) idx = maxIdx;
    el.scrollTo({ top: idx * DATE_WHEEL_ITEM_HEIGHT, behavior: 'smooth' });
    updateWheelSelected(el, idx);
    return values[idx];
  }

  function rebuildDayWheel() {
    if (datePickerY == null || datePickerM == null) return;
    const dim = daysInMonth(datePickerY, datePickerM);
    dayValues = Array.from({ length: dim }, (_, i) => i + 1);
    if (datePickerD == null) datePickerD = 1;
    if (datePickerD > dim) datePickerD = dim;
    setWheel(dateWheelDay, dayValues, datePickerD, (v) => `${v}日`);
  }

  function openDatePicker() {
    if (!datePickerModal || !recordDateInput) return;
    const parsed = parseYMD(recordDateInput.value) || parseYMD(toLocalDateStr(new Date()));
    const now = new Date();
    datePickerY = parsed ? parsed.y : now.getFullYear();
    datePickerM = parsed ? parsed.m : (now.getMonth() + 1);
    datePickerD = parsed ? parsed.d : now.getDate();

    const baseStart = now.getFullYear() - 10;
    const baseEnd = now.getFullYear() + 10;
    const startY = Math.min(baseStart, datePickerY);
    const endY = Math.max(baseEnd, datePickerY);
    yearValues = [];
    for (let y = startY; y <= endY; y++) yearValues.push(y);
    monthValues = Array.from({ length: 12 }, (_, i) => i + 1);

    datePickerModal.classList.remove('hidden');

    // 某些浏览器/移动端在 display:none -> block 后，scrollTop 需要下一帧再设置才会生效
    requestAnimationFrame(() => {
      setWheel(dateWheelYear, yearValues, datePickerY, (v) => `${v}年`);
      setWheel(dateWheelMonth, monthValues, datePickerM, (v) => `${v}月`);
      rebuildDayWheel();
    });
  }

  function closeDatePicker() {
    if (datePickerModal) datePickerModal.classList.add('hidden');
  }

  function applyDatePicker() {
    if (!recordDateInput) return;
    if (datePickerY == null || datePickerM == null || datePickerD == null) return;
    recordDateInput.value = `${datePickerY}-${pad2(datePickerM)}-${pad2(datePickerD)}`;
    closeDatePicker();
  }

  function bindWheel(el, getValues, onValue) {
    if (!el) return;
    let t = null;
    el.addEventListener('scroll', () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        const values = getValues();
        const v = snapWheel(el, values);
        if (v != null) onValue(v);
      }, 80);
    });
    el.addEventListener('click', (e) => {
      const item = e.target && e.target.closest && e.target.closest('.date-wheel-item');
      if (!item) return;
      const values = getValues();
      const v = parseInt(item.getAttribute('data-value'), 10);
      const idx = values.indexOf(v);
      if (idx >= 0) el.scrollTo({ top: idx * DATE_WHEEL_ITEM_HEIGHT, behavior: 'smooth' });
    });
  }

  function openTypePicker() {
    if (!typePickerModal) return;
    const currentValue = (filterTypeInput && filterTypeInput.value) || '';
    const options = typePickerModal.querySelectorAll('.picker-option');
    options.forEach(opt => {
      const optValue = opt.getAttribute('data-value');
      opt.classList.remove('selected');
      if (optValue === currentValue) {
        opt.classList.add('selected');
      }
    });
    typePickerModal.classList.remove('hidden');
  }

  function closeTypePicker() {
    if (typePickerModal) typePickerModal.classList.add('hidden');
  }

  function selectType(value, label) {
    if (filterTypeInput) filterTypeInput.value = value;
    const filterTypeLabel = $('filter-type-label');
    if (filterTypeLabel) {
      // 移除可能存在的✓符号
      const cleanLabel = label.replace('✓', '').trim();
      filterTypeLabel.textContent = cleanLabel || '全部';
    }
    closeTypePicker();
    loadRecords();
  }

  function openCategoryPicker() {
    if (!categoryPickerModal) return;
    const categoryInput = recordForm.querySelector('[name="category"]');
    const currentValue = categoryInput ? categoryInput.value : '';
    const options = categoryPickerModal.querySelectorAll('.picker-option');
    options.forEach(opt => {
      const optValue = opt.getAttribute('data-value');
      opt.classList.remove('selected');
      if (optValue === currentValue) {
        opt.classList.add('selected');
      }
    });
    categoryPickerModal.classList.remove('hidden');
  }

  function closeCategoryPicker() {
    if (categoryPickerModal) categoryPickerModal.classList.add('hidden');
  }

  function selectCategory(value, label) {
    const categoryInput = recordForm.querySelector('[name="category"]');
    if (categoryInput) categoryInput.value = value;
    if (categoryBtn) {
      // 移除可能存在的✓符号
      const cleanLabel = label.replace(/✓/g, '').trim();
      if ('value' in categoryBtn) categoryBtn.value = cleanLabel || '';
      else categoryBtn.textContent = cleanLabel || '选择分类';
    }
    closeCategoryPicker();
  }

  function initMainPage() {
    navUsername.textContent = currentUsername || '用户';
    // 初始化类型选择按钮文本
    const filterTypeLabel = $('filter-type-label');
    if (filterTypeLabel && filterTypeInput) {
      const value = filterTypeInput.value || '';
      const labels = { '': '全部', 'income': '收入', 'expense': '支出' };
      filterTypeLabel.textContent = labels[value] || '全部';
    }
    setView('list');
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

  document.querySelectorAll('.view-tab').forEach(function(tab) {
    tab.addEventListener('click', function() { setView(tab.dataset.view); });
  });

  if (periodPrev) periodPrev.addEventListener('click', function() {
    try {
      if (currentView === 'week' && calendarWeekStart) {
        calendarWeekStart = new Date(calendarWeekStart.getFullYear(), calendarWeekStart.getMonth(), calendarWeekStart.getDate() - 7);
        var r = getWeekRangeFromMonday(calendarWeekStart);
        if ($('filter-start')) $('filter-start').value = r.start;
        if ($('filter-end')) $('filter-end').value = r.end;
        if (periodLabel) periodLabel.textContent = r.start + ' 周';
      } else if (currentView === 'month' && calendarMonth) {
        if (calendarMonth.m === 1) { calendarMonth.m = 12; calendarMonth.y--; } else calendarMonth.m--;
        var r = getMonthRangeFromYM(calendarMonth.y, calendarMonth.m);
        if ($('filter-start')) $('filter-start').value = r.start;
        if ($('filter-end')) $('filter-end').value = r.end;
        if (periodLabel) periodLabel.textContent = calendarMonth.y + '年' + calendarMonth.m + '月';
      } else if (currentView === 'year' && calendarYear) {
        calendarYear--;
        var r = getYearRange(calendarYear);
        if ($('filter-start')) $('filter-start').value = r.start;
        if ($('filter-end')) $('filter-end').value = r.end;
        if (periodLabel) periodLabel.textContent = calendarYear + '年';
      } else if (currentView === 'day' && calendarDay) {
        var d = new Date(calendarDay + 'T12:00:00');
        d.setDate(d.getDate() - 1);
        calendarDay = toLocalDateStr(d);
        if ($('filter-start')) $('filter-start').value = calendarDay;
        if ($('filter-end')) $('filter-end').value = calendarDay;
        if (periodLabel) periodLabel.textContent = calendarDay;
      }
      loadRecords();
    } catch (e) { console.error(e); }
  });
  if (periodNext) periodNext.addEventListener('click', function() {
    try {
      if (currentView === 'week' && calendarWeekStart) {
        calendarWeekStart = new Date(calendarWeekStart.getFullYear(), calendarWeekStart.getMonth(), calendarWeekStart.getDate() + 7);
        var r = getWeekRangeFromMonday(calendarWeekStart);
        if ($('filter-start')) $('filter-start').value = r.start;
        if ($('filter-end')) $('filter-end').value = r.end;
        if (periodLabel) periodLabel.textContent = r.start + ' 周';
      } else if (currentView === 'month' && calendarMonth) {
        if (calendarMonth.m === 12) { calendarMonth.m = 1; calendarMonth.y++; } else calendarMonth.m++;
        var r = getMonthRangeFromYM(calendarMonth.y, calendarMonth.m);
        if ($('filter-start')) $('filter-start').value = r.start;
        if ($('filter-end')) $('filter-end').value = r.end;
        if (periodLabel) periodLabel.textContent = calendarMonth.y + '年' + calendarMonth.m + '月';
      } else if (currentView === 'year' && calendarYear) {
        calendarYear++;
        var r = getYearRange(calendarYear);
        if ($('filter-start')) $('filter-start').value = r.start;
        if ($('filter-end')) $('filter-end').value = r.end;
        if (periodLabel) periodLabel.textContent = calendarYear + '年';
      } else if (currentView === 'day' && calendarDay) {
        var d = new Date(calendarDay + 'T12:00:00');
        d.setDate(d.getDate() + 1);
        calendarDay = toLocalDateStr(d);
        if ($('filter-start')) $('filter-start').value = calendarDay;
        if ($('filter-end')) $('filter-end').value = calendarDay;
        if (periodLabel) periodLabel.textContent = calendarDay;
      }
      loadRecords();
    } catch (e) { console.error(e); }
  });
  $('add-income').addEventListener('click', () => openModal('income'));
  $('add-expense').addEventListener('click', () => openModal('expense'));
  $('filter-btn').addEventListener('click', loadRecords);
  
  // 记账日期滚轮弹窗
  if (recordDateInput) {
    recordDateInput.addEventListener('click', openDatePicker);
  }
  if (datePickerCancel) {
    datePickerCancel.addEventListener('click', closeDatePicker);
  }
  if (datePickerOk) {
    datePickerOk.addEventListener('click', applyDatePicker);
  }
  if (datePickerModal) {
    const backdrop = datePickerModal.querySelector('.picker-modal-backdrop');
    if (backdrop) backdrop.addEventListener('click', closeDatePicker);
  }
  bindWheel(dateWheelYear, () => yearValues, (v) => {
    datePickerY = v;
    rebuildDayWheel();
  });
  bindWheel(dateWheelMonth, () => monthValues, (v) => {
    datePickerM = v;
    rebuildDayWheel();
  });
  bindWheel(dateWheelDay, () => dayValues, (v) => {
    datePickerD = v;
  });

  // 类型选择弹窗
  if (filterTypeBtn) {
    filterTypeBtn.addEventListener('click', openTypePicker);
  }
  if (pickerCancel) {
    pickerCancel.addEventListener('click', closeTypePicker);
  }
  if (typePickerModal) {
    const backdrop = typePickerModal.querySelector('.picker-modal-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', closeTypePicker);
    }
    const options = typePickerModal.querySelectorAll('.picker-option');
    options.forEach(opt => {
      opt.addEventListener('click', function() {
        const value = this.getAttribute('data-value');
        // 获取原始文本内容（不包含✓符号）
        const label = this.textContent.replace(/✓/g, '').trim();
        selectType(value, label);
      });
    });
  }

  // 分类选择弹窗
  if (categoryBtn) {
    categoryBtn.addEventListener('click', openCategoryPicker);
  }
  if (categoryPickerCancel) {
    categoryPickerCancel.addEventListener('click', closeCategoryPicker);
  }
  if (categoryPickerModal) {
    const backdrop = categoryPickerModal.querySelector('.picker-modal-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', closeCategoryPicker);
    }
    const options = categoryPickerModal.querySelectorAll('.picker-option');
    options.forEach(opt => {
      opt.addEventListener('click', function() {
        const value = this.getAttribute('data-value');
        // 获取原始文本内容（不包含✓符号）
        const label = this.textContent.replace(/✓/g, '').trim();
        selectCategory(value, label);
      });
    });
  }
  modalCancel.addEventListener('click', closeModal);
  if (modal) {
    const backdrop = modal.querySelector('.record-modal-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', closeModal);
    }
  }

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
