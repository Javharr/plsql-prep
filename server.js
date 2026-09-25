import express from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { pool, migrate } from "./db.js";
import { oracleEnabled, run as runSql, check as checkSql, schema as sqlSchema } from "./oracle.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const SIGNUP_CODE = process.env.SIGNUP_CODE || "";
const SECURE_COOKIE = process.env.NODE_ENV === "production" || !!process.env.RAILWAY_ENVIRONMENT;
const COOKIE = "sid";
const SESSION_DAYS = 60;

const app = express();
app.set("trust proxy", 1); // Railway стоит за прокси — нужен настоящий IP для лимита попыток
app.disable("x-powered-by");

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});

/* ---------------- статика ---------------- */

app.use(
  express.static(path.join(__dirname, "public"), {
    extensions: ["html"],
    setHeaders(res, filePath) {
      if (/\.(json|js|css|html)$/.test(filePath)) res.setHeader("Cache-Control", "no-cache");
    },
  })
);

// редактор кода отдаём со своего сервера, без внешних CDN
app.use("/vendor/codemirror", express.static(path.join(__dirname, "node_modules", "codemirror"), { maxAge: "7d" }));

app.get("/healthz", (_req, res) => res.type("text").send("ok"));

/* ---------------- утилиты ---------------- */

const api = express.Router();
api.use(express.json({ limit: "256kb" }));

// Запись принимаем только как JSON: обычная HTML-форма с чужого сайта так не отправит,
// вместе с SameSite=Lax это закрывает CSRF.
api.use((req, res, next) => {
  if (["POST", "PUT", "DELETE"].includes(req.method) && !req.is("application/json") && req.path !== "/logout") {
    return res.status(415).json({ error: "Ожидается JSON" });
  }
  next();
});

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: SECURE_COOKIE,
    sameSite: "lax",
    maxAge: SESSION_DAYS * 24 * 3600 * 1000,
    path: "/",
  });
}

async function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
    [sha256(token), userId, String(SESSION_DAYS)]
  );
  setSessionCookie(res, token);
}

async function requireUser(req, res, next) {
  const token = readCookie(req, COOKIE);
  if (!token) return res.status(401).json({ error: "Нужно войти" });
  const { rows } = await pool.query(
    `SELECT u.id, u.username
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)]
  );
  if (!rows.length) return res.status(401).json({ error: "Сессия истекла" });
  req.user = rows[0];
  next();
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Простой лимит попыток входа: 10 неудач за 15 минут с одного IP
const attempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.first > 15 * 60 * 1000) return false;
  return rec.count >= 10;
}
function noteFailure(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.first > 15 * 60 * 1000) attempts.set(ip, { first: now, count: 1 });
  else rec.count++;
}

const USERNAME_RE = /^[a-z0-9_.-]{3,32}$/;

// настоящий bcrypt-хэш для несуществующих логинов: время ответа не выдаёт, есть ли такой пользователь
const DUMMY_HASH = bcrypt.hashSync("no-such-user-" + crypto.randomBytes(8).toString("hex"), 12);

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/* ---------------- авторизация ---------------- */

api.post("/register", wrap(async (req, res) => {
  if (!SIGNUP_CODE) {
    return res.status(403).json({ error: "Регистрация закрыта: в Railway не задана переменная SIGNUP_CODE." });
  }
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const code = String(req.body.code || "").trim();

  if (!safeEqual(code, SIGNUP_CODE)) {
    noteFailure(req.ip);
    return res.status(403).json({ error: "Неверный код приглашения." });
  }
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: "Логин: 3–32 символа, латиница в нижнем регистре, цифры, точка, дефис или подчёркивание." });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Пароль — минимум 8 символов." });
  }

  const hash = await bcrypt.hash(password, 12);
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username`,
      [username, hash]
    );
    await pool.query(`INSERT INTO progress (user_id) VALUES ($1)`, [rows[0].id]);
    await createSession(res, rows[0].id);
    res.status(201).json({ username: rows[0].username });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Такой логин уже занят." });
    throw e;
  }
}));

api.post("/login", wrap(async (req, res) => {
  if (tooManyAttempts(req.ip)) {
    return res.status(429).json({ error: "Слишком много попыток. Подожди 15 минут." });
  }
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  const { rows } = await pool.query(
    `SELECT id, username, password_hash FROM users WHERE username = $1`,
    [username]
  );
  // сравниваем хэш даже для несуществующего логина, чтобы по времени ответа нельзя было угадать логины
  const hash = rows[0]?.password_hash || DUMMY_HASH;
  const ok = await bcrypt.compare(password, hash);

  if (!rows.length || !ok) {
    noteFailure(req.ip);
    return res.status(401).json({ error: "Неверный логин или пароль." });
  }
  attempts.delete(req.ip);
  await createSession(res, rows[0].id);
  res.json({ username: rows[0].username });
}));

