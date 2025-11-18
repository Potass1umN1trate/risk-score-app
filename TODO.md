## TODO по проекту RiskScore на Next.js

### 1. Базовая настройка проекта

* [x] Инициализировать проект через `npx create-next-app@latest risk-score-app`
* [x] Включить:

  * TypeScript: **Yes**
  * ESLint: **Yes**
  * Tailwind CSS: **Yes** (желательно)
  * App Router: **Yes**
  * `src/` директорию: **No** (чтобы всё было в `app/`)
* [ ] Запустить `npm run dev` и убедиться, что стартовая страница открывается

---

### 2. Структура папок и файлов

* [ ] Создать папки:

  * [ ] `components/`
  * [ ] `lib/`
* [ ] В `app/`:

  * [ ] Оставить/подправить `app/layout.tsx` под общий layout
  * [ ] Переписать `app/page.tsx` под главную/лендинг системы

---

### 3. Общие компоненты UI

* [ ] `components/Header.tsx`
  Навигация: Главная / Анализ кошелька / Личный кабинет + кнопки Войти/Регистрация.
* [ ] Подключить `Header` в `app/layout.tsx` (чтобы шапка была на всех страницах).

---

### 4. Страницы (routes)

* [ ] `app/analysis/page.tsx`

  * [ ] Подключить форму `WalletAnalysisForm`
  * [ ] Держать стейт результата анализа
  * [ ] Рендерить `RiskSummary`, `ActivityStats`, `GraphView`, когда есть результат
* [ ] `app/dashboard/page.tsx`

  * [ ] Фетчить `/api/history`
  * [ ] Рендерить `HistoryTable`
* [ ] (По желанию) `app/login/page.tsx` и `app/register/page.tsx` — простые формы аутентификации (пока можно заглушки)

---

### 5. Компоненты для анализа

* [ ] `components/WalletAnalysisForm.tsx`

  * [ ] Поля: адрес кошелька, выбор блокчейна, глубина анализа
  * [ ] `fetch('/api/analyze')` по submit
  * [ ] Обработка loading/error
* [ ] `components/RiskSummary.tsx`

  * [ ] Принимает `WalletAnalysisResult`
  * [ ] Показывает итоговый score, уровень риска, адрес, блокчейн, дату
* [ ] `components/ActivityStats.tsx`

  * [ ] Выводит: totalTx, smallTxShare, peakDayTx
* [ ] `components/GraphView.tsx`

  * [ ] Пока: список узлов и связей в текстовом виде
  * [ ] Позже: можно подключить граф-визуализацию
* [ ] `components/HistoryTable.tsx`

  * [ ] Таблица с историей анализов: адрес, блокчейн, глубина, score, дата

---

### 6. Доменная логика (`lib/`)

* [ ] `lib/types.ts`

  * [ ] Типы: `SupportedBlockchain`, `WalletAnalysisRequest`, `WalletAnalysisResult`, `GraphNode`, `GraphLink`, `ActivityStats`
* [ ] `lib/blockchainApi.ts`

  * [ ] Функция `fetchTransactionsMock` с тестовыми транзакциями
  * [ ] Оставить интерфейс так, чтобы потом поменять на реальное API
* [ ] `lib/riskScore.ts`

  * [ ] Функция `calculateRiskScore`, которая по stats/graph считает риск (0–100)
* [ ] `lib/analysis.ts`

  * [ ] Функция `performFullAnalysis(req)`:

    * [ ] Получить транзакции (`fetchTransactionsMock`)
    * [ ] `buildGraphFromTransactions` → nodes + links
    * [ ] `analyzeActivity` → stats
    * [ ] `calculateRiskScore` → итоговый риск
    * [ ] Вернуть `WalletAnalysisResult`
* [ ] `lib/db.ts`

  * [ ] Временное in-memory хранилище: `saveAnalysis(userId, result)` и `getUserHistory(userId)`

---

### 7. API маршруты (server side)

* [ ] `app/api/analyze/route.ts`

  * [ ] Валидация входных данных
  * [ ] Вызов `performFullAnalysis`
  * [ ] `saveAnalysis('demo-user-id', result)`
  * [ ] Возврат результата в JSON
* [ ] `app/api/history/route.ts`

  * [ ] Вызов `getUserHistory('demo-user-id')`
  * [ ] Возврат списка анализов

*(потом можно добавить `api/auth/login`, `api/auth/register` и реальную авторизацию)*

---

### 8. UI/UX и мелочи

* [ ] Причесать стили (Tailwind классы, отступы, фон, шрифты)
* [ ] Нормальные сообщения об ошибках (анализ не удался, нет транзакций и т.п.)
* [ ] Обработать кейс «0 транзакций» (нормальный вывод, не падать)
* [ ] Локализовать формат даты под `ru-RU` (я уже использовал `toLocaleString('ru-RU')`)

---

### 9. Для следующего этапа (когда MVP будет работать)

Это уже «звёздочка» ⭐, но пригодится для диплома/реального проекта:

* [ ] Подключить реальный блокчейн API (например, для Bitcoin/Ethereum)
* [ ] Настроить реальную БД (PostgreSQL + Prisma или Drizzle)
* [ ] Добавить авторизацию (NextAuth или свой JWT)
* [ ] Реальная граф-визуализация (D3, `react-force-graph`, `vis-network` и т.п.)
* [ ] Написать разделы ПЗ:

  * [ ] Архитектура приложения
  * [ ] Описание модулей (`lib/analysis.ts`, `lib/riskScore.ts`, API-роуты)
  * [ ] Скриншоты страниц и структурные схемы


