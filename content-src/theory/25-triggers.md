---
id: triggers
title: Триггеры
group: plsql
summary: Виды триггеров и порядок срабатывания, :NEW и :OLD, предикаты INSERTING/UPDATING/DELETING, мутирующая таблица ORA-04091 и compound trigger, INSTEAD OF, системные триггеры и когда триггеры лучше не писать.
lessons: l22, l23
---

## Что такое триггер

**Триггер** — PL/SQL-код, который Oracle **сам** выполняет при наступлении события. Вызвать его напрямую нельзя.

События бывают:

- **DML** — `INSERT`, `UPDATE [OF столбцы]`, `DELETE` на таблице или представлении;
- **DDL** — `CREATE`, `ALTER`, `DROP` в схеме или базе;
- **системные** — `LOGON`, `LOGOFF`, `STARTUP`, `SHUTDOWN`, `SERVERERROR`.

Типичные применения: аудит (кто и когда изменил), заполнение служебных столбцов (`created_at`, `updated_by`), сложные правила целостности, которые не выражаются ограничениями, журналирование изменений.

## Виды DML-триггеров

По времени: `BEFORE` или `AFTER` события. По уровню:

- **Statement-level** (на уровне команды) — срабатывает **один раз** на команду, даже если она изменила 0 строк.
- **Row-level** (`FOR EACH ROW`) — срабатывает **для каждой** изменённой строки; если строк 0 — ни разу.

Порядок срабатывания для одной команды:

1. BEFORE statement
2. для каждой строки: BEFORE row → изменение строки → AFTER row
3. AFTER statement

Несколько триггеров одного вида на одной таблице срабатывают в неопределённом порядке, если не задать `FOLLOWS` / `PRECEDES`.

```sql
CREATE OR REPLACE TRIGGER emp_audit_trg
  BEFORE INSERT OR UPDATE ON employees
  FOR EACH ROW
  WHEN (NEW.salary > 0)                     -- в WHEN без двоеточия
BEGIN
  IF INSERTING THEN
    :NEW.created_at := SYSDATE;
  ELSIF UPDATING('SALARY') THEN
    INSERT INTO salary_log (emp_id, old_sal, new_sal, changed_at)
    VALUES (:OLD.employee_id, :OLD.salary, :NEW.salary, SYSDATE);
  END IF;
  :NEW.updated_by := USER;
END;
/
```

## :NEW, :OLD и предикаты

В row-level триггере доступны значения строки:

| Событие | `:OLD` | `:NEW` |
|---|---|---|
| INSERT | все NULL | новые значения |
| UPDATE | значения до изменения | значения после |
| DELETE | удаляемые значения | все NULL |

- `:NEW` можно **изменять только в BEFORE**-триггере (подставить значение, поправить данные). В AFTER — только читать.
- В statement-level триггере `:NEW` и `:OLD` нет.
- Предикаты `INSERTING`, `UPDATING`, `UPDATING('COL')`, `DELETING` — какое событие вызвало триггер, если он объявлен на несколько.

## Мутирующая таблица — ORA-04091

Row-level триггер **не может читать или изменять таблицу, на которой он срабатывает** (она «мутирует» — находится в процессе изменения):

```sql
CREATE OR REPLACE TRIGGER check_max_sal
  BEFORE UPDATE OF salary ON employees FOR EACH ROW
DECLARE
  v_avg NUMBER;
BEGIN
  SELECT AVG(salary) INTO v_avg FROM employees;    -- ORA-04091: table is mutating
  …
END;
```

Почему: строки меняются по одной, и посреди команды результат запроса к таблице был бы непредсказуем (зависел бы от порядка обработки строк).

Нюанс: однострочный `INSERT … VALUES` в BEFORE row-триггере эту ошибку не даёт, а `INSERT … SELECT` — даёт.

Решения:

