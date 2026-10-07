/* PL/SQL Prep — клиент.
   Прогресс хранится на сервере под логином и одинаков на всех устройствах;
   localStorage — только кэш на случай обрыва сети и выбор темы. */

const app = document.getElementById("app");
const CACHE_KEY = "plsql-prep";
const THEME_KEY = "plsql-theme";
const KEYS = ["A", "B", "C", "D"];
const STATUS = { done: "пройдено", current: "сейчас", next: "впереди" };
const HISTORY_MAX = 30;
const SR_DAYS = [1, 3, 7, 14, 30];   // интервалы повторения: ошибся → завтра, дальше 3, 7, 14, 30 дней
const IV_SEC_PER_Q = 75;             // время на вопрос в режиме собеседования

let DATA = null;          // lessons.json
let QUESTIONS = [];       // questions.json
let CHEAT = [];           // cheatsheet.json
let USER = null;          // { username }
let SQL_ENABLED = false;  // подключена ли Oracle
let SCHEMA = null;        // таблицы и столбцы из базы (для консоли)
let progress = {};
let saveState = "saved";  // saved | saving | offline
let currentTab = null;

/* ================= утилиты ================= */

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl";
const $ = (id) => document.getElementById(id);

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
const qWord = (n) => `${n} ${plural(n, "вопрос", "вопроса", "вопросов")}`;
const dWord = (n) => `${n} ${plural(n, "день", "дня", "дней")}`;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

/* даты — по локальному времени устройства */
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseDay = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = parseDay(k); d.setDate(d.getDate() + n); return dayKey(d); };
const today = () => dayKey();
const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const fmtDay = (k) => { const d = parseDay(k); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const fmtTime = (sec) => `${Math.floor(sec / 60)}:${String(Math.max(0, sec % 60)).padStart(2, "0")}`;

/* иконки (в стиле lucide), рисуются линией текущего цвета */
const ICON_PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  repeat: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  quiz: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v4"/>',
  cheat: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
  terminal: '<rect x="2" y="3" width="20" height="18" rx="3"/><path d="m7 9 3 3-3 3"/><path d="M13 15h4"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  arrow: '<path d="M5 12h14M13 5l7 7-7 7"/>',
  back: '<path d="M19 12H5M11 19l-7-7 7-7"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
  sparkles: '<path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/><path d="M19 3v4M17 5h4"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
};
const icon = (name, cls = "") => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[name] || ""}</svg>`;

/* статическая подсветка SQL тем же режимом, что и редактор */
function hl(code) {
  if (!window.CodeMirror || !CodeMirror.runMode) return esc(code);
  let out = "";
  CodeMirror.runMode(String(code), "text/x-plsql", (text, style) => {
    out += style ? `<span class="${style.split(" ").map((s) => "cm-" + s).join(" ")}">${esc(text)}</span>` : esc(text);
  });
  return out;
}
const codeBlock = (code) => `<pre class="code hl">${hl(code)}</pre>`;

/* кольцо прогресса */
function ring(value, max, { size = 120, stroke = 10, label = "", cls = "", text = null, barCls = "" } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = max ? Math.min(1, value / max) : 0;
  return `<div class="ring ${cls}" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/>
      <circle class="bar ${barCls}" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"
        stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p)}"/>
    </svg>
    <div class="val"><b>${text ?? Math.round(p * 100) + "%"}</b>${label ? `<span>${label}</span>` : ""}</div>
  </div>`;
}

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
  // активность по дням сливаем по максимуму, чтобы не терять дни с другого устройства
  if (local.act && server.act && local.act !== server.act) {
    for (const [d, n] of Object.entries(local.act)) if ((server.act[d] || 0) < n) { server.act[d] = n; added = true; }
  }
  progress = server;
  if (migrateReview()) added = true;
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

/* ================= активность, серия, повторение ================= */

function bump(n = 1) {
  const act = { ...(progress.act || {}) };
  act[today()] = (act[today()] || 0) + n;
  progress.act = act;
}

function streakInfo() {
  const act = progress.act || {};
  let d = today();
  if (!act[d]) d = addDays(d, -1);
  let cur = 0;
  while (act[d]) { cur++; d = addDays(d, -1); }
  let best = 0, run = 0, prev = null;
  for (const k of Object.keys(act).filter((k) => act[k] > 0).sort()) {
    run = prev && addDays(prev, 1) === k ? run + 1 : 1;
    best = Math.max(best, run);
    prev = k;
  }
  return { cur, best: Math.max(best, cur), todayCount: act[today()] || 0 };
}

const goal = () => progress.goal || 15;

// старые ошибки (до появления повторения) ставим в очередь на сегодня
function migrateReview() {
  let changed = false;
  for (const q of QUESTIONS) {
    if (progress["q:" + q.id] === "bad" && !progress["r:" + q.id]) {
      progress["r:" + q.id] = { b: 0, d: today() };
      changed = true;
    }
  }
  return changed;
}

function recordAnswer(id, right) {
  progress["q:" + id] = right ? "ok" : "bad";
  const k = "r:" + id;
  const r = progress[k];
  if (!right) progress[k] = { b: 0, d: addDays(today(), SR_DAYS[0]) };
  else if (r) {
    const b = r.b + 1;
    if (b >= SR_DAYS.length) delete progress[k];
    else progress[k] = { b, d: addDays(today(), SR_DAYS[b]) };
  }
  bump();
  save();
  renderNav();
}

const reviewItems = () => QUESTIONS.filter((q) => progress["r:" + q.id]);
const dueItems = () => reviewItems().filter((q) => progress["r:" + q.id].d <= today());

/* ================= модель уроков и вопросов ================= */

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

const sectionOf = (q) => q.section || "lessons";
const isCard = (q) => q.type === "card";
const qById = (id) => QUESTIONS.find((x) => x.id === id);
const interviewQs = () => QUESTIONS.filter((q) => sectionOf(q) !== "lessons");
const SECTION_NAME = { lessons: "Уроки", sql: "SQL", plsql: "PL/SQL" };

function topicStats(list = QUESTIONS) {
  const map = new Map();
  for (const q of list) {
    const t = map.get(q.topic) || { topic: q.topic, total: 0, seen: 0, ok: 0, ids: [] };
    t.total++;
    t.ids.push(q.id);
    const st = progress["q:" + q.id];
    if (st) t.seen++;
    if (st === "ok") t.ok++;
    map.set(q.topic, t);
  }
  return [...map.values()];
}

const readiness = () => {
  const list = interviewQs();
  return { ok: list.filter((q) => progress["q:" + q.id] === "ok").length, total: list.length };
};

/* дальше по программе — показываем как дорожную карту */
const ROADMAP = [
  ["04", "ORDER BY, DISTINCT, FETCH FIRST, ROWNUM"], ["05", "Агрегаты, GROUP BY, HAVING"], ["06", "Соединения"],
  ["07", "Подзапросы, EXISTS, NOT IN и NULL"], ["08", "UNION, INTERSECT, MINUS"], ["09", "DML, транзакции, MERGE"],
  ["10", "DDL: ограничения, последовательности, индексы"], ["11", "Аналитические функции"], ["12", "Иерархия: CONNECT BY"],
  ["13", "PL/SQL: анатомия блока"], ["14", "Ветвления и циклы"], ["15", "Курсоры I"], ["16", "Курсоры II и REF CURSOR"],
  ["17", "Исключения"], ["18", "Процедуры и функции"], ["19", "Пакеты"], ["20", "Записи и коллекции"],
  ["21", "BULK COLLECT и FORALL"], ["22", "Триггеры"], ["23", "Мутирующие таблицы, автономные транзакции"],
  ["24", "Динамический SQL"], ["25", "Эксплуатация и словарь"], ["26", "Планы выполнения"],
];

/* ================= оболочка: навигация, тема, пользователь ================= */

const NAV = [
  { k: "home", href: "#/", label: "Главная", icon: "home", tab: true },
  { k: "lessons", href: "#/lessons", label: "Уроки", icon: "book", tab: true },
  { k: "review", href: "#/review", label: "Повторение", icon: "repeat", tab: true, short: "Повтор" },
  { k: "quiz", href: "#/quiz", label: "Тест", icon: "quiz", tab: true },
  { k: "interview", href: "#/interview", label: "Собеседование", icon: "mic", tab: true, short: "Собес" },
  { group: "Инструменты" },
  { k: "cheat", href: "#/cheat", label: "Шпаргалка", icon: "cheat" },
  { k: "console", href: "#/console", label: "Консоль", icon: "terminal" },
  { k: "schema", href: "#/schema", label: "Схема", icon: "database" },
];

function renderNav() {
  if (!USER || !DATA) return;
  const due = dueItems().length;
  const badge = (k, cls = "") => (k === "review" && due ? `<span class="badge ${cls}">${due}</span>` : "");
  $("nav").innerHTML = NAV.map((n) => n.group
    ? `<div class="group">${n.group}</div>`
    : `<a href="${n.href}" data-nav="${n.k}" class="${n.k === currentTab ? "on" : ""}">${icon(n.icon)}<span>${n.label}</span>${badge(n.k, "warm")}</a>`).join("");
  $("tabbar").innerHTML = NAV.filter((n) => n.tab).map((n) =>
    `<a href="${n.href}" data-nav="${n.k}" class="${n.k === currentTab ? "on" : ""}">${icon(n.icon)}<span>${n.short || n.label}</span>${badge(n.k, "warm")}</a>`).join("");
}

function setTab(name) {
  currentTab = name;
  document.body.classList.toggle("guest", !USER);
  renderNav();
  closeDrawer();
}

function renderMe() {
  const me = $("me");
  if (!USER) { me.innerHTML = ""; return; }
  const title = { saved: "Прогресс сохранён", saving: "Сохраняю…", offline: "Нет связи — сохранено на устройстве" }[saveState];
  me.innerHTML = `
    <span class="avatar" title="${title}">${esc(USER.username[0] || "?")}<span class="dot ${saveState}"></span></span>
    <span class="who">${esc(USER.username)}<small>${title}</small></span>
    <button type="button" class="icon-btn" id="logout" title="Выйти">${icon("logout", "sm")}</button>`;
  $("logout").onclick = async () => {
    try { await api("POST", "/api/logout"); } catch (e) { /* всё равно выходим */ }
    USER = null;
    progress = {};
    try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
    viewAuth();
  };
}

function getTheme() { try { return localStorage.getItem(THEME_KEY) || "system"; } catch (e) { return "system"; } }
function setTheme(t) {
  try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  renderThemeSwitch();
}
function renderThemeSwitch() {
  const cur = getTheme();
  const opts = [["system", "monitor", "Как в системе"], ["dark", "moon", "Тёмная"], ["light", "sun", "Светлая"]];
  $("theme-switch").innerHTML = opts.map(([k, ic, t]) =>
    `<button type="button" data-theme-set="${k}" class="${cur === k ? "on" : ""}" title="${t}" aria-label="${t}">${icon(ic, "sm")}</button>`).join("");
  $("theme-switch").querySelectorAll("[data-theme-set]").forEach((b) => (b.onclick = () => setTheme(b.dataset.themeSet)));
}

function openDrawer() { $("sidebar").classList.add("open"); $("scrim").classList.add("on"); }
function closeDrawer() { $("sidebar").classList.remove("open"); $("scrim").classList.remove("on"); }

function initShell() {
  document.querySelectorAll("[data-search]").forEach((b) => {
    b.innerHTML = b.classList.contains("search-btn")
      ? `${icon("search", "sm")}<span>Поиск</span><kbd>${MOD} K</kbd>`
      : icon("search");
    b.onclick = () => openPalette();
  });
  $("menu-btn").innerHTML = icon("menu");
  $("menu-btn").onclick = openDrawer;
  $("scrim").onclick = closeDrawer;
  renderThemeSwitch();
  // клик по пункту меню, на котором уже стоим, — перерисовать экран (выйти из теста и т. п.)
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-nav]");
    if (a && a.getAttribute("href") === (location.hash || "#/")) { e.preventDefault(); route(); }
  });
  // «прожектор» на карточках
  document.addEventListener("pointermove", (e) => {
    const el = e.target.closest && e.target.closest(".glow");
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  }, { passive: true });
  document.addEventListener("keydown", onGlobalKey);
}

function onGlobalKey(e) {
  if ((e.metaKey || e.ctrlKey) && e.code === "KeyK") {
    e.preventDefault();
    if (!USER) return;
    return $("palette").hidden ? openPalette() : closePalette();
  }
  if (!$("palette").hidden) return; // палитра обрабатывает клавиши сама
  const typing = e.target.closest && e.target.closest("input, textarea, select, .CodeMirror, [contenteditable]");
  if (typing) return;
  if (e.key === "/" && USER) { e.preventDefault(); return openPalette(); }
  if (RUN && RUN.active) runKey(e);
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
    <div class="auth-wrap">
      <div class="card auth glow">
        <div class="brand"><span class="brand-mark">SQL</span><span class="brand-text">PL/SQL Prep<small>к собеседованию</small></span></div>
        <h1>${reg ? "Регистрация" : "С возвращением"}</h1>
        <p class="lede" style="margin:0">${reg ? "По коду-приглашению из настроек Railway." : "Прогресс один и тот же на телефоне и ноутбуке."}</p>
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
      </div>
    </div>`;

  $("auth-switch").onclick = () => viewAuth(null, reg ? "login" : "register");
  const form = $("auth-form");
  const errBox = $("auth-error");
  const submit = $("auth-submit");
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
  $("username").focus();
}

