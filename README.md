# PL/SQL Prep

An interactive course and trainer I built to prepare for PL/SQL developer interviews: step-by-step theory, tasks that run against a real Oracle database with server-side auto-checks, spaced repetition and an interview simulator.

> Course content is in Russian. Access is invite-only, so this repository is the code.

## Highlights

- **26 lessons, 204 steps** — from `SELECT` and `NULL` to cursors, packages, `BULK COLLECT`, triggers, mutating tables, dynamic SQL and execution plans.
- **202 auto-checked tasks** — the editor runs SQL and PL/SQL in Oracle Autonomous Database; answers are compared with reference solutions stored on the server by result rows, `DBMS_OUTPUT` or a verify query, with per-lesson sandbox tables.
- **349 questions** — 254 lesson quizzes, 45 SQL and 50 PL/SQL interview questions, including 25 oral flash cards.
- **Interview theory** — 27 topics (normalization, ACID, isolation levels, indexes, cursors, exceptions, packages, triggers, collections, BULK, dynamic SQL, performance…): explanation with examples, 168 interview questions with answers and 196 multiple-choice questions with explanations.
- **Learning tools** — spaced repetition (1 / 3 / 7 / 14 / 30 days), timed interview mode with a per-topic breakdown, a 112-entry Oracle cheatsheet, ⌘K search, activity calendar and daily goal.
- **Security** — bcrypt passwords, hashed session tokens in httpOnly cookies, JSON-only writes against CSRF, login rate limiting; SQL runs with a 20 s timeout, 500-row and 30-runs-per-minute limits.

## Stack

Node.js · Express · PostgreSQL (users, progress) · Oracle Autonomous Database via node-oracledb thin mode (mTLS wallet) · vanilla JS · CodeMirror 5 · Railway

## Lessons

SELECT, WHERE и NULL · Функции Oracle · Преобразования и условия · Сортировка и ограничение строк · Агрегаты и группировка · Соединения таблиц · Подзапросы · Операции над множествами · DML и транзакции · DDL · Аналитические функции · Иерархические запросы · PL/SQL: анатомия блока · Ветвления и циклы · Курсоры I–II · Исключения · Процедуры и функции · Пакеты · Записи и коллекции · BULK COLLECT и FORALL · Триггеры · Мутирующие таблицы и автономные транзакции · Динамический SQL · Эксплуатация и словарь данных · Планы выполнения и производительность

---

## Документация (RU)

Учебник и тренажёр для подготовки к позиции PL/SQL developer: теория по шагам, задачи на учебной схеме и тест с разбором ошибок.

Вход по логину и паролю, прогресс хранится в Postgres и одинаков на всех устройствах.
Запросы пока выполняются в своём клиенте (DataGrip) на локальной Oracle 23ai Free.

## Деплой на Railway

