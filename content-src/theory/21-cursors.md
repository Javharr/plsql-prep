---
id: cursors
title: Курсоры
group: plsql
summary: Неявные и явные курсоры, атрибуты %FOUND, %NOTFOUND, %ROWCOUNT, %ISOPEN, курсорный FOR, параметры, FOR UPDATE и WHERE CURRENT OF, REF CURSOR и SYS_REFCURSOR.
lessons: l15, l16
---

## Что такое курсор

**Курсор** — указатель на рабочую область, где Oracle хранит результат SQL-команды и текущую позицию в нём. Любая SQL-команда в PL/SQL выполняется через курсор: либо **неявный** (Oracle создаёт и закрывает его сам), либо **явный** (объявляешь и управляешь сам).

## Неявный курсор и SQL%-атрибуты

Каждый `INSERT`, `UPDATE`, `DELETE`, `MERGE` и `SELECT INTO` использует неявный курсор с именем `SQL`. После команды доступны атрибуты:

```sql
UPDATE employees SET salary = salary * 1.1 WHERE department_id = 60;
DBMS_OUTPUT.PUT_LINE('Обновлено строк: ' || SQL%ROWCOUNT);
IF SQL%NOTFOUND THEN
  DBMS_OUTPUT.PUT_LINE('Никого не нашли');
END IF;
```

| Атрибут | Значение |
|---|---|
| `SQL%ROWCOUNT` | сколько строк затронула последняя команда |
| `SQL%FOUND` | TRUE, если затронута хотя бы одна строка |
| `SQL%NOTFOUND` | противоположность FOUND |
| `SQL%ISOPEN` | для неявного курсора всегда FALSE — он закрывается сразу |

Атрибуты относятся к **последней** SQL-команде. Если между UPDATE и проверкой выполнилась другая команда (например, вызов процедуры с SQL внутри), `SQL%ROWCOUNT` будет уже её.

## Явный курсор: OPEN — FETCH — CLOSE

```sql
DECLARE
  CURSOR c_emp IS
    SELECT employee_id, last_name, salary FROM employees WHERE department_id = 60;
  r c_emp%ROWTYPE;
BEGIN
  OPEN c_emp;                       -- выполнить запрос
  LOOP
    FETCH c_emp INTO r;             -- взять следующую строку
    EXIT WHEN c_emp%NOTFOUND;       -- сразу после FETCH!
    DBMS_OUTPUT.PUT_LINE(r.last_name || ': ' || r.salary);
  END LOOP;
  DBMS_OUTPUT.PUT_LINE('Всего: ' || c_emp%ROWCOUNT);
  CLOSE c_emp;                      -- освободить ресурсы
END;
```

Атрибуты те же, но с именем курсора: `c_emp%FOUND`, `%NOTFOUND`, `%ROWCOUNT` (сколько строк уже выбрано), `%ISOPEN`.

Типичные ошибки:

- `EXIT WHEN` не сразу после `FETCH` — последняя строка обработается дважды;
- `FETCH` из закрытого курсора или повторный `OPEN` открытого — `INVALID_CURSOR` / `CURSOR_ALREADY_OPEN`;
- забыли `CLOSE` — открытые курсоры копятся, в итоге `ORA-01000: maximum open cursors exceeded`.

Запрос выполняется и **фиксирует снимок данных в момент OPEN**: изменения, сделанные после открытия, курсор не увидит.

## Курсорный FOR — как писать по умолчанию

```sql
BEGIN
  FOR r IN (SELECT last_name, salary FROM employees WHERE department_id = 60) LOOP
    DBMS_OUTPUT.PUT_LINE(r.last_name || ': ' || r.salary);
  END LOOP;
END;
```

Сам открывает курсор, объявляет запись `r`, делает FETCH, выходит, когда строки кончились, и **закрывает курсор даже при исключении**. Кроме того, Oracle оптимизирует его и выбирает строки пачками по 100 (неявный bulk fetch). Ручной OPEN/FETCH нужен, когда требуется управлять выборкой: прерваться посередине, передать курсор куда-то, FETCH BULK COLLECT LIMIT.

