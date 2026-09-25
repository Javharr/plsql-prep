/* PL/SQL: подготовка — клиент.
   Прогресс хранится на сервере под логином и одинаков на всех устройствах;
   localStorage — только кэш на случай обрыва сети. */

const app = document.getElementById("app");
const tabsEl = document.getElementById("tabs");
const meEl = document.getElementById("me");
const CACHE_KEY = "plsql-prep";
const KEYS = ["A", "B", "C", "D"];
const STATUS = { done: "пройдено", current: "сейчас", next: "впереди" };
const HISTORY_MAX = 30;

let DATA = null;          // lessons.json
let QUESTIONS = [];       // questions.json
let USER = null;          // { username }
let SQL_ENABLED = false;  // подключена ли Oracle
let SCHEMA = null;        // таблицы и столбцы из базы (для консоли)
let progress = {};
let saveState = "saved";  // saved | saving | offline

/* ================= утилиты ================= */

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl";

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
const rows = (n) => `${n} ${plural(n, "строка", "строки", "строк")}`;

/* ================= API и прогресс ================= */

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* пустой ответ */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Ошибка ${res.status}`);
    err.status = res.status;
    err.ms = data && data.ms;
    throw err;
  }
  return data;
}

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch (e) { return {}; }
}
function writeCache() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(progress)); } catch (e) { /* приватный режим */ }
}

let saveTimer = null;
function save() {
  writeCache();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(pushProgress, 700);
}

async function pushProgress() {
  saveState = "saving";
  renderMe();
  try {
    await api("PUT", "/api/progress", { data: progress });
    saveState = "saved";
  } catch (e) {
    if (e.status === 401) { USER = null; return viewAuth("Сессия истекла — войди снова."); }
    saveState = "offline";
  }
  renderMe();
}

async function pullProgress() {
  const { data } = await api("GET", "/api/progress");
  const server = data || {};
  const local = readCache();
  let added = false;
  for (const [k, v] of Object.entries(local)) {
    if (!(k in server) && v !== undefined && v !== null) { server[k] = v; added = true; }
  }
  progress = server;
  writeCache();
  if (added) await pushProgress();
}

async function loadSqlStatus() {
  try { SQL_ENABLED = !!(await api("GET", "/api/sql/status")).enabled; } catch (e) { SQL_ENABLED = false; }
}

function mark(key, value) {
  if (value === undefined || value === "") delete progress[key];
  else progress[key] = value;
  save();
}

/* ================= модель уроков ================= */

const allSteps = () => DATA.lessons.flatMap((l) => l.steps.map((s) => ({ ...s, lesson: l })));
const isDone = (s) => s.status === "done" || progress["s:" + s.id] === "done";
const stepState = (s) => (isDone(s) ? "done" : s.status === "current" ? "current" : "next");

function findStep(id) {
  for (const l of DATA.lessons) {
    const i = l.steps.findIndex((s) => s.id === id);
    if (i > -1) return { lesson: l, step: l.steps[i], index: i };
  }
  return null;
}

function nextUp() {
  const list = allSteps();
  return list.find((s) => !isDone(s) && s.status === "current") || list.find((s) => !isDone(s)) || null;
}

/* ================= шапка ================= */

function setTab(name) {
  tabsEl.hidden = !USER;
  tabsEl.querySelectorAll("a").forEach((a) => a.classList.toggle("on", a.dataset.tab === name));
}

function renderMe() {
  if (!USER) { meEl.innerHTML = ""; return; }
  const title = { saved: "Прогресс сохранён", saving: "Сохраняю…", offline: "Нет связи — прогресс сохранён на устройстве" }[saveState];
  meEl.innerHTML = `
    <span class="dot ${saveState}" title="${title}"></span>
    <span class="who">${esc(USER.username)}</span>
    <button type="button" id="logout">Выйти</button>`;
  document.getElementById("logout").onclick = async () => {
    try { await api("POST", "/api/logout"); } catch (e) { /* всё равно выходим */ }
    USER = null;
    progress = {};
    try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
    viewAuth();
  };
}

/* ================= редактор ================= */

function createEditor(host, { value = "", placeholder = "", onChange, onRun, onCheck }) {
  if (window.CodeMirror) {
    const run = () => onRun && onRun();
    const check = () => (onCheck ? onCheck() : run());
    const cm = CodeMirror(host, {
      value,
      mode: "text/x-plsql",
      lineNumbers: true,
      lineWrapping: true,
      indentUnit: 2,
      tabSize: 2,
      indentWithTabs: false,
      matchBrackets: true,
      autoCloseBrackets: "()''",
      placeholder,
      extraKeys: {
        "Cmd-Enter": run, "Ctrl-Enter": run,
        "Shift-Cmd-Enter": check, "Shift-Ctrl-Enter": check,
        Tab: (c) => (c.somethingSelected() ? c.indentSelection("add") : c.replaceSelection("  ")),
      },
    });
    cm.on("change", () => onChange && onChange(cm.getValue()));
    return {
      get: () => cm.getValue(),
      set: (v) => { cm.setValue(v); cm.focus(); cm.setCursor(cm.lineCount(), 0); },
      insert: (t) => { cm.replaceSelection(t); cm.focus(); },
      focus: () => cm.focus(),
      refresh: () => cm.refresh(),
    };
  }
  // запасной вариант, если CodeMirror не загрузился
  const ta = document.createElement("textarea");
  ta.className = "fallback";
  ta.spellcheck = false;
  ta.value = value;
  ta.placeholder = placeholder;
  host.appendChild(ta);
  ta.addEventListener("input", () => onChange && onChange(ta.value));
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      (e.shiftKey && onCheck ? onCheck : onRun)();
    }
  });
  return {
    get: () => ta.value,
    set: (v) => { ta.value = v; ta.focus(); },
    insert: (t) => { ta.setRangeText(t, ta.selectionStart, ta.selectionEnd, "end"); ta.focus(); },
    focus: () => ta.focus(),
    refresh: () => {},
  };
}

/* ================= рендер результатов ================= */

const cell = (v) => (v === null || v === undefined ? `<span class="null">NULL</span>` : esc(v));

function tableHtml(columns, rowsData) {
  return `
    <div class="grid-wrap">
      <table class="grid">
        <thead><tr><th class="rn">#</th>${columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
        <tbody>${rowsData.map((r, i) => `<tr><td class="rn">${i + 1}</td>${r.map((v) => `<td>${cell(v)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>`;
}

function renderRun(r) {
  const out = [];
  if (r.columns) {
    out.push(`<div class="res-meta"><span>${rows(r.rows.length)}${r.truncated ? " — показаны первые" : ""}</span><span>${r.ms} мс</span></div>`);
    out.push(r.rows.length ? tableHtml(r.columns, r.rows) : `<div class="msg">Запрос выполнен, но строк нет.</div>`);
  } else {
    const affected = r.kind === "sql" && r.rowsAffected != null ? ` · затронуто: ${rows(r.rowsAffected)}` : "";
    out.push(`<div class="msg ok">Выполнено${affected} · ${r.ms} мс</div>`);
  }
  if (r.warning) {
    out.push(`<div class="msg bad"><pre>${esc(r.warning)}${r.compileErrors?.length ? "\n\n" + r.compileErrors.map(esc).join("\n") : ""}</pre></div>`);
  }
  if (r.output?.length) {
    out.push(`<div class="sub">DBMS_OUTPUT</div><pre class="out">${esc(r.output.join("\n"))}</pre>`);
  }
  return out.join("");
}

function renderError(message, ms) {
  return `<div class="msg bad"><pre>${esc(message)}</pre></div>${ms != null ? `<div class="res-meta"><span>${ms} мс</span></div>` : ""}`;
}

function renderCheck(r, next) {
  if (r.ok) {
    return `<div class="msg ok"><b>✓ Верно.</b> Шаг отмечен пройденным.
      ${next ? `<div class="next"><a class="btn ok" href="#/step/${next.id}">Следующий шаг: ${esc(next.title)} →</a></div>` : ""}</div>`;
  }
  const out = [r.error ? renderError(r.message) : `<div class="msg bad">${esc(r.message)}</div>`];
  if (r.missing?.length) {
    out.push(`<div class="sub">Этих строк не хватает (до трёх):</div>`);
    out.push(tableHtml(r.missing[0].map((_, i) => r.columns?.[i] ?? `#${i + 1}`), r.missing));
  }
  if (r.extra?.length) {
    out.push(`<div class="sub">А эти лишние:</div>`);
    out.push(tableHtml(r.columns, r.extra));
  }
  return out.join("");
}

/* ================= экран: вход ================= */

function viewAuth(message, mode = "login") {
  setTab(null);
  renderMe();
  const reg = mode === "register";
  app.innerHTML = `
    <div class="card auth">
      <span class="eyebrow">PL/SQL · подготовка</span>
      <h1>${reg ? "Регистрация" : "Вход"}</h1>
      <p class="lede" style="margin:0">${reg ? "По коду-приглашению из настроек Railway." : "Прогресс одинаковый на телефоне и ноутбуке."}</p>
      ${message ? `<p class="notice">${esc(message)}</p>` : ""}
      <form id="auth-form" novalidate>
        <label for="username">Логин</label>
        <input id="username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required>
        <label for="password">Пароль</label>
        <input id="password" name="password" type="password" autocomplete="${reg ? "new-password" : "current-password"}" required>
        ${reg ? `<label for="code">Код приглашения</label>
        <input id="code" name="code" autocomplete="off" autocapitalize="none" spellcheck="false" required>` : ""}
        <p class="form-error" id="auth-error" hidden></p>
        <button class="btn primary" type="submit" id="auth-submit">${reg ? "Создать аккаунт" : "Войти"}</button>
      </form>
      <button class="btn ghost switch" id="auth-switch" type="button">${reg ? "Уже есть аккаунт — войти" : "Нет аккаунта — зарегистрироваться"}</button>
    </div>`;

  document.getElementById("auth-switch").onclick = () => viewAuth(null, reg ? "login" : "register");
  const form = document.getElementById("auth-form");
  const errBox = document.getElementById("auth-error");
  const submit = document.getElementById("auth-submit");
  form.onsubmit = async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    submit.disabled = true;
    const body = { username: form.username.value.trim(), password: form.password.value };
    if (reg) body.code = form.code.value.trim();
    try {
      USER = await api("POST", reg ? "/api/register" : "/api/login", body);
      await Promise.all([pullProgress(), loadSqlStatus()]);
      route();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.hidden = false;
      submit.disabled = false;
    }
  };
  document.getElementById("username").focus();
}

