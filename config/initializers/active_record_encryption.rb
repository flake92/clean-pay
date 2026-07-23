master_secret =
  Rails.application.config.x.clean_pay.security.refresh_secret&.value ||
  Rails.application.secret_key_base
key_generator = ActiveSupport::KeyGenerator.new(master_secret, iterations: 65_536)

Rails.application.config.active_record.encryption.tap do |encryption|
  encryption.primary_key =
    key_generator.generate_key("clean-pay/active-record/primary", 32)
  encryption.deterministic_key =
    key_generator.generate_key("clean-pay/active-record/deterministic", 32)
  encryption.key_derivation_salt =
    key_generator.generate_key("clean-pay/active-record/salt", 32)
  encryption.support_unencrypted_data = false
  encryption.extend_queries = false
end
