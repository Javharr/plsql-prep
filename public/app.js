/* PL/SQL: подготовка — учебник и тренажёр.
   Прогресс хранится в localStorage этого браузера. */

const app = document.getElementById("app");
const footStats = document.getElementById("foot-stats");
const KEYS = ["A", "B", "C", "D"];

let DATA = null;      // lessons.json
let QUESTIONS = [];   // questions.json
let progress = load();

/* ---------------- хранилище ---------------- */

function load() {
  try {
    return JSON.parse(localStorage.getItem("plsql-prep") || "{}");
  } catch (e) {
    return {};
  }
}

function save() {
  try {
    localStorage.setItem("plsql-prep", JSON.stringify(progress));
  } catch (e) {
    /* приватный режим — просто работаем без сохранения */
  }
}

function mark(id, value) {
  progress[id] = value;
  save();
  renderFoot();
}

function isDone(step) {
  return step.status === "done" || progress["s:" + step.id] === "done";
}

/* ---------------- утилиты ---------------- */

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const STATUS = { done: "пройдено", current: "сейчас", next: "впереди" };

function setTab(name) {
  document.querySelectorAll(".tabs a").forEach((a) => {
    a.classList.toggle("on", a.dataset.tab === name);
  });
}

function renderFoot() {
  const answered = QUESTIONS.filter((q) => progress["q:" + q.id]).length;
  const ok = QUESTIONS.filter((q) => progress["q:" + q.id] === "ok").length;
  const steps = DATA ? DATA.lessons.flatMap((l) => l.steps) : [];
  const doneSteps = steps.filter(isDone).length;
  footStats.textContent =
    `шагов пройдено ${doneSteps} из ${steps.length} · вопросов отвечено ${answered} из ${QUESTIONS.length}` +
    (answered ? ` · верно ${Math.round((ok / answered) * 100)}%` : "");
}

/* ---------------- экран: список уроков ---------------- */

function viewLessons() {
  setTab("lessons");
  const cards = DATA.lessons
    .map((l) => {
      const total = l.steps.length;
      const done = l.steps.filter(isDone).length;
      return `
        <a class="card" href="#/lesson/${l.id}">
          <span class="num">УРОК ${l.num}</span>
          <h3>${esc(l.title)}</h3>
          <p>${esc(l.subtitle)}</p>
          <span class="meter"><i style="width:${total ? (done / total) * 100 : 0}%"></i></span>
          <p style="margin-top:8px;font-size:13px">пройдено ${done} из ${total} шагов</p>
        </a>`;
    })
    .join("");

  app.innerHTML = `
    <h1>Подготовка к PL/SQL</h1>
    <p class="lede">Теория по шагам, задачи на учебной схеме и тест с разбором. Запросы пишем в DataGrip на своей базе — здесь разбор и проверка себя.</p>
    <div class="cards">${cards}</div>`;
}

/* ---------------- экран: урок ---------------- */

function viewLesson(id) {
  setTab("lessons");
  const l = DATA.lessons.find((x) => x.id === id);
  if (!l) return viewLessons();

  const steps = l.steps
    .map((s) => {
      const state = isDone(s) ? "done" : s.status;
      const ex = (s.examples || [])
        .map((e) => `<tr><td>${esc(e.sql)}</td><td>${esc(e.out)}</td></tr>`)
        .join("");
      const mistakes = (s.mistakes || []).length
        ? `<div class="mistakes"><b>мои ошибки на этом шаге</b><ul>${s.mistakes
            .map((m) => `<li>${esc(m)}</li>`)
            .join("")}</ul></div>`
        : "";
      return `
      <details class="step" id="${s.id}">
        <summary><span class="chip ${state}">${STATUS[state]}</span> ${esc(s.title)}</summary>
        <div class="body">
          <div class="theory">${s.theory}</div>
          ${ex ? `<table class="ex">${ex}</table>` : ""}
          <div class="task"><b>задание</b>${esc(s.task)}</div>
          ${mistakes}
          <details class="sol"><summary>Показать решение</summary><pre>${esc(s.solution)}</pre></details>
          ${s.status === "done" ? "" : `<button class="ghost" data-step="${s.id}" style="margin-top:14px">
            ${progress["s:" + s.id] === "done" ? "✓ отмечено пройденным" : "Отметить пройденным"}
          </button>`}
        </div>
      </details>`;
    })
    .join("");

  app.innerHTML = `
    <a class="back" href="#/lessons">← все уроки</a>
    <h1>Урок ${l.num}. ${esc(l.title)}</h1>
    <p class="lede">${esc(l.subtitle)}</p>
    <div class="steps">${steps}</div>`;

  app.querySelectorAll("button[data-step]").forEach((b) => {
    b.onclick = () => {
      const key = "s:" + b.dataset.step;
      mark(key, progress[key] === "done" ? undefined : "done");
      viewLesson(id);
      const el = document.getElementById(b.dataset.step);
      if (el) { el.open = true; el.scrollIntoView({ block: "center" }); }
    };
  });
}

/* ---------------- экран: тест ---------------- */

let queue = [];
let pos = 0;
let answered = false;