/* ================= экран: главная ================= */

function viewHome() {
  setTab("home");
  const steps = allSteps();
  const done = steps.filter(isDone).length;
  const answered = QUESTIONS.filter((q) => progress["q:" + q.id]).length;
  const ok = QUESTIONS.filter((q) => progress["q:" + q.id] === "ok").length;
  const wrong = QUESTIONS.filter((q) => progress["q:" + q.id] === "bad").length;
  const next = nextUp();

  app.innerHTML = `
    <div class="page">
      <div class="card hero">
        <div>
          <span class="eyebrow">Подготовка к PL/SQL developer</span>
          <h1>Привет, ${esc(USER.username)}</h1>
          <p class="lede">Один шаг — одна тема: теория, пример, задача и проверка прямо в Oracle.</p>
        </div>
        ${next ? `<div class="continue">
          <span class="next-title">Дальше: урок ${esc(next.lesson.num)} · ${esc(next.title)}</span>
          <a class="btn primary" href="#/step/${next.id}">Продолжить →</a>
        </div>` : ""}
      </div>

      <div class="stats">
        <div class="stat"><b>${done}/${steps.length}</b><span>шагов пройдено</span></div>
        <div class="stat"><b>${answered}/${QUESTIONS.length}</b><span>вопросов теста</span></div>
        <div class="stat"><b>${answered ? Math.round((ok / answered) * 100) + "%" : "—"}</b><span>верных в тесте</span></div>
        <div class="stat"><b>${wrong}</b><span>вопросов на повтор</span></div>
      </div>

      <h2>Уроки</h2>
      <div class="lessons">
        ${DATA.lessons.map((l) => {
          const d = l.steps.filter(isDone).length;
          return `
          <a class="card lesson-card" href="#/lesson/${l.id}">
            <span class="eyebrow">Урок ${esc(l.num)}</span>
            <h3>${esc(l.title)}</h3>
            <p>${esc(l.subtitle)}</p>
            <div class="meter"><i style="width:${(d / l.steps.length) * 100}%"></i></div>
            <div class="meta"><span>${d} из ${l.steps.length} шагов</span><span>${d === l.steps.length ? "готово ✓" : ""}</span></div>
          </a>`;
        }).join("")}
      </div>
    </div>`;
}