/* ================= экран: главная (дашборд) ================= */

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Доброй ночи" : h < 12 ? "Доброе утро" : h < 18 ? "Добрый день" : "Добрый вечер";
}

function heatmapHtml(weeks = 20) {
  const act = progress.act || {};
  const t = today();
  const dow = (parseDay(t).getDay() + 6) % 7;           // 0 = понедельник
  const start = addDays(t, -(weeks - 1) * 7 - dow);     // понедельник первой недели
  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i);
    const n = act[d] || 0;
    const lvl = n === 0 ? 0 : n < 5 ? 1 : n < 15 ? 2 : n < 30 ? 3 : 4;
    const fut = d > t;
    cells.push(`<i class="l${lvl}${d === t ? " today" : ""}${fut ? " future" : ""}" title="${fmtDay(d)}: ${n} ${plural(n, "действие", "действия", "действий")}"></i>`);
  }
  const total = Object.values(act).reduce((a, b) => a + b, 0);
  const days = Object.values(act).filter((n) => n > 0).length;
  return `
    <div class="heat" style="--weeks:${weeks}">${cells.join("")}</div>
    <div class="heat-legend"><span>${days ? `${dWord(days)} с занятиями · ${total} ${plural(total, "ответ", "ответа", "ответов")} и решений` : "Ответ на вопрос или решённая задача закрашивает день"}</span><span class="sp"></span>
      меньше <i style="background:var(--heat-0)"></i><i style="background:var(--heat-1)"></i><i style="background:var(--heat-2)"></i><i style="background:var(--heat-3)"></i><i style="background:var(--heat-4)"></i> больше</div>`;
}

function weakTopicsHtml(limit = 7) {
  const stats = topicStats().filter((t) => t.seen > 0).sort((a, b) => a.ok / a.seen - b.ok / b.seen || b.seen - a.seen);
  if (!stats.length) return `<div class="empty-state" style="padding:20px 0">${icon("chart")}<p>Пройди пару вопросов в тесте — здесь появятся сильные и слабые темы.</p></div>`;
  return `<div class="topics">${stats.slice(0, limit).map((t) => {
    const p = pct(t.ok, t.seen);
    return `<button class="topic-row" type="button" data-topic="${esc(t.topic)}" title="Потренировать тему">
      <span class="name">${esc(t.topic)}</span>
      <span class="meter ${p < 50 ? "bad" : p < 80 ? "warm" : "ok"}"><i style="width:${Math.max(p, 4)}%"></i></span>
      <span class="pct ${p < 50 ? "lo" : p >= 80 ? "hi" : ""}">${p}%</span>
    </button>`;
  }).join("")}</div>`;
}

function bindTopicButtons(root = app) {
  root.querySelectorAll("[data-topic]").forEach((b) => (b.onclick = () => {
    const ids = QUESTIONS.filter((q) => q.topic === b.dataset.topic).map((q) => q.id);
    startRun(shuffle(ids), { mode: "practice", back: location.hash || "#/", title: b.dataset.topic });
  }));
}

