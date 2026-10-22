---
id: bulk
title: BULK COLLECT и FORALL
group: plsql
summary: Массовая обработка данных: почему построчный цикл медленный, BULK COLLECT и LIMIT, FORALL, SAVE EXCEPTIONS и SQL%BULK_EXCEPTIONS, INDICES OF и VALUES OF.
lessons: l21
---

## Проблема: построчная обработка

```sql
FOR r IN (SELECT employee_id, salary FROM employees) LOOP
  UPDATE employees_hist SET salary = r.salary WHERE employee_id = r.employee_id;
END LOOP;
```

На каждую строку — отдельная SQL-команда и **переключение контекста** между PL/SQL и SQL движками. На миллионе строк это миллион переключений. Массовые операции решают проблему: данные переносятся **пачками** между движками за одно переключение.

> **Правило номер ноль:** если задачу можно решить одной SQL-командой (`UPDATE … WHERE`, `INSERT … SELECT`, `MERGE`) — так и нужно. BULK/FORALL — когда между чтением и записью нужна процедурная логика.

## BULK COLLECT — читать пачкой

Загружает весь результат запроса в коллекцию за одно обращение:

```sql
DECLARE
  TYPE t_ids  IS TABLE OF employees.employee_id%TYPE;
  TYPE t_sals IS TABLE OF employees.salary%TYPE;
  ids  t_ids;
  sals t_sals;
BEGIN
  SELECT employee_id, salary BULK COLLECT INTO ids, sals
    FROM employees WHERE department_id = 50;
  DBMS_OUTPUT.PUT_LINE('Загружено: ' || ids.COUNT);
END;
```

- Коллекции инициализировать не нужно — BULK COLLECT сделает это сам и заполнит с индекса 1.
- Если строк нет — **NO_DATA_FOUND не бросается**, коллекция просто пустая (`COUNT = 0`). Проверять надо `COUNT`, а не исключение.
- Работает также в `FETCH … BULK COLLECT INTO`, в `RETURNING … BULK COLLECT INTO` и в `EXECUTE IMMEDIATE … BULK COLLECT INTO`.

## LIMIT — не съесть всю память

BULK COLLECT без ограничения на таблице в 50 млн строк загрузит всё в PGA сессии. Для больших наборов читают порциями:

```sql
DECLARE
  CURSOR c IS SELECT employee_id, salary FROM big_table;
  TYPE t_rows IS TABLE OF c%ROWTYPE;
  rows t_rows;
BEGIN
  OPEN c;
  LOOP
    FETCH c BULK COLLECT INTO rows LIMIT 1000;
    EXIT WHEN rows.COUNT = 0;          -- не c%NOTFOUND!
    FOR i IN 1 .. rows.COUNT LOOP
      NULL;                            -- обработка
    END LOOP;
  END LOOP;
  CLOSE c;
END;
```

> **Ловушка:** `EXIT WHEN c%NOTFOUND` сразу после FETCH потеряет **последнюю неполную пачку**: если осталось 300 строк, FETCH их вернёт, но `%NOTFOUND` уже TRUE. Выходить по `rows.COUNT = 0` (или проверять `%NOTFOUND` в конце цикла, после обработки).

Обычный размер пачки — 100–1000: дальше выигрыш почти не растёт, а память — растёт.

## FORALL — писать пачкой

Отправляет одну DML-команду в SQL-движок вместе со всей коллекцией значений:

```sql
FORALL i IN 1 .. ids.COUNT
  UPDATE employees SET salary = sals(i) * 1.1 WHERE employee_id = ids(i);

DBMS_OUTPUT.PUT_LINE('Всего обновлено: ' || SQL%ROWCOUNT);
DBMS_OUTPUT.PUT_LINE('Второй командой: ' || SQL%BULK_ROWCOUNT(2));
```

Важно:

- `FORALL` — **не цикл**. После него стоит ровно **одна** DML-команда (INSERT, UPDATE, DELETE, MERGE или EXECUTE IMMEDIATE), никаких IF и других операторов.
- `SQL%BULK_ROWCOUNT(i)` — сколько строк затронуло i-е выполнение.
- Коллекция должна быть плотной в диапазоне `1..COUNT`; для разреженных — `INDICES OF`.

## SAVE EXCEPTIONS — не падать на первой ошибке

По умолчанию первая ошибка в FORALL останавливает выполнение: строки до неё обработаны (не откатываются автоматически — откатывается только упавшее выполнение), после — нет. `SAVE EXCEPTIONS` продолжает до конца и собирает ошибки:

```sql
DECLARE
  e_bulk EXCEPTION;
  PRAGMA EXCEPTION_INIT(e_bulk, -24381);
BEGIN
  FORALL i IN 1 .. ids.COUNT SAVE EXCEPTIONS
    INSERT INTO target VALUES (ids(i), sals(i));
EXCEPTION
  WHEN e_bulk THEN
    FOR j IN 1 .. SQL%BULK_EXCEPTIONS.COUNT LOOP
      DBMS_OUTPUT.PUT_LINE(
        'Элемент ' || SQL%BULK_EXCEPTIONS(j).ERROR_INDEX ||
        ': ' || SQLERRM(-SQL%BULK_EXCEPTIONS(j).ERROR_CODE));
    END LOOP;
END;
```

В конце FORALL возбуждает `ORA-24381: error(s) in array DML`. `ERROR_INDEX` — номер элемента коллекции, `ERROR_CODE` — номер ошибки **без минуса**.