function viewQuizStart() {
  setTab("quiz");
  const done = QUESTIONS.filter((q) => progress["q:" + q.id]).length;
  const ok = QUESTIONS.filter((q) => progress["q:" + q.id] === "ok").length;
  const wrong = QUESTIONS.filter((q) => progress["q:" + q.id] === "bad").length;

  app.innerHTML = `
    <h1>Тест</h1>
    <p class="lede">Вопросы-ловушки по пройденному: то, на чём спотыкаются на собеседовании. Отвечай честно — тест запоминает, где ты ошибся.</p>
    <div class="stats">
      <div class="stat"><b>${done}</b><span>пройдено из ${QUESTIONS.length}</span></div>
      <div class="stat"><b>${done ? Math.round((ok / done) * 100) + "%" : "—"}</b><span>верных</span></div>
      <div class="stat"><b>${wrong}</b><span>с ошибкой</span></div>
    </div>
    <div class="actions">
      <button class="primary" id="go">${done ? "Продолжить" : "Начать"}</button>
      ${wrong ? `<button class="ghost" id="err">Только ошибки — ${wrong}</button>` : ""}
      ${done ? `<button class="ghost" id="all">Прогнать все заново</button>` : ""}
      ${done ? `<button class="ghost" id="reset">Сбросить результаты теста</button>` : ""}
    </div>`;

  document.getElementById("go").onclick = () => {
    const unseen = QUESTIONS.filter((q) => !progress["q:" + q.id]).map((q) => q.id);
    startQuiz(unseen.length ? unseen : shuffle(QUESTIONS.map((q) => q.id)));
  };
  const err = document.getElementById("err");
  if (err) err.onclick = () =>
    startQuiz(shuffle(QUESTIONS.filter((q) => progress["q:" + q.id] === "bad").map((q) => q.id)));
  const all = document.getElementById("all");
  if (all) all.onclick = () => startQuiz(shuffle(QUESTIONS.map((q) => q.id)));
  const reset = document.getElementById("reset");
  if (reset)
    reset.onclick = () => {
      QUESTIONS.forEach((q) => delete progress["q:" + q.id]);
      save();
      renderFoot();
      viewQuizStart();
    };
}

function startQuiz(ids) {
  queue = ids;
  pos = 0;
  renderQuestion();
}

function renderQuestion() {
  if (pos >= queue.length) return renderQuizEnd();
  answered = false;
  const q = QUESTIONS.find((x) => x.id === queue[pos]);

  app.innerHTML = `
    <a class="back" href="#/quiz">← к тесту</a>
    <span class="qtopic">${esc(q.topic)} · ${pos + 1} из ${queue.length}</span>
    <p class="qtext">${esc(q.q)}</p>
    ${q.code ? `<pre>${esc(q.code)}</pre>` : ""}
    <div class="opts" id="opts"></div>
    <div id="after"></div>`;

  const opts = document.getElementById("opts");
  const order = shuffle(q.opts.map((text, i) => ({ text, i })));
  order.forEach((o, n) => {
    const b = document.createElement("button");
    b.className = "opt";
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
      <div class="verdict ${right ? "ok" : "bad"}">${right ? "Верно" : "Мимо"}</div>
      <p>${q.why}</p>
    </div>
    <button class="primary" id="next" style="margin-top:14px">
      ${pos + 1 >= queue.length ? "Итоги" : "Дальше"}
    </button>`;
  document.getElementById("next").onclick = () => { pos++; renderQuestion(); };
}

function renderQuizEnd() {
  const ok = queue.filter((id) => progress["q:" + id] === "ok").length;
  const missed = queue.filter((id) => progress["q:" + id] === "bad");

  app.innerHTML = `
    <p class="score">${ok} / ${queue.length}</p>
    <p class="lede">${missed.length ? "Вот что стоит перечитать." : "Чисто. Можно идти дальше."}</p>
    ${missed
      .map((id) => {
        const q = QUESTIONS.find((x) => x.id === id);
        return `<div class="tbl"><h3>${esc(q.topic)}</h3><p class="note">${esc(q.q)}</p></div>`;
      })
      .join("")}
    <div class="actions" style="margin-top:16px">
      ${missed.length ? '<button class="primary" id="again">Пройти ошибки ещё раз</button>' : ""}
      <button class="${missed.length ? "ghost" : "primary"}" id="home">К тесту</button>
    </div>`;

  const again = document.getElementById("again");
  if (again) again.onclick = () => startQuiz(shuffle(missed));
  document.getElementById("home").onclick = viewQuizStart;
}

/* ---------------- экран: схема ---------------- */

function viewSchema() {
  setTab("schema");
  app.innerHTML = `
    <h1>Учебная схема</h1>
    <p class="lede">Пользователь <span class="mono">plsql</span>, сервис <span class="mono">FREEPDB1</span>. Ловушки в данных расставлены специально — на них и тренируемся.</p>
    ${DATA.schema
      .map(
        (t) => `
      <div class="tbl">
        <h3>${esc(t.table)}</h3>
        <span class="rows">${t.rows} строк</span>
        <p class="cols">${esc(t.columns)}</p>
        <p class="note">${esc(t.note)}</p>
      </div>`
      )
      .join("")}`;
}

/* ---------------- роутер ---------------- */

function route() {
  const hash = location.hash || "#/lessons";
  const parts = hash.slice(2).split("/");
  window.scrollTo(0, 0);

  if (parts[0] === "lesson" && parts[1]) return viewLesson(parts[1]);
  if (parts[0] === "quiz") return viewQuizStart();
  if (parts[0] === "schema") return viewSchema();
  return viewLessons();
}

window.addEventListener("hashchange", route);

Promise.all([
  fetch("/content/lessons.json").then((r) => r.json()),
  fetch("/content/questions.json").then((r) => r.json()),
])
  .then(([lessons, questions]) => {
    DATA = lessons;
    QUESTIONS = questions;
    renderFoot();
    route();
  })
  .catch((e) => {
    app.innerHTML = `<h1>Не загрузился контент</h1><p class="lede">${esc(e.message)}</p>`;
  });
