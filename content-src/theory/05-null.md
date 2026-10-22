---
id: null
title: NULL и трёхзначная логика
group: sql
summary: Почему NULL не равен NULL, как NULL ведёт себя в условиях, выражениях, сортировке и NOT IN, и функции NVL, NVL2, COALESCE, NULLIF.
lessons: l01, l02, l03
---

## NULL — это «неизвестно», а не ноль

`NULL` означает отсутствие значения: «неизвестно» или «не применимо». Это не ноль, не пустая строка и не пробел. Главное правило: **любое сравнение с NULL даёт не TRUE и не FALSE, а UNKNOWN**.

```sql
SELECT * FROM employees WHERE commission_pct = NULL;   -- 0 строк, всегда
SELECT * FROM employees WHERE commission_pct IS NULL;  -- так правильно
```

`WHERE` пропускает только строки, где условие TRUE. UNKNOWN отбрасывается так же, как FALSE. Поэтому `= NULL` и `<> NULL` никогда не находят ничего.

> **Особенность Oracle:** пустая строка `''` в Oracle **и есть NULL**. `WHERE name = ''` не найдёт ничего, а `LENGTH('')` вернёт NULL, а не 0. В PostgreSQL и SQL Server это не так.

## Трёхзначная логика

| A | B | A AND B | A OR B |
|---|---|---|---|
| TRUE | UNKNOWN | UNKNOWN | TRUE |
| FALSE | UNKNOWN | FALSE | UNKNOWN |
| UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |

`NOT UNKNOWN` = UNKNOWN. Из-за этого `WHERE NOT (salary > 5000)` не вернёт строки, где salary NULL: они не попадают ни в условие, ни в его отрицание.

## NULL в выражениях

Почти любое выражение с NULL даёт NULL:

- `salary + NULL` → NULL, `salary * commission_pct` → NULL у тех, у кого нет комиссии;
- `NULL / 0` → NULL (а не ошибка деления на ноль).

Исключения: **конкатенация** в Oracle игнорирует NULL (`'a' || NULL || 'b'` = `'ab'`), а агрегаты пропускают NULL (`SUM`, `AVG`, `COUNT(col)`).

```sql
SELECT last_name, salary + salary * commission_pct AS total    -- NULL у большинства
     , salary + salary * NVL(commission_pct, 0) AS total_ok
  FROM employees;
```

## Функции для работы с NULL

| Функция | Результат |
|---|---|
| `NVL(a, b)` | a, если a не NULL, иначе b |
| `NVL2(a, b, c)` | b, если a **не** NULL, иначе c |
| `COALESCE(a, b, c, …)` | первый не NULL аргумент |
| `NULLIF(a, b)` | NULL, если a = b, иначе a |
| `LNNVL(условие)` | TRUE, если условие FALSE **или UNKNOWN** |

Разница `NVL` и `COALESCE`: `COALESCE` — стандарт SQL, принимает много аргументов и вычисляет их **лениво** (до первого не NULL). `NVL` всегда вычисляет оба аргумента и приводит второй к типу первого. Если второй аргумент — дорогая функция, `COALESCE` быстрее.

`NULLIF` удобна против деления на ноль: `amount / NULLIF(qty, 0)` даст NULL вместо ORA-01476.

## NULL в DISTINCT, GROUP BY, ORDER BY, UNIQUE

Здесь NULL ведут себя как **одинаковые**:

- `DISTINCT` оставит одну строку NULL;
- `GROUP BY` соберёт все NULL в одну группу;
- `UNION` уберёт дубли-NULL;
- `DECODE(x, NULL, 'пусто', …)` считает NULL равным NULL — в отличие от `CASE x WHEN NULL`, который никогда не срабатывает.

В сортировке Oracle считает NULL **больше любого значения**: при `ORDER BY ASC` они в конце, при `DESC` — в начале. Явно: `NULLS FIRST` / `NULLS LAST`.

## Ловушка NOT IN

Самая коварная ловушка с NULL:

```sql
SELECT * FROM departments
 WHERE department_id NOT IN (SELECT department_id FROM employees);
```

Если среди `employees.department_id` есть хоть один NULL, запрос вернёт **0 строк**. Почему: `x NOT IN (1, 2, NULL)` = `x <> 1 AND x <> 2 AND x <> NULL`, последнее — UNKNOWN, и всё условие не бывает TRUE.

Решения: `NOT EXISTS` (не страдает от NULL) или отфильтровать NULL в подзапросе `WHERE department_id IS NOT NULL`. `IN` такой проблемы не имеет: для IN NULL в списке просто ничего не находит.

## ? Чему равно NULL = NULL?