Альтернатива на уровне SQL — `LOG ERRORS INTO err$_table` (DML error logging через `DBMS_ERRLOG`).

## INDICES OF и VALUES OF

Для разреженной коллекции (после DELETE) `FORALL i IN 1..COUNT` упадёт на «дырке». Варианты:

```sql
FORALL i IN INDICES OF ids             -- только существующие индексы
  UPDATE … WHERE employee_id = ids(i);

FORALL i IN VALUES OF idx_list         -- индексы берутся из значений другой коллекции
  UPDATE … WHERE employee_id = ids(i);
```

`VALUES OF` удобен, когда нужно обработать подмножество элементов: собрал в `idx_list` номера нужных элементов и передал.

## ? Что такое BULK COLLECT и FORALL и зачем они нужны?

Массовая передача данных между PL/SQL и SQL движками. BULK COLLECT загружает много строк в коллекцию за одно переключение контекста, FORALL отправляет одну DML-команду со всей коллекцией значений. Это в разы быстрее, чем построчный цикл с SQL внутри, где каждая итерация — переключение контекста. Но если задача решается одной SQL-командой — это ещё быстрее.

## ? Зачем нужен LIMIT в BULK COLLECT?

Без LIMIT весь результат загружается в память сессии (PGA), что на больших таблицах приводит к огромному расходу памяти или ошибке. С LIMIT строки читаются порциями (обычно 100–1000) в цикле. Выходить из такого цикла нужно по `коллекция.COUNT = 0`, а не по `%NOTFOUND` сразу после FETCH — иначе потеряется последняя неполная пачка.

## ? Бросает ли BULK COLLECT NO_DATA_FOUND?

Нет. Если запрос не вернул строк, коллекция остаётся пустой (COUNT = 0), исключения нет — в отличие от обычного SELECT INTO. Проверять результат нужно через COUNT.

## ? Как обработать ошибки отдельных строк в FORALL?

Добавить SAVE EXCEPTIONS: FORALL выполнит все элементы, а в конце возбудит ORA-24381. В обработчике перебрать SQL%BULK_EXCEPTIONS: ERROR_INDEX — номер элемента, ERROR_CODE — код ошибки (без минуса, текст — SQLERRM(-код)). Без SAVE EXCEPTIONS выполнение остановится на первой ошибке.

## ? Можно ли поставить IF внутри FORALL?

Нет: FORALL — не цикл, после него допускается ровно одна DML-команда. Фильтр делают заранее — собирают нужные элементы в отдельную коллекцию или коллекцию индексов и используют VALUES OF; либо переносят условие в WHERE самой DML.

## ? Что делать с разреженной коллекцией в FORALL?

Использовать `FORALL i IN INDICES OF коллекция` — пройдёт только существующие индексы. Или `VALUES OF коллекция_индексов` — индексы берутся из значений другой коллекции. Обычный диапазон 1..COUNT упадёт на удалённом элементе.

## Тест: Запрос с BULK COLLECT INTO не вернул ни одной строки. Что произойдёт?
- Исключение NO_DATA_FOUND
- Коллекция станет NULL
- [x] Коллекция будет пустой, COUNT = 0
- Исключение COLLECTION_IS_NULL
> BULK COLLECT не бросает NO_DATA_FOUND, проверяй COUNT.

## Тест: В цикле FETCH … BULK COLLECT INTO rows LIMIT 100 стоит EXIT WHEN c%NOTFOUND сразу после FETCH. В таблице 250 строк. Сколько обработается?
- 250
- [x] 200
- 300
- 100
> Третий FETCH вернёт 50 строк и выставит %NOTFOUND = TRUE — цикл выйдет, не обработав их. Выходи по `rows.COUNT = 0`.

## Тест: Что из этого НЕЛЬЗЯ написать после FORALL i IN 1..n?
- INSERT INTO t VALUES (a(i))
- UPDATE t SET x = a(i) WHERE id = b(i)
- [x] IF a(i) > 0 THEN UPDATE … END IF
- EXECUTE IMMEDIATE '…' USING a(i)
> FORALL принимает ровно одну DML-команду (или EXECUTE IMMEDIATE). IF и любые другие операторы — нельзя.

## Тест: Какую ошибку возбуждает FORALL … SAVE EXCEPTIONS, если были ошибки?
- ORA-06502
- ORA-01403
- [x] ORA-24381
- ORA-00001
> ORA-24381 error(s) in array DML. Подробности — в SQL%BULK_EXCEPTIONS.

## Тест: Что показывает SQL%BULK_ROWCOUNT(3) после FORALL?
- Количество ошибок
- Общее количество строк
- [x] Сколько строк затронуло третье выполнение команды
- Номер третьей ошибки
> Для каждого элемента — своё количество строк. Общее — SQL%ROWCOUNT.

## Тест: Коллекция с индексами 1, 2, 5, 9. Как правильно написать FORALL?
- FORALL i IN 1..c.COUNT
- FORALL i IN c.FIRST..c.LAST
- [x] FORALL i IN INDICES OF c
- FORALL i IN REVERSE 1..9
> Коллекция разреженная, первые два варианта наткнутся на несуществующие элементы. INDICES OF проходит только по существующим.

## Тест: Нужно увеличить всем зарплату на 10%. Что выбрать?
- Курсорный цикл с UPDATE на каждую строку
- BULK COLLECT + FORALL
- [x] Один UPDATE employees SET salary = salary * 1.1
- FOR i IN 1..COUNT с EXECUTE IMMEDIATE
> Если задача решается одной SQL-командой — это всегда быстрее любой PL/SQL-обработки.