1. **Compound trigger** (11g+) — один триггер с секциями для всех моментов и общими переменными: в row-секции копим id изменённых строк в коллекцию, в `AFTER STATEMENT` — когда таблица уже не мутирует — делаем нужные запросы.
2. Statement-level `AFTER` триггер — в нём таблицу читать можно.
3. Пересмотреть дизайн: может, правило — это ограничение, материализованное представление или логика в пакете.
4. `PRAGMA AUTONOMOUS_TRANSACTION` формально убирает ошибку, но читает данные **без** текущих изменений — это почти всегда **неправильное** решение.

## Compound trigger

```sql
CREATE OR REPLACE TRIGGER emp_sal_ct
  FOR UPDATE OF salary ON employees
  COMPOUND TRIGGER
  TYPE t_ids IS TABLE OF employees.department_id%TYPE;
  g_depts t_ids := t_ids();

  AFTER EACH ROW IS
  BEGIN
    g_depts.EXTEND;
    g_depts(g_depts.LAST) := :NEW.department_id;
  END AFTER EACH ROW;

  AFTER STATEMENT IS
  BEGIN
    FOR i IN 1 .. g_depts.COUNT LOOP
      -- здесь уже можно читать employees: команда завершилась
      recalc_dept_budget(g_depts(i));
    END LOOP;
  END AFTER STATEMENT;
END emp_sal_ct;
/
```

Секции: `BEFORE STATEMENT`, `BEFORE EACH ROW`, `AFTER EACH ROW`, `AFTER STATEMENT`. Переменные общие для всех секций и живут **одну команду** (в отличие от переменных пакета, которые живут всю сессию и требуют ручной очистки).

## INSTEAD OF и системные триггеры

**INSTEAD OF** — только на **представлениях**: выполняется *вместо* DML. Позволяет сделать изменяемым сложное представление с соединением:

```sql
CREATE OR REPLACE TRIGGER emp_dept_v_ins
  INSTEAD OF INSERT ON emp_dept_v FOR EACH ROW
BEGIN
  INSERT INTO employees (employee_id, last_name, department_id)
  VALUES (:NEW.employee_id, :NEW.last_name,
          (SELECT department_id FROM departments WHERE department_name = :NEW.department_name));
END;
```

**DDL и системные** триггеры: `AFTER DDL ON SCHEMA` — журнал изменений структуры; `AFTER LOGON ON DATABASE` — настройка сессии; `AFTER SERVERERROR` — логирование ошибок.

## Ограничения и подводные камни

- В триггере нельзя `COMMIT` / `ROLLBACK` (кроме автономной транзакции): триггер — часть команды, которая его вызвала.
- Триггеры **не срабатывают** на `TRUNCATE`, при прямой загрузке в обход SQL (некоторые режимы SQL*Loader).
- Триггеры невидимы при чтении кода: «магия», которая происходит при обычном UPDATE. Их сложно отлаживать, они замедляют массовые операции (row-триггер выполняется на каждую строку).
- Хорошая практика: в триггере минимум кода — вызов процедуры из пакета; для бизнес-логики предпочитать явные вызовы API, а триггеры оставлять для аудита и служебных полей.
- Отключить на время загрузки: `ALTER TRIGGER … DISABLE` или `ALTER TABLE … DISABLE ALL TRIGGERS`.

## ? Какие виды триггеров бывают?

По событию: DML (INSERT/UPDATE/DELETE), DDL (CREATE/ALTER/DROP), системные (LOGON, STARTUP, SERVERERROR). DML-триггеры по времени — BEFORE и AFTER, по уровню — на команду (statement) и на строку (FOR EACH ROW). Отдельно INSTEAD OF — для представлений, и compound trigger, объединяющий все моменты срабатывания.

## ? В каком порядке срабатывают триггеры?

BEFORE STATEMENT один раз, затем для каждой строки BEFORE ROW, изменение строки, AFTER ROW, и в конце AFTER STATEMENT один раз. Порядок нескольких триггеров одного типа не гарантирован — задают FOLLOWS/PRECEDES.

## ? Что такое :NEW и :OLD?

Псевдозаписи в row-level триггере: :OLD — значения строки до изменения, :NEW — после. При INSERT :OLD пустой (NULL), при DELETE пустой :NEW. Изменять :NEW можно только в BEFORE-триггере. В statement-триггерах их нет.