## Параметры курсора и FOR UPDATE

```sql
DECLARE
  CURSOR c_dept (p_dept NUMBER, p_min NUMBER DEFAULT 0) IS
    SELECT employee_id, salary FROM employees
     WHERE department_id = p_dept AND salary >= p_min
       FOR UPDATE OF salary NOWAIT;
BEGIN
  FOR r IN c_dept(60, 5000) LOOP
    UPDATE employees SET salary = r.salary * 1.05 WHERE CURRENT OF c_dept;
  END LOOP;
  COMMIT;
END;
```

- Параметры делают один курсор пригодным для разных значений; типы без размера (`NUMBER`, не `NUMBER(4)`).
- `FOR UPDATE` блокирует **все** выбранные строки в момент OPEN; `NOWAIT` — ошибка вместо ожидания, если кто-то их уже держит.
- `WHERE CURRENT OF имя_курсора` — изменить именно текущую строку курсора (по её ROWID) без повторного поиска.
- После `COMMIT` блокировки снимаются, и `FETCH` из `FOR UPDATE`-курсора даст `ORA-01002: fetch out of sequence` — нельзя коммитить внутри такого цикла.

## REF CURSOR и SYS_REFCURSOR

Обычный курсор привязан к одному запросу при компиляции. **Курсорная переменная** (REF CURSOR) — указатель, который можно открыть для разных запросов, в том числе динамических, и **передать** в другую процедуру или клиенту (Java, Python, отчёт):

```sql
CREATE OR REPLACE FUNCTION get_emps(p_dept NUMBER) RETURN SYS_REFCURSOR IS
  rc SYS_REFCURSOR;
BEGIN
  OPEN rc FOR SELECT employee_id, last_name FROM employees WHERE department_id = p_dept;
  RETURN rc;            -- закроет тот, кто будет читать
END;
```

- **Сильный** REF CURSOR (`TYPE t IS REF CURSOR RETURN employees%ROWTYPE`) — структура строки задана, проверяется при компиляции.
- **Слабый** — без RETURN; `SYS_REFCURSOR` — встроенный слабый тип.
- `OPEN rc FOR 'SELECT … WHERE id = :1' USING v_id` — для динамического SQL.

## ? Чем явный курсор отличается от неявного?

Неявный Oracle создаёт сам для каждой DML-команды и SELECT INTO, открывает и закрывает автоматически; доступ к нему — через SQL%ROWCOUNT, SQL%FOUND и т.д. Явный объявляется в DECLARE для запроса, который возвращает несколько строк, и управляется вручную: OPEN, FETCH в цикле, CLOSE, атрибуты имя%FOUND, %NOTFOUND, %ROWCOUNT, %ISOPEN.

## ? Какие атрибуты курсора ты знаешь?

%FOUND — последний FETCH или DML что-то нашёл; %NOTFOUND — наоборот; %ROWCOUNT — сколько строк выбрано или изменено; %ISOPEN — открыт ли курсор. Для неявного курсора пишутся как SQL%…, и SQL%ISOPEN всегда FALSE. Для BULK-операций есть ещё SQL%BULK_ROWCOUNT и SQL%BULK_EXCEPTIONS.

## ? Почему курсорный FOR удобнее, чем OPEN/FETCH/CLOSE?

Он сам открывает курсор, объявляет запись, выбирает строки, выходит из цикла и закрывает курсор — даже если внутри случилось исключение. Меньше кода и ошибок (забытый CLOSE, неправильный EXIT WHEN). Плюс Oracle выбирает строки пачками по 100. Ручное управление нужно для BULK COLLECT LIMIT или передачи курсора.

## ? Что такое REF CURSOR и SYS_REFCURSOR?