/* ================= экран: обзор урока ================= */

function viewLesson(id) {
  setTab("home");
  const l = DATA.lessons.find((x) => x.id === id);
  if (!l) return viewHome();
  app.innerHTML = `
    <div class="page">
      <a class="back" href="#/">← все уроки</a>
      <span class="eyebrow" style="display:block">Урок ${esc(l.num)}</span>
      <h1>${esc(l.title)}</h1>
      <p class="lede">${esc(l.subtitle)}</p>
      <div class="card step-list">
        ${l.steps.map((s, i) => {
          const st = stepState(s);
          return `<a class="step-row ${st}" href="#/step/${s.id}">
            <span class="n">${st === "done" ? "✓" : i + 1}</span>
            <span>${esc(s.title)}</span>
            <span class="chip ${st}">${STATUS[st]}</span>
          </a>`;
        }).join("")}
      </div>
    </div>`;
}

/* ================= экран: шаг ================= */

const sqlSaveTimers = {};
function rememberText(key, text) {
  clearTimeout(sqlSaveTimers[key]);
  sqlSaveTimers[key] = setTimeout(() => {
    if ((progress[key] || "") !== text) mark(key, text || undefined);
  }, 1200);
}

function viewStep(id) {
  setTab("home");
  const found = findStep(id);
  if (!found) return viewHome();
  const { lesson, step: s, index } = found;
  const prev = lesson.steps[index - 1];
  const nextInLesson = lesson.steps[index + 1];
  const list = allSteps();
  const globalIdx = list.findIndex((x) => x.id === s.id);
  const nextGlobal = list[globalIdx + 1] || null;
  const st = stepState(s);

  const pills = lesson.steps.map((x, i) => {
    const xs = stepState(x);
    const cls = [xs === "done" ? "done" : xs === "current" ? "cur" : "", x.id === s.id ? "here" : ""].join(" ");
    return `<a class="pill ${cls}" href="#/step/${x.id}" title="${esc(x.title)}">${xs === "done" ? "✓" : i + 1}</a>`;
  }).join("");

  const examples = (s.examples || []).map((e) => `
    <div class="row"><div class="sql">${esc(e.sql)}</div><div class="out">${esc(e.out)}</div></div>`).join("");

  const mistakes = (s.mistakes || []).length
    ? `<div class="mistakes"><span class="eyebrow">мои ошибки на этом шаге</span><ul>${s.mistakes.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></div>`
    : "";

  const right = SQL_ENABLED
    ? `
      <div class="ed-head">
        <span class="eyebrow">SQL · Oracle</span>
        <span class="keys"><kbd>${MOD} ↵</kbd> выполнить${s.check ? ` · <kbd>${MOD} ⇧ ↵</kbd> проверить` : ""}</span>
      </div>
      <div class="ed" id="ed"></div>
      <div class="ed-actions">
        <button class="btn" id="run" type="button">▶ Выполнить</button>
        ${s.check ? `<button class="btn primary" id="check" type="button">✓ Проверить решение</button>` : ""}
        <span class="spacer"></span>
        <span class="status" id="status"></span>
      </div>
      <div class="results" id="res"><div class="empty">Напиши запрос и нажми «Выполнить». ${s.check ? "Когда результат устроит — «Проверить решение»." : ""}</div></div>`
    : `<div class="results"><div class="msg">Выполнение запросов на сайте не подключено — решай в DataGrip.</div></div>`;

  app.innerHTML = `
    <div class="stepbar">
      <a class="crumb" href="#/lesson/${lesson.id}">Урок ${esc(lesson.num)} · ${esc(lesson.title)}</a>
      <nav class="pills">${pills}</nav>
      <div class="stepnav">
        <a class="btn ghost" ${prev ? `href="#/step/${prev.id}"` : "aria-disabled=true"} title="Предыдущий шаг">←</a>
        <a class="btn ghost" ${nextInLesson ? `href="#/step/${nextInLesson.id}"` : nextGlobal ? `href="#/step/${nextGlobal.id}"` : "aria-disabled=true"} title="Следующий шаг">→</a>
      </div>
    </div>
    <div class="split">
      <section class="pane left">
        <div class="inner">
          <div class="step-head">
            <span class="chip ${st}" id="step-chip">${STATUS[st]}</span>
            <span class="eyebrow">шаг ${index + 1} из ${lesson.steps.length}</span>
          </div>
          <h1>${esc(s.title)}</h1>
          <div class="theory">${s.theory}</div>
          ${examples ? `<div class="examples">${examples}</div>` : ""}
          <div class="task"><span class="eyebrow">задание</span>${esc(s.task)}</div>
          ${mistakes}
          <details class="sol"><summary>Показать решение</summary><pre class="code">${esc(s.solution)}</pre></details>
          ${!s.check && s.status !== "done"
            ? `<button class="btn mark-done" id="mark" type="button">${progress["s:" + s.id] === "done" ? "✓ Отмечено пройденным" : "Отметить пройденным"}</button>`
            : ""}
        </div>
      </section>
      <section class="pane right">${right}</section>
    </div>`;

  const markBtn = document.getElementById("mark");
  if (markBtn) markBtn.onclick = () => {
    const k = "s:" + s.id;
    mark(k, progress[k] === "done" ? undefined : "done");
    viewStep(id);
  };

  if (!SQL_ENABLED) return;

  const res = document.getElementById("res");
  const status = document.getElementById("status");
  const runBtn = document.getElementById("run");
  const checkBtn = document.getElementById("check");
  const key = "sql:" + s.id;

  const go = async (mode) => {
    const sql = ed.get();
    if (!sql.trim()) { res.innerHTML = `<div class="msg bad">Сначала напиши запрос.</div>`; return; }
    if ((progress[key] || "") !== sql) mark(key, sql);
    runBtn.disabled = true;
    if (checkBtn) checkBtn.disabled = true;
    status.textContent = mode === "check" ? "Проверяю…" : "Выполняю…";
    try {
      if (mode === "check") {
        const r = await api("POST", "/api/sql/check", { stepId: s.id, sql });
        res.innerHTML = renderCheck(r, nextGlobal);
        if (r.ok && !isDone(s)) {
          mark("s:" + s.id, "done");
          const chip = document.getElementById("step-chip");
          chip.className = "chip done";
          chip.textContent = STATUS.done;
          const here = document.querySelector(".pill.here");
          if (here) { here.classList.add("done"); here.classList.remove("cur"); here.textContent = "✓"; }
        }
      } else {
        res.innerHTML = renderRun(await api("POST", "/api/sql/run", { sql }));
      }
    } catch (e) {
      if (e.status === 401) { USER = null; return viewAuth("Сессия истекла — войди снова."); }
      res.innerHTML = renderError(e.message, e.ms);
    } finally {
      runBtn.disabled = false;
      if (checkBtn) checkBtn.disabled = false;
      status.textContent = "";
    }
  };

  const ed = createEditor(document.getElementById("ed"), {
    value: progress[key] || "",
    placeholder: "-- пиши запрос здесь",
    onChange: (v) => rememberText(key, v),
    onRun: () => go("run"),
    onCheck: s.check ? () => go("check") : null,
  });
  runBtn.onclick = () => go("run");
  if (checkBtn) checkBtn.onclick = () => go("check");
}

