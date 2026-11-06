# buisnes board

Доска бизнес-процессов: BPMN-схемы, документы в Markdown, замечания. Фронтенд — React + Vite + TypeScript, бэкенд — Rust (axum + sqlx) + PostgreSQL.

## Быстрый старт (2 команды)

Нужны: [Node.js 20+](https://nodejs.org), [Docker Desktop](https://www.docker.com/products/docker-desktop), [Rust](https://rustup.rs).

```bash
npm run setup     # один раз: зависимости, backend/.env, база в Docker
npm run dev:all   # каждый день: база + бэкенд + фронтенд
```

Откройте http://localhost:5173 и зарегистрируйте себя (первый запуск Rust-бэкенда собирается пару минут).

## Команды

| Команда | Что делает |
|---|---|
| `npm run dev:all` | поднимает всё сразу |
| `npm run check` | проверка типов + `cargo check` — запускайте перед коммитом |
| `npm run build` | сборка фронтенда |
| `docker compose down -v` | сбросить локальную базу с нуля |

## Как работать командой

1. `git pull` → новая ветка: `git switch -c feature/что-делаем`.
2. Пишете код (в том числе с Claude Code: в корне лежит `CLAUDE.md` с правилами проекта, он подхватывается сам).
3. `npm run check` → коммит → `git push` → Pull Request в `main`. CI проверит сборку.
4. Один человек смотрит PR и мержит. В `main` напрямую не пушим.

Правила, которые легко нарушить:
- **Миграции БД** (`backend/migrations/`) только добавляем новыми файлами `0006_...sql`, старые не правим — иначе у всех сломается база.
- **Секреты** (`backend/.env`) не коммитим, он в `.gitignore`. Новые переменные добавляйте в `backend/.env.example`.
- Мелкие PR лучше больших: легче ревьюить и меньше конфликтов.

Подробности про бэкенд, секреты и боевой режим — в [backend/README.md](backend/README.md).