Курсорная переменная — указатель на курсор, который можно открыть для разных запросов (в том числе динамических) и передать между процедурами или вернуть клиентскому приложению. Сильный REF CURSOR имеет заданную структуру строки, слабый — нет. SYS_REFCURSOR — встроенный слабый тип, чтобы не объявлять свой.

## ? Что делают FOR UPDATE и WHERE CURRENT OF?

FOR UPDATE в объявлении курсора блокирует выбранные строки в момент OPEN, чтобы их никто не изменил, пока ты их обрабатываешь (NOWAIT — ошибка вместо ожидания, SKIP LOCKED — пропуск занятых). WHERE CURRENT OF в UPDATE/DELETE меняет текущую строку курсора по её ROWID. COMMIT внутри такого цикла снимает блокировки, и следующий FETCH даёт ORA-01002.

## ? Что значит ошибка ORA-01000 maximum open cursors exceeded?

Сессия держит открытыми больше курсоров, чем разрешает параметр OPEN_CURSORS. Обычно это утечка: явные курсоры или REF CURSOR открываются и не закрываются (особенно в обработчиках ошибок или на стороне Java без close()). Лечится закрытием курсоров во всех ветках, курсорными FOR-циклами, а не увеличением параметра.

## Тест: Что вернёт SQL%ROWCOUNT после UPDATE, который не нашёл ни одной строки?
- NULL
- [x] 0
- -1
- Исключение NO_DATA_FOUND
> UPDATE, DELETE и INSERT не бросают NO_DATA_FOUND — это только SELECT INTO. Количество строк — 0, а SQL%NOTFOUND = TRUE.

## Тест: Где должен стоять EXIT WHEN c%NOTFOUND в цикле с явным курсором?
- Перед FETCH
- [x] Сразу после FETCH
- В конце цикла, после обработки строки
- Не важно
> Если проверка стоит после обработки, то после последнего неудачного FETCH обработается запись с прошлыми значениями — последняя строка дважды.

## Тест: Что вернёт SQL%ISOPEN после выполнения UPDATE?
- TRUE
- [x] FALSE
- NULL
- Зависит от количества строк
> Неявный курсор закрывается сразу после команды, поэтому SQL%ISOPEN всегда FALSE.

## Тест: Нужно ли закрывать курсор курсорного цикла FOR r IN (SELECT …)?
- Да, CLOSE после END LOOP
- Да, в разделе EXCEPTION
- [x] Нет, Oracle закроет его сам, даже при исключении
- Нет, он закроется только при COMMIT
> Курсорный FOR сам управляет курсором: OPEN, FETCH, CLOSE.

## Тест: В цикле по курсору FOR UPDATE после каждой строки делают COMMIT. Что произойдёт на следующем FETCH?
- Всё нормально
- Курсор перечитает данные
- [x] ORA-01002: fetch out of sequence
- Deadlock
> COMMIT снимает блокировки, которые наложил FOR UPDATE, и курсор становится недействительным для дальнейшей выборки.

## Тест: Какой тип выбрать, чтобы функция вернула результат запроса Java-приложению?
- %ROWTYPE
- Явный курсор CURSOR c IS …
- [x] SYS_REFCURSOR
- VARRAY
> Курсорная переменная передаётся клиенту, и он читает строки сам. Обычный явный курсор передать нельзя.

## Тест: Когда фиксируется набор данных, который вернёт явный курсор?
- При каждом FETCH
- [x] В момент OPEN
- При объявлении в DECLARE
- При CLOSE
> Запрос выполняется при OPEN и даёт согласованный снимок на этот момент. Изменения после OPEN курсор не увидит.

## Тест: Какая ошибка будет при повторном OPEN уже открытого курсора?
- INVALID_CURSOR
- [x] CURSOR_ALREADY_OPEN
- ORA-01000
- Никакой, курсор переоткроется
> Перед повторным OPEN курсор нужно закрыть. INVALID_CURSOR — при FETCH или CLOSE не открытого курсора.
