WebAuthn.configure do |config|
  app = Rails.application.config.x.clean_pay

  config.allowed_origins = [ app.urls.app.origin ]
  config.rp_id = app.urls.app.host
  config.rp_name = app.brand.name
  config.credential_options_timeout = 120_000
end