function viewHome() {
  setTab("home");
  const steps = allSteps();
  const done = steps.filter(isDone).length;
  const next = nextUp();
  const st = streakInfo();
  const g = goal();
  const answered = QUESTIONS.filter((q) => progress["q:" + q.id]).length;
  const ok = QUESTIONS.filter((q) => progress["q:" + q.id] === "ok").length;
  const due = dueItems().length;
  const ready = readiness();
  const nextIdx = next ? next.lesson.steps.findIndex((s) => s.id === next.id) + 1 : 0;

  app.innerHTML = `
    <div class="page stagger">
      <section class="card hero glow">
        <div>
          <span class="tag">${icon("sparkles", "sm")} ${greeting()}, ${esc(USER.username)}</span>
          <h1>${next ? `Продолжим: <span class="grad-text">${esc(next.title)}</span>` : "Все уроки пройдены"}</h1>
          <p class="lede">${next ? `Урок ${esc(next.lesson.num)} · ${esc(next.lesson.title)} · шаг ${nextIdx} из ${next.lesson.steps.length}` : "Самое время прогнать собеседование и повторение."}</p>
          <div class="actions">
            ${next ? `<a class="btn primary lg" href="#/step/${next.id}">Продолжить ${icon("arrow")}</a>` : ""}
            ${due ? `<a class="btn lg" href="#/review">${icon("repeat")} Повторить · ${due}</a>` : `<a class="btn lg" href="#/interview">${icon("mic")} Собеседование</a>`}
          </div>
        </div>
        ${ring(ready.ok, ready.total, { size: 148, stroke: 11, label: "готовность<br>к собесу" })}
      </section>

      <section class="tiles">
        <div class="card tile flame ${st.cur ? "lit" : ""}">
          <div class="t-head">${icon("flame")} Серия</div>
          <div class="t-val">${st.cur}<small>${plural(st.cur, "день", "дня", "дней")}</small></div>
          <div class="t-sub">${st.todayCount ? "Сегодня уже засчитано" : st.cur ? "Ответь сегодня, чтобы не прервать" : "Начни сегодня"} · рекорд ${st.best}</div>
        </div>
        <div class="card tile">
          <div class="t-head">${icon("target")} Цель на сегодня</div>
          <div class="t-row">
            ${ring(st.todayCount, g, { size: 56, stroke: 6, cls: "sm", text: `${Math.min(st.todayCount, 999)}`, barCls: st.todayCount >= g ? "ok" : "" })}
            <div class="t-val" style="font-size:20px">${st.todayCount >= g ? "Готово" : `ещё ${g - st.todayCount}`}</div>
          </div>
          <div class="t-sub">цель: <select id="goal" aria-label="Цель на день">${[5, 10, 15, 20, 30, 50].map((n) => `<option value="${n}" ${n === g ? "selected" : ""}>${n} в день</option>`).join("")}</select></div>
        </div>
        <div class="card tile">
          <div class="t-head">${icon("chart")} Точность</div>
          <div class="t-val">${answered ? pct(ok, answered) + "%" : "—"}</div>
          <div class="t-sub">${answered}/${QUESTIONS.length} вопросов · ${done}/${steps.length} шагов</div>
        </div>
        <a class="card tile" href="#/review">
          <div class="t-head">${icon("repeat")} Повторение</div>
          <div class="t-val" style="${due ? "color:var(--warm)" : ""}">${due}</div>
          <div class="t-sub">${due ? "вопросов ждут сегодня →" : `в ротации: ${reviewItems().length}`}</div>
        </a>
      </section>

      <section class="dash-grid">
        <div class="card panel-card">
          <h2>${icon("zap", "sm")} Активность <span class="muted">20 недель</span></h2>
          ${heatmapHtml()}
        </div>
        <div class="card panel-card">
          <h2>${icon("alert", "sm")} Слабые темы <span class="muted">нажми, чтобы потренировать</span></h2>
          ${weakTopicsHtml()}
        </div>
      </section>

      <div class="section-head"><h2>Инструменты</h2></div>
      <section class="quick">
        <a class="card glow" href="#/interview"><span class="q-ic">${icon("mic")}</span><h3>Собеседование</h3><p>15 вопросов на время, разбор в конце</p></a>
        <a class="card glow" href="#/review"><span class="q-ic warm">${icon("repeat")}</span><h3>Повторение</h3><p>Ошибки возвращаются через 1, 3, 7 дней</p></a>
        <a class="card glow" href="#/cheat"><span class="q-ic ok">${icon("cheat")}</span><h3>Шпаргалка</h3><p>${CHEAT.length} функций и конструкций Oracle</p></a>
        <a class="card glow" href="#/console"><span class="q-ic">${icon("terminal")}</span><h3>Консоль</h3><p>Свободные запросы к своей схеме</p></a>
      </section>

      <div class="section-head"><h2>Уроки</h2><a href="#/lessons">Вся программа →</a></div>
      ${lessonCards()}
    </div>`;

  $("goal").onchange = (e) => { mark("goal", +e.target.value); viewHome(); };
  bindTopicButtons();
}

function lessonCards() {
  return `<div class="lessons">${DATA.lessons.map((l) => {
    const d = l.steps.filter(isDone).length;
    const full = d === l.steps.length;
    return `
      <a class="card glow lesson-card" href="#/lesson/${l.id}">
        <span class="num">УРОК ${esc(l.num)}</span>
        <h3>${esc(l.title)}</h3>
        <p>${esc(l.subtitle)}</p>
        <div class="foot">
          <div class="meter ${full ? "ok" : ""}"><i style="width:${(d / l.steps.length) * 100}%"></i></div>
          <div class="meta"><span>${d} из ${l.steps.length} шагов</span>${full ? `<span class="done">готово ✓</span>` : ""}</div>
        </div>
      </a>`;
  }).join("")}</div>`;
}

/* ================= экран: все уроки ================= */

