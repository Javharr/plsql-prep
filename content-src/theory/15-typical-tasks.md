---
id: typical-tasks
title: Типовые задачи с собеседований
group: sql
summary: N-я по величине зарплата, дубликаты и их удаление, топ-N в группе, пропуски в нумерации, сравнение с предыдущей строкой, разворот строк в столбцы — решения в нескольких вариантах.
lessons: l07, l11
---

## N-я по величине зарплата

Самая частая задача. Вторая по величине (разных значений):

```sql
-- 1. аналитика: работает для любого N
SELECT DISTINCT salary
  FROM (SELECT salary, DENSE_RANK() OVER (ORDER BY salary DESC) AS rn FROM employees)
 WHERE rn = 2;

-- 2. подзапрос: только для второй
SELECT MAX(salary) FROM employees
 WHERE salary < (SELECT MAX(salary) FROM employees);

-- 3. OFFSET/FETCH (12c+)
SELECT DISTINCT salary FROM employees
 ORDER BY salary DESC
OFFSET 1 ROWS FETCH NEXT 1 ROWS ONLY;
```

Что спросят дальше: почему `DENSE_RANK`, а не `ROW_NUMBER` (при двух одинаковых максимумах ROW_NUMBER вернёт снова максимум); что если второй зарплаты нет (вариант 2 вернёт NULL, остальные — 0 строк). Для «вторая в каждом отделе» — добавить `PARTITION BY department_id`.

## Найти и удалить дубликаты

Найти значения, которые встречаются больше одного раза:

```sql
SELECT email, COUNT(*) FROM customers GROUP BY email HAVING COUNT(*) > 1;
```

Вывести все строки-дубли целиком:

```sql
SELECT * FROM (
  SELECT c.*, COUNT(*) OVER (PARTITION BY email) AS cnt FROM customers c
) WHERE cnt > 1;
```

Удалить дубли, оставив одну строку из каждой группы (с минимальным id или ROWID):

```sql
DELETE FROM customers
 WHERE ROWID IN (
   SELECT rid FROM (
     SELECT ROWID AS rid,
            ROW_NUMBER() OVER (PARTITION BY email ORDER BY cust_id) AS rn
       FROM customers)
    WHERE rn > 1);

-- классический вариант без аналитики
DELETE FROM customers c
 WHERE ROWID > (SELECT MIN(ROWID) FROM customers c2 WHERE c2.email = c.email);
```

После чистки — повесить `UNIQUE`, чтобы дубли не вернулись.

## Топ-N и «последняя запись» в группе

Последний заказ каждого клиента:

```sql
SELECT * FROM (
  SELECT o.*, ROW_NUMBER() OVER (PARTITION BY cust_id ORDER BY order_date DESC, order_id DESC) AS rn
    FROM orders o)
 WHERE rn = 1;
```

Вариант с агрегатом Oracle — `MAX(amount) KEEP (DENSE_RANK LAST ORDER BY order_date)` — значение из строки с последней датой без подзапроса.

## Сравнение с предыдущей строкой

Изменение продаж к прошлому месяцу:

```sql
SELECT mon, total,
       total - LAG(total) OVER (ORDER BY mon) AS diff,
       ROUND(100 * (total / LAG(total) OVER (ORDER BY mon) - 1), 1) AS pct
  FROM monthly_sales;
```

Без аналитики пришлось бы соединять таблицу саму с собой по `mon = ADD_MONTHS(prev.mon, 1)`.

## Пропуски и непрерывные отрезки

Найти пропущенные номера в последовательности id:

```sql
SELECT id + 1 AS gap_start, next_id - 1 AS gap_end
  FROM (SELECT id, LEAD(id) OVER (ORDER BY id) AS next_id FROM orders)
 WHERE next_id - id > 1;
```

Найти непрерывные отрезки (например, дни подряд с входом пользователя) — приём «gaps and islands»: у дней подряд разность `дата - ROW_NUMBER()` одинакова:

```sql
SELECT user_id, MIN(d) AS from_d, MAX(d) AS to_d, COUNT(*) AS days
  FROM (SELECT user_id, d, d - ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY d) AS grp
          FROM logins)
 GROUP BY user_id, grp;
```

## Строки в столбцы и обратно (PIVOT)

Количество сотрудников по отделам и должностям — должности в столбцы:

```sql
-- условная агрегация: работает везде
SELECT department_id,
       COUNT(CASE WHEN job_id = 'IT_PROG'  THEN 1 END) AS it_prog,
       COUNT(CASE WHEN job_id = 'SA_REP'   THEN 1 END) AS sa_rep
  FROM employees GROUP BY department_id;

-- PIVOT в Oracle
SELECT * FROM (SELECT department_id, job_id FROM employees)
 PIVOT (COUNT(*) FOR job_id IN ('IT_PROG' AS it_prog, 'SA_REP' AS sa_rep));
```

