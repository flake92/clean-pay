ENV["RAILS_ENV"] ||= "test"
require_relative "../config/environment"
require "rails/test_help"
require "minitest/mock"

module ActiveSupport
  class TestCase
    # Native database adapters are not fork-safe on every supported workstation.
    # CI may opt into process parallelism after provisioning isolated test DBs.
    parallelize(workers: ENV.fetch("PARALLEL_WORKERS", "1").to_i)

    # Setup all fixtures in test/fixtures/*.yml for all tests in alphabetical order.
    fixtures :all

    private

    def create_web_user(**attributes)
      WebUser.create!(
        {
          email: "#{SecureRandom.hex(8)}@example.test",
          email_verified: true
        }.merge(attributes)
      )
    end

    def create_web_session(web_user: create_web_user, **attributes)
      WebSession.create!(
        {
          web_user:,
          refresh_token_hash: SecureRandom.hex(32),
          access_expires_at: 15.minutes.from_now,
          refresh_expires_at: 30.days.from_now
        }.merge(attributes)
      )
    end

    def json_headers(origin: Rails.application.config.x.clean_pay.urls.app.origin)
      {
        "CONTENT_TYPE" => "application/json",
        "HTTP_ORIGIN" => origin
      }
    end

    def parsed_response
      ::JSON.parse(response.body)
    end

    def sign_in_as(web_user, auth_method: :email, assurance_level: :full)
      tokens = Identity::SessionAuthenticator.new.issue!(
        web_user:,
        auth_method:,
        assurance_level:
      )
      cookies[:clean_pay_access] = tokens.access_token
      cookies[:clean_pay_refresh] = tokens.refresh_token
      tokens
    end

    def sign_in_with_upstream(web_user = create_web_user, **options)
      tokens = sign_in_as(web_user, **options)
      tokens.web_session.update!(
        remnashop_access_token: "upstream-access",
        remnashop_refresh_token: "upstream-refresh",
        remnashop_access_token_expires_at: 15.minutes.from_now,
        remnashop_refresh_token_expires_at: 30.days.from_now
      )
      tokens
    end

    def stubbed_authentication_result(web_user: create_web_user)
      upstream = Integrations::RemnashopClient::AuthResult.new(
        body: {
          "expires_at" => 15.minutes.from_now.iso8601,
          "refresh_expires_at" => 30.days.from_now.iso8601
        },
        access_token: "upstream-access",
        refresh_token: "upstream-refresh",
        remnashop_user_id: "upstream-owner"
      )
      tokens = Identity::SessionAuthenticator.new.issue!(
        web_user:,
        auth_method: :email
      )
      Identity::EmailAuthentication::Result.new(
        web_user:,
        tokens:,
        profile: {
          "email" => web_user.email,
          "is_email_verified" => web_user.email_verified?
        },
        upstream_auth: upstream
      )
    end
  end
end