UNKNOWN — не TRUE и не FALSE. Поэтому `WHERE col = NULL` не вернёт ни одной строки. Проверять нужно `IS NULL` / `IS NOT NULL`. При этом DISTINCT, GROUP BY, UNION и DECODE считают NULL одинаковыми — это отдельные правила, а не сравнение через `=`.

## ? Почему NOT IN с подзапросом может вернуть 0 строк?

Если подзапрос вернул хотя бы один NULL, то `x NOT IN (…, NULL)` разворачивается в цепочку `AND x <> …`, где `x <> NULL` = UNKNOWN. Всё условие никогда не TRUE — результат пустой. Лечится `NOT EXISTS` или фильтром `IS NOT NULL` в подзапросе.

## ? Чем NVL отличается от COALESCE?

NVL — функция Oracle на два аргумента: всегда вычисляет оба и приводит второй к типу первого. COALESCE — стандарт SQL, принимает любое число аргументов, возвращает первый не NULL и вычисляет аргументы лениво. Плюс NVL2(a, b, c): b, если a не NULL, иначе c.

## ? Пустая строка и NULL — это одно и то же?

В Oracle — да: `''` хранится и обрабатывается как NULL. `WHERE s = ''` ничего не найдёт, `LENGTH('')` вернёт NULL, вставка `''` в NOT NULL-столбец даст ORA-01400. В других СУБД пустая строка — обычное значение, это частый источник ошибок при переносе.

## ? Как NULL ведут себя при сортировке?

В Oracle NULL считается больше любого значения: при ASC они в конце, при DESC в начале. Порядок можно задать явно: `ORDER BY commission_pct DESC NULLS LAST`.

## ? Что вернёт salary + commission_pct, если commission_pct NULL?

NULL — арифметика с NULL даёт NULL. Нужно подставить значение по умолчанию: `salary + NVL(commission_pct, 0)`. Исключение — конкатенация: `'a' || NULL` = `'a'`.

## Тест: Сколько строк вернёт SELECT * FROM employees WHERE commission_pct = NULL, если у 17 сотрудников комиссии нет?
- 17
- [x] 0
- Все строки
- Ошибку
> `= NULL` даёт UNKNOWN для каждой строки, а WHERE пропускает только TRUE. Правильно — `IS NULL`.

## Тест: Что вернёт SELECT 'x' || NULL || 'y' FROM dual?
- NULL
- [x] 'xy'
- 'xNULLy'
- Ошибку
> В Oracle конкатенация пропускает NULL. Это исключение — арифметика с NULL дала бы NULL.

## Тест: Подзапрос вернул (10, 20, NULL). Что даст условие 30 NOT IN (подзапрос)?
- TRUE
- FALSE
- [x] UNKNOWN — строка не попадёт в результат
- Ошибку ORA-01427
> `30 <> 10 AND 30 <> 20 AND 30 <> NULL` → `TRUE AND TRUE AND UNKNOWN` = UNKNOWN. Один NULL ломает весь NOT IN.

## Тест: Что вернёт NVL2(commission_pct, 'есть', 'нет') для сотрудника с комиссией 0.2?
- 0.2
- [x] 'есть'
- 'нет'
- NULL
> NVL2(a, b, c) возвращает b, если a **не** NULL, и c, если NULL.

## Тест: Где окажутся строки с NULL при ORDER BY commission_pct (по возрастанию) в Oracle?
- В начале
- [x] В конце
- Порядок не определён
- Они не попадут в результат
> Oracle считает NULL больше любого значения: ASC — в конце, DESC — в начале. Поменять — `NULLS FIRST` / `NULLS LAST`.

## Тест: Что вернёт CASE commission_pct WHEN NULL THEN 'нет' ELSE 'есть' END для строки с NULL?
- 'нет'
- [x] 'есть'
- NULL
- Ошибку
> Простой CASE сравнивает через `=`, а `NULL = NULL` — UNKNOWN, ветка не срабатывает. Нужно `CASE WHEN commission_pct IS NULL THEN …`. (DECODE, наоборот, считает NULL равными.)

## Тест: Как безопасно поделить amount на qty, если qty может быть 0?
- amount / NVL(qty, 0)
- [x] amount / NULLIF(qty, 0)
- amount / COALESCE(qty, 1)
- amount / DECODE(qty, NULL, 1)
> NULLIF(qty, 0) превращает ноль в NULL, а деление на NULL даёт NULL вместо ORA-01476. Вариант с COALESCE спасает от NULL, но не от нуля.

## Тест: Чему в Oracle равно LENGTH('')?
- 0
- [x] NULL
- 1
- Ошибка
> Пустая строка в Oracle — это NULL, а функция от NULL возвращает NULL.
