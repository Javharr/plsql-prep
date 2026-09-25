# PL/SQL: подготовка

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
| `ORACLE_TNS_ALIAS` | имя сервиса из `tnsnames.ora`, например `smqi0y4a3hyldpa0_low` |
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

Автопроверка: у шага в `lessons.json` есть поле `check` с эталонным запросом. Сервер выполняет эталон и запрос ученика и сравнивает строки: число столбцов, число строк и значения (без учёта порядка, если `ordered: false`). Эталон берётся только с сервера.

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

Редактор — CodeMirror 5 (режим `text/x-plsql`), отдаётся с этого же сервера из `node_modules` по адресу `/vendor/codemirror`.

Безопасность: пароли хранятся как bcrypt-хэш; сессия — случайный токен в httpOnly-куке, в базе лежит только его SHA-256; запись в API принимается только как JSON, что вместе с `SameSite=Lax` закрывает CSRF.

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
