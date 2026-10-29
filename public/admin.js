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
        render();
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
    if (!list.length) { var tr0 = el('tr'); var td0 = el('td', 'No applications match.'); td0.colSpan = 8; tr0.appendChild(td0); tb.appendChild(tr0); }
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
      tb.appendChild(tr);
    });
  }
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
