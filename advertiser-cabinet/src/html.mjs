import { randomBytes } from "node:crypto";

function escape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function formatInteger(value) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value || 0);
}

function formatMoney(value, currency) {
  try {
    return new Intl.NumberFormat("ru-RU", { style: "currency", currency, maximumFractionDigits: 2 }).format(value || 0);
  } catch {
    return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value || 0)} ${escape(currency)}`;
  }
}

function monthTitle(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const title = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, monthNumber - 1, 1)));
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function adjacentMonth(month, delta) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function layout({ title, body, basePath, nonce, account = null }) {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)} · Clean Pay</title>
<style nonce="${nonce}">
:root{color-scheme:light;--ink:#18233a;--muted:#63708a;--line:#dde4ef;--panel:#fff;--brand:#6657d9;--brand2:#8a5bd6;--soft:#f2efff;--ok:#138a5b;--warn:#a66000}*{box-sizing:border-box}body{margin:0;background:#f5f7fb;color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}a{color:inherit}.shell{max-width:1180px;margin:auto;padding:24px}.top{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:24px}.brand{display:flex;align-items:center;gap:12px;font-weight:800;font-size:20px}.logo{display:grid;place-items:center;width:42px;height:42px;border-radius:13px;color:#fff;background:linear-gradient(135deg,var(--brand),var(--brand2));box-shadow:0 8px 22px #6657d933}.identity{display:flex;align-items:center;gap:12px;color:var(--muted)}button,.button{border:0;border-radius:10px;padding:10px 15px;background:var(--brand);color:#fff;font:inherit;font-weight:700;text-decoration:none;cursor:pointer}.button.secondary,button.secondary{background:#fff;color:var(--ink);border:1px solid var(--line)}.card{background:var(--panel);border:1px solid var(--line);border-radius:16px;box-shadow:0 8px 28px #25334d0d}.login-wrap{min-height:calc(100vh - 48px);display:grid;place-items:center}.login{width:min(420px,100%);padding:30px}.login h1{margin:6px 0}.muted{color:var(--muted)}label{display:block;font-weight:700;margin:18px 0 6px}input,select{width:100%;border:1px solid #cbd5e4;border-radius:10px;padding:12px 13px;background:#fff;color:var(--ink);font:inherit}input:focus{outline:3px solid #6657d924;border-color:var(--brand)}.error,.notice{padding:11px 13px;border-radius:10px;margin:14px 0}.error{background:#fff0f0;color:#a22424}.notice{background:#fff7e8;color:#83540a}.campaigns{display:flex;gap:8px;overflow:auto;padding:2px 0 14px}.campaign{white-space:nowrap}.campaign.active{background:var(--brand);color:#fff;border-color:var(--brand)}.campaign:not(.active){background:#fff;color:var(--ink);border:1px solid var(--line)}.hero{padding:24px;margin-bottom:18px}.hero-row,.month-nav{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}.hero h1{margin:0 0 4px;font-size:26px}.link{display:block;margin-top:12px;color:var(--brand);font-weight:700;overflow-wrap:anywhere}.month-nav{justify-content:flex-start;margin:16px 0}.month-nav strong{min-width:180px;text-align:center}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:18px 0}.metric{padding:19px}.metric .value{font-size:28px;font-weight:800;margin-top:5px}.metric .label{color:var(--muted);font-size:13px}.money-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:14px;margin:18px 0}.money{padding:19px;border-left:4px solid var(--brand)}.money h3{margin:0 0 8px}.money-row{display:flex;justify-content:space-between;gap:12px;margin-top:7px}.table-card{overflow:hidden}.table-head{padding:19px 20px;border-bottom:1px solid var(--line)}.table-head h2{margin:0}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;min-width:760px}th,td{padding:12px 16px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);background:#fafbfe}tbody tr:hover{background:#fafbfe}.zero{color:#a3adbf}.definition{margin-top:18px;padding:19px}.definition h2{font-size:17px;margin:0 0 7px}.footer{color:var(--muted);font-size:13px;text-align:center;padding:22px}.status{display:inline-block;padding:4px 9px;border-radius:99px;background:#e7f8f0;color:var(--ok);font-size:12px;font-weight:800}@media(max-width:820px){.grid{grid-template-columns:repeat(2,1fr)}.shell{padding:16px}.identity span{display:none}}@media(max-width:480px){.grid{grid-template-columns:1fr}.hero,.login{padding:20px}.metric .value{font-size:24px}}
</style></head><body><main class="shell">${account ? `<header class="top"><div class="brand"><span class="logo">CP</span><span>Статистика партнёров</span></div><div class="identity"><span>${escape(account.name)} · ${account.role === "admin" ? "Администратор" : "Рекламодатель"}</span><form method="post" action="${basePath}/logout"><input type="hidden" name="csrf" value="${escape(account.csrf)}"><button class="secondary" type="submit">Выйти</button></form></div></header>` : ""}${body}</main></body></html>`;
}

