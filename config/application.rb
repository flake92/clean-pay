require_relative "boot"

require "rails"
# Pick the frameworks you want:
require "active_model/railtie"
# require "active_job/railtie"
require "active_record/railtie"
# require "active_storage/engine"
require "action_controller/railtie"
# require "action_mailer/railtie"
# require "action_mailbox/engine"
# require "action_text/engine"
require "action_view/railtie"
# require "action_cable/engine"
require "rails/test_unit/railtie"

# Require the gems listed in Gemfile, including any gems
# you've limited to :test, :development, or :production.
Bundler.require(*Rails.groups)

require_relative "app_config"

module CleanPay
  class Application < Rails::Application
    # Initialize configuration defaults for originally generated Rails version.
    config.load_defaults 8.1

    # Please, add to the `ignore` list any other `lib` subdirectories that do
    # not contain `.rb` files, or that should not be reloaded or eager loaded.
    # Common ones are `templates`, `generators`, or `middleware`, for example.
    config.autoload_lib(ignore: %w[assets tasks])

    # Configuration for the application, engines, and railties goes here.
    #
    # These settings can be overridden in specific environments using the files
    # in config/environments, which are processed later.
    #
    config.time_zone = "UTC"
    config.i18n.default_locale = :ru
    config.i18n.available_locales = [ :ru ]
    config.turbo.draw_routes = false
    config.action_controller.forgery_protection_origin_check = true

    config.x.clean_pay = AppConfig.load
    config.cache_store = :redis_cache_store, {
      url: config.x.clean_pay.storage.redis.to_s,
      namespace: "clean-pay:cache",
      connect_timeout: 1,
      read_timeout: 0.5,
      write_timeout: 0.5,
      reconnect_attempts: 1,
      pool: {
        size: ENV.fetch("RAILS_MAX_THREADS", 5).to_i,
        timeout: 1
      },
      error_handler: lambda do |method:, returning:, exception:|
        Rails.error.report(
          exception,
          handled: true,
          severity: :warning,
          context: { source: "redis_cache", method:, returning: }
        )
      end
    }
  end
end