api.post("/logout", wrap(async (req, res) => {
  const token = readCookie(req, COOKIE);
  if (token) await pool.query(`DELETE FROM sessions WHERE token_hash = $1`, [sha256(token)]);
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
}));

api.get("/me", wrap(requireUser), (req, res) => {
  res.json({ username: req.user.username });
});

/* ---------------- прогресс ---------------- */

api.get("/progress", wrap(requireUser), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT data, updated_at FROM progress WHERE user_id = $1`,
    [req.user.id]
  );
  res.json({ data: rows[0]?.data || {}, updatedAt: rows[0]?.updated_at || null });
}));

api.put("/progress", wrap(requireUser), wrap(async (req, res) => {
  const data = req.body?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return res.status(400).json({ error: "Ожидается объект data." });
  }
  await pool.query(
    `INSERT INTO progress (user_id, data, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [req.user.id, data]
  );
  res.json({ ok: true });
}));

/* ---------------- SQL: выполнение и проверка ---------------- */

// эталоны для проверки берём с сервера, а не из запроса — подменить их из браузера нельзя
let lessonsCache = { mtime: 0, steps: new Map() };
function stepById(id) {
  const file = path.join(__dirname, "public", "content", "lessons.json");
  const { mtimeMs } = fs.statSync(file);
  if (mtimeMs !== lessonsCache.mtime) {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const steps = new Map();
    for (const l of data.lessons) for (const s of l.steps) steps.set(s.id, s);
    lessonsCache = { mtime: mtimeMs, steps };
  }
  return lessonsCache.steps.get(id);
}

// не больше 30 запусков в минуту: защита от случайного цикла в интерфейсе
const runLog = new Map();
function tooManyRuns(userId) {
  const now = Date.now();
  const list = (runLog.get(userId) || []).filter((t) => now - t < 60_000);
  list.push(now);
  runLog.set(userId, list);
  return list.length > 30;
}

api.get("/sql/status", wrap(requireUser), (_req, res) => {
  res.json({ enabled: oracleEnabled });
});

api.get("/sql/schema", wrap(requireUser), wrap(async (_req, res) => {
  if (!oracleEnabled) return res.status(503).json({ error: "Oracle пока не подключена к сайту." });
  res.json({ tables: await sqlSchema() });
}));

api.post("/sql/run", wrap(requireUser), wrap(async (req, res) => {
  if (!oracleEnabled) return res.status(503).json({ error: "Oracle пока не подключена к сайту." });
  if (tooManyRuns(req.user.id)) return res.status(429).json({ error: "Слишком часто. Подожди минуту." });
  const sql = String(req.body?.sql || "");
  if (sql.length > 20_000) return res.status(400).json({ error: "Слишком длинный текст." });
  try {
    res.json(await runSql(sql));
  } catch (e) {
    if (e.userFacing) return res.status(400).json({ error: e.message, ms: e.ms });
    throw e;
  }
}));

api.post("/sql/check", wrap(requireUser), wrap(async (req, res) => {
  if (!oracleEnabled) return res.status(503).json({ error: "Oracle пока не подключена к сайту." });
  if (tooManyRuns(req.user.id)) return res.status(429).json({ error: "Слишком часто. Подожди минуту." });
  const step = stepById(String(req.body?.stepId || ""));
  if (!step?.check?.sql) return res.status(404).json({ error: "У этого шага нет автопроверки." });
  const sql = String(req.body?.sql || "");
  if (sql.length > 20_000) return res.status(400).json({ error: "Слишком длинный текст." });
  res.json(await checkSql(sql, step.check.sql, { ordered: !!step.check.ordered }));
}));

app.use("/api", api);
app.use("/api", (_req, res) => res.status(404).json({ error: "Нет такого адреса" }));

// одностраничное приложение: всё прочее отдаёт index.html
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Ошибка на сервере. Попробуй ещё раз." });
});

/* ---------------- старт ---------------- */

migrate()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`plsql-prep слушает порт ${PORT}`);
      if (!SIGNUP_CODE) console.warn("SIGNUP_CODE не задан — регистрация закрыта.");
      console.log(oracleEnabled ? "Oracle: подключение настроено" : "Oracle: переменные ORACLE_* не заданы — выполнение SQL выключено");
    });
  })
  .catch((e) => {
    console.error("Не удалось подготовить базу:", e.message);
    process.exit(1);
  });