1. Запушить репозиторий на GitHub.
2. Railway → **New Project → Deploy from GitHub repo** → выбрать этот репозиторий.
3. В том же проекте: **+ Create → Database → PostgreSQL**.
4. В сервисе сайта → **Variables** добавить:

   | Переменная | Значение |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` — выбрать из подсказки, это ссылка на базу внутри Railway |
   | `SIGNUP_CODE` | любая длинная строка, которую знаешь только ты — код для регистрации |

5. **Settings → Networking → Generate Domain** — получить адрес сайта.
6. Открыть сайт → «Нет аккаунта — зарегистрироваться» → логин, пароль, код из `SIGNUP_CODE`.

Таблицы в базе создаются сами при старте. После регистрации `SIGNUP_CODE` можно удалить — регистрация закроется, вход продолжит работать.

## Выполнение SQL: Oracle Autonomous Database

Редактор на странице шага выполняет запросы в Oracle Autonomous Database (Always Free) через node-oracledb в thin-режиме, по mTLS с wallet. Без этих переменных сайт работает, просто без редактора.

| Переменная | Что это |
|---|---|
| `ORACLE_USER` | пользователь базы (у нас `plsql`) |
| `ORACLE_PASSWORD` | его пароль |
| `ORACLE_TNS_ALIAS` | имя сервиса из `tnsnames.ora`, например `<dbname>_low` |
| `ORACLE_WALLET_PASSWORD` | пароль, заданный при скачивании wallet |
| `ORACLE_WALLET_PEM_B64` | `ewallet.pem` в base64 |
| `ORACLE_TNSNAMES_B64` | `tnsnames.ora` в base64 |

Два base64-значения удобно положить сразу в буфер обмена (содержимое не появится на экране):

```bash
cd ~/oracle-wallet/plsqlprep && {
  echo "ORACLE_WALLET_PEM_B64=$(base64 -i ewallet.pem | tr -d '\n')"
  echo "ORACLE_TNSNAMES_B64=$(base64 -i tnsnames.ora | tr -d '\n')"
} | pbcopy
```

и вставить в Railway → Variables → **Raw Editor**. Wallet никогда не кладётся в репозиторий.

Ограничения: одна команда за запуск (или один PL/SQL-блок), таймаут 20 секунд, до 500 строк в результате, не больше 30 запусков в минуту. Каждая команда коммитится сразу (autocommit).

Автопроверка: у шага в `lessons.json` есть поле `check`, эталоны берутся только с сервера. Три режима:

| `check.mode` | Для чего | Как проверяется |
|---|---|---|
| `rows` (по умолчанию) | SELECT | эталонный `check.sql` и запрос ученика сравниваются по числу столбцов и строкам (без учёта порядка, если `ordered: false`) |
| `output` | анонимные PL/SQL-блоки | выполняются блок ученика и эталонный блок `check.sql`, сравнивается вывод DBMS_OUTPUT |
| `verify` | CREATE, DDL, DML, триггеры, пакеты | выполняется команда ученика, затем `check.verify`, результат сравнивается с `check.expect`; `reset: true` — перед этим выполнить `setup` урока |

У урока может быть `setup` — PL/SQL-блок, который (пере)создаёт таблицы-песочницы (кнопка «Подготовить таблицы урока», `POST /api/sql/setup`), и `cleanup` — для прогона проверок. Базовые учебные таблицы уроки не меняют: DML только по песочницам или внутри блока с ROLLBACK.

Для локальной разработки вместо wallet можно задать `ORACLE_CONNECT_STRING=host:1521/FREEPDB1` (плюс `ORACLE_USER`, `ORACLE_PASSWORD`).

Проверка живости: `GET /healthz` отвечает `ok`.

## Локальный запуск

Нужен Postgres. Например, в Docker:

```bash
docker run -d --name plsql-pg -e POSTGRES_PASSWORD=pg -p 5432:5432 postgres:16
npm install
DATABASE_URL=postgres://postgres:pg@localhost:5432/postgres SIGNUP_CODE=local npm start
# http://localhost:3000
```

## Как устроено

```
server.js                      — express: статика, вход, API прогресса и SQL
db.js                          — подключение к Postgres и создание таблиц
oracle.js                      — выполнение SQL/PL/SQL в Oracle и автопроверка задач
public/index.html              — каркас страницы
public/css/app.css             — стили: тёмная тема по умолчанию, светлая по настройке системы
public/js/app.js               — вход, главная, шаги (теория слева, редактор справа), консоль, тест, схема
public/content/lessons.json    — уроки и шаги: теория, примеры, задачи, решения
public/content/questions.json  — банк вопросов для теста
public/content/cheatsheet.json — шпаргалка: функции и конструкции Oracle (генерируется, можно править руками)
public/content/theory.json     — раздел «Теория» (собирается из content-src/theory/*.md, руками не править)
content-src/theory/*.md        — исходники тем теории
scripts/build-theory.mjs       — сборка theory.json
```

API:

| Метод | Адрес | Что делает |
|---|---|---|
| POST | `/api/register` | регистрация по коду `SIGNUP_CODE` |
| POST | `/api/login` | вход; не больше 10 неудачных попыток за 15 минут с одного IP |
| POST | `/api/logout` | выход |
| GET | `/api/me` | кто вошёл |
| GET / PUT | `/api/progress` | прочитать / сохранить прогресс |
| GET | `/api/sql/status` | подключена ли Oracle |
| GET | `/api/sql/schema` | таблицы и столбцы схемы — для боковой панели консоли |
| POST | `/api/sql/run` | выполнить запрос или PL/SQL-блок |
| POST | `/api/sql/check` | проверить решение шага по эталону |
| POST | `/api/sql/setup` | подготовить таблицы-песочницы урока |

Редактор — CodeMirror 5 (режим `text/x-plsql`), отдаётся с этого же сервера из `node_modules` по адресу `/vendor/codemirror`.

Безопасность: пароли хранятся как bcrypt-хэш; сессия — случайный токен в httpOnly-куке, в базе лежит только его SHA-256; запись в API принимается только как JSON, что вместе с `SameSite=Lax` закрывает CSRF.

## Разделы и инструменты

- **Главная** — дашборд: серия дней, цель на день, календарь активности, слабые темы, готовность к собеседованию.
- **Уроки** — шаги с теорией и задачей, редактор с автопроверкой.
- **Теория** — темы собеседования: объяснение с примерами, вопросы с ответами (раскрываются или тренируются карточками) и тест с вариантами. Вопросы теории попадают в общий банк: их видят «Тест», «Собеседование» и «Повторение».
- **Повторение** — интервальное: ошибка возвращается через 1 день, верные ответы — через 3, 7, 14, 30 дней.
- **Тест** — разделы «По урокам», «Собес · SQL», «Собес · PL/SQL», тренировка по темам. Клавиши 1–4 / A–D, Enter.
- **Собеседование** — случайные вопросы на время; после каждого ответа — правильный вариант и объяснение, в конце итог с оценкой по темам и список ошибок, история попыток.
- **Шпаргалка** — справочник функций с примерами на учебной схеме, кнопка «В консоль».
- **Поиск** — ⌘K / Ctrl+K или `/`: разделы, шпаргалка, шаги уроков, вопросы.
- Тема: как в системе, тёмная или светлая (переключатель внизу меню).

Ключи прогресса: `s:<шаг>`, `q:<вопрос>` (ok/bad), `r:<вопрос>` ({b: ступень, d: дата повторения}), `act` (действий по дням), `goal`, `iv:hist`, `iv:cfg`, `t:<тема>` (read — тема прочитана), `quiz:section`, `sql:<шаг>`, `console:*`.

## Как добавить материал

Новый шаг урока — объект в `steps` внутри нужного урока в `lessons.json`:

```json
{
  "id": "l02s11",
  "title": "TO_CHAR для чисел",
  "status": "next",
  "theory": "<p>…</p>",
  "examples": [{ "sql": "TO_CHAR(1234.5, '9G999D99')", "out": "1 234,50" }],
  "task": "…",
  "solution": "SELECT …",
  "mistakes": ["…"]
}
```

`status` — `done`, `current` или `next`. Отметки «пройдено» и результаты теста хранятся на сервере под логином.

Новый вопрос теста — объект в `questions.json`:

```json
{
  "id": "уникальный-id",
  "topic": "Строки",
  "q": "Текст вопроса",
  "code": "SELECT … (необязательно)",
  "opts": ["верный", "неверный", "неверный", "неверный"],
  "a": 0,
  "why": "Разбор: почему так и где тут ловушка."
}
```

`a` — индекс правильного ответа в `opts`. Варианты на экране перемешиваются, поэтому верный можно держать первым.

Поле `section` раскладывает вопросы по разделам теста: `lessons` (по урокам, по умолчанию), `sql` и `plsql` (вопросы собеседования).

Устный вопрос — карточка: вопрос, кнопка «Показать ответ», затем самооценка «Знал / Не знал». Ответ — HTML (`<b>`, `<code>`, `<br>`).

```json
{ "id": "card-…", "type": "card", "section": "plsql", "topic": "Курсоры", "q": "Вопрос", "answer": "Ответ" }
```

### Тема теории

Файл `content-src/theory/NN-имя.md` (номер задаёт порядок), после правки — `node scripts/build-theory.mjs`:

````md
---
id: normalization
title: Нормализация
group: sql              # sql или plsql
summary: Одна строка о теме
lessons: l10            # связанные уроки, необязательно
---

## Заголовок раздела теории
Текст в markdown: абзацы, списки, ```sql-блоки, таблицы, `код`, **жирный**, > выноска.

## ? Вопрос с собеседования
Ответ в markdown.

## Тест: Текст вопроса с вариантами
- неверный
- [x] верный
- неверный
> Объяснение, почему так.
````

Id вопросов строятся по порядку (`th-<тема>-q1`, `th-<тема>-c1`), поэтому новые вопросы лучше дописывать в конец темы — иначе сдвинется прогресс по уже отвеченным.