## ? Что такое мутирующая таблица и как обойти ORA-04091?

Row-level триггер не может читать или менять таблицу, на которой срабатывает, пока она изменяется командой: результат зависел бы от порядка обработки строк. Обходы: compound trigger (копим ключи в row-секции, обрабатываем в AFTER STATEMENT), отдельный statement-level AFTER-триггер, перенос логики в пакетную процедуру. Автономная транзакция убирает ошибку, но видит данные без текущих изменений — обычно это неверно.

## ? Что такое compound trigger и зачем он нужен?

Триггер (11g+) с секциями BEFORE STATEMENT, BEFORE EACH ROW, AFTER EACH ROW, AFTER STATEMENT и общими переменными, которые живут в пределах одной команды. Главное применение — обход мутирующей таблицы: собрать данные по строкам и обработать их после команды. Ещё — пакетная вставка в журнал (накопить и сделать FORALL в конце).

## ? Можно ли делать COMMIT в триггере?

Нет — ORA-04092. Триггер выполняется в рамках команды, которая его вызвала, и решение о фиксации принимает вызывающая транзакция. Единственный вариант — автономная транзакция (например, для записи в журнал, который должен сохраниться даже при откате основной операции).

## ? Когда триггеры лучше не использовать?

Для основной бизнес-логики: она становится скрытой, её трудно отлаживать и тестировать, порядок выполнения неочевиден, массовые операции замедляются. Правила, выражаемые ограничениями (FK, CHECK, UNIQUE), лучше делать ограничениями. Триггеры хороши для аудита, служебных полей и INSTEAD OF на представлениях.

## Тест: UPDATE изменил 0 строк. Сработает ли statement-level AFTER UPDATE триггер?
- Нет
- [x] Да, один раз
- Да, по разу на каждую строку таблицы
- Только если есть WHEN
> Statement-триггер срабатывает на саму команду, независимо от количества строк. Row-триггер в этом случае не сработает ни разу.

## Тест: В каком триггере можно изменить значение :NEW.salary?
- AFTER row
- [x] BEFORE row
- AFTER statement
- BEFORE statement
> Изменить новую строку можно только до её записи — в BEFORE row. В statement-триггерах :NEW вообще нет.

## Тест: Чему равен :OLD.salary в триггере на INSERT?
- Значению из DEFAULT
- 0
- [x] NULL
- Ошибка: :OLD недоступен
> При вставке старой строки нет, все поля :OLD — NULL.

## Тест: Row-level триггер на employees выполняет SELECT AVG(salary) FROM employees при UPDATE. Что будет?
- Вернётся среднее до изменения
- Вернётся среднее после изменения
- [x] ORA-04091: table is mutating
- Deadlock
> Строковый триггер не может читать свою таблицу во время её изменения. Решение — compound trigger или statement-level AFTER.

## Тест: На каком объекте можно создать триггер INSTEAD OF?
- На таблице
- [x] На представлении
- На последовательности
- На индексе
> INSTEAD OF выполняется вместо DML над представлением — так делают изменяемыми сложные представления.

## Тест: Сработает ли триггер BEFORE DELETE ON t при TRUNCATE TABLE t?
- Да
- [x] Нет
- Только FOR EACH ROW
- Только AFTER
> TRUNCATE — DDL, DML-триггеры на него не реагируют. Для реакции на TRUNCATE нужен DDL-триггер.

## Тест: Сколько живут переменные, объявленные в compound trigger?
- Всю сессию
- [x] Одну команду (statement), вызвавшую триггер
- Одну строку
- До COMMIT
> В этом их преимущество перед переменными пакета: не нужно вручную очищать состояние между командами.

## Тест: Какая ошибка будет при COMMIT в обычном триггере?
- ORA-04091
- [x] ORA-04092: cannot COMMIT in a trigger
- ORA-06510
- Никакой, COMMIT выполнится
> Триггер — часть вызвавшей его команды и не управляет транзакцией. Исключение — автономная транзакция.