function viewLessons() {
  setTab("lessons");
  const maxNum = Math.max(...DATA.lessons.map((l) => +l.num));
  const ahead = ROADMAP.filter(([n]) => +n > maxNum);
  const steps = allSteps();
  app.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div class="grow">
          <span class="eyebrow">Программа</span>
          <h1>Уроки</h1>
          <p class="lede">Один шаг — одна тема: теория, пример, задача и автопроверка прямо в Oracle. Пройдено ${steps.filter(isDone).length} из ${steps.length} шагов.</p>
        </div>
      </div>
      ${lessonCards()}
      ${ahead.length ? `
        <div class="section-head"><h2>Дальше по программе</h2></div>
        <div class="roadmap">${ahead.map(([n, t]) => `<div class="road-item ${+n >= 13 ? "pl" : ""}">${icon("lock", "sm")}<span class="n">${n}</span><span>${esc(t)}</span></div>`).join("")}</div>` : ""}
    </div>`;
}

/* ================= экран: обзор урока ================= */

function viewLesson(id) {
  setTab("lessons");
  const l = DATA.lessons.find((x) => x.id === id);
  if (!l) return viewLessons();
  const d = l.steps.filter(isDone).length;
  app.innerHTML = `
    <div class="page narrow">
      <a class="back" href="#/lessons">${icon("back", "sm")} все уроки</a>
      <span class="eyebrow" style="display:block">Урок ${esc(l.num)}</span>
      <h1>${esc(l.title)}</h1>
      <p class="lede">${esc(l.subtitle)}</p>
      <div class="meter ${d === l.steps.length ? "ok" : ""}" style="margin:-10px 0 22px"><i style="width:${(d / l.steps.length) * 100}%"></i></div>
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
  setTab("lessons");
  const found = findStep(id);
  if (!found) return viewLessons();
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
    <div class="row"><div class="sql hl">${hl(e.sql)}</div><div class="out">${esc(e.out)}</div></div>`).join("");

  const mistakes = (s.mistakes || []).length
    ? `<div class="mistakes"><span class="eyebrow">${icon("alert", "sm")} мои ошибки на этом шаге</span><ul>${s.mistakes.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></div>`
    : "";

  const right = SQL_ENABLED
    ? `
      <div class="ed-head">
        <span class="lang">Oracle · схема PLSQL</span>
        <span class="keys"><kbd>${MOD} ↵</kbd> выполнить${s.check ? ` · <kbd>${MOD} ⇧ ↵</kbd> проверить` : ""}</span>
      </div>
      <div class="ed" id="ed"></div>
      <div class="ed-actions">
        <button class="btn" id="run" type="button">${icon("play", "sm")} Выполнить</button>
        ${s.check ? `<button class="btn primary" id="check" type="button">${icon("check", "sm")} Проверить решение</button>` : ""}
        <span class="spacer"></span>
        <span class="status" id="status"></span>
      </div>
      <div class="results" id="res"><div class="empty">Напиши запрос и нажми «Выполнить». ${s.check ? "Когда результат устроит — «Проверить решение»." : ""}</div></div>`
    : `<div class="results"><div class="msg">Выполнение запросов на сайте не подключено — решай в DataGrip.</div></div>`;

  app.innerHTML = `
    <div class="stepbar">
      <a class="crumb" href="#/lesson/${lesson.id}">${icon("back", "sm")} Урок ${esc(lesson.num)} · ${esc(lesson.title)}</a>
      <nav class="pills">${pills}</nav>
      <div class="stepnav">
        <a class="btn ghost" ${prev ? `href="#/step/${prev.id}"` : 'aria-disabled="true"'} title="Предыдущий шаг">←</a>
        <a class="btn ghost" ${nextInLesson ? `href="#/step/${nextInLesson.id}"` : nextGlobal ? `href="#/step/${nextGlobal.id}"` : 'aria-disabled="true"'} title="Следующий шаг">→</a>
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
          <div class="task"><span class="eyebrow">${icon("target", "sm")} задание</span>${esc(s.task)}</div>
          ${mistakes}
          <details class="sol"><summary>Показать решение</summary>${codeBlock(s.solution)}</details>
          ${!s.check && s.status !== "done"
            ? `<button class="btn mark-done" id="mark" type="button">${progress["s:" + s.id] === "done" ? "✓ Отмечено пройденным" : "Отметить пройденным"}</button>`
            : ""}
        </div>
      </section>
      <section class="pane right">${right}</section>
    </div>`;

  const markBtn = $("mark");
  if (markBtn) markBtn.onclick = () => {
    const k = "s:" + s.id;
    if (progress[k] !== "done") bump();
    mark(k, progress[k] === "done" ? undefined : "done");
    viewStep(id);
  };

  if (!SQL_ENABLED) return;

  const res = $("res");
  const status = $("status");
  const runBtn = $("run");
  const checkBtn = $("check");
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
          bump();
          mark("s:" + s.id, "done");
          const chip = $("step-chip");
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

  const ed = createEditor($("ed"), {
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
          <span class="lang">Консоль · схема PLSQL</span>
          <span class="keys"><kbd>${MOD} ↵</kbd> выполнить</span>
        </div>
        <div class="ed tall" id="ed"></div>
        <div class="ed-actions">
          <button class="btn primary" id="run" type="button">${icon("play", "sm")} Выполнить</button>
          <button class="btn ghost" id="clear" type="button">Очистить</button>
          <span class="spacer"></span>
          <span class="status" id="status"></span>
        </div>
        <div class="results" id="res"><div class="empty">Любые запросы к своей схеме: SELECT, DML, PL/SQL-блоки. Каждая команда сразу коммитится. Готовые примеры — в «Шпаргалке».</div></div>
      </section>
    </div>`;

  const res = $("res");
  const status = $("status");
  const runBtn = $("run");
  const side = $("side");
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

  const ed = createEditor($("ed"), {
    value: progress["console:draft"] || "SELECT *\n  FROM employees\n FETCH FIRST 10 ROWS ONLY;",
    placeholder: "-- любой запрос к своей схеме",
    onChange: (v) => rememberText("console:draft", v),
    onRun: go,
  });
  runBtn.onclick = go;
  $("clear").onclick = () => { ed.set(""); res.innerHTML = ""; };

  async function renderSide() {
    if (sideMode === "history") {
      const h = history();
      side.innerHTML = h.length
        ? h.map((q, i) => `<button class="hist-item hl" type="button" data-h="${i}">${hl(q)}</button>`).join("")
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
        $("tlist").innerHTML = list.length
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
      $("tfilter").oninput = (e) => draw(e.target.value);
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

  // запрос из «Схемы» или «Шпаргалки»
  let preset = null;
  try { preset = sessionStorage.getItem("console:preset"); sessionStorage.removeItem("console:preset"); } catch (e) {}
  if (preset) { ed.set(preset); go(); }
}

function openInConsole(sql) {
  try { sessionStorage.setItem("console:preset", sql); } catch (e) {}
  navigate("#/console");
}

function navigate(href) {
  if ((location.hash || "#/") === href) route();
  else location.hash = href;
}

/* ================= прогон вопросов: тест, повторение, собеседование ================= */

let RUN = null;
let timerId = null;
function stopTimer() { clearInterval(timerId); timerId = null; }
const runLeft = () => Math.max(0, RUN.limitSec - Math.floor((Date.now() - RUN.started) / 1000));

function startRun(ids, { mode = "practice", back = "#/quiz", title = "Тест", limitSec = 0, meta = {} } = {}) {
  ids = ids.filter(qById);
  if (!ids.length) return;
  stopTimer();
  RUN = { ids, pos: 0, mode, back, title, limitSec, meta, results: {}, started: Date.now(), active: true, state: "q" };
  if (limitSec) timerId = setInterval(tickTimer, 1000);
  renderRunQ();
}

function tickTimer() {
  if (!RUN || !RUN.active) return stopTimer();
  const left = runLeft();
  const el = $("timer");
  if (el) {
    el.querySelector("span").textContent = fmtTime(left);
    el.classList.toggle("low", left <= 60);
  }
  if (left <= 0) finishRun(true);
}

function renderRunQ() {
  if (RUN.pos >= RUN.ids.length) return finishRun();
  const q = qById(RUN.ids[RUN.pos]);
  RUN.q = q;
  RUN.state = "q";
  const iv = RUN.mode === "interview";
  window.scrollTo(0, 0);
  app.innerHTML = `
    <div class="page run">
      <div class="run-top">
        ${iv
          ? `<button class="btn ghost sm" id="run-end" type="button">${icon("x", "sm")} Завершить</button>`
          : `<a class="back" href="${RUN.back}" data-nav="exit">${icon("x", "sm")} ${esc(RUN.title)}</a>`}
        <div class="run-progress"><i style="width:${pct(RUN.pos, RUN.ids.length)}%"></i></div>
        <span class="run-count">${RUN.pos + 1} / ${RUN.ids.length}</span>
        ${RUN.limitSec ? `<span class="timer ${runLeft() <= 60 ? "low" : ""}" id="timer">${icon("clock", "sm")}<span>${fmtTime(runLeft())}</span></span>` : ""}
      </div>
      <div class="card qcard">
        <div class="qmeta">
          <span class="tag">${esc(q.topic)}</span>
          ${sectionOf(q) !== "lessons" ? `<span class="tag ghost">${SECTION_NAME[sectionOf(q)]}</span>` : ""}
          ${isCard(q) ? `<span class="tag warm">${icon("mic", "sm")} устно</span>` : ""}
        </div>
        <h2 class="qtext">${esc(q.q)}</h2>
        ${q.code ? codeBlock(q.code) : ""}
        <div id="qbody"></div>
      </div>
      <div id="after"></div>
    </div>`;
  const end = $("run-end");
  if (end) end.onclick = () => finishRun(false, true);

  const body = $("qbody");
  if (isCard(q)) {
    body.innerHTML = `
      <p class="hint">${icon("mic", "sm")} Ответь вслух, как на собеседовании: 30–60 секунд своими словами. Потом сверься.</p>
      <div class="quiz-actions" id="reveal-row"><button class="btn primary" id="reveal" type="button">Показать ответ</button><span class="kh"><kbd>Space</kbd></span></div>`;
    $("reveal").onclick = revealCard;
    return;
  }
  RUN.order = shuffle(q.opts.map((text, i) => ({ text, i })));
  body.innerHTML = `
    <div class="opts">${RUN.order.map((o, n) => `<button class="opt" type="button" data-n="${n}"><span class="key">${KEYS[n]}</span><span>${esc(o.text)}</span></button>`).join("")}</div>
    <div class="kh" style="margin-top:12px">клавиши <kbd>1</kbd>–<kbd>4</kbd> или <kbd>A</kbd>–<kbd>D</kbd></div>`;
  body.querySelectorAll(".opt").forEach((b) => (b.onclick = () => chooseOpt(+b.dataset.n)));
}

function chooseOpt(n) {
  if (!RUN || RUN.state !== "q") return;
  const run = RUN;
  const q = run.q;
  const right = run.order[n].i === q.a;
  run.results[q.id] = { right, chosen: run.order[n].i };
  run.state = "answered";
  recordAnswer(q.id, right);
  const btns = [...document.querySelectorAll(".opt")];
  if (run.mode === "interview") {
    btns.forEach((b, k) => { b.disabled = true; b.classList.add(k === n ? "is-pick" : "is-dim"); });
    setTimeout(() => { if (RUN === run && run.state === "answered") nextQ(); }, 260);
    return;
  }
  btns.forEach((b, k) => {
    b.disabled = true;
    if (run.order[k].i === q.a) b.classList.add("is-ok");
    else if (k === n) b.classList.add("is-bad");
    else b.classList.add("is-dim");
  });
  $("after").innerHTML = `
    <div class="why">
      <span class="eyebrow ${right ? "ok" : "bad"}">${icon(right ? "check" : "x", "sm")} ${right ? "Верно" : "Мимо — вернётся завтра на повторении"}</span>
      <p>${q.why}</p>
    </div>
    <div class="quiz-actions">${nextButton()}<span class="kh"><kbd>Enter</kbd></span></div>`;
  bindNext();
}

function revealCard() {
  if (!RUN || RUN.state !== "q") return;
  RUN.state = "revealed";
  const q = RUN.q;
  $("reveal-row").remove();
  $("after").innerHTML = `
    <div class="why answer"><span class="eyebrow">${icon("sparkles", "sm")} Ответ</span><div>${q.answer}</div></div>
    <div class="quiz-actions">
      <button class="btn ok" id="knew" type="button">${icon("check", "sm")} Знал</button>
      <button class="btn bad" id="didnt" type="button">${icon("x", "sm")} Не знал</button>
      <span class="kh"><kbd>1</kbd> знал · <kbd>2</kbd> не знал</span>
    </div>`;
  $("knew").onclick = () => gradeCard(true);
  $("didnt").onclick = () => gradeCard(false);
}

function gradeCard(right) {
  if (!RUN || RUN.state !== "revealed") return;
  RUN.state = "answered";
  RUN.results[RUN.q.id] = { right };
  recordAnswer(RUN.q.id, right);
  nextQ();
}

const nextButton = () => `<button class="btn primary" id="next" type="button">${RUN.pos + 1 >= RUN.ids.length ? "Итоги" : "Дальше"} ${icon("arrow", "sm")}</button>`;
function bindNext() { const b = $("next"); b.onclick = nextQ; b.focus({ preventScroll: true }); }
function nextQ() { if (!RUN) return; RUN.pos++; renderRunQ(); }

function runKey(e) {
  const code = e.code;
  if (e.target.tagName === "BUTTON" && (code === "Enter" || code === "Space")) return; // кнопка в фокусе нажмётся сама
  const pick = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3, KeyA: 0, KeyB: 1, KeyC: 2, KeyD: 3 };
  if (RUN.state === "q") {
    if (isCard(RUN.q)) { if (code === "Space" || code === "Enter") { e.preventDefault(); revealCard(); } return; }
    if (code in pick && pick[code] < RUN.order.length) { e.preventDefault(); chooseOpt(pick[code]); }
  } else if (RUN.state === "revealed") {
    if (code === "Digit1" || code === "Numpad1") gradeCard(true);
    else if (code === "Digit2" || code === "Numpad2") gradeCard(false);
  } else if (RUN.state === "answered" && RUN.mode !== "interview") {
    if (code === "Enter" || code === "Space" || code === "ArrowRight") { e.preventDefault(); nextQ(); }
  }
}

function verdict(p) {
  if (p >= 85) return ["Уверенно", "На таком уровне собеседование по этим темам не страшно."];
  if (p >= 65) return ["Почти готов", "База есть — подтяни темы ниже, и будет уверенно."];
  if (p >= 40) return ["Есть пробелы", "Часть тем проседает: пройди повторение и шпаргалку по ним."];
  return ["Пока рано", "Начни с уроков и повторения — и через неделю попробуй снова."];
}

function missList(ids) {
  return ids.map((id) => {
    const q = qById(id);
    const right = (q.code ? codeBlock(q.code) : "") + (isCard(q) ? q.answer : `<div class="right">✓ ${esc(q.opts[q.a])}</div>${q.why}`);
    return `<details class="card miss">
      <summary>${icon("x")}<div><span class="eyebrow">${esc(q.topic)}${isCard(q) ? " · устно" : ""}</span><p>${esc(q.q)}</p></div><span class="more">ответ ▾</span></summary>
      <div class="body">${right}</div>
    </details>`;
  }).join("");
}

function finishRun(timeout = false, early = false) {
  stopTimer();
  const run = RUN;
  if (!run) return;
  run.active = false;
  run.state = "end";
  const sec = Math.round((Date.now() - run.started) / 1000);
  const total = run.ids.length;
  const ok = run.ids.filter((id) => run.results[id]?.right).length;
  const missed = run.ids.filter((id) => run.results[id] && !run.results[id].right);
  const skipped = run.ids.filter((id) => !run.results[id]);
  const p = pct(ok, total);
  window.scrollTo(0, 0);

  if (run.mode === "interview") {
    const hist = Array.isArray(progress["iv:hist"]) ? progress["iv:hist"] : [];
    mark("iv:hist", [{ t: Date.now(), n: total, ok, sec, mix: run.meta.mix || "all" }, ...hist].slice(0, 30));
    const [title, text] = verdict(p);
    const byTopic = new Map();
    for (const id of run.ids) {
      const q = qById(id);
      const t = byTopic.get(q.topic) || { ok: 0, n: 0 };
      t.n++;
      if (run.results[id]?.right) t.ok++;
      byTopic.set(q.topic, t);
    }
    const topics = [...byTopic.entries()].sort((a, b) => a[1].ok / a[1].n - b[1].ok / b[1].n);
    app.innerHTML = `
      <div class="page run stagger">
        <section class="card result-hero glow">
          ${ring(ok, total, { size: 150, stroke: 12, label: `${ok} из ${total}` })}
          <div>
            <span class="eyebrow">Собеседование · ${{ all: "SQL + PL/SQL", sql: "SQL", plsql: "PL/SQL" }[run.meta.mix || "all"]}</span>
            <h1>${title}</h1>
            <p class="lede">${text}</p>
            <div class="result-meta">
              <span>${icon("clock", "sm")} ${fmtTime(sec)}${timeout ? " — время вышло" : ""}</span>
              ${skipped.length ? `<span>${icon("alert", "sm")} без ответа: ${skipped.length}</span>` : ""}
              <span>${icon("x", "sm")} ошибок: ${missed.length}</span>
            </div>
          </div>
        </section>
        <section class="card panel-card">
          <h2>${icon("chart", "sm")} По темам</h2>
          <div class="breakdown">${topics.map(([t, s]) => {
            const tp = pct(s.ok, s.n);
            return `<div class="row"><span>${esc(t)}</span><span class="meter ${tp < 50 ? "bad" : tp < 100 ? "warm" : "ok"}"><i style="width:${Math.max(tp, 4)}%"></i></span><span class="n">${s.ok}/${s.n}</span></div>`;
          }).join("")}</div>
        </section>
        ${missed.length || skipped.length ? `<div class="section-head"><h2>Разбор ошибок</h2></div>${missList([...missed, ...skipped])}` : ""}
        <div class="quiz-actions">
          ${missed.length ? `<button class="btn primary" id="again" type="button">${icon("repeat", "sm")} Прорешать ошибки</button>` : ""}
          <a class="btn ${missed.length ? "" : "primary"}" href="#/interview" data-nav="exit">Новое собеседование</a>
          <a class="btn ghost" href="#/" data-nav="exit">На главную</a>
        </div>
      </div>`;
    const again = $("again");
    if (again) again.onclick = () => startRun(shuffle(missed), { mode: "practice", back: "#/interview", title: "Ошибки собеседования" });
    return;
  }

  app.innerHTML = `
    <div class="page run stagger">
      <section class="card result-hero glow">
        ${ring(ok, total, { size: 130, stroke: 11, label: `${ok} из ${total}`, barCls: p === 100 ? "ok" : "" })}
        <div>
          <span class="eyebrow">${esc(run.title)}${early ? " · завершено досрочно" : ""}</span>
          <h1>${p === 100 ? "Чисто!" : p >= 70 ? "Хорошо" : "Есть над чем поработать"}</h1>
          <p class="lede">${missed.length ? `Ошибки уже в повторении — вернутся завтра.` : "Ни одной ошибки. Так держать."}</p>
        </div>
      </section>
      ${missed.length ? `<div class="section-head"><h2>Разбор</h2></div>${missList(missed)}` : ""}
      <div class="quiz-actions">
        ${missed.length ? `<button class="btn primary" id="again" type="button">Пройти ошибки ещё раз</button>` : ""}
        <a class="btn ${missed.length ? "" : "primary"}" href="${run.back}" data-nav="exit">Готово</a>
      </div>
    </div>`;
  const again = $("again");
  if (again) again.onclick = () => startRun(shuffle(missed), { mode: "practice", back: run.back, title: run.title });
}

/* ================= экран: тест ================= */

const SECTIONS = [
  { k: "lessons", name: "По урокам", lede: "Вопросы по пройденным урокам: ловушки с NULL, функциями, датами." },
  { k: "sql", name: "Собес · SQL", lede: "То, что спрашивают на собеседовании по SQL: соединения, группировка, аналитика, подзапросы, NULL." },
  { k: "plsql", name: "Собес · PL/SQL", lede: "Блоки, курсоры, исключения, пакеты, триггеры, коллекции, BULK, динамический SQL." },
  { k: "all", name: "Всё", lede: "Все вопросы вперемешку." },
];
const curSection = () => (SECTIONS.some((s) => s.k === progress["quiz:section"]) ? progress["quiz:section"] : "lessons");
const inSection = (sec) => QUESTIONS.filter((q) => sec === "all" || sectionOf(q) === sec);

function viewQuiz() {
  setTab("quiz");
  const sec = curSection();
  const meta = SECTIONS.find((s) => s.k === sec);
  const list = inSection(sec);
  const ids = (arr) => arr.map((q) => q.id);
  const done = list.filter((q) => progress["q:" + q.id]).length;
  const ok = list.filter((q) => progress["q:" + q.id] === "ok").length;
  const wrong = list.filter((q) => progress["q:" + q.id] === "bad");
  const cards = list.filter(isCard);
  const mc = list.filter((q) => !isCard(q));
  const title = SECTIONS.find((s) => s.k === sec).name;

  app.innerHTML = `
    <div class="page">
      <span class="eyebrow">Тест</span>
      <h1>Вопросы и ловушки</h1>
      <p class="lede">${meta.lede}${cards.length ? ` ${mc.length} вопросов с вариантами и ${cards.length} устных: сначала ответь вслух, потом открой ответ.` : ""}</p>
      <div class="secs" role="tablist">
        ${SECTIONS.map((s) => {
          const l = inSection(s.k);
          const d = l.filter((q) => progress["q:" + q.id]).length;
          return `<button class="sec ${s.k === sec ? "on" : ""}" data-sec="${s.k}" type="button" role="tab" aria-selected="${s.k === sec}">${s.name}<span>${d}/${l.length}</span></button>`;
        }).join("")}
      </div>
      <div class="stats">
        <div class="card stat"><b>${done}/${list.length}</b><span>пройдено</span></div>
        <div class="card stat"><b>${done ? pct(ok, done) + "%" : "—"}</b><span>верных</span></div>
        <div class="card stat"><b style="${wrong.length ? "color:var(--bad)" : ""}">${wrong.length}</b><span>с ошибкой</span></div>
      </div>
      <div class="meter" style="margin-bottom:6px"><i style="width:${pct(done, list.length)}%"></i></div>
      <div class="quiz-actions">
        <button class="btn primary lg" id="go" type="button">${icon("play", "sm")} ${done < list.length ? (done ? "Продолжить" : "Начать") : "Пройти все заново"}</button>
        ${wrong.length ? `<button class="btn lg" id="err" type="button">Только ошибки · ${wrong.length}</button>` : ""}
        ${cards.length && mc.length ? `<button class="btn lg" id="oral" type="button">${icon("mic", "sm")} Только устные · ${cards.length}</button>` : ""}
        ${done && done < list.length ? `<button class="btn ghost" id="all" type="button">Все заново</button>` : ""}
        ${done ? `<button class="btn ghost" id="reset" type="button">Сбросить раздел</button>` : ""}
      </div>
      <div class="section-head"><h2>По темам</h2></div>
      <div class="topic-grid">${topicStats(list).sort((a, b) => a.topic.localeCompare(b.topic, "ru")).map((t) => {
        const tp = t.seen ? pct(t.ok, t.seen) : 0;
        return `<button class="topic-btn" type="button" data-topic-in="${esc(t.topic)}">
          <span class="top">${esc(t.topic)}<span>${t.seen}/${t.total}</span></span>
          <span class="meter ${!t.seen ? "" : tp < 50 ? "bad" : tp < 80 ? "warm" : "ok"}"><i style="width:${t.seen ? Math.max(tp, 4) : 0}%"></i></span>
        </button>`;
      }).join("")}</div>
    </div>`;

  app.querySelectorAll(".sec").forEach((b) => (b.onclick = () => { mark("quiz:section", b.dataset.sec); viewQuiz(); }));
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  const opts = { mode: "practice", back: "#/quiz", title };
  on("go", () => {
    const unseen = list.filter((q) => !progress["q:" + q.id]);
    startRun(unseen.length ? (sec === "lessons" ? ids(unseen) : shuffle(ids(unseen))) : shuffle(ids(list)), opts);
  });
  on("err", () => startRun(shuffle(ids(wrong)), opts));
  on("oral", () => startRun(shuffle(ids(cards)), opts));
  on("all", () => startRun(shuffle(ids(list)), opts));
  on("reset", () => {
    list.forEach((q) => delete progress["q:" + q.id]);
    save();
    viewQuiz();
  });
  app.querySelectorAll("[data-topic-in]").forEach((b) => (b.onclick = () => {
    const t = b.dataset.topicIn;
    startRun(shuffle(ids(list.filter((q) => q.topic === t))), { ...opts, title: t });
  }));
}

/* ================= экран: повторение ================= */

function viewReview() {
  setTab("review");
  const items = reviewItems();
  const due = dueItems();
  const t = today();
  const days = Array.from({ length: 7 }, (_, i) => addDays(t, i));
  const counts = days.map((d, i) => items.filter((q) => { const r = progress["r:" + q.id].d; return i === 0 ? r <= d : r === d; }).length);
  const max = Math.max(1, ...counts);
  const nextDay = items.map((q) => progress["r:" + q.id].d).filter((d) => d > t).sort()[0];
  const boxes = SR_DAYS.map((_, b) => items.filter((q) => progress["r:" + q.id].b === b).length);
  const label = (d, i) => (i === 0 ? "сег" : i === 1 ? "завт" : WEEKDAYS[parseDay(d).getDay()]);

  app.innerHTML = `
    <div class="page">
      <span class="eyebrow">Интервальное повторение</span>
      <h1>Повторение</h1>
      <p class="lede">Вопрос, на котором ошибся, возвращается завтра. Ответил верно — следующий раз через 3 дня, потом через 7, 14 и 30. После этого он считается выученным.</p>
      <div class="two-col stagger">
        <section class="card panel-card glow">
          ${due.length ? `
            <span class="eyebrow">на сегодня</span>
            <div style="display:flex;align-items:center;gap:22px;margin:16px 0 22px">
              ${ring(1, 1, { size: 110, stroke: 10, text: String(due.length), label: plural(due.length, "вопрос", "вопроса", "вопросов"), barCls: "warm" })}
              <p style="margin:0;color:var(--muted)">Займёт минут ${Math.max(1, Math.round(due.length * 0.6))}. Каждый верный ответ отодвигает вопрос дальше.</p>
            </div>
            <button class="btn primary lg" id="start" type="button">${icon("play", "sm")} Начать · ${due.length}</button>`
          : `<div class="empty-state">${icon("check")}<h3>На сегодня всё</h3>
              <p>${items.length ? `Следующее повторение — ${nextDay ? (nextDay === addDays(t, 1) ? "завтра" : fmtDay(nextDay)) : "скоро"}.` : "Ошибок пока нет. Пройди тест или собеседование — ошибки попадут сюда."}</p>
              ${items.length ? `<button class="btn" id="early" type="button">Повторить заранее · ${items.length}</button>` : `<a class="btn primary" href="#/quiz">К тесту</a>`}</div>`}
        </section>
        <section class="card panel-card">
          <h2>${icon("clock", "sm")} Ближайшие 7 дней <span class="muted">в ротации: ${items.length}</span></h2>
          <div class="sched">${days.map((d, i) => `<div class="col-b ${counts[i] ? "" : "zero"}"><b>${counts[i] || ""}</b><i style="height:${Math.max(4, (counts[i] / max) * 80)}px"></i><span>${label(d, i)}</span></div>`).join("")}</div>
          <h2 style="margin-top:22px">${icon("chart", "sm")} Ступени</h2>
          <div class="breakdown">${boxes.map((n, b) => `<div class="row"><span>через ${dWord(SR_DAYS[b])}</span><span class="meter"><i style="width:${items.length ? (n / items.length) * 100 : 0}%"></i></span><span class="n">${n}</span></div>`).join("")}</div>
        </section>
      </div>
    </div>`;
  const opts = { mode: "practice", back: "#/review", title: "Повторение" };
  const start = $("start");
  if (start) start.onclick = () => startRun(shuffle(due.map((q) => q.id)), opts);
  const early = $("early");
  if (early) early.onclick = () => startRun(shuffle(items.map((q) => q.id)), opts);
}

/* ================= экран: собеседование ================= */

function ivConfig() {
  const c = progress["iv:cfg"] || {};
  return { n: c.n || 15, mix: c.mix || "all", oral: c.oral !== false };
}

function ivPool(cfg) {
  const base = interviewQs().filter((q) => cfg.oral || !isCard(q));
  if (cfg.mix !== "all") return shuffle(base.filter((q) => q.section === cfg.mix)).slice(0, cfg.n);
  const half = Math.ceil(cfg.n / 2);
  return shuffle([
    ...shuffle(base.filter((q) => q.section === "sql")).slice(0, half),
    ...shuffle(base.filter((q) => q.section === "plsql")).slice(0, cfg.n - half),
  ]);
}

function viewInterview() {
  setTab("interview");
  const cfg = ivConfig();
  const hist = Array.isArray(progress["iv:hist"]) ? progress["iv:hist"] : [];
  const best = hist.reduce((m, h) => Math.max(m, pct(h.ok, h.n)), 0);
  const avail = interviewQs().filter((q) => (cfg.oral || !isCard(q)) && (cfg.mix === "all" || q.section === cfg.mix)).length;
  const n = Math.min(cfg.n, avail);
  const seg = (key, options) => `<div class="seg" data-key="${key}">${options.map(([v, t]) => `<button type="button" data-v="${v}" class="${String(cfg[key]) === String(v) ? "on" : ""}">${t}</button>`).join("")}</div>`;
  const mixName = { all: "SQL + PL/SQL", sql: "SQL", plsql: "PL/SQL" };

  app.innerHTML = `
    <div class="page">
      <span class="eyebrow">Режим собеседования</span>
      <h1>Пробное собеседование</h1>
      <p class="lede">Случайные вопросы из банка собеседований, таймер и никаких подсказок по ходу — как на настоящем интервью. Разбор и оценка по темам — в конце.</p>
      <div class="two-col stagger">
        <section class="card setup glow">
          <div class="field"><label>Сколько вопросов</label>${seg("n", [[10, "10"], [15, "15"], [20, "20"], [30, "30"]])}</div>
          <div class="field"><label>Темы</label>${seg("mix", [["all", "SQL + PL/SQL"], ["sql", "Только SQL"], ["plsql", "Только PL/SQL"]])}</div>
          <div class="field"><label class="toggle"><input type="checkbox" id="oral" ${cfg.oral ? "checked" : ""}> Устные вопросы (отвечаешь вслух, потом сверяешься)</label></div>
          <div class="result-meta" style="margin:0 0 20px">
            <span>${icon("quiz", "sm")} ${qWord(n)}</span>
            <span>${icon("clock", "sm")} ${Math.round((n * IV_SEC_PER_Q) / 60)} мин</span>
          </div>
          <button class="btn primary lg" id="start" type="button" ${n ? "" : "disabled"}>${icon("play", "sm")} Начать собеседование</button>
        </section>
        <section class="card panel-card">
          <h2>${icon("trophy", "sm")} Попытки <span class="muted">${hist.length ? `лучший результат ${best}%` : ""}</span></h2>
          ${hist.length ? `<div class="iv-hist">${hist.slice(0, 8).map((h) => {
            const p = pct(h.ok, h.n);
            return `<div class="row"><span>${fmtDay(dayKey(new Date(h.t)))}<span class="muted hide-m"> · ${mixName[h.mix] || ""}</span></span>
              <span class="muted">${h.ok}/${h.n}</span><span class="muted hide-m">${fmtTime(h.sec)}</span>
              <span class="score" style="color:${p >= 85 ? "var(--ok)" : p >= 65 ? "var(--warm)" : "var(--bad)"}">${p}%</span></div>`;
          }).join("")}</div>`
          : `<div class="empty-state" style="padding:20px 0">${icon("mic")}<p>Здесь будет история попыток. Цель — стабильно 85% и выше.</p></div>`}
        </section>
      </div>
    </div>`;

  app.querySelectorAll(".seg").forEach((s) => s.querySelectorAll("button").forEach((b) => (b.onclick = () => {
    const key = s.dataset.key;
    mark("iv:cfg", { ...cfg, [key]: key === "n" ? +b.dataset.v : b.dataset.v });
    viewInterview();
  })));
  $("oral").onchange = (e) => { mark("iv:cfg", { ...cfg, oral: e.target.checked }); viewInterview(); };
  $("start").onclick = () => {
    const ids = ivPool(cfg).map((q) => q.id);
    startRun(ids, { mode: "interview", back: "#/interview", title: "Собеседование", limitSec: ids.length * IV_SEC_PER_Q, meta: { mix: cfg.mix } });
  };
}

/* ================= экран: шпаргалка ================= */

let cheatQuery = "";
let cheatCat = "";
const stripTags = (s) => String(s || "").replace(/<[^>]+>/g, "");
const cheatText = (c) => `${c.name} ${c.sig || ""} ${stripTags(c.desc)} ${c.cat} ${stripTags(c.trap)}`.toLowerCase();

function cheatCardHtml(c) {
  return `
    <article class="card cheat-card" id="cheat-${esc(c.id)}">
      <h3>${esc(c.name)}</h3>
      ${c.sig ? `<div class="sig">${esc(c.sig)}</div>` : ""}
      <p class="desc">${c.desc}</p>
      ${c.ex ? codeBlock(c.ex) : ""}
      ${c.out ? `<div class="out">${esc(c.out)}</div>` : ""}
      ${c.trap ? `<div class="trap">${icon("alert")}<span>${c.trap}</span></div>` : ""}
      ${c.ex ? `<div class="acts">
        ${c.run && SQL_ENABLED ? `<button class="btn sm" type="button" data-run="${esc(c.id)}">${icon("play", "sm")} В консоль</button>` : ""}
        <button class="btn sm ghost" type="button" data-copy="${esc(c.id)}">${icon("copy", "sm")} Копировать</button>
      </div>` : ""}
    </article>`;
}

function viewCheat(focusId) {
  setTab("cheat");
  const cats = [...new Set(CHEAT.map((c) => c.cat))];
  if (focusId) { cheatQuery = ""; cheatCat = ""; }
  app.innerHTML = `
    <div class="page">
      <span class="eyebrow">Справочник</span>
      <h1>Шпаргалка Oracle</h1>
      <p class="lede">${CHEAT.length} функций и конструкций SQL и PL/SQL: синтаксис, пример на нашей схеме и ловушка, о которой спрашивают на собеседовании.</p>
      <div class="cheat-tools">
        <div class="cheat-search">${icon("search")}<input class="input" id="cq" type="search" placeholder="Найти: NVL, курсор, дата, ROWNUM…" value="${esc(cheatQuery)}" autocomplete="off" spellcheck="false"></div>
        <div class="cats" id="cats">
          <button type="button" data-cat="" class="${cheatCat ? "" : "on"}">Все</button>
          ${cats.map((c) => `<button type="button" data-cat="${esc(c)}" class="${cheatCat === c ? "on" : ""}">${esc(c)}</button>`).join("")}
        </div>
      </div>
      <div id="cheat-list"></div>
    </div>`;

  const draw = () => {
    const terms = cheatQuery.toLowerCase().split(/\s+/).filter(Boolean);
    const list = CHEAT.filter((c) => (!cheatCat || c.cat === cheatCat) && terms.every((t) => cheatText(c).includes(t)));
    const groups = cats.map((cat) => [cat, list.filter((c) => c.cat === cat)]).filter(([, l]) => l.length);
    $("cheat-list").innerHTML = groups.length
      ? groups.map(([cat, l]) => `<h2 class="cat-title">${esc(cat)} <span>${l.length}</span></h2><div class="cheat-grid">${l.map(cheatCardHtml).join("")}</div>`).join("")
      : `<div class="empty-state">${icon("search")}<h3>Ничего не нашлось</h3><p>Попробуй другое слово или выбери «Все».</p></div>`;
    $("cheat-list").querySelectorAll("[data-run]").forEach((b) => (b.onclick = () => openInConsole(CHEAT.find((c) => c.id === b.dataset.run).ex)));
    $("cheat-list").querySelectorAll("[data-copy]").forEach((b) => (b.onclick = async () => {
      try {
        await navigator.clipboard.writeText(CHEAT.find((c) => c.id === b.dataset.copy).ex);
        b.innerHTML = `${icon("check", "sm")} Скопировано`;
        setTimeout(() => { b.innerHTML = `${icon("copy", "sm")} Копировать`; }, 1400);
      } catch (e) { b.textContent = "Не удалось"; }
    }));
  };
  draw();
  const input = $("cq");
  input.oninput = () => { cheatQuery = input.value; draw(); };
  $("cats").querySelectorAll("[data-cat]").forEach((b) => (b.onclick = () => {
    cheatCat = b.dataset.cat;
    $("cats").querySelectorAll("[data-cat]").forEach((x) => x.classList.toggle("on", x === b));
    draw();
  }));
  if (focusId) {
    const el = $("cheat-" + focusId);
    if (el) requestAnimationFrame(() => { el.scrollIntoView({ block: "center" }); el.classList.add("flash"); });
  }
}

/* ================= палитра поиска ⌘K ================= */

let PAL = { list: [], sel: 0 };

function paletteResults(query) {
  const q = query.trim().toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  const has = (text) => terms.every((t) => text.includes(t));
  const rank = (title) => (title.toLowerCase().startsWith(q) ? 0 : title.toLowerCase().includes(q) ? 1 : 2);
  const top = (arr, n) => arr.map((x) => ({ ...x, r: rank(x.title) })).sort((a, b) => a.r - b.r).slice(0, n);
  const groups = [];

  const pages = NAV.filter((n) => !n.group).map((n) => ({ icon: n.icon, title: n.label, sub: "Раздел", go: () => navigate(n.href) }));
  if (!terms.length) {
    const next = nextUp();
    if (next) groups.push(["Продолжить", [{ icon: "arrow", title: next.title, sub: `Урок ${next.lesson.num} · ${next.lesson.title}`, go: () => navigate("#/step/" + next.id) }]]);
    const due = dueItems().length;
    groups.push(["Действия", [
      { icon: "mic", title: "Начать собеседование", sub: "15 вопросов на время", go: () => navigate("#/interview") },
      ...(due ? [{ icon: "repeat", title: `Повторить ${qWord(due)}`, sub: "Интервальное повторение", go: () => navigate("#/review") }] : []),
    ]]);
    groups.push(["Разделы", pages]);
    return groups;
  }
  const p = pages.filter((x) => has(x.title.toLowerCase()));
  if (p.length) groups.push(["Разделы", p]);
  const ch = top(CHEAT.filter((c) => has(cheatText(c))).map((c) => ({ icon: "cheat", title: c.name, sub: `${c.cat} · ${stripTags(c.desc)}`, go: () => navigate("#/cheat/" + c.id) })), 6);
  if (ch.length) groups.push(["Шпаргалка", ch]);
  const st = top(allSteps().filter((s) => has(`${s.title} ${s.lesson.title} ${stripTags(s.theory)}`.toLowerCase()))
    .map((s) => ({ icon: "book", title: s.title, sub: `Урок ${s.lesson.num} · ${s.lesson.title}`, go: () => navigate("#/step/" + s.id) })), 5);
  if (st.length) groups.push(["Шаги уроков", st]);
  const qs = top(QUESTIONS.filter((x) => has(`${x.q} ${x.topic}`.toLowerCase()))
    .map((x) => ({ icon: isCard(x) ? "mic" : "quiz", title: x.q, sub: `${x.topic} · ${SECTION_NAME[sectionOf(x)]}`, go: () => startRun([x.id], { mode: "practice", back: location.hash || "#/", title: "Вопрос" }) })), 6);
  if (qs.length) groups.push(["Вопросы", qs]);
  return groups;
}

function drawPalette(query) {
  const groups = paletteResults(query);
  PAL.list = groups.flatMap(([, items]) => items);
  PAL.sel = Math.min(PAL.sel, Math.max(0, PAL.list.length - 1));
  let i = 0;
  $("pal-list").innerHTML = PAL.list.length
    ? groups.map(([g, items]) => `<div class="pal-group">${g}</div>${items.map((it) => {
        const k = i++;
        return `<div class="pal-item ${k === PAL.sel ? "on" : ""}" data-i="${k}" role="option">${icon(it.icon)}<span class="tx"><b>${esc(it.title)}</b><small>${esc(it.sub)}</small></span></div>`;
      }).join("")}`).join("")
    : `<div class="pal-empty">Ничего не нашлось</div>`;
  $("pal-list").querySelectorAll(".pal-item").forEach((el) => {
    el.onmousemove = () => { if (PAL.sel !== +el.dataset.i) { PAL.sel = +el.dataset.i; highlightPal(); } };
    el.onclick = () => choosePal(+el.dataset.i);
  });
}

function highlightPal() {
  $("pal-list").querySelectorAll(".pal-item").forEach((el) => el.classList.toggle("on", +el.dataset.i === PAL.sel));
  const on = $("pal-list").querySelector(".pal-item.on");
  if (on) on.scrollIntoView({ block: "nearest" });
}

function choosePal(i) {
  const it = PAL.list[i];
  if (!it) return;
  closePalette();
  it.go();
}

function openPalette() {
  if (!USER || !DATA) return;
  closeDrawer();
  const p = $("palette");
  p.hidden = false;
  p.innerHTML = `
    <div class="pal-box" role="dialog" aria-modal="true" aria-label="Поиск">
      <div class="pal-in">${icon("search")}<input id="pal-q" placeholder="Функция, тема, вопрос, шаг урока…" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></div>
      <div class="pal-list" id="pal-list" role="listbox"></div>
      <div class="pal-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> выбрать</span><span><kbd>↵</kbd> открыть</span><span><kbd>Esc</kbd> закрыть</span></div>
    </div>`;
  p.onclick = (e) => { if (e.target === p) closePalette(); };
  const input = $("pal-q");
  PAL.sel = 0;
  input.oninput = () => { PAL.sel = 0; drawPalette(input.value); };
  input.onkeydown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); PAL.sel = Math.min(PAL.sel + 1, PAL.list.length - 1); highlightPal(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); PAL.sel = Math.max(PAL.sel - 1, 0); highlightPal(); }
    else if (e.key === "Enter") { e.preventDefault(); choosePal(PAL.sel); }
    else if (e.key === "Escape") { e.preventDefault(); closePalette(); }
  };
  drawPalette("");
  input.focus();
}

