// EasyTech — username-only sign-in, session guard and visitor log.
//
// SHARED DATABASE: paste your Firebase Realtime Database URL below (see SETUP-SHARED-DATABASE.txt).
// When it is filled in, every account, login and feedback from EVERY device is saved in one
// place, so the admins can see everybody's activity. When it is empty, the site falls back to
// this browser's localStorage (data is then visible only on the same browser/device).
(function () {
  var DB_URL = ''; // e.g. 'https://easytech-12345-default-rtdb.firebaseio.com'

  var USERS = 'et-users', LOG = 'et-log', FB = 'et-feedback', SESSION = 'et-session', MIGRATED = 'et-migrated';
  var ADMINS = ['om balapure', 'omkar devrukhkar', 'shreya kate']; // only these usernames can see Visitors & Feedback
  var STALE_MS = 45000; // a session with no heartbeat for 45s is treated as closed
  var REMOTE = !!DB_URL;
  var BASE = DB_URL.replace(/\/+$/, '');
  var isLoginPage = document.currentScript && document.currentScript.getAttribute('data-page') === 'login';

  // ---------- helpers ----------
  function clean(n) { return (n || '').trim().replace(/\s+/g, ' '); }
  function key(n) { return clean(n).toLowerCase(); }
  function nowIso() { return new Date().toISOString(); }
  function getSession() { try { return JSON.parse(sessionStorage.getItem(SESSION)); } catch (e) { return null; } }
  function isAdminKey(k) { return ADMINS.indexOf(k) !== -1; }
  function fmt(iso) { return iso ? new Date(iso).toLocaleString() : '—'; }
  // Firebase keys cannot contain . $ # [ ] / so usernames are stored as url-safe base64
  function enc(k) { return btoa(unescape(encodeURIComponent(k))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

  // ---------- storage layer (all calls return Promises) ----------
  var lsRead = function (k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  var lsWrite = function (k, v) { localStorage.setItem(k, JSON.stringify(v)); };

  function http(method, path, body) {
    return fetch(BASE + '/' + path + '.json', {
      method: method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) throw new Error('Server error ' + r.status);
      return r.json();
    });
  }

  var store = REMOTE ? {
    getUser: function (k) { return http('GET', 'users/' + enc(k)); },
    putUser: function (k, u) { return http('PUT', 'users/' + enc(k), u); },
    allUsers: function () { return http('GET', 'users').then(function (o) { return o ? Object.keys(o).map(function (i) { return o[i]; }) : []; }); },
    addLog: function (type, user) { return http('POST', 'log', { type: type, user: user, time: nowIso() }); },
    allLog: function () {
      return http('GET', 'log').then(function (o) {
        var a = o ? Object.keys(o).map(function (i) { return o[i]; }) : [];
        return a.sort(function (x, y) { return x.time < y.time ? -1 : x.time > y.time ? 1 : 0; });
      });
    },
    getActive: function (k) { return http('GET', 'active/' + enc(k)); },
    putActive: function (k, sid) { return http('PUT', 'active/' + enc(k), { sid: sid, ts: Date.now() }); },
    delActive: function (k) { return http('DELETE', 'active/' + enc(k)); },
    addFeedback: function (f) { return http('POST', 'feedback', f); },
    allFeedback: function () {
      return http('GET', 'feedback').then(function (o) {
        var a = o ? Object.keys(o).map(function (i) { return o[i]; }) : [];
        a.sort(function (x, y) { return x.time < y.time ? -1 : x.time > y.time ? 1 : 0; });
        a.forEach(function (f, i) { f.id = i + 1; });
        return a;
      });
    }
  } : {
    getUser: function (k) { return Promise.resolve(lsRead(USERS, {})[k] || null); },
    putUser: function (k, u) { var all = lsRead(USERS, {}); all[k] = u; lsWrite(USERS, all); return Promise.resolve(); },
    allUsers: function () { return Promise.resolve(Object.values(lsRead(USERS, {}))); },
    addLog: function (type, user) { var l = lsRead(LOG, []); l.push({ type: type, user: user, time: nowIso() }); lsWrite(LOG, l); return Promise.resolve(); },
    allLog: function () { return Promise.resolve(lsRead(LOG, [])); },
    getActive: function (k) { return Promise.resolve(lsRead('et-active', {})[k] || null); },
    putActive: function (k, sid) { var a = lsRead('et-active', {}); a[k] = { sid: sid, ts: Date.now() }; lsWrite('et-active', a); return Promise.resolve(); },
    delActive: function (k) { var a = lsRead('et-active', {}); delete a[k]; lsWrite('et-active', a); return Promise.resolve(); },
    addFeedback: function (f) { var l = lsRead(FB, []); l.push(f); lsWrite(FB, l); return Promise.resolve(); },
    allFeedback: function () { var a = lsRead(FB, []); a.forEach(function (f, i) { f.id = i + 1; }); return Promise.resolve(a); }
  };

  function inUseElsewhere(rec, sid) { return !!(rec && rec.sid !== sid && Date.now() - rec.ts < STALE_MS); }
  function netError(e) { return { ok: false, reason: 'network', message: 'Cannot reach the EasyTech server right now. Please check your internet connection and try again.' }; }

  // One-time upload of data this browser saved before the shared database was switched on
  function migrateLocal() {
    if (!REMOTE || localStorage.getItem(MIGRATED)) return Promise.resolve();
    var users = lsRead(USERS, {}), log = lsRead(LOG, []), fb = lsRead(FB, []);
    var jobs = [];
    Object.keys(users).forEach(function (k) { jobs.push(store.getUser(k).then(function (u) { if (!u) return store.putUser(k, users[k]); })); });
    log.forEach(function (e) { jobs.push(http('POST', 'log', e)); });
    fb.forEach(function (f) { jobs.push(http('POST', 'feedback', f)); });
    return Promise.all(jobs).then(function () { localStorage.setItem(MIGRATED, '1'); }).catch(function () {});
  }

  // ---------- CSV export (admin only) ----------
  function csvCell(c) {
    var t = String(c == null ? '' : c);
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; // stop spreadsheet formula injection from user-typed text
    return '"' + t.replace(/"/g, '""') + '"';
  }
  function toCsv(rows) { return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n'); }
  function saveCsv(filename, rows) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
    a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  }
  var EVENT_LABELS = { account_created: 'Account created', login: 'Logged in', denied: 'Denied (name already in use)' };

  function startSession(name) {
    var k = key(name), sid = String(Date.now()) + Math.random().toString(36).slice(2);
    sessionStorage.setItem(SESSION, JSON.stringify({ user: name, key: k, sid: sid }));
    return store.putActive(k, sid);
  }

  var api = {
    fmt: fmt,
    shared: REMOTE,
    isAdmin: function () { var x = getSession(); return !!x && isAdminKey(x.key); },
    current: getSession,

    // Admin-only readers — each returns a Promise
    users: function () { return api.isAdmin() ? store.allUsers() : Promise.resolve([]); },
    log: function () { return api.isAdmin() ? store.allLog() : Promise.resolve([]); },
    feedback: function () { return api.isAdmin() ? store.allFeedback() : Promise.resolve([]); },

    downloadFeedbackCsv: function () {
      if (!api.isAdmin()) return Promise.resolve(false);
      return store.allFeedback().then(function (list) {
        var rows = [['No', 'Login ID', 'Name', 'Email', 'Subject', 'Message', 'Date/Time']].concat(
          list.map(function (f) { return [f.id, f.loginId, f.name, f.email, f.subject, f.message, fmt(f.time)]; }));
        saveCsv('easytech-feedback.csv', rows); return true;
      });
    },
    downloadVisitorsCsv: function () {
      if (!api.isAdmin()) return Promise.resolve(false);
      return store.allLog().then(function (list) {
        var rows = [['No', 'Username', 'Event', 'Date/Time']].concat(
          list.map(function (e, i) { return [i + 1, e.user, EVENT_LABELS[e.type] || e.type, fmt(e.time)]; }));
        saveCsv('easytech-visitors.csv', rows); return true;
      });
    },

    saveFeedback: function (f) {
      var sess = getSession();
      return store.addFeedback({ loginId: sess ? sess.user : '(unknown)', name: f.name, email: f.email, subject: f.subject, message: f.message, time: nowIso() });
    },

    // Resolves to {ok:true} or {ok:false, reason, message}
    createAccount: function (raw) {
      var name = clean(raw), k = key(name);
      if (name.length < 3 || name.length > 30) return Promise.resolve({ ok: false, reason: 'invalid', message: 'Please enter a username of 3 to 30 characters.' });
      return migrateLocal().then(function () { return store.getUser(k); }).then(function (existing) {
        if (existing) {
          return store.addLog('denied', existing.name).then(function () {
            return { ok: false, reason: 'taken', message: 'This username already exists. Please choose a different name for your new account.' };
          });
        }
        var t = nowIso();
        return store.putUser(k, { name: name, created: t, lastLogin: t, logins: 1 })
          .then(function () { return store.addLog('account_created', name); })
          .then(function () { return store.addLog('login', name); })
          .then(function () { return startSession(name); })
          .then(function () { return { ok: true }; });
      }).catch(netError);
    },

    login: function (raw) {
      var name = clean(raw), k = key(name);
      if (!name) return Promise.resolve({ ok: false, reason: 'invalid', message: 'Please enter your username.' });
      return migrateLocal().then(function () { return Promise.all([store.getUser(k), store.getActive(k)]); }).then(function (r) {
        var user = r[0], active = r[1];
        if (!user) return { ok: false, reason: 'unknown', message: 'No account found with this name. Please create a new account.' };
        if (inUseElsewhere(active, null)) {
          return store.addLog('denied', user.name).then(function () {
            return { ok: false, reason: 'in-use', message: 'This username is already logged in. Someone else may be using this name, so we cannot let you in. Please create a new account with your own name.' };
          });
        }
        user.lastLogin = nowIso();
        user.logins = (user.logins || 0) + 1;
        return store.putUser(k, user)
          .then(function () { return store.addLog('login', user.name); })
          .then(function () { return startSession(user.name); })
          .then(function () { return { ok: true }; });
      }).catch(netError);
    },

    logout: function () {
      var s = getSession();
      sessionStorage.removeItem(SESSION);
      var done = function () { location.replace('login.html'); };
      if (!s) return done();
      store.getActive(s.key).then(function (a) { return (a && a.sid === s.sid) ? store.delActive(s.key) : null; }).then(done, done);
    }
  };
  window.EasyAuth = api;

  var s = getSession();
  if (isLoginPage) {
    if (s) location.replace('Main.html');
    return;
  }

  // Guard: every other page needs a session created by a successful login
  if (!s) {
    document.documentElement.style.visibility = 'hidden';
    location.replace('login.html');
    return;
  }
  // Admin-only pages
  if (/(visitors|feedback)\.html$/i.test(location.pathname) && !isAdminKey(s.key)) {
    sessionStorage.setItem('et-notice', 'Sorry, only admin users can view that page.');
    document.documentElement.style.visibility = 'hidden';
    location.replace('Main.html');
    return;
  }

  // Heartbeat keeps this session marked "in use"; if another session took over, sign out
  function beat() {
    store.getActive(s.key).then(function (a) {
      if (a && a.sid !== s.sid && Date.now() - a.ts < STALE_MS) {
        sessionStorage.removeItem(SESSION);
        location.replace('login.html');
      } else {
        store.putActive(s.key, s.sid);
      }
    }).catch(function () {});
  }
  beat();
  setInterval(beat, 10000);

  document.addEventListener('DOMContentLoaded', function () {
    var bar = document.querySelector('.a11y-bar .container');
    if (bar) {
      var who = document.createElement('span');
      who.className = 'auth-who';
      who.textContent = 'Signed in as ' + s.user + (isAdminKey(s.key) ? ' (Admin)' : '');
      var out = document.createElement('button');
      out.type = 'button'; out.className = 'a11y-btn'; out.textContent = 'Log out';
      out.addEventListener('click', api.logout);
      bar.appendChild(who); bar.appendChild(out);
    }
    var notice = sessionStorage.getItem('et-notice');
    if (notice) {
      sessionStorage.removeItem('et-notice');
      var n = document.createElement('div');
      n.setAttribute('role', 'alert');
      n.style.cssText = 'background:#9c2d21;color:#fff;padding:14px;text-align:center;font-weight:700';
      n.textContent = notice;
      document.body.insertBefore(n, document.body.firstChild);
    }
    var nav = document.getElementById('navbar');
    if (nav && isAdminKey(s.key) && !nav.querySelector('a[href="visitors.html"]')) {
      var li = document.createElement('li');
      li.innerHTML = '<a href="visitors.html">Visitors</a>';
      nav.appendChild(li);
    }
    if (nav && isAdminKey(s.key) && !nav.querySelector('a[href="feedback.html"]')) {
      var li2 = document.createElement('li');
      li2.innerHTML = '<a href="feedback.html">Feedback</a>';
      nav.appendChild(li2);
    }
  });
})();
