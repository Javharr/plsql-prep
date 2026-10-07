/* Выполнение SQL и PL/SQL в Oracle Autonomous Database.
   Работает через node-oracledb в thin-режиме (без Oracle Client), подключение по mTLS с wallet.

   Переменные окружения (задаются в Railway, в код и в git не попадают):
     ORACLE_USER             — пользователь базы, у нас plsql
     ORACLE_PASSWORD         — его пароль
     ORACLE_TNS_ALIAS        — имя сервиса из tnsnames.ora, например smqi0y4a3hyldpa0_low
     ORACLE_WALLET_PASSWORD  — пароль wallet, заданный при скачивании
     ORACLE_WALLET_PEM_B64   — base64 файла ewallet.pem
     ORACLE_TNSNAMES_B64     — base64 файла tnsnames.ora
*/

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import oracledb from "oracledb";

const {
  ORACLE_USER,
  ORACLE_PASSWORD,
  ORACLE_TNS_ALIAS,
  ORACLE_WALLET_PASSWORD,
  ORACLE_WALLET_PEM_B64,
  ORACLE_TNSNAMES_B64,
  ORACLE_CONNECT_STRING, // для локальной разработки: host:port/service без wallet
} = process.env;

const CALL_TIMEOUT_MS = 20_000;
const MAX_ROWS = 500;
const MAX_OUTPUT_LINES = 1000;

const useWallet = Boolean(
  ORACLE_TNS_ALIAS && ORACLE_WALLET_PASSWORD && ORACLE_WALLET_PEM_B64 && ORACLE_TNSNAMES_B64
);
export const oracleEnabled = Boolean(ORACLE_USER && ORACLE_PASSWORD && (useWallet || ORACLE_CONNECT_STRING));

// Даты, CLOB и числа забираем строками: так результат выглядит как в DataGrip,
// и сравнение при проверке задач не спотыкается о плавающую точку.
// В thin-режиме fetchAsString для дат даёт формат JavaScript («Sun Mar 01 2015 …»),
// поэтому даты форматируем сами, как NLS_DATE_FORMAT 'YYYY-MM-DD HH24:MI:SS'.
const pad = (n, w = 2) => String(n).padStart(w, "0");
const fmtDate = (d) =>
  d == null ? d : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const fmtTs = (d) => (d == null ? d : `${fmtDate(d)}.${pad(d.getMilliseconds(), 3)}`);
const fmtNum = (v) => (v == null ? v : v.replace(/^(-?)\./, "$10.")); // .15 → 0.15, как в DataGrip

oracledb.fetchTypeHandler = (meta) => {
  switch (meta.dbType) {
    case oracledb.DB_TYPE_DATE:
      return { converter: fmtDate };
    case oracledb.DB_TYPE_TIMESTAMP:
    case oracledb.DB_TYPE_TIMESTAMP_TZ:
    case oracledb.DB_TYPE_TIMESTAMP_LTZ:
      return { converter: fmtTs };
    case oracledb.DB_TYPE_NUMBER:
    case oracledb.DB_TYPE_BINARY_DOUBLE:
    case oracledb.DB_TYPE_BINARY_FLOAT:
      return { type: oracledb.STRING, converter: fmtNum };
    case oracledb.DB_TYPE_CLOB:
    case oracledb.DB_TYPE_NCLOB:
      return { type: oracledb.STRING };
    default:
      return undefined;
  }
};

let poolPromise = null;

function writeWallet() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oracle-wallet-"));
  fs.writeFileSync(path.join(dir, "ewallet.pem"), Buffer.from(ORACLE_WALLET_PEM_B64, "base64"), { mode: 0o600 });
  fs.writeFileSync(path.join(dir, "tnsnames.ora"), Buffer.from(ORACLE_TNSNAMES_B64, "base64"), { mode: 0o600 });
  return dir;
}