`UNPIVOT` делает обратное. Собрать значения группы в одну строку — `LISTAGG(last_name, ', ') WITHIN GROUP (ORDER BY last_name)`.

## ? Как найти вторую по величине зарплату?

Через аналитику: `DENSE_RANK() OVER (ORDER BY salary DESC)` в подзапросе и `WHERE rn = 2` — работает для любого N. Через подзапрос: `MAX(salary) WHERE salary < (SELECT MAX(salary) …)` — только для второй. Через `ORDER BY … OFFSET 1 ROWS FETCH NEXT 1 ROWS ONLY` по DISTINCT зарплатам. DENSE_RANK, а не ROW_NUMBER, — чтобы одинаковые максимумы не считались разными местами.

## ? Как удалить дубликаты, оставив по одной строке?

Пронумеровать строки внутри группы дублей `ROW_NUMBER() OVER (PARTITION BY ключ ORDER BY id)` и удалить по ROWID все, где номер больше 1. Или классически: `DELETE … WHERE ROWID > (SELECT MIN(ROWID) … с тем же ключом)`. После — добавить UNIQUE, чтобы не повторилось.

## ? Как вывести последнюю запись для каждого клиента?

`ROW_NUMBER() OVER (PARTITION BY cust_id ORDER BY order_date DESC)` во вложенном запросе и `rn = 1` снаружи. В ORDER BY добавить уникальный столбец, чтобы при одинаковых датах результат был стабильным. Вариант без подзапроса — агрегат `KEEP (DENSE_RANK LAST ORDER BY order_date)`.

## ? Как найти пропущенные id в таблице?

`LEAD(id) OVER (ORDER BY id)` даёт следующий существующий id; где разница больше 1, — пропуск от id + 1 до next_id − 1. Другой вариант — сгенерировать полный ряд чисел (CONNECT BY LEVEL) и MINUS существующие id.

## ? Как превратить строки в столбцы?

Условной агрегацией: `SUM(CASE WHEN категория = 'A' THEN сумма END) AS a, …` с GROUP BY — работает в любой СУБД. В Oracle есть PIVOT, но список значений-столбцов в нём задаётся заранее. Обратная операция — UNPIVOT. Склеить значения группы в строку — LISTAGG.

## ? Как посчитать изменение по сравнению с прошлым периодом?

LAG: `value - LAG(value) OVER (ORDER BY period)`. Для каждой группы отдельно — PARTITION BY. Если периоды могут пропускаться, сначала достроить календарь (генерация дат + LEFT JOIN), иначе LAG возьмёт не прошлый месяц, а предыдущую имеющуюся строку.

## Тест: Зарплаты: 24000, 24000, 17000, 14000. Что вернёт запрос с ROW_NUMBER() OVER (ORDER BY salary DESC) и rn = 2?
- 17000
- [x] 24000
- 14000
- Ничего
> ROW_NUMBER нумерует строки, а не значения: вторая строка — тоже 24000. Для «второй по величине» нужен DENSE_RANK.

## Тест: Что вернёт SELECT MAX(salary) FROM employees WHERE salary < (SELECT MAX(salary) FROM employees), если у всех одинаковая зарплата?
- Эту зарплату
- [x] NULL
- Ноль строк
- Ошибку
> Под условие не попадает ни одна строка, а MAX по пустому набору — одна строка с NULL.

## Тест: Какое условие выберет дубли для удаления, оставив строку с минимальным ROWID?
- ROWID = (SELECT MIN(ROWID) … с тем же email)
- [x] ROWID > (SELECT MIN(ROWID) … с тем же email)
- ROWID < (SELECT MAX(ROWID) … с тем же email) OR ROWID IS NULL
- COUNT(*) > 1
> Удаляем всё, что «больше минимального» в своей группе, — остаётся ровно одна строка с минимальным ROWID.

## Тест: Как вывести только значения email, которые встречаются больше одного раза?
- WHERE COUNT(*) > 1
- [x] GROUP BY email HAVING COUNT(*) > 1
- SELECT DISTINCT email
- ORDER BY email
> Условие по количеству в группе — это HAVING. В WHERE агрегаты запрещены.

## Тест: Какая функция склеит фамилии сотрудников отдела в одну строку через запятую?
- CONCAT
- WM_CONCAT
- [x] LISTAGG
- PIVOT
> `LISTAGG(last_name, ', ') WITHIN GROUP (ORDER BY last_name)` с GROUP BY department_id. WM_CONCAT — недокументированная функция, в 12c её убрали.

## Тест: Даты входа: 1, 2, 3, 7, 8 марта. Сколько «островов» (отрезков подряд) найдёт приём d - ROW_NUMBER()?
- 1
- [x] 2
- 3
- 5
> Разности: 1−1, 2−2, 3−3 одинаковые (отрезок 1–3), 7−4, 8−5 одинаковые (отрезок 7–8). Два острова.
