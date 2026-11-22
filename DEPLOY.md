# Обновление Jevox Journal

Откройте pull request в `main`. GitHub Actions запускает тесты и собирает пакет Cloudflare Pages. После слияния возьмите актуальный `main` и запишите SHA коммита, который будете развёртывать.

```sh
git switch main
git pull --ff-only
git rev-parse HEAD
npm ci
npm test
npm run build:pages
```

Сверьте `wrangler.pages.jsonc` с настройками Production проекта `jevoxjournal`. Секреты авторизации и интеграций задаются в Cloudflare. Если в коммите появились новые SQL-миграции, примените их к общей базе D1.

```sh
npx wrangler@4.137.0 d1 migrations apply DB --remote --config wrangler.pages.jsonc
```

Загрузите сборку в существующий проект Pages, затем проверьте страницу входа и изменённую функцию.

```sh
(cd .wrangler/pages-deploy && npx wrangler@4.137.0 pages deploy --project-name jevoxjournal --branch main)
```

Команда `npm run deploy` использует отдельную конфигурацию Cloudflare Workers.

## Интерфейс на GitHub Pages

Workflow **Publish GitHub Pages** собирает статический интерфейс из `main` и публикует на `https://jevoxnetwork.github.io/jevox-journal/`. Для проверки локальной сборки выполните `node scripts/build-github.mjs`. OAuth callback-и остаются на домене Cloudflare. Если меняется контракт API, сначала обновите Worker, затем опубликованный интерфейс.

GitHub Pages обращается к API через Worker `jevox-github-api`. Для его обновления выполните `npx wrangler@4.137.0 deploy --config wrangler.github-relay.jsonc`. Worker перенаправляет запросы к существующему Cloudflare Pages и использует ту же базу через API журнала.
