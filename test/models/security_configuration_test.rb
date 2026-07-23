require "test_helper"

class SecurityConfigurationTest < ActiveSupport::TestCase
  test "configures restrictive CSP with only contracted browser origins" do
    policy = Rails.application.config.content_security_policy

    assert_equal [ "'self'" ], policy.directives.fetch("default-src")
    assert_equal [ "'none'" ], policy.directives.fetch("object-src")
    assert_equal [ "'none'" ], policy.directives.fetch("frame-ancestors")
    assert_includes policy.directives.fetch("script-src"), "https://telegram.org"
    assert_includes policy.directives.fetch("script-src"),
      "https://challenges.cloudflare.com"
    assert_equal %w[script-src style-src],
      Rails.application.config.content_security_policy_nonce_directives
  end

  test "allows only contracted browser capabilities" do
    header =
      Rails.application.config.action_dispatch.default_headers.fetch(
        "Permissions-Policy"
      )

    assert_includes header, "camera=()"
    assert_includes header, "geolocation=()"
    assert_includes header, "clipboard-write=(self)"
    assert_includes header, "publickey-credentials-get=(self)"
  end

  test "provides bounded Redis and Active Record encryption configuration" do
    config = Rails.application.config

    assert_instance_of ConnectionPool, config.x.redis_pool
    assert_equal "clean-pay", config.x.redis_key_prefix
    assert config.active_record.encryption.primary_key.present?
    assert config.active_record.encryption.deterministic_key.present?
    assert config.active_record.encryption.key_derivation_salt.present?
    assert_equal false, config.active_record.encryption.support_unencrypted_data
  end
end