function getPool() {
  if (!oracleEnabled) throw new Error("Oracle не подключена");
  if (!poolPromise) {
    const conn = useWallet
      ? (() => {
          const dir = writeWallet();
          return { connectString: ORACLE_TNS_ALIAS, configDir: dir, walletLocation: dir, walletPassword: ORACLE_WALLET_PASSWORD };
        })()
      : { connectString: ORACLE_CONNECT_STRING };
    poolPromise = oracledb
      .createPool({
        user: ORACLE_USER,
        password: ORACLE_PASSWORD,
        ...conn,
        poolMin: 0,
        poolMax: 2,
        poolIncrement: 1,
        poolTimeout: 120,
        sessionCallback: async (conn, _tag, cb) => {
          try {
            await conn.execute(
              `ALTER SESSION SET NLS_DATE_FORMAT = 'YYYY-MM-DD HH24:MI:SS'
                                 NLS_TIMESTAMP_FORMAT = 'YYYY-MM-DD HH24:MI:SS.FF3'
                                 NLS_NUMERIC_CHARACTERS = '.,'`
            );
            cb();
          } catch (e) {
            cb(e);
          }
        },
      })
      .catch((e) => {
        poolPromise = null; // дать шанс следующей попытке
        throw e;
      });
  }
  return poolPromise;
}

/* ---------------- разбор текста запроса ---------------- */

const PLSQL_START =
  /^(<<\w+>>\s*)?(declare|begin|create\s+(or\s+replace\s+)?((editionable|noneditionable)\s+)?(procedure|function|package|trigger|type))\b/i;

// Делит текст на команды по «;», не трогая «;» внутри строк и комментариев.
function splitSql(text) {
  const parts = [];
  let cur = "";
  let meaningful = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (c === "-" && n === "-") {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end;
      cur += "\n";
      continue;
    }
    if (c === "/" && n === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 1;
      cur += " ";
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "'" && text[j + 1] === "'") { j += 2; continue; }
        if (text[j] === "'") break;
        j++;
      }
      cur += text.slice(i, j + 1);
      meaningful = true;
      i = j;
      continue;
    }
    if (c === ";") {
      if (meaningful) parts.push(cur.trim());
      cur = "";
      meaningful = false;
      continue;
    }
    cur += c;
    if (!/\s/.test(c)) meaningful = true;
  }
  if (meaningful) parts.push(cur.trim());
  return parts;
}

// Возвращает { kind: "sql" | "plsql", text } или бросает понятную ошибку.
export function prepare(raw) {
  let text = String(raw || "").replace(/\r\n/g, "\n").trim();
  // строка с одиночным «/» в конце — привычка из SQL*Plus и DataGrip, выкидываем
  text = text.replace(/\n\s*\/\s*$/, "").trim();
  if (!text) throw userError("Пустой запрос.");

  const firstWord = text.replace(/^(\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)*/, "");
  if (PLSQL_START.test(firstWord)) {
    return { kind: "plsql", text: firstWord };
  }

  const parts = splitSql(text);
  if (parts.length === 0) throw userError("В запросе только комментарии.");
  if (parts.length > 1) {
    throw userError(
      `Здесь выполняется одна команда за раз, а у тебя их ${parts.length}. ` +
      "Оставь одну или выполни их по очереди."
    );
  }
  return { kind: "sql", text: parts[0] };
}

function userError(message) {
  const e = new Error(message);
  e.userFacing = true;
  return e;
}

/* ---------------- выполнение ---------------- */

async function readDbmsOutput(conn) {
  const lines = [];
  for (let i = 0; i < MAX_OUTPUT_LINES; i++) {
    const r = await conn.execute(`BEGIN DBMS_OUTPUT.GET_LINE(:line, :status); END;`, {
      line: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
      status: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
    });
    if (r.outBinds.status !== 0) break;
    lines.push(r.outBinds.line ?? "");
  }
  return lines;
}

async function compileErrors(conn) {
  const r = await conn.execute(
    `SELECT name, type, line, position, text
       FROM user_errors
      ORDER BY name, type, sequence
      FETCH FIRST 20 ROWS ONLY`,
    [],
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );
  return r.rows.map((e) => `${e.TYPE} ${e.NAME}, строка ${e.LINE}:${e.POSITION} — ${e.TEXT.trim()}`);
}

