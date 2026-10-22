// Сборка раздела «Теория»: content-src/theory/*.md → public/content/theory.json
// Запуск: node scripts/build-theory.mjs
//
// Формат файла темы:
//   ---
//   id: normalization
//   title: Нормализация
//   group: sql            (sql | plsql)
//   summary: одна строка о теме
//   lessons: l10, l11     (необязательно — связанные уроки)
//   ---
//   ## Заголовок раздела теории        → раздел теории (markdown ниже)
//   ## ? Вопрос с собеседования        → вопрос и ответ (ответ — markdown ниже)
//   ## Тест: Текст вопроса             → вопрос с вариантами:
//      ```sql … ```   (необязательно — код к вопросу)
//      - неверный вариант
//      - [x] верный вариант
//      > объяснение (markdown, можно несколько строк)
//
// Markdown: абзацы, списки «- » и «1. », блоки ```sql, таблицы |a|b|, цитаты «> » (выноска),
// внутри строки — `код`, **жирный**, *курсив*.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "content-src", "theory");
const outFile = path.join(root, "public", "content", "theory.json");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(s) {
  // код прячем в заглушки, чтобы **жирный** мог оборачивать `код`, а звёздочки внутри кода не трогались
  const codes = [];
  const text = String(s).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  return esc(text)
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s(«])\*([^*\s][^*]*?)\*(?=[\s.,;:!?)»]|$)/g, "$1<i>$2</i>")
    .replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
}
const plain = (s) => String(s).replace(/`([^`]+)`/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").trim();

function md(text) {
  const lines = String(text).replace(/\s+$/, "").split("\n");
  const out = [];
  let i = 0;
  const isBlockStart = (l) => /^```/.test(l) || /^\s*[-*] /.test(l) || /^\s*\d+\. /.test(l) || /^\|/.test(l) || /^> ?/.test(l) || /^#{3,4} /.test(l);
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (/^```/.test(l)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre class="code" data-sql>${esc(buf.join("\n"))}</pre>`);
      continue;
    }
    if (/^#{3,4} /.test(l)) { out.push(`<h4>${inline(l.replace(/^#+ /, ""))}</h4>`); i++; continue; }
    if (/^\s*[-*] /.test(l) || /^\s*\d+\. /.test(l)) {
      const ordered = /^\s*\d+\. /.test(l);
      const items = [];
      while (i < lines.length && (ordered ? /^\s*\d+\. /.test(lines[i]) : /^\s*[-*] /.test(lines[i]))) {
        let item = lines[i].replace(/^\s*(?:[-*]|\d+\.) /, "");
        i++;
        while (i < lines.length && /^ {2,}\S/.test(lines[i]) && !/^\s*(?:[-*]|\d+\.) /.test(lines[i])) item += " " + lines[i++].trim();
        items.push(`<li>${inline(item)}</li>`);
      }
      out.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^\|/.test(l)) {
      const rowsRaw = [];
      while (i < lines.length && /^\|/.test(lines[i])) rowsRaw.push(lines[i++]);
      const cells = (r) => r.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
      const head = cells(rowsRaw[0]);
      const body = rowsRaw.slice(2).map(cells);
      out.push(`<div class="tbl-wrap"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    if (/^> ?/.test(l)) {
      const buf = [];
      while (i < lines.length && /^> ?/.test(lines[i])) buf.push(lines[i++].replace(/^> ?/, ""));
      out.push(`<div class="callout">${md(buf.join("\n"))}</div>`);
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) buf.push(lines[i++].trim());
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return out.join("");
}

function parseQuiz(title, body, where) {
  const lines = body.split("\n");
  let code = "";
  const opts = [];
  let a = -1;
  const why = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^```/.test(l)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      code = buf.join("\n");
      continue;
    }
    const m = /^- (\[x\] )?(.*)$/.exec(l);
    if (m) {
      if (m[1]) { if (a !== -1) throw new Error(`${where}: два верных ответа в «${title}»`); a = opts.length; }
      opts.push(plain(m[2]));
      continue;
    }
    if (/^> ?/.test(l)) { why.push(l.replace(/^> ?/, "")); continue; }
    if (l.trim()) throw new Error(`${where}: непонятная строка в тесте «${title}»: ${l}`);
  }
  if (a === -1) throw new Error(`${where}: нет верного ответа ([x]) в «${title}»`);
  if (opts.length < 2 || opts.length > 4) throw new Error(`${where}: вариантов должно быть 2–4 в «${title}»`);
  if (!why.length) throw new Error(`${where}: нет объяснения (> …) в «${title}»`);
  return { q: plain(title), ...(code ? { code } : {}), opts, a, why: md(why.join("\n")) };
}

function parseFile(file) {
  const raw = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const where = path.basename(file);
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  if (!fm) throw new Error(`${where}: нет шапки --- … ---`);
  const meta = {};
  for (const line of fm[1].split("\n")) {
    const m = /^(\w+):\s*(.*)$/.exec(line);
    if (m) meta[m[1]] = m[2].trim();
  }
  for (const k of ["id", "title", "group", "summary"]) if (!meta[k]) throw new Error(`${where}: в шапке нет ${k}`);
  if (!["sql", "plsql"].includes(meta.group)) throw new Error(`${where}: group должен быть sql или plsql`);

  const rest = raw.slice(fm[0].length);
  const chunks = rest.split(/^## /m).slice(1);
  const topic = {
    id: meta.id, title: meta.title, group: meta.group, summary: meta.summary,
    lessons: meta.lessons ? meta.lessons.split(/[,\s]+/).filter(Boolean) : [],
    sections: [], qa: [], quiz: [],
  };
  for (const ch of chunks) {
    const nl = ch.indexOf("\n");
    const head = (nl === -1 ? ch : ch.slice(0, nl)).trim();
    const body = nl === -1 ? "" : ch.slice(nl + 1);
    if (head.startsWith("? ")) topic.qa.push({ q: plain(head.slice(2)), a: md(body) });
    else if (/^Тест:/.test(head)) topic.quiz.push(parseQuiz(head.replace(/^Тест:\s*/, ""), body.trim(), where));
    else topic.sections.push({ h: plain(head), html: md(body) });
  }
  if (!topic.sections.length) throw new Error(`${where}: нет ни одного раздела теории`);
  return topic;
}

const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".md")).sort();
const topics = files.map((f) => parseFile(path.join(srcDir, f)));
const ids = new Set();
for (const t of topics) {
  if (ids.has(t.id)) throw new Error(`повторяется id темы: ${t.id}`);
  ids.add(t.id);
}
fs.writeFileSync(outFile, JSON.stringify({ topics }, null, 1) + "\n");
const n = (k) => topics.reduce((s, t) => s + t[k].length, 0);
console.log(`theory.json: ${topics.length} тем, ${n("sections")} разделов, ${n("qa")} вопросов с ответами, ${n("quiz")} тестовых вопросов`);