export function loginPage({ basePath, error = "" }) {
  const nonce = randomBytes(18).toString("base64url");
  const body = `<div class="login-wrap"><section class="card login"><div class="brand"><span class="logo">CP</span><span>Clean Pay</span></div><h1>Статистика партнёров</h1><p class="muted">Закрытый кабинет рекламодателя</p>${error ? `<div class="error" role="alert">${escape(error)}</div>` : ""}<form method="post" action="${basePath}/login"><label for="login">Логин</label><input id="login" name="login" autocomplete="username" maxlength="64" required><label for="password">Пароль</label><input id="password" name="password" type="password" autocomplete="current-password" maxlength="256" required><button style="width:100%;margin-top:22px" type="submit">Войти</button></form></section></div>`;
  return { html: layout({ title: "Вход", body, basePath, nonce }), nonce };
}

function amountLines(currencies, field) {
  const entries = Object.entries(currencies);
  if (!entries.length) return '<span class="zero">—</span>';
  return entries.map(([currency, value]) => `<div>${formatMoney(value[field], currency)}</div>`).join("");
}

function countCurrency(currencies, field) {
  return Object.values(currencies).reduce((sum, value) => sum + value[field], 0);
}

function calendarDays(stats) {
  const [year, monthNumber] = stats.month.split("-").map(Number);
  const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const indexed = new Map(stats.days.map((day) => [day.day, day]));
  return Array.from({ length: count }, (_, index) => {
    const day = `${stats.month}-${String(index + 1).padStart(2, "0")}`;
    return indexed.get(day) || { day, registrations: 0, trials: 0, currencies: {} };
  });
}