/* ================= экран: консоль ================= */

async function loadSchema() {
  if (SCHEMA) return SCHEMA;
  SCHEMA = (await api("GET", "/api/sql/schema")).tables;
  return SCHEMA;
}

function viewConsole() {
  setTab("console");
  if (!SQL_ENABLED) {
    app.innerHTML = `<div class="page"><h1>Консоль</h1><div class="msg">Выполнение запросов на сайте не подключено.</div></div>`;
    return;
  }
  app.innerHTML = `
    <div class="console">
      <aside class="side">
        <div class="side-tabs">
          <button type="button" data-side="tables" class="on">Таблицы</button>
          <button type="button" data-side="history">История</button>
        </div>
        <div class="side-body" id="side"></div>
      </aside>
      <section class="work">
        <div class="ed-head">
          <span class="eyebrow">Консоль · схема PLSQL</span>
          <span class="keys"><kbd>${MOD} ↵</kbd> выполнить</span>
        </div>
        <div class="ed tall" id="ed"></div>
        <div class="ed-actions">
          <button class="btn primary" id="run" type="button">▶ Выполнить</button>
          <button class="btn ghost" id="clear" type="button">Очистить</button>
          <span class="spacer"></span>
          <span class="status" id="status"></span>
        </div>
        <div class="results" id="res"><div class="empty">Любые запросы к своей схеме: SELECT, DML, PL/SQL-блоки. Каждая команда сразу коммитится.</div></div>
      </section>
    </div>`;

  const res = document.getElementById("res");
  const status = document.getElementById("status");
  const runBtn = document.getElementById("run");
  const side = document.getElementById("side");
  let sideMode = "tables";

  const history = () => (Array.isArray(progress["console:history"]) ? progress["console:history"] : []);

  const go = async () => {
    const sql = ed.get();
    if (!sql.trim()) return;
    mark("console:draft", sql);
    const h = [sql, ...history().filter((x) => x !== sql)].slice(0, HISTORY_MAX);
    mark("console:history", h);
    if (sideMode === "history") renderSide();
    runBtn.disabled = true;
    status.textContent = "Выполняю…";
    try {
      const r = await api("POST", "/api/sql/run", { sql });
      res.innerHTML = renderRun(r);
      if (!r.columns) { SCHEMA = null; if (sideMode === "tables") renderSide(); } // DDL мог поменять таблицы
    } catch (e) {
      if (e.status === 401) { USER = null; return viewAuth("Сессия истекла — войди снова."); }
      res.innerHTML = renderError(e.message, e.ms);
    } finally {
      runBtn.disabled = false;
      status.textContent = "";
    }
  };

  const ed = createEditor(document.getElementById("ed"), {
    value: progress["console:draft"] || "SELECT *\n  FROM employees\n FETCH FIRST 10 ROWS ONLY;",
    placeholder: "-- любой запрос к своей схеме",
    onChange: (v) => rememberText("console:draft", v),
    onRun: go,
  });
  runBtn.onclick = go;
  document.getElementById("clear").onclick = () => { ed.set(""); res.innerHTML = ""; };

  async function renderSide() {
    if (sideMode === "history") {
      const h = history();
      side.innerHTML = h.length
        ? h.map((q, i) => `<button class="hist-item" type="button" data-h="${i}">${esc(q)}</button>`).join("")
        : `<p class="side-note">Здесь появятся выполненные запросы. Нажми на запрос, чтобы вернуть его в редактор.</p>`;
      side.querySelectorAll("[data-h]").forEach((b) => (b.onclick = () => ed.set(h[+b.dataset.h])));
      return;
    }
    side.innerHTML = `<p class="side-note">Загружаю таблицы…</p>`;
    try {
      const tables = await loadSchema();
      side.innerHTML = `<input id="tfilter" type="search" placeholder="Найти таблицу или столбец" autocomplete="off">
        <div id="tlist"></div>`;
      const draw = (q = "") => {
        const needle = q.trim().toUpperCase();
        const list = tables.filter((t) => !needle || t.name.includes(needle) || t.columns.some((c) => c.name.includes(needle)));
        document.getElementById("tlist").innerHTML = list.length
          ? list.map((t) => `
            <details class="tbl-item" ${needle ? "open" : ""}>
              <summary><span>${esc(t.name.toLowerCase())}</span><span class="peek" data-peek="${esc(t.name)}">SELECT *</span></summary>
              ${t.columns.map((c) => `<div class="col" data-col="${esc(c.name.toLowerCase())}">
                <span>${esc(c.name.toLowerCase())}</span>${c.nullable ? "" : `<span class="nn" title="NOT NULL">●</span>`}<span class="t">${esc(c.type)}</span></div>`).join("")}
            </details>`).join("")
          : `<p class="side-note">Ничего не найдено.</p>`;
        side.querySelectorAll("[data-peek]").forEach((el) => (el.onclick = (e) => {
          e.preventDefault();
          ed.set(`SELECT *\n  FROM ${el.dataset.peek.toLowerCase()}\n FETCH FIRST 50 ROWS ONLY;`);
          go();
        }));
        side.querySelectorAll("[data-col]").forEach((el) => (el.onclick = () => ed.insert(el.dataset.col)));
      };
      draw();
      document.getElementById("tfilter").oninput = (e) => draw(e.target.value);
    } catch (e) {
      side.innerHTML = `<p class="side-note">Не удалось загрузить таблицы: ${esc(e.message)}</p>`;
    }
  }

  document.querySelectorAll("[data-side]").forEach((b) => (b.onclick = () => {
    sideMode = b.dataset.side;
    document.querySelectorAll("[data-side]").forEach((x) => x.classList.toggle("on", x === b));
    renderSide();
  }));
  renderSide();

  // запрос из раздела «Схема»
  const preset = sessionStorage.getItem("console:preset");
  if (preset) {
    sessionStorage.removeItem("console:preset");
    ed.set(preset);
    go();
  }
}

