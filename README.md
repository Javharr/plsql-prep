# PL/SQL: подготовка

Учебник и тренажёр для подготовки к позиции PL/SQL developer: теория по шагам, задачи на учебной схеме и тест с разбором ошибок.

Запросы выполняются в своём клиенте (DataGrip) на локальной Oracle 23ai Free — сайт базу не трогает.

## Локальный запуск

```bash
npm install
npm start
# http://localhost:3000
```

## Деплой на Railway

1. Запушить репозиторий на GitHub.
2. Railway → New Project → Deploy from GitHub repo → выбрать этот репозиторий.
3. Ничего настраивать не нужно: Railway сам увидит `package.json`, выполнит `npm install` и запустит `npm start`. Порт берётся из переменной `PORT`.
4. Settings → Networking → Generate Domain, чтобы получить публичный адрес.

Проверка живости: `GET /healthz` отвечает `ok`.

## Структура

```
server.js                      — express, отдаёт public/
public/index.html              — каркас страницы
public/styles.css              — стили, светлая и тёмная темы
public/app.js                  — роутер, уроки, тест, схема
public/content/lessons.json    — уроки и шаги: теория, примеры, задачи, решения
public/content/questions.json  — банк вопросов для теста
```

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

`status` — `done`, `current` или `next`. Отметка «пройдено» и результаты теста хранятся в `localStorage` браузера, то есть отдельно на каждом устройстве.

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
