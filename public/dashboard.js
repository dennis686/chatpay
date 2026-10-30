(function () {
  var $ = function (id) { return document.getElementById(id); };
  var TEXT = {
    new: 'We have received your application. We will contact you by email or phone soon.',
    contacted: 'We have been in touch. Please check your email and phone for onboarding details.',
    onboarded: 'You are onboarded. You can start chatting and teaching.',
    paid: 'Your payment has been sent to your mobile money number.',
    rejected: 'Your application was not accepted this time.'
  };
  var NAMES = { airtel: 'Airtel Money', mtn: 'MTN MoMo' };
  function td(text) { var e = document.createElement('td'); e.textContent = text; return e; }
  function money(n) { return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  function show(d) {
    $('login').classList.add('hidden'); $('panel').classList.remove('hidden'); $('logout').classList.remove('hidden');
    $('hello').textContent = 'Hello, ' + d.profile.fullName.split(' ')[0];
    $('status').textContent = d.profile.status;
    $('statusText').textContent = TEXT[d.profile.status] || '';
    $('pending').textContent = money(d.totals.pending);
    $('paid').textContent = money(d.totals.paid);
    $('method').textContent = NAMES[d.profile.provider] + ' ' + d.profile.momoMasked;
    $('method').style.fontSize = '1rem';
    var tb = $('rows'); tb.textContent = '';
    if (!d.payouts.length) { var r0 = document.createElement('tr'); var c = td('Nothing recorded yet.'); c.colSpan = 5; r0.appendChild(c); tb.appendChild(r0); }
    d.payouts.forEach(function (p) {
      var tr = document.createElement('tr');
      tr.appendChild(td(new Date(p.createdAt).toLocaleDateString()));
      tr.appendChild(td(p.kind === 'bonus' ? 'Bonus' : 'Earning'));
      tr.appendChild(td(p.note || '-'));
      tr.appendChild(td(money(p.amount)));
      tr.appendChild(td(p.status === 'paid' ? 'Paid' : 'Pending'));
      tb.appendChild(tr);
    });
  }
  function load() {
    return fetch('/api/me').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { if (d && d.ok) show(d); }).catch(function () {});
  }
  $('login').addEventListener('submit', function (e) {
    e.preventDefault(); $('loginErr').textContent = '';
    fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: $('email').value, password: $('pw').value }) })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j.ok) { $('pw').value = ''; load(); } else { $('loginErr').textContent = j.message || 'Could not sign in.'; } })
      .catch(function () { $('loginErr').textContent = 'Could not connect. Check your internet.'; });
  });
  $('logout').addEventListener('click', function () {
    fetch('/api/logout', { method: 'POST' }).then(function () { location.reload(); });
  });
  load();
})();
