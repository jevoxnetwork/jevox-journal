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
npx wrangler@4.137.0 pages deploy --config wrangler.pages.jsonc --project-name jevoxjournal --branch main
```

Команда `npm run deploy` использует отдельную конфигурацию Cloudflare Workers.
