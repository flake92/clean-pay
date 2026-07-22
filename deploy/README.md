# Развёртывание будущего Ruby-монолита

Старые Node/Next entrypoints удалены. Рабочее развёртывание нельзя восстанавливать копированием прежних скриптов.

Новый deploy-комплект должен содержать Ruby image, web/retention/reconciliation команды одного релиза, строгую проверку переменных, миграции без сброса БД, healthchecks, backup/restore/update и подключение к внешней edge-сети. Полный контракт находится в `software-spec/07-operations/`, `08-quality/` и `02-interfaces/configuration.md`.

До появления и проверки этих файлов `docker-compose.yml` используется только как test/prestage-инфраструктура без приложения.
