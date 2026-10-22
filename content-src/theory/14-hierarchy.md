---
id: hierarchy
title: Иерархические запросы
group: sql
summary: Деревья в таблице: CONNECT BY PRIOR, START WITH, LEVEL, SYS_CONNECT_BY_PATH, циклы, и то же самое через рекурсивный WITH.
lessons: l12
---

## Иерархия в таблице

Дерево обычно хранят как «список смежности»: у каждой строки есть ссылка на родителя. Например, `employees.manager_id` указывает на `employee_id` начальника, у директора `manager_id` = NULL. Так же устроены категории товаров, структура подразделений, комментарии с ответами.

Обычным JOIN можно пройти один уровень (сотрудник — начальник). Для всего дерева произвольной глубины нужен иерархический запрос.

## CONNECT BY — синтаксис Oracle

```sql
SELECT LEVEL, LPAD(' ', 2 * (LEVEL - 1)) || last_name AS tree, employee_id, manager_id
  FROM employees
 START WITH manager_id IS NULL               -- корень (или корни)
CONNECT BY PRIOR employee_id = manager_id    -- как перейти от родителя к ребёнку
 ORDER SIBLINGS BY last_name;                -- сортировка внутри одного уровня
```

- `START WITH` — с каких строк начать.
- `CONNECT BY PRIOR родитель = ребёнок` — `PRIOR` указывает на столбец **предыдущего** (уже найденного) уровня. `PRIOR employee_id = manager_id` — «ребёнок — тот, чей manager_id равен employee_id найденной строки», то есть обход **сверху вниз**.
- Поменять `PRIOR` местами — `CONNECT BY employee_id = PRIOR manager_id` — обход **снизу вверх**: от сотрудника к цепочке начальников.

## Псевдостолбцы и функции

| Что | Значение |
|---|---|
| `LEVEL` | глубина: корень — 1 |
| `CONNECT_BY_ISLEAF` | 1, если у строки нет детей |
| `CONNECT_BY_ROOT col` | значение столбца у корня текущей ветки |
| `SYS_CONNECT_BY_PATH(col, '/')` | путь от корня: `/King/Kochhar/Greenberg` |
| `CONNECT_BY_ISCYCLE` | 1, если строка замыкает цикл (вместе с `NOCYCLE`) |
| `ORDER SIBLINGS BY` | сортировка детей одного родителя, не ломая дерево |

Где фильтровать: условие в `WHERE` отбрасывает строки **после** построения дерева (их дети остаются, если сами подходят). Условие в `CONNECT BY` обрезает **ветку целиком** — дальше по ней обход не идёт.

```sql
-- не дальше 3 уровня
... CONNECT BY PRIOR employee_id = manager_id AND LEVEL <= 3
```

## Циклы

Если данные содержат цикл (A подчиняется B, B подчиняется A), запрос упадёт с `ORA-01436: CONNECT BY loop in user data`. Решение — `CONNECT BY NOCYCLE …`: Oracle остановится перед повтором, а `CONNECT_BY_ISCYCLE = 1` покажет, где цикл.

## Генерация строк

`CONNECT BY` без связи между строками — популярный трюк для генерации последовательности:

```sql
SELECT LEVEL AS n FROM dual CONNECT BY LEVEL <= 10;                         -- числа 1..10
SELECT DATE '2024-01-01' + LEVEL - 1 AS d FROM dual CONNECT BY LEVEL <= 31; -- дни января
```

Нужен, чтобы построить календарь и найти дни без продаж через LEFT JOIN.

## Рекурсивный WITH (стандарт SQL)

Работает во всех современных СУБД, в Oracle с 11gR2:

```sql
WITH tree (employee_id, last_name, manager_id, lvl) AS (
  SELECT employee_id, last_name, manager_id, 1          -- якорь: корень
    FROM employees WHERE manager_id IS NULL
  UNION ALL
  SELECT e.employee_id, e.last_name, e.manager_id, t.lvl + 1   -- рекурсивная часть
    FROM employees e JOIN tree t ON e.manager_id = t.employee_id
)
SEARCH DEPTH FIRST BY last_name SET ord
CYCLE employee_id SET is_cycle TO 'Y' DEFAULT 'N'
SELECT * FROM tree ORDER BY ord;
```

- обязателен список столбцов после имени и `UNION ALL`;
- `SEARCH DEPTH FIRST` / `BREADTH FIRST` — порядок обхода;
- `CYCLE` — защита от циклов.