/* ================= экран: тест ================= */

let queue = [];
let pos = 0;
let answered = false;

function viewQuizStart() {
  setTab("quiz");
  const done = QUESTIONS.filter((q) => progress["q:" + q.id]).length;
  const ok = QUESTIONS.filter((q) => progress["q:" + q.id] === "ok").length;
  const wrong = QUESTIONS.filter((q) => progress["q:" + q.id] === "bad").length;
  app.innerHTML = `
    <div class="page quiz">
      <span class="eyebrow">Тест</span>
      <h1>Вопросы-ловушки</h1>
      <p class="lede">То, на чём спотыкаются на собеседовании. Отвечай честно — тест запоминает, где ты ошибся.</p>
      <div class="stats" style="grid-template-columns:repeat(3,1fr)">
        <div class="stat"><b>${done}/${QUESTIONS.length}</b><span>пройдено</span></div>
        <div class="stat"><b>${done ? Math.round((ok / done) * 100) + "%" : "—"}</b><span>верных</span></div>
        <div class="stat"><b>${wrong}</b><span>с ошибкой</span></div>
      </div>
      <div class="quiz-actions">
        <button class="btn primary" id="go" type="button">${done < QUESTIONS.length ? (done ? "Продолжить" : "Начать") : "Пройти все заново"}</button>
        ${wrong ? `<button class="btn" id="err" type="button">Только ошибки · ${wrong}</button>` : ""}
        ${done && done < QUESTIONS.length ? `<button class="btn ghost" id="all" type="button">Все заново</button>` : ""}
        ${done ? `<button class="btn ghost" id="reset" type="button">Сбросить результаты</button>` : ""}
      </div>
    </div>`;

  document.getElementById("go").onclick = () => {
    const unseen = QUESTIONS.filter((q) => !progress["q:" + q.id]).map((q) => q.id);
    startQuiz(unseen.length ? unseen : shuffle(QUESTIONS.map((q) => q.id)));
  };
  const err = document.getElementById("err");
  if (err) err.onclick = () => startQuiz(shuffle(QUESTIONS.filter((q) => progress["q:" + q.id] === "bad").map((q) => q.id)));
  const all = document.getElementById("all");
  if (all) all.onclick = () => startQuiz(shuffle(QUESTIONS.map((q) => q.id)));
  const reset = document.getElementById("reset");
  if (reset) reset.onclick = () => {
    QUESTIONS.forEach((q) => delete progress["q:" + q.id]);
    save();
    viewQuizStart();
  };
}

