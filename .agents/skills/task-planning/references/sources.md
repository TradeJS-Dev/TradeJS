# Источники, авторство и лицензии

Адаптация для TradeJS выполнена 29 октября 2026 года и перенесена в
репозиторий `investing` с исправлением путей. Использованы предоставленные
локальные источники. Исходные файлы были доступны; другие версии DevHub
не потребовались. Все необходимые правила и лицензии находятся в этом
наборе: исходный репозиторий и установленный плагин для работы не нужны.
Имена источников ниже служат атрибуцией, а не путями для исполнения.

## Что использовано

- `task-planning` и `task-unit-test-coverage` — русские проектные навыки account.
- `ub-mode`, `devhub-implement`, `devhub-verify`, `devhub-e2e` и пять основных
  справочников — установленный DevHub `0.16.1`; в `plugin.json` автором указан
  `aleksnick`. Из `workflow.md` использованы принципы простоты, без его
  инфраструктуры и обязательного распределения ролей.
- React/UI-навыки — русские адаптации Vercel из account; автор исходных
  навыков `vercel`, MIT. Сохранены точные тексты `LICENSE`:
  [композиция](../../vercel-composition-patterns/LICENSE),
  [React](../../vercel-react-best-practices/LICENSE),
  [интерфейс](../../web-design-guidelines/LICENSE).
