(function () {
  var STATUSES = ['new', 'contacted', 'onboarded', 'paid', 'rejected'];
  var token = sessionStorage.getItem('cp_admin') || '';
  var data = [];
  var $ = function (id) { return document.getElementById(id); };

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, opts.headers || {});
    return fetch(path, opts);
  }
  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }
  function signOut() {
    sessionStorage.removeItem('cp_admin'); token = '';
    $('panel').classList.add('hidden'); $('logout').classList.add('hidden'); $('login').classList.remove('hidden');
  }
  function load() {
    return api('/api/admin/applications').then(function (r) {
      if (r.status === 401) { signOut(); $('loginErr').textContent = 'Wrong token.'; return; }
      return r.json().then(function (j) {
        data = j.slice().reverse();
        $('login').classList.add('hidden'); $('panel').classList.remove('hidden'); $('logout').classList.remove('hidden');
        render(); loadPayouts(); loadJobs(); loadTasks(); loadSubs();
      });
    }).catch(function () { $('loginErr').textContent = 'Could not reach the server.'; });
  }
  function render() {
    var q = $('q').value.trim().toLowerCase(), fs = $('fs').value, fp = $('fp').value;
    var list = data.filter(function (r) {
      if (fs && r.status !== fs) return false;
      if (fp && r.provider !== fp) return false;
      return !q || [r.fullName, r.email, r.phone, r.momoNumber].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    var stats = $('stats'); stats.textContent = '';
    var t = el('div'); t.appendChild(el('b', data.length)); t.appendChild(document.createTextNode('Total')); stats.appendChild(t);
    STATUSES.forEach(function (s) {
      var d = el('div'); d.appendChild(el('b', data.filter(function (r) { return r.status === s; }).length)); d.appendChild(document.createTextNode(s)); stats.appendChild(d);
    });
    $('count').textContent = 'Showing ' + list.length + ' of ' + data.length;
    var tb = $('rows'); tb.textContent = '';
    if (!list.length) { var tr0 = el('tr'); var td0 = el('td', 'No applications match.'); td0.colSpan = 10; tr0.appendChild(td0); tb.appendChild(tr0); }
    list.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', new Date(r.createdAt).toLocaleDateString()));
      tr.appendChild(el('td', r.fullName));
      var c = el('td'); c.appendChild(document.createTextNode(r.email)); c.appendChild(document.createElement('br')); c.appendChild(document.createTextNode(r.phone)); tr.appendChild(c);
      tr.appendChild(el('td', r.age));
      tr.appendChild(el('td', r.language));
      var p = el('td'); p.appendChild(el('span', r.provider === 'airtel' ? 'Airtel' : 'MTN', 'pill ' + r.provider)); p.appendChild(document.createElement('br')); p.appendChild(document.createTextNode(r.momoNumber)); tr.appendChild(p);
      tr.appendChild(el('td', r.experience || '-', 'wrapc'));
      var s = el('td'); var sel = el('select', null, 'st'); sel.setAttribute('aria-label', 'Status for ' + r.fullName);
      STATUSES.forEach(function (o) { var op = el('option', o); op.value = o; if (o === r.status) op.selected = true; sel.appendChild(op); });
      sel.addEventListener('change', function () {
        sel.disabled = true;
        api('/api/admin/applications/' + encodeURIComponent(r.id), { method: 'PATCH', body: JSON.stringify({ status: sel.value }) })
          .then(function (res) { if (!res.ok) throw 0; r.status = sel.value; render(); })
          .catch(function () { alert('Could not update status.'); sel.value = r.status; sel.disabled = false; });
      });
      s.appendChild(sel); tr.appendChild(s);
      var ac = el('td');
      ['earning', 'bonus'].forEach(function (k) {
        var b = el('button', '+ ' + k, 'btn alt'); b.type = 'button'; b.style.padding = '4px 10px'; b.style.marginRight = '6px';
        b.addEventListener('click', function () { addPayout(r, k); });
        ac.appendChild(b);
      });
      tr.appendChild(ac);
      var wc = el('td'); var wb = el('button', r.workplaceAccess ? 'Revoke' : 'Grant access', r.workplaceAccess ? 'btn alt' : 'btn'); wb.type = 'button'; wb.style.padding = '4px 10px';
      wb.addEventListener('click', function () {
        var grant = !r.workplaceAccess;
        if (!confirm((grant ? 'Give ' : 'Remove workplace access from ') + r.fullName + (grant ? ' access to the workplace? Only do this after you have verified their details.' : '?'))) return;
        api('/api/admin/applications/' + encodeURIComponent(r.id) + '/access', { method: 'PATCH', body: JSON.stringify({ access: grant }) })
          .then(function (res) { if (!res.ok) throw 0; r.workplaceAccess = grant; render(); })
          .catch(function () { alert('Could not change access.'); });
      });
      wc.appendChild(wb); tr.appendChild(wc);
      tb.appendChild(tr);
    });
  }

  function addPayout(r, k) {
    var amt = prompt('Amount in ZMW for ' + r.fullName + ' (' + k + ')'); if (amt === null) return;
    var note = prompt('Note (optional)') || '';
    api('/api/admin/applications/' + encodeURIComponent(r.id) + '/payouts', { method: 'POST', body: JSON.stringify({ kind: k, amount: amt, note: note }) })
      .then(function (res) { return res.json().then(function (j) { if (!res.ok) throw new Error(j.message || 'Failed'); loadPayouts(); }); })
      .catch(function (e) { alert(e.message); });
  }
  function loadPayouts() {
    api('/api/admin/payouts').then(function (r) { return r.ok ? r.json() : []; }).then(renderPayouts);
  }
  function renderPayouts(list) {
    var tb = $('pays'); tb.textContent = '';
    var owed = list.filter(function (p) { return p.status === 'pending'; }).reduce(function (t, p) { return t + p.amount; }, 0);
    $('payTotal').textContent = '(ZMW ' + owed.toFixed(2) + ' pending)';
    list.sort(function (a, b) { return (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1); });
    list.forEach(function (p) {
      var tr = el('tr');
      tr.appendChild(el('td', new Date(p.createdAt).toLocaleDateString()));
      tr.appendChild(el('td', p.fullName));
      tr.appendChild(el('td', (p.provider === 'airtel' ? 'Airtel ' : 'MTN ') + p.momoNumber));
      tr.appendChild(el('td', p.kind));
      tr.appendChild(el('td', p.amount.toFixed(2)));
      tr.appendChild(el('td', p.note || '-', 'wrapc'));
      var s = el('td');
      if (p.status === 'paid') { s.textContent = 'Paid'; }
      else {
        var b = el('button', 'Mark paid', 'btn'); b.type = 'button'; b.style.padding = '4px 10px';
        b.addEventListener('click', function () {
          if (!confirm('Mark ZMW ' + p.amount.toFixed(2) + ' to ' + p.fullName + ' as paid? Only do this after you have sent the money.')) return;
          api('/api/admin/payouts/' + encodeURIComponent(p.id), { method: 'PATCH', body: JSON.stringify({ status: 'paid' }) }).then(loadPayouts);
        });
        s.appendChild(b);
      }
      tr.appendChild(s); tb.appendChild(tr);
    });
  }

  function loadJobs() {
    api('/api/admin/jobs').then(function (r) { return r.ok ? r.json() : []; }).then(function (list) {
      var tb = $('jobsRows'); tb.textContent = '';
      list.forEach(function (jb) {
        var tr = el('tr');
        tr.appendChild(el('td', jb.title, 'wrapc')); tr.appendChild(el('td', jb.employer || '(none)'));
        tr.appendChild(el('td', jb.pay || '(none)')); tr.appendChild(el('td', jb.schedule || '-'));
        var c = el('td'); var b = el('button', 'Remove', 'btn alt'); b.type = 'button'; b.style.padding = '4px 10px';
        b.addEventListener('click', function () {
          if (confirm('Remove "' + jb.title + '"?')) api('/api/admin/jobs/' + encodeURIComponent(jb.id), { method: 'DELETE' }).then(loadJobs);
        });
        c.appendChild(b); tr.appendChild(c); tb.appendChild(tr);
      });
    });
  }

  var STARTER = [
    { title: 'Customer chat agent', pay: 'K2,800 to K4,000 per month', schedule: 'Full-time, 8 hours, shifts' },
    { title: 'Data entry clerk', pay: 'K1,800 to K2,600 per month', schedule: 'Part-time, 4 hours a day' },
    { title: 'English to Nyanja or Bemba translator', pay: 'K150 to K300 per 1,000 words', schedule: 'Per task, work when you want' },
    { title: 'Audio transcriber', pay: 'K60 to K90 per audio hour', schedule: 'Per task, work when you want' },
    { title: 'Social media assistant', pay: 'K2,000 to K3,200 per month', schedule: 'Part-time, 15 hours a week' },
    { title: 'Virtual assistant', pay: 'K3,500 to K5,000 per month', schedule: 'Full-time, Mon to Fri, daytime' }
  ];
  $('seedJobs').addEventListener('click', function () {
    if (!confirm('Add 6 job listings with the pay and hours shown, with Chatpay as the employer? Workers will read these as real offers, so only keep the ones Chatpay will actually pay. You can remove any afterwards.')) return;
    api('/api/admin/jobs').then(function (r) { return r.ok ? r.json() : []; }).then(function (existing) {
      var have = existing.map(function (x) { return x.title; });
      var todo = STARTER.filter(function (s) { return have.indexOf(s.title) < 0; });
      return Promise.all(todo.map(function (s) {
        return api('/api/admin/jobs', { method: 'POST', body: JSON.stringify({ title: s.title, employer: 'Chatpay', pay: s.pay, schedule: s.schedule }) });
      }));
    }).then(loadJobs).catch(function () { alert('Could not add the jobs.'); });
  });
  $('addJob').addEventListener('click', function () {
    var title = prompt('Job title'); if (!title) return;
    var employer = prompt('Employer name (required for trust)') || '';
    var pay = prompt('Pay, e.g. K150 per 1,000 words') || '';
    var schedule = prompt('Hours or schedule, e.g. Part-time, online') || '';
    api('/api/admin/jobs', { method: 'POST', body: JSON.stringify({ title: title, employer: employer, pay: pay, schedule: schedule }) })
      .then(function (r) { return r.json().then(function (x) { if (!r.ok) throw new Error(x.message || 'Failed'); loadJobs(); }); })
      .catch(function (e) { alert(e.message); });
  });

  function loadTasks() {
    api('/api/admin/tasks').then(function (r) { return r.ok ? r.json() : []; }).then(function (list) {
      var tb = $('tasksRows'); tb.textContent = '';
      list.forEach(function (t) {
        var tr = el('tr'); tr.appendChild(el('td', t.title, 'wrapc')); tr.appendChild(el('td', t.pay || '-')); tr.appendChild(el('td', t.instructions || '-', 'wrapc'));
        var c = el('td'); var b = el('button', 'Remove', 'btn alt'); b.type = 'button'; b.style.padding = '4px 10px';
        b.addEventListener('click', function () { if (confirm('Remove "' + t.title + '" and its submissions?')) api('/api/admin/tasks/' + encodeURIComponent(t.id), { method: 'DELETE' }).then(function () { loadTasks(); loadSubs(); }); });
        c.appendChild(b); tr.appendChild(c); tb.appendChild(tr);
      });
    });
  }
  function loadSubs() {
    api('/api/admin/submissions').then(function (r) { return r.ok ? r.json() : []; }).then(function (list) {
      var tb = $('subsRows'); tb.textContent = '';
      list.forEach(function (s) {
        var tr = el('tr'); tr.appendChild(el('td', new Date(s.createdAt).toLocaleDateString())); tr.appendChild(el('td', s.fullName));
        tr.appendChild(el('td', s.task, 'wrapc')); tr.appendChild(el('td', s.answer, 'wrapc')); tb.appendChild(tr);
      });
    });
  }
  $('addTask').addEventListener('click', function () {
    var title = prompt('Task title'); if (!title) return;
    var instructions = prompt('Instructions for the worker') || '';
    var pay = prompt('Pay for this task, e.g. K20') || '';
    api('/api/admin/tasks', { method: 'POST', body: JSON.stringify({ title: title, instructions: instructions, pay: pay }) })
      .then(function (r) { return r.json().then(function (x) { if (!r.ok) throw new Error(x.message || 'Failed'); loadTasks(); }); })
      .catch(function (e) { alert(e.message); });
  });
  $('login').addEventListener('submit', function (e) {
    e.preventDefault(); $('loginErr').textContent = '';
    token = $('token').value; sessionStorage.setItem('cp_admin', token); $('token').value = ''; load();
  });
  $('logout').addEventListener('click', signOut);
  ['q', 'fs', 'fp'].forEach(function (id) { $(id).addEventListener('input', render); });
  $('csv').addEventListener('click', function () {
    api('/api/admin/export.csv').then(function (r) { return r.blob(); }).then(function (b) {
      var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'chatpay-applications.csv'; a.click(); URL.revokeObjectURL(a.href);
    });
  });
  if (token) load();
})();