function startQuiz(ids) { queue = ids; pos = 0; renderQuestion(); }

function renderQuestion() {
  if (pos >= queue.length) return renderQuizEnd();
  answered = false;
  const q = QUESTIONS.find((x) => x.id === queue[pos]);
  app.innerHTML = `
    <div class="page quiz">
      <a class="back" href="#/quiz">← к тесту</a>
      <div><span class="eyebrow qtopic">${esc(q.topic)}</span> <span class="eyebrow">· ${pos + 1} из ${queue.length}</span></div>
      <p class="qtext">${esc(q.q)}</p>
      ${q.code ? `<pre class="code" style="margin-bottom:16px">${esc(q.code)}</pre>` : ""}
      <div class="opts" id="opts"></div>
      <div id="after"></div>
    </div>`;
  const opts = document.getElementById("opts");
  const order = shuffle(q.opts.map((text, i) => ({ text, i })));
  order.forEach((o, n) => {
    const b = document.createElement("button");
    b.className = "opt";
    b.type = "button";
    b.innerHTML = `<span class="key">${KEYS[n]}</span><span>${esc(o.text)}</span>`;
    b.onclick = () => answer(q, o.i, b, opts, order);
    opts.appendChild(b);
  });
}

function answer(q, chosen, btn, opts, order) {
  if (answered) return;
  answered = true;
  const right = chosen === q.a;
  mark("q:" + q.id, right ? "ok" : "bad");
  [...opts.children].forEach((el, n) => {
    el.disabled = true;
    if (order[n].i === q.a) el.classList.add("is-ok");
    else if (el === btn) el.classList.add("is-bad");
    else el.classList.add("is-dim");
  });
  document.getElementById("after").innerHTML = `
    <div class="why">
      <span class="eyebrow ${right ? "ok" : "bad"}">${right ? "Верно" : "Мимо"}</span>
      <p>${q.why}</p>
    </div>
    <div class="quiz-actions"><button class="btn primary" id="next" type="button">${pos + 1 >= queue.length ? "Итоги" : "Дальше →"}</button></div>`;
  const next = document.getElementById("next");
  next.onclick = () => { pos++; renderQuestion(); window.scrollTo(0, 0); };
  next.focus();
}

