Rails.application.configure do
  config.content_security_policy do |policy|
    policy.default_src :self
    policy.base_uri :self
    policy.object_src :none
    policy.frame_ancestors :none
    policy.form_action :self
    policy.font_src :self, :data
    policy.img_src :self, :data,
      "https://oauth.telegram.org",
      "https://telegram.org",
      "https://*.telegram.org",
      "https://t.me"
    policy.script_src :self,
      "https://telegram.org",
      "https://challenges.cloudflare.com"
    policy.style_src :self
    policy.connect_src :self,
      "https://oauth.telegram.org",
      "https://challenges.cloudflare.com"
    policy.frame_src "https://challenges.cloudflare.com"
    policy.manifest_src :self
    policy.worker_src :self
  end

  config.content_security_policy_nonce_generator =
    ->(_request) { SecureRandom.base64(16) }
  config.content_security_policy_nonce_directives = %w[script-src style-src]
end