- `ub-mode` основан на Robert C. Martin,
  [unclebob/ub-mode, 57a8bdd28e45ed41900ace0bafa2ff76dd9ed70f](https://github.com/unclebob/ub-mode/tree/57a8bdd28e45ed41900ace0bafa2ff76dd9ed70f).
  По атрибуции DevHub отдельной лицензии в том исходнике нет, README описывает
  копирование `SKILL.md`. Локальная адаптация не объявляет его MIT и не
  добавляет разрешение на распространение, которого нет в источнике.
- Ponytail: DietrichGebert,
  [09c434ab73ca43761c5d8b0c5d341926c2fba710](https://github.com/DietrichGebert/ponytail/blob/09c434ab73ca43761c5d8b0c5d341926c2fba710/skills/ponytail/SKILL.md).
  Точный MIT notice сохранён в
  [ponytail.LICENSE](../../ub-mode/references/ponytail.LICENSE).

Отдельная лицензия проектных навыков account и перечисленных материалов
DevHub в прочитанных источниках не найдена; условия не выдуманы и не
заменены общей MIT-лицензией. Авторство и известные notices сохранены.
Это локальная адаптация по поручению пользователя, не юридическое заключение
о правах на дальнейшее публичное распространение.

## Существенные изменения

Выбор владельца и механизма перенесён в `task-planning` и `ub-mode`, правила
тестов и проверок — в `task-unit-test-coverage`, браузерные наблюдения — также
в `web-design-guidelines`. Общие справочники хранятся один раз и подключаются
относительными ссылками. Навыки рассчитаны на установку вместе в `.agents/skills` репозитория `investing`.

Исключены обязательные внешние системы, служебные CLI, досье, схемы отчётов,
специальные каталоги данных, субагенты, многократные аудиты и рутинные
согласования. Истории отдельных чужих MR не перенесены как нормы TradeJS:
не вводятся чужие aliases, правила interface/type, исключения esbuild-jest,
обязательные Page Objects, ICU или особые правила бизнес-аккаунтов.

Ограничения React 18 заменены текущим React 19 и фактическими паттернами
приложения. Добавлены проверенные локально границы Next.js, Chakra/Zustand,
строгих типов, публичных subpaths и точных команд. Новые серверные правила
являются дополнением TradeJS, а не заявлением о содержимом Vercel upstream.
Метрики качества и новое покрытие не обязательны без конкретного риска.

Исследовательский Project bundle из `.codex/skills` не изменён.
Набор не расширяет полномочия на публикацию, сообщения, удаление данных,
интерактивную авторизацию и изменение внешних систем.

## Контрольные суммы прочитанных источников

SHA-256 фиксирует содержимое, на котором основан отбор; исходные файлы не
нужны при исполнении. Обновление требует сравнить изменения и повторно
сверить применимость к TradeJS, а не заменить адаптацию целиком.

| Источник | SHA-256 |
| --- | --- |
| `навыки account: task-planning/SKILL.md` | `4eded54e91e44d3c7bd915d76247399be9d31100aa7345049693dd9706e21e4d` |
| `навыки account: task-unit-test-coverage/SKILL.md` | `658288795a6780a113d0530ef0bdc0b35392e09c61e47026c902639fc61e9a23` |
| `навыки account: vercel-composition-patterns/SKILL.md` | `77930a41d688fef1034284932272630ee938754f2e996e73ef8dc00182bde311` |
| `навыки account: vercel-composition-patterns/references/patterns.md` | `5418cf1729950f1a2018daafbeb1a4316bcef8a9dc110b35d054e2c99f5a7046` |
| `навыки account: vercel-composition-patterns/references/upstream.md` | `606d9346d5b446e22e4b4522ed56d7cd7bc6d5a326e3677fc356bcb677eb094d` |
| `навыки account: vercel-composition-patterns/LICENSE` | `1bd2c994aaf15ff4ae7a80835c12712e44c6a25ffd38e187937c2bc46d2f7d40` |
| `навыки account: vercel-react-best-practices/SKILL.md` | `558347f98c48f129160d33f80f254f78f8035340bb9af099932a7708f0551d42` |
| `навыки account: vercel-react-best-practices/references/client.md` | `6b107f72739454faa119624133211f4e11ce180c13b61921d2aa7855c1b3a1fb` |
| `навыки account: vercel-react-best-practices/references/upstream.md` | `3fa41927ff39bdb196ef8dd8f7ab4539b257651f067a5dd69f9d97f51dce0a7b` |
| `навыки account: vercel-react-best-practices/LICENSE` | `1bd2c994aaf15ff4ae7a80835c12712e44c6a25ffd38e187937c2bc46d2f7d40` |
| `навыки account: web-design-guidelines/SKILL.md` | `1b238b2f51bd20015864b2e51bce0b3dbdcef1c57588538c28d0991c93714edb` |
| `навыки account: web-design-guidelines/references/interface.md` | `c5cde415c39c98f175e6ca61f4861722a3d95d23fa970570e7b0d32a3ab8af44` |
| `навыки account: web-design-guidelines/references/upstream.md` | `0c5ac5b729591b24d423cd77418f0d4e1060afc5bcd37209db1da85f65a2e1a7` |
| `навыки account: web-design-guidelines/LICENSE` | `6cd1609c9c12233507cdd2ce0d32e9a721e3c27494951be06b90090deeeb7af2` |
| `DevHub 0.16.1: skills/ub-mode/SKILL.md` | `434679426b648ec0dafaf26d5ee7544ffba588e37fc3822ad02dc97bba37bd77` |
| `DevHub 0.16.1: skills/devhub-implement/SKILL.md` | `4887b8a29759ebee262c0b6c512c5134d2afee8ee7bff741183884f385319e56` |
| `DevHub 0.16.1: skills/devhub-verify/SKILL.md` | `ec7100bd029feb6dc017dac9f5d4902a34869a7b16e2d3abc885ccb97fd9b971` |
| `DevHub 0.16.1: skills/devhub-e2e/SKILL.md` | `49fb0f0555c24f56ec2f65f2e44e3e7962ed6d4e1cc4e64f3532fc8c2c50a347` |
| `DevHub 0.16.1: references/implementation-decisions.md` | `fdcc698726f4ae0d67d8d032b320300fa60c9dfe27d1ab7bbd9204b29c7fff21` |
| `DevHub 0.16.1: references/solution-review.md` | `c26e0b934781295b77ace07339641cc2ac8d6d2cba76a95f0a3eb4f9047b965a` |
| `DevHub 0.16.1: references/test-quality.md` | `e5690e4814089f8f33136270de923ae608a7bacef229ee14dcec1b0119635703` |
| `DevHub 0.16.1: references/review-standards.md` | `a18353419afbb5b87900abb716a31e511bfa1464c8f57e05f5710f4c359d9b44` |
| `DevHub 0.16.1: references/ponytail.md` | `636a293f87d37bf66ae92b799056588c757d52e4710dfbf32d788f1a1943d40b` |
| `DevHub 0.16.1: references/ponytail.LICENSE` | `fb1bc6909ac3ef82d5c22106e32ef682b0cff66788fa915fb9b53b15c9d2f3ab` |
| `DevHub 0.16.1: references/workflow.md` | `859dd3be5db96c62b38ea8641666610cd4139ae21c2089ef16bb919ea6f44bc0` |