function renderQuizEnd() {
  const ok = queue.filter((id) => progress["q:" + id] === "ok").length;
  const missed = queue.filter((id) => progress["q:" + id] === "bad");
  app.innerHTML = `
    <div class="page quiz">
      <p class="score">${ok} / ${queue.length}</p>
      <p class="lede">${missed.length ? "Вот что стоит перечитать." : "Чисто. Можно идти дальше."}</p>
      ${missed.map((id) => {
        const q = QUESTIONS.find((x) => x.id === id);
        return `<div class="card miss"><span class="eyebrow">${esc(q.topic)}</span><p>${esc(q.q)}</p></div>`;
      }).join("")}
      <div class="quiz-actions">
        ${missed.length ? `<button class="btn primary" id="again" type="button">Пройти ошибки ещё раз</button>` : ""}
        <a class="btn ${missed.length ? "" : "primary"}" href="#/quiz">К тесту</a>
      </div>
    </div>`;
  const again = document.getElementById("again");
  if (again) again.onclick = () => startQuiz(shuffle(missed));
}

/* ================= экран: схема ================= */

function viewSchema() {
  setTab("schema");
  app.innerHTML = `
    <div class="page">
      <span class="eyebrow">Учебная схема</span>
      <h1>Таблицы и ловушки в данных</h1>
      <p class="lede">Пользователь <span class="mono">plsql</span>. Ловушки расставлены специально — на них и тренируемся.</p>
      <div class="schema-grid">
        ${DATA.schema.map((t) => `
          <div class="card tbl-card">
            <h3>${esc(t.table)} <span class="rows">${rows(t.rows)}</span>
              ${SQL_ENABLED ? `<a href="#/console" data-open="${esc(t.table)}">открыть в консоли →</a>` : ""}</h3>
            <p class="cols">${esc(t.columns)}</p>
            <p class="note">${esc(t.note)}</p>
          </div>`).join("")}
      </div>
    </div>`;
  app.querySelectorAll("[data-open]").forEach((a) => (a.onclick = () => {
    try { sessionStorage.setItem("console:preset", `SELECT *\n  FROM ${a.dataset.open};`); } catch (e) {}
  }));
}

