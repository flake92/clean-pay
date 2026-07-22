# Наблюдаемые дизайн-токены текущего интерфейса

Этот документ сохраняет базовую визуальную систему. Он не заменяет экранные эталоны: итоговые значения вычисленных стилей должны быть подтверждены снимками и браузерными измерениями.

## Шрифты

| Назначение | Наблюдаемое значение |
|---|---|
| базовое семейство темы | `"Inter var", sans-serif` |
| загруженный переменный sans | Geist, доступен как `--font-geist-sans` |
| загруженный mono | Geist Mono, доступен как `--font-geist-mono` |
| сглаживание | `-webkit-font-smoothing: antialiased`, `-moz-osx-font-smoothing: grayscale` |
| feature settings темы | `"cv02","cv03","cv04","cv11"` |

Фактическое базовое семейство определяется каскадом темы и должно быть измерено в браузере: наличие Geist в корневом классе само по себе не доказывает, что он перекрывает `--font-family` PrimeReact.

## Основная палитра

| Токен/роль | Значение |
|---|---|
| фон приложения `--background` | `#eff3f8` |
| основной foreground | `#111827` |
| primary | `#6366f1` |
| primary hover | `#4f46e5` |
| primary text | `#ffffff` |
| информационная кнопка | `#0ea5e9`; hover `#0284c7` |
| ошибка/invalid | `#ef4444` |
| surface ground темы | `#f9fafb` |
| surface card/overlay | `#ffffff` |
| surface border темы | `#dfe7ef` |
| surface hover | `#f6f9fc` |
| основной текст темы | `#4b5563` |
| вторичный текст темы | `#6b7280` |
| заголовки/card title | `#334155` |
| muted card subtitle | `#64748b` |
| focus ring темы | `0 0 0 0.2rem #c7d2fe` |
| маска overlay | `rgba(0,0,0,0.4)` |

Шкала primary: `50 #f7f7fe`, `100 #dadafc`, `200 #bcbdf9`, `300 #9ea0f6`, `400 #8183f4`, `500 #6366f1`, `600 #5457cd`, `700 #4547a9`, `800 #363885`, `900 #282960`.

## Примитивы форм

### Поле ввода

- фон `#ffffff`;
- граница `1px solid #d1d5db`;
- радиус `6px`;
- текст `#111827`, `1rem`, line-height `1.5`;
- padding `0.75rem`;
- placeholder `#8b95a5`;
- hover/focus border `#6366f1`;
- focus shadow `0 0 0 0.2rem rgba(99,102,241,0.16)`;
- invalid border `#ef4444`.

### Основная кнопка

- фон и граница `#6366f1`, текст белый;
- радиус `6px`;
- font-weight `700`, line-height `1.25`;
- min-height `3.125rem`, padding `0.875rem 1.25rem`;
- inline-flex, центрирование, gap `0.5rem`, `white-space:nowrap`;
- disabled opacity `0.65`, cursor default;
- hover `#4f46e5`;
- focus shadow `0 0 0 0.2rem rgba(99,102,241,0.22)`.

Outlined/text-кнопки прозрачны, имеют primary text и hover-фон `rgba(99,102,241,0.08)`.

### Карточка

- фон `#ffffff`;
- граница `1px solid #dce3ec`;
- радиус `8px`;
- тень `0 1px 3px rgba(15,23,42,0.12)`;
- основной текст `#334155`;
- body: column, gap `1.125rem`, padding `2rem`;
- title: `1.5rem`, weight `700`, line-height `1.25`;
- subtitle: `#64748b`, weight `400`, line-height `1.4`.

### Метка состояния

Радиус `6px`, размер `0.8125rem`, weight `700`, line-height `1.25`, min-height `1.625rem`, padding `0.25rem 0.5rem`.

## Оболочка аутентификации

| Элемент | Значение |
|---|---|
| страница | min-height `100vh` и `100dvh`, padding `1rem`, центрирование по двум осям |
| внешний frame | max-width `42rem`, border `1px solid surface-border`, radius `24px`, padding `0.25rem`, белый фон |
| внутренняя поверхность | radius `20px`, padding `2.25rem 3rem` |
| ограничитель контента | max-width `34rem`, auto horizontal margins |
| логотип | `68×68px` (`4.25rem`), radius `10px`, `object-fit:cover` |
| title | класс размера `text-3xl`, medium; точное вычисленное значение требуется снять браузером |

### Мобильный экран ≤480 px

- выравнивание страницы сверху; padding `0.75rem`;
- frame `calc(100vw - 1.5rem)`;
- card padding `1.25rem 1rem`;
- logo `3.5rem`;
- title `2rem`, line-height `1.15`;
- description `1rem`, line-height `1.45`;
- input/button min-height `3rem`.

### Узкий mobile ≤360 px

- page padding `0.5rem`;
- frame `calc(100vw - 1rem)`;
- card padding `1rem 0.75rem`;
- title `1.75rem`.

## Основная кабинетная оболочка

| Элемент | Desktop ≥992 px | Mobile ≤991 px |
|---|---|---|
| topbar | fixed, `height:5rem`, `padding:0 2rem`, white, z-index 997 | та же высота; элементы переставлены, дополнительное меню раскрывается справа под topbar |
| logo area | width `300px`, текст `1.5rem`, image height `2.5rem` | width auto, order 2 |
| sidebar | fixed width `300px`, top `7rem`, left `2rem`, height `calc(100vh - 9rem)`, padding `0.5rem 1.5rem`, radius `12px`, z-index 999 | скрыт `translateX(-100%)`, при открытии `left:0;top:0;height:100vh`, углы слева без радиуса |
| main container | min-height `100vh`, padding `7rem 2rem 2rem 4rem` | margin-left 0, padding-left `2rem` |
| static main offset | margin-left `300px` | отсутствует |
| overlay mask | скрыта | fixed fullscreen, z-index 998, `rgba(0,0,0,0.4)` при открытом меню |

При ширине ≥1960 px `.layout-main` ограничивается `1504px` и центрируется.

## Навигационные состояния

- menu link: padding `0.75rem 1rem`, радиус `12px`, переход `0.2s`;
- active route: weight `700`, primary color;
- hover: `surface-hover`;
- keyboard focus: inset focus ring;
- topbar round button: `3rem × 3rem`, radius `50%`, icon `1.5rem`;
- mobile topbar popup: right `2rem`, top `5rem`, min-width `15rem`, padding `1rem`, radius `12px`.

## Статус проверки

Значения сверены с реально отрисованными desktop/mobile эталонами и повторным браузерным рендером автономного макета. Итоговый каскад темы, utility-классов и локальных правил представлен именно эталонными JPEG; при расхождении отдельного токена и растра авторитетен растр. Отчёт и ограничения автоматической метрики находятся в `visual-comparison-report.md`.