export async function run(raw) {
  const { kind, text } = prepare(raw);
  const pool = await getPool();
  const conn = await pool.getConnection();
  conn.callTimeout = CALL_TIMEOUT_MS;
  const started = Date.now();
  try {
    await conn.execute(`BEGIN DBMS_OUTPUT.ENABLE(NULL); END;`);
    const r = await conn.execute(text, [], {
      outFormat: oracledb.OUT_FORMAT_ARRAY,
      maxRows: MAX_ROWS + 1,
      autoCommit: true,
    });
    const ms = Date.now() - started;
    const output = await readDbmsOutput(conn);

    const result = { kind, ms, output };

    if (r.metaData) {
      result.columns = r.metaData.map((m) => m.name);
      result.truncated = r.rows.length > MAX_ROWS;
      result.rows = r.rows.slice(0, MAX_ROWS);
    } else {
      result.rowsAffected = r.rowsAffected ?? null;
    }

    if (r.warning) {
      result.warning = r.warning.message;
      result.compileErrors = await compileErrors(conn);
    }
    return result;
  } catch (e) {
    const ms = Date.now() - started;
    if (e.userFacing) throw e;
    // ORA-/DPY- ошибки отдаём как есть: читать их — часть учёбы
    const err = userError(
      e.code === "DPY-4024" || /call timeout/i.test(e.message)
        ? `Запрос выполнялся дольше ${CALL_TIMEOUT_MS / 1000} секунд и был прерван.`
        : e.message
    );
    err.ms = ms;
    throw err;
  } finally {
    await conn.close().catch(() => {});
  }
}

/* ---------------- список таблиц для консоли ---------------- */