Рекурсивный WITH гибче (можно накапливать суммы по пути, соединять с другими таблицами на каждом шаге) и переносим; `CONNECT BY` короче и даёт готовые `SYS_CONNECT_BY_PATH`, `CONNECT_BY_ISLEAF`.

## ? Как в Oracle вывести дерево подчинённости сотрудников?

`START WITH manager_id IS NULL CONNECT BY PRIOR employee_id = manager_id`. LEVEL даёт глубину, отступ можно построить через LPAD, путь — SYS_CONNECT_BY_PATH, порядок детей — ORDER SIBLINGS BY. Альтернатива по стандарту — рекурсивный WITH с якорем (корни) и рекурсивной частью через UNION ALL.

## ? Что значит PRIOR и как поменять направление обхода?

PRIOR помечает столбец строки предыдущего уровня. `PRIOR employee_id = manager_id` — ищем тех, у кого начальник — найденная строка: обход вниз. `employee_id = PRIOR manager_id` — ищем начальника найденной строки: обход вверх, к корню.

## ? Чем отличается условие в WHERE от условия в CONNECT BY?

WHERE фильтрует строки уже построенного дерева: отброшенная строка исчезает, но её потомки остаются, если подходят. Условие в CONNECT BY ограничивает сам обход: ветка обрезается, и потомки не ищутся.

## ? Что делать, если в иерархии есть цикл?

Без защиты будет ORA-01436 CONNECT BY loop in user data. Добавить NOCYCLE: обход остановится перед повторной строкой, а CONNECT_BY_ISCYCLE = 1 покажет, на какой строке цикл. В рекурсивном WITH — предложение CYCLE.

## ? Как сгенерировать последовательность чисел или дат без таблицы?

`SELECT LEVEL FROM dual CONNECT BY LEVEL <= N` или рекурсивный WITH. Для дат — прибавлять LEVEL - 1 к начальной дате. Применяется для календаря отчёта, поиска пропусков, размножения строк.

## Тест: Какое условие CONNECT BY обходит дерево сверху вниз (от начальника к подчинённым)?
- [x] CONNECT BY PRIOR employee_id = manager_id
- CONNECT BY employee_id = PRIOR manager_id
- CONNECT BY PRIOR manager_id = manager_id
- CONNECT BY LEVEL = manager_id
> Ребёнок — тот, у кого manager_id равен employee_id найденной (PRIOR) строки. Это движение вниз.

## Тест: Какой LEVEL у корневой строки?
- 0
- [x] 1
- NULL
- Зависит от START WITH
> Нумерация уровней в CONNECT BY начинается с 1.

## Тест: Что вернёт SYS_CONNECT_BY_PATH(last_name, '/')?
- Имя корня ветки
- Количество уровней
- [x] Путь от корня до текущей строки, например /King/Kochhar
- Имя непосредственного родителя
> Функция склеивает значения по пути от корня. Корень ветки отдельно — CONNECT_BY_ROOT.

## Тест: Какая ошибка будет без NOCYCLE, если в данных есть цикл подчинения?
- ORA-01427
- [x] ORA-01436
- ORA-00060
- Запрос зациклится навсегда
> ORA-01436: CONNECT BY loop in user data. NOCYCLE останавливает обход перед повтором.

## Тест: Как отсортировать сотрудников по фамилии внутри каждого уровня, не разрушив дерево?
- ORDER BY last_name
- ORDER BY LEVEL, last_name
- [x] ORDER SIBLINGS BY last_name
- GROUP BY LEVEL
> Обычный ORDER BY перемешает строки и сломает структуру. ORDER SIBLINGS BY сортирует только детей одного родителя.

## Тест: Что вернёт SELECT LEVEL FROM dual CONNECT BY LEVEL <= 5?
- Одну строку со значением 5
- [x] Пять строк: 1, 2, 3, 4, 5
- Ошибку: в dual нет иерархии
- Бесконечную последовательность
> Классический генератор строк: условие связи всегда истинно до LEVEL = 5.

## Тест: Что обязательно в рекурсивном WITH?
- CONNECT BY в рекурсивной части
- [x] Список столбцов после имени CTE и UNION ALL между якорем и рекурсивной частью
- Предложение CYCLE
- ORDER SIBLINGS BY
> Рекурсивный подзапрос в Oracle требует список столбцов и UNION ALL. CYCLE и SEARCH — необязательны.