function closePalette() {
  const p = $("palette");
  p.hidden = true;
  p.innerHTML = "";
}

/* ================= экран: схема ================= */

function viewSchema() {
  setTab("schema");
  app.innerHTML = `
    <div class="page">
      <span class="eyebrow">Учебная схема</span>
      <h1>Таблицы и ловушки в данных</h1>
      <p class="lede">Пользователь <span class="mono">plsql</span>. Ловушки расставлены специально — на них и тренируемся.</p>
      <div class="schema-grid stagger">
        ${DATA.schema.map((t) => `
          <div class="card glow tbl-card">
            <h3>${icon("table", "sm")} ${esc(t.table)} <span class="rows">${rows(t.rows)}</span>
              ${SQL_ENABLED ? `<a href="#/console" data-open="${esc(t.table)}">открыть →</a>` : ""}</h3>
            <p class="cols">${esc(t.columns)}</p>
            <p class="note">${esc(t.note)}</p>
          </div>`).join("")}
      </div>
    </div>`;
  app.querySelectorAll("[data-open]").forEach((a) => (a.onclick = (e) => {
    e.preventDefault();
    openInConsole(`SELECT *\n  FROM ${a.dataset.open};`);
  }));
}

/* ================= роутер ================= */

function route() {
  stopTimer();
  RUN = null;
  if (!$("palette").hidden) closePalette();
  if (!USER) return viewAuth();
  renderMe();
  window.scrollTo(0, 0);
  const [page, arg] = (location.hash || "#/").slice(2).split("/");
  if (page === "step" && arg) return viewStep(arg);
  if (page === "lesson" && arg) return viewLesson(arg);
  if (page === "lessons") return viewLessons();
  if (page === "review") return viewReview();
  if (page === "quiz") return viewQuiz();
  if (page === "interview") return viewInterview();
  if (page === "cheat") return viewCheat(arg ? decodeURIComponent(arg) : null);
  if (page === "console") return viewConsole();
  if (page === "schema") return viewSchema();
  return viewHome();
}

window.addEventListener("hashchange", route);

async function boot() {
  initShell();
  try {
    [DATA, QUESTIONS, CHEAT] = await Promise.all([
      fetch("/content/lessons.json").then((r) => r.json()),
      fetch("/content/questions.json").then((r) => r.json()),
      fetch("/content/cheatsheet.json").then((r) => (r.ok ? r.json() : [])).catch(() => []),
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
    migrateReview();
    saveState = "offline";
  }
  route();
}

boot();
