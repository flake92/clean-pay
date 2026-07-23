require "test_helper"

class MailpitContractTest < ActiveSupport::TestCase
  MAILPIT_BASE = "http://127.0.0.1:8025"

  test "MP-001 readiness uses the real Mailpit messages endpoint" do
    client = Integrations::MailpitClient.new(
      http: Integrations::HttpClient.new(base_url: MAILPIT_BASE, timeout: 5)
    )

    assert_predicate client, :ready?
  end

  test "MAIL-001 SMTP-001 and MP-002/003 deliver a real Remnashop code" do
    email = "mail-contract-#{SecureRandom.hex(10)}@example.test"
    password = "CleanPay-#{SecureRandom.hex(10)}-A1!"
    result = Integrations::RemnashopClient.new.register(
      email:,
      password:,
      name: "Clean Pay Mail Contract"
    )

    assert_predicate result.access_token, :present?
    assert_predicate result.refresh_token, :present?
    assert_predicate result.remnashop_user_id, :present?

    requested = Integrations::RemnashopClient.new.request_email_verification(
      access_token: result.access_token,
      email:
    )
    assert_equal true, requested.fetch("success")
    assert_equal email, requested.fetch("target_email")

    message = wait_for_message(email)
    assert_equal "Your verification code", message.fetch("Subject")

    full = mailpit.request(
      :get,
      "api/v1/message/#{ERB::Util.url_encode(message.fetch("ID"))}"
    ).body
    body = [
      full["Text"],
      full["HTML"],
      full["Body"]
    ].compact.join("\n")
    assert_match(/verification code/i, body)
    code = body[/\b\d{6}\b/]
    assert_predicate code, :present?

    confirmed = Integrations::RemnashopClient.new.confirm_email(
      access_token: result.access_token,
      code:
    )
    assert_equal true, confirmed.fetch("success")
    assert_equal email, confirmed.fetch("email")

    profile = Integrations::RemnashopClient.new.me(
      access_token: result.access_token
    )
    assert_equal email, profile.fetch("email")
    assert_equal true, profile.fetch("is_email_verified")

    login = Integrations::RemnashopClient.new.login(email:, password:)
    assert_equal result.remnashop_user_id, login.remnashop_user_id
    refreshed = Integrations::RemnashopClient.new.refresh(
      refresh_token: login.refresh_token
    )
    assert_equal result.remnashop_user_id, refreshed.remnashop_user_id

    next_email = "changed-#{email}"
    changed = Integrations::RemnashopClient.new.change_email(
      access_token: refreshed.access_token,
      email: next_email
    )
    assert_equal true, changed.fetch("success")
    assert_equal next_email, changed.fetch("pending_email")

    requested_after_change = Integrations::RemnashopClient.new.request_email_verification(
      access_token: refreshed.access_token,
      email: next_email
    )
    assert_equal true, requested_after_change.fetch("success")
    assert_equal next_email, requested_after_change.fetch("target_email")
    assert_equal next_email,
      Array(wait_for_message(next_email).fetch("To")).first.fetch("Address")
  end

  private

  def mailpit
    @mailpit ||= Integrations::HttpClient.new(
      base_url: MAILPIT_BASE,
      timeout: 5
    )
  end

  def wait_for_message(email)
    deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 45
    loop do
      response = mailpit.request(:get, "api/v1/messages")
      message = Array(response.body["messages"]).find do |item|
        Array(item["To"]).any? {
          _1["Address"].to_s.casecmp?(email)
        }
      end
      return message if message
      raise "Mailpit did not receive #{email}" if
        Process.clock_gettime(Process::CLOCK_MONOTONIC) >= deadline

      sleep 0.5
    end
  end
end