export async function schema() {
  const pool = await getPool();
  const conn = await pool.getConnection();
  conn.callTimeout = CALL_TIMEOUT_MS;
  try {
    const r = await conn.execute(
      `SELECT c.table_name, c.column_name, c.data_type, c.data_length,
              c.data_precision, c.data_scale, c.nullable
         FROM user_tab_columns c
         JOIN user_tables t ON t.table_name = c.table_name
        WHERE c.table_name NOT LIKE '%$%'
        ORDER BY c.table_name, c.column_id`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const tables = new Map();
    for (const c of r.rows) {
      let type = c.DATA_TYPE;
      if (type === "NUMBER" && c.DATA_PRECISION) type += `(${c.DATA_PRECISION}${c.DATA_SCALE && c.DATA_SCALE !== "0" ? "," + c.DATA_SCALE : ""})`;
      else if (/CHAR/.test(type)) type += `(${c.DATA_LENGTH})`;
      if (!tables.has(c.TABLE_NAME)) tables.set(c.TABLE_NAME, []);
      tables.get(c.TABLE_NAME).push({ name: c.COLUMN_NAME, type, nullable: c.NULLABLE === "Y" });
    }
    return [...tables].map(([name, columns]) => ({ name, columns }));
  } finally {
    await conn.close().catch(() => {});
  }
}

/* ---------------- проверка задач ---------------- */

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
const rowsWord = (n) => `${n} ${plural(n, "строка", "строки", "строк")}`;

const norm = (row) => JSON.stringify(row.map((v) => (v === null || v === undefined ? null : String(v))));

export async function check(userSql, expectedSql, { ordered = false } = {}) {
  const exp = await run(expectedSql);
  let got;
  try {
    got = await run(userSql);
  } catch (e) {
    return { ok: false, message: e.message, error: true };
  }
  return compare(got, exp, ordered);
}

// Чистая функция сравнения — отдельно, чтобы её можно было проверить без базы.
export function compare(got, exp, ordered = false) {
  if (!got.columns) {
    return { ok: false, message: "Для этой задачи нужен SELECT: проверка сравнивает строки результата." };
  }
  if (got.truncated) {
    return { ok: false, message: `Запрос вернул больше ${MAX_ROWS} строк — так быть не должно. Проверь условия и JOIN.` };
  }
  if (got.columns.length !== exp.columns.length) {
    return {
      ok: false,
      message: `Столбцов у тебя ${got.columns.length}, а нужно ${exp.columns.length}. Перечитай, что именно просят вывести.`,
    };
  }

  const a = got.rows.map(norm);
  const b = exp.rows.map(norm);

  if (ordered) {
    const same = a.length === b.length && a.every((r, i) => r === b[i]);
    if (same) return { ok: true, message: "Верно." };
    if (a.length === b.length && [...a].sort().join() === [...b].sort().join()) {
      return { ok: false, message: "Строки верные, но порядок другой. Проверь ORDER BY." };
    }
  } else if (a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n")) {
    return { ok: true, message: "Верно." };
  }

  // считаем, каких строк не хватает и какие лишние
  const count = (arr) => arr.reduce((m, r) => m.set(r, (m.get(r) || 0) + 1), new Map());
  const ca = count(a);
  const cb = count(b);
  const missing = [];
  const extra = [];
  for (const [r, n] of cb) for (let i = 0; i < n - (ca.get(r) || 0); i++) missing.push(JSON.parse(r));
  for (const [r, n] of ca) for (let i = 0; i < n - (cb.get(r) || 0); i++) extra.push(JSON.parse(r));

  let message = `У тебя ${rowsWord(a.length)}, а должно быть ${b.length}.`;
  if (a.length === b.length) message = "Число строк совпадает, но значения отличаются.";

  return {
    ok: false,
    message,
    missing: missing.slice(0, 3),
    extra: extra.slice(0, 3),
    columns: got.columns,
  };
}

/* ---------------- проверка шага по режимам ----------------
   rows    — сравнить строки SELECT ученика с эталонным SELECT (check.sql)
   output  — выполнить блок ученика и эталонный блок, сравнить вывод DBMS_OUTPUT
   verify  — выполнить команду ученика (CREATE, DDL, DML, блок), затем проверочный
             запрос check.verify и сравнить его результат с эталоном check.expect
   reset: true — перед проверкой выполнить setup урока (пересоздать песочницу) */

const outLines = (r) => {
  const lines = (r.output || []).map((l) => String(l ?? "").replace(/\s+$/, ""));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
};

export function compareOutput(got, exp) {
  if (got.columns) {
    return { ok: false, message: "Здесь нужен PL/SQL-блок, который печатает результат через DBMS_OUTPUT.PUT_LINE, а не SELECT." };
  }
  const a = outLines(got);
  const b = outLines(exp);
  if (a.length === b.length && a.every((l, i) => l === b[i])) return { ok: true, message: "Верно." };
  let message;
  if (!a.length) message = "Блок выполнился, но ничего не напечатал. Нужен DBMS_OUTPUT.PUT_LINE.";
  else if (a.length !== b.length) message = `Строк вывода у тебя ${a.length}, а нужно ${b.length}.`;
  else {
    const i = a.findIndex((l, k) => l !== b[k]);
    message = `Отличается строка ${i + 1}: у тебя «${a[i]}», а нужно «${b[i]}».`;
  }
  return { ok: false, message, output: { got: a.slice(0, 15), expected: b.slice(0, 15) } };
}

export async function checkStep(c, userSql, { setup } = {}) {
  const mode = c.mode || "rows";
  // reset: перед проверкой вернуть таблицы-песочницы урока в исходное состояние
  if (c.reset && setup) await run(setup);
  if (mode === "rows") return check(userSql, c.sql, { ordered: !!c.ordered });

  if (mode === "output") {
    const exp = await run(c.sql);
    let got;
    try { got = await run(userSql); } catch (e) { return { ok: false, message: e.message, error: true }; }
    if (got.warning) return { ok: false, message: [got.warning, ...(got.compileErrors || [])].join("\n"), error: true };
    return compareOutput(got, exp);
  }

  if (mode === "verify") {
    let got;
    try { got = await run(userSql); } catch (e) { return { ok: false, message: e.message, error: true }; }
    if (got.warning) {
      return { ok: false, message: ["Создалось с ошибками компиляции:", ...(got.compileErrors || [])].join("\n"), error: true };
    }
    let v;
    try { v = await run(c.verify); } catch (e) { return { ok: false, message: "Команда выполнилась, но проверка не прошла: " + e.message, error: true }; }
    const exp = await run(c.expect);
    if (v.columns) {
      const r = compare(v, exp, !!c.ordered);
      if (!r.ok) r.message = "Команда выполнилась, но результат не тот. " + r.message;
      return r;
    }
    return compareOutput(v, exp);
  }
  return { ok: false, message: "Неизвестный режим проверки." };
}
