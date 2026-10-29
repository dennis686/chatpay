(function () {
  var form = document.getElementById('applyForm');
  var msg = document.getElementById('msg');
  var btn = document.getElementById('submit');
  var fields = ['fullName','email','phone','age','language','provider','momoNumber','momoConfirm','consent'];

  function normPhone(raw) {
    var d = String(raw || '').replace(/[\s\-()]/g, '').replace(/^\+/, '');
    var m = d.match(/^(?:260|0)?(9[567]\d{7}|7[67]\d{7}|55\d{7})$/);
    return m ? '+260' + m[1] : null;
  }
  function setErr(name, text) {
    var el = document.querySelector('[data-err="' + name + '"]');
    if (el) el.textContent = text || '';
  }
  function val(name) {
    var el = form.elements[name];
    if (!el) return '';
    if (el.type === 'checkbox') return el.checked;
    if (el.length && el[0] && el[0].type === 'radio') { return (form.querySelector('input[name="' + name + '"]:checked') || {}).value || ''; }
    return el.value.trim();
  }
  function check() {
    var e = {};
    var n = val('fullName'); if (n.length < 3 || n.indexOf(' ') < 0) e.fullName = 'Enter your first and last name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(val('email'))) e.email = 'Enter a valid email address.';
    if (!normPhone(val('phone'))) e.phone = 'Enter a valid Zambian number, e.g. 097 123 4567.';
    var a = parseInt(val('age'), 10); if (!(a >= 18 && a <= 80)) e.age = 'You must be 18 or older to apply.';
    if (!val('language')) e.language = 'Choose a language.';
    var p = val('provider'); if (!p) e.provider = 'Choose Airtel Money or MTN MoMo.';
    var m = normPhone(val('momoNumber'));
    if (!m) e.momoNumber = 'Enter a valid mobile money number.';
    else if (p === 'airtel' && !/^\+260(97|77)/.test(m)) e.momoNumber = 'Airtel Money numbers start with 097 or 077.';
    else if (p === 'mtn' && !/^\+260(96|76)/.test(m)) e.momoNumber = 'MTN MoMo numbers start with 096 or 076.';
    if (m && normPhone(val('momoConfirm')) !== m) e.momoConfirm = 'The numbers do not match.';
    if (!val('consent')) e.consent = 'You must accept the Terms and Privacy Policy.';
    return e;
  }
  function show(e) { fields.forEach(function (f) { setErr(f, e[f]); }); }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    msg.className = ''; msg.textContent = '';
    var e = check(); show(e);
    if (Object.keys(e).length) {
      var first = fields.filter(function (f) { return e[f]; })[0];
      var el = form.elements[first]; if (el && el.focus) el.focus(); else if (el && el[0]) el[0].focus();
      return;
    }
    btn.disabled = true; btn.textContent = 'Sending…';
    fetch('/api/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: val('fullName'), email: val('email'), phone: val('phone'), age: val('age'),
        language: val('language'), experience: val('experience'), provider: val('provider'),
        momoNumber: val('momoNumber'), consent: val('consent'), website: val('website')
      })
    }).then(function (r) { return r.json().then(function (j) { return { s: r.status, j: j }; }); })
      .then(function (r) {
        if (r.j.ok) { form.reset(); msg.className = 'ok'; msg.textContent = r.j.message; msg.scrollIntoView({ block: 'center' }); }
        else if (r.j.errors) { show(r.j.errors); }
        else { msg.className = 'bad'; msg.textContent = r.j.message || 'Something went wrong. Please try again.'; }
      })
      .catch(function () { msg.className = 'bad'; msg.textContent = 'Could not connect. Check your internet and try again.'; })
      .then(function () { btn.disabled = false; btn.textContent = 'Submit application'; });
  });
  document.getElementById('year').textContent = new Date().getFullYear();
})();