/* ================= роутер ================= */

function route() {
  if (!USER) return viewAuth();
  renderMe();
  window.scrollTo(0, 0);
  const [page, arg] = (location.hash || "#/").slice(2).split("/");
  if (page === "step" && arg) return viewStep(arg);
  if (page === "lesson" && arg) return viewLesson(arg);
  if (page === "lessons") return viewHome();
  if (page === "console") return viewConsole();
  if (page === "quiz") return viewQuizStart();
  if (page === "schema") return viewSchema();
  return viewHome();
}

window.addEventListener("hashchange", route);

async function boot() {
  try {
    [DATA, QUESTIONS] = await Promise.all([
      fetch("/content/lessons.json").then((r) => r.json()),
      fetch("/content/questions.json").then((r) => r.json()),
    ]);
  } catch (e) {
    app.innerHTML = `<div class="page"><h1>Не загрузился контент</h1><p class="lede">${esc(e.message)}</p></div>`;
    return;
  }
  try {
    USER = await api("GET", "/api/me");
  } catch (e) {
    USER = null;
    if (e.status !== 401) return viewAuth("Сервер не отвечает. Проверь соединение и обнови страницу.");
  }
  if (!USER) return viewAuth();
  try {
    await Promise.all([pullProgress(), loadSqlStatus()]);
  } catch (e) {
    progress = readCache();
    saveState = "offline";
  }
  route();
}

boot();