export function dashboardPage({ config, account, campaigns, stats, csrf }) {
  const nonce = randomBytes(18).toString("base64url");
  const queryCampaign = encodeURIComponent(stats.campaign.id);
  const campaignNav = campaigns.map((campaign) => `<a class="button campaign ${campaign.id === stats.campaign.id ? "active" : ""}" href="${config.basePath}/?campaign=${encodeURIComponent(campaign.id)}&month=${stats.month}">${escape(campaign.name)}</a>`).join("");
  const totalPayments = Object.values(stats.totals).reduce((sum, item) => sum + item.payments, 0);
  const firstPayments = Object.values(stats.totals).reduce((sum, item) => sum + item.firstPayments, 0);
  const revenue = Object.entries(stats.totals).map(([currency, item]) => `<article class="card money"><h3>${escape(currency)}</h3><div class="money-row"><span>Общий доход</span><strong>${formatMoney(item.revenue, currency)}</strong></div><div class="money-row"><span>С первых покупок</span><strong>${formatMoney(item.firstRevenue, currency)}</strong></div></article>`).join("") || '<article class="card money"><h3>Доход</h3><div class="muted">В выбранном месяце оплат нет</div></article>';
  const rows = calendarDays(stats).map((day) => {
    const date = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${day.day}T00:00:00Z`));
    return `<tr><td><strong>${escape(date)}</strong></td><td>${day.registrations || '<span class="zero">0</span>'}</td><td>${day.trials || '<span class="zero">0</span>'}</td><td>${countCurrency(day.currencies, "firstPayments") || '<span class="zero">0</span>'}</td><td>${countCurrency(day.currencies, "payments") || '<span class="zero">0</span>'}</td><td>${amountLines(day.currencies, "firstRevenue")}</td><td>${amountLines(day.currencies, "revenue")}</td></tr>`;
  }).join("");
  const body = `${campaigns.length > 1 ? `<nav class="campaigns" aria-label="Рекламные ссылки">${campaignNav}</nav>` : ""}<section class="card hero"><div class="hero-row"><div><h1>${escape(stats.campaign.name)}</h1><div class="muted">Код рекламной ссылки: <strong>${escape(stats.campaign.adLinkCode)}</strong></div></div><span class="status">Только чтение</span></div><a class="link" href="${escape(stats.campaign.telegramUrl)}" rel="noreferrer" target="_blank">${escape(stats.campaign.telegramUrl)}</a><nav class="month-nav"><a class="button secondary" aria-label="Предыдущий месяц" href="${config.basePath}/?campaign=${queryCampaign}&month=${adjacentMonth(stats.month, -1)}">←</a><strong>${escape(monthTitle(stats.month))}</strong><a class="button secondary" aria-label="Следующий месяц" href="${config.basePath}/?campaign=${queryCampaign}&month=${adjacentMonth(stats.month, 1)}">→</a></nav>${stats.linkFound ? (stats.linkActive ? "" : '<div class="notice">Рекламная ссылка отключена в RemnaShop. Исторические данные продолжают отображаться.</div>') : '<div class="notice">Рекламная ссылка пока не найдена в RemnaShop.</div>'}</section><section class="grid"><article class="card metric"><div class="label">Регистрации</div><div class="value">${formatInteger(stats.registrations)}</div></article><article class="card metric"><div class="label">Пробники</div><div class="value">${formatInteger(stats.trials)}</div></article><article class="card metric"><div class="label">Покупатели</div><div class="value">${formatInteger(stats.payingRegistrations)}</div></article><article class="card metric"><div class="label">Успешные оплаты</div><div class="value">${formatInteger(totalPayments)}</div></article><article class="card metric"><div class="label">Регистрация → покупка</div><div class="value">${(stats.conversion * 100).toFixed(1)}%</div></article><article class="card metric"><div class="label">Пробник → покупка</div><div class="value">${(stats.trialConversion * 100).toFixed(1)}%</div></article></section><section class="money-grid">${revenue}</section><section class="card table-card"><div class="table-head"><h2>Статистика по дням</h2><div class="muted">Первые оплаты: ${formatInteger(firstPayments)} · Все суммы показаны в валюте фактического платежа</div></div><div class="scroll"><table><thead><tr><th>День</th><th>Регистрации</th><th>Пробники</th><th>Первые оплаты</th><th>Все оплаты</th><th>Доход с первых оплат</th><th>Общий доход</th></tr></thead><tbody>${rows}</tbody></table></div></section><section class="card definition"><h2>Как считается статистика</h2><div class="muted">Регистрация учитывается, когда бот впервые создаёт пользователя с рекламной ссылкой <strong>${escape(stats.campaign.adLinkCode)}</strong>. Оплата учитывается только при успешном, нетестовом платеже этого пользователя в течение ${config.attributionDays} дней после регистрации. Бесплатные операции и отменённые платежи не входят в суммы. Часовой пояс отчёта: ${escape(config.timezone)}.</div></section><footer class="footer">Данные RemnaShop · Обновлено ${escape(new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "medium", timeZone: config.timezone }).format(new Date()))}</footer>`;
  return { html: layout({ title: stats.campaign.name, body, basePath: config.basePath, nonce, account: { ...account, csrf } }), nonce };
}
