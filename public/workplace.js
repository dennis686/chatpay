(function () {
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, text, cls) { var e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; }
  function lock(msg, linkText) {
    var b = $('locked'); b.classList.remove('hidden'); b.textContent = msg + ' ';
    var a = el('a', linkText); a.href = '/dashboard.html'; b.appendChild(a);
  }
  function card(t) {
    var c = el('div', null, 'task');
    c.appendChild(el('strong', t.title));
    if (t.pay) c.appendChild(el('div', 'Pay: ' + t.pay, 'note'));
    if (t.instructions) c.appendChild(el('pre', t.instructions));
    if (t.submitted) { c.appendChild(el('p', 'Submitted. The Chatpay team will review it.', 'note')); return c; }
    var ta = el('textarea'); ta.rows = 4; ta.maxLength = 3000; ta.setAttribute('aria-label', 'Your answer for ' + t.title);
    var msg = el('span', '', 'err'); msg.setAttribute('role', 'alert');
    var b = el('button', 'Submit answer', 'btn'); b.type = 'button';
    b.addEventListener('click', function () {
      msg.textContent = ''; b.disabled = true;
      fetch('/api/workplace/tasks/' + encodeURIComponent(t.id) + '/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answer: ta.value }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (r) {
          if (r.ok) { c.replaceWith(card(Object.assign({}, t, { submitted: true }))); }
          else { msg.textContent = r.j.message || 'Could not submit.'; b.disabled = false; }
        })
        .catch(function () { msg.textContent = 'Could not connect. Check your internet.'; b.disabled = false; });
    });
    c.appendChild(ta); c.appendChild(msg); c.appendChild(b);
    return c;
  }
  fetch('/api/workplace').then(function (r) { return r.json().then(function (j) { return { s: r.status, j: j }; }); })
    .then(function (r) {
      if (r.s === 401) return lock('Please sign in to continue.', 'Go to sign in');
      if (r.s === 403) return lock('Your workplace opens after the Chatpay team verifies your details and approves you.', 'Back to my dashboard');
      var box = $('tasks');
      if (!r.j.tasks.length) return box.appendChild(el('p', 'No tasks right now. Check back soon.', 'note'));
      r.j.tasks.forEach(function (t) { box.appendChild(card(t)); });
    })
    .catch(function () { lock('Could not load the workplace. Check your internet.', 'Back'); });
})();
