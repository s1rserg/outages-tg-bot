# Черкасиобленерго · Telegram-бот

Telegram-бот перевіряє публічну стрічку кожні 5 хвилин. Бот відстежує обласний і тимчасовий уманський графіки для підчерги кожного підписника. Бот перечитує видимі дописи, включно з редагуваннями, які вже відображає Telegram. Якщо тимчасовий графік опубліковано без дати, сповіщення також буде без дати.

## Деплой на Cloudflare Workers Free

1. Створіть бота через @BotFather. Виконайте `npx wrangler login`.
2. Виконайте `npx wrangler d1 create outages-tg-bot`. Запишіть отриманий `database_id` у `wrangler.toml`.
3. Виконайте `npx wrangler d1 migrations apply outages-tg-bot --remote`, потім `npx wrangler deploy`.
4. Додайте токен через `npx wrangler secret put BOT_TOKEN`. Згенеруйте окремий випадковий секрет командою `openssl rand -hex 32` і додайте його через `npx wrangler secret put WEBHOOK_SECRET`.
5. Зареєструйте вебхук через Telegram Bot API. Перед виконанням введіть токен і секрет у змінні через команди нижче.

```bash
read -rsp 'Bot token: ' BOT_TOKEN; echo
read -rsp 'Webhook secret: ' WEBHOOK_SECRET; echo
read -rp 'Worker HTTPS origin: ' WORKER_URL
curl --fail-with-body -sS -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  --data-urlencode "url=${WORKER_URL%/}/telegram" \
  --data-urlencode "secret_token=${WEBHOOK_SECRET}" \
  --data-urlencode 'allowed_updates=["message"]'
unset BOT_TOKEN WEBHOOK_SECRET WORKER_URL
```

Після `{"ok":true,...}` надішліть боту `/start`. Протягом наступного запуску перевірте журнал через `npx wrangler tail` і записи у D1. Команда `/stop` видаляє підписку та її заплановані повідомлення. Worker надсилає до 20 очікуваних повідомлень за один запуск. Через тимчасові помилки Telegram доставка повторюється на наступному запуску.

## Перевірка парсера

`node --test`

## Команди бота
 
Після /start бот показує кнопки керування в чаті. Кнопка «Обрати підчергу» відкриває список доступних підчерг. Кнопка «Довідка» або команда /help показує пояснення.

- `/start` активує підписку з підчергою 2.2 за замовчуванням або зберігає поточний вибір активного підписника.
- `/queue` показує поточну підчергу.
- `/queue 3.1` змінює підчергу для обох графіків. Доступні підчерги від 1.1 до 6.2.
- `/stop` вимикає розсилку.

Для оновлення вже розгорнутого бота застосуйте міграцію 0002 перед деплоєм нового коду. Наявні підписники зберігають підчергу 2.2.
