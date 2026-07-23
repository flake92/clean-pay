require "test_helper"

class Identity::AccountMergeTest < ActiveSupport::TestCase
  test "dry-runs, commits, proves target and completes under lease" do
    with_telegram_bot_token do
      user = create_web_user(
        remnashop_user_id: "100",
        telegram_id: "42",
        telegram_username: "clean_pay"
      )
      session = create_web_session(web_user: user)
      confirmation, = issue_confirmation(user)
      client = FakeClient.new(
        authentications: [ upstream_auth("100"), upstream_auth("200") ],
        profile: {
          "telegram_id" => "42",
          "email" => "target@example.test",
          "is_email_verified" => true
        }
      )

      result = Identity::AccountMerge.new(client:).call!(
        confirmation:,
        web_session: session
      )

      assert_predicate confirmation.reload, :completed?
      assert_equal "200", user.reload.remnashop_user_id
      assert_equal "target@example.test", user.email
      assert_equal [ true, false ], client.merge_modes
      assert_equal "target-access", session.reload.remnashop_access_token
      assert result.access_token.present?
      assert_not result.replayed
    end
  end

  test "recognizes already merged upstream owner without a second merge" do
    with_telegram_bot_token do
      user = create_web_user(
        remnashop_user_id: "100",
        telegram_id: "42"
      )
      session = create_web_session(web_user: user)
      confirmation, = issue_confirmation(user)
      client = FakeClient.new(
        authentications: [ upstream_auth("200") ],
        profile: {
          "telegram_id" => "42",
          "email" => "target@example.test",
          "is_email_verified" => true
        }
      )

      Identity::AccountMerge.new(client:).call!(
        confirmation:,
        web_session: session
      )

      assert_predicate confirmation.reload, :completed?
      assert_empty client.merge_modes
    end
  end

  class FakeClient
    attr_reader :merge_modes

    def initialize(authentications:, profile:)
      @authentications = authentications
      @profile = profile
      @merge_modes = []
    end

    def telegram_auth(*)
      @authentications.shift || raise("unexpected Telegram authentication")
    end

    def merge_users(payload:, dry_run:)
      @merge_modes << dry_run
      {
        "dry_run" => dry_run,
        "source_user_id" => payload.fetch(:source_user_id),
        "target_user_id" => payload.fetch(:target_user_id),
        "conflicts" => [],
        "requires_relogin" => !dry_run
      }
    end

    def me(*) = @profile
  end

  private

  def issue_confirmation(user)
    AccountMergeConfirmation.issue!(
      web_user: user,
      source_remnashop_user_id: "100",
      target_remnashop_user_id: "200",
      source_email: user.email,
      target_email: "target@example.test",
      telegram_id: "42",
      telegram_username: user.telegram_username
    )
  end

  def upstream_auth(owner)
    Integrations::RemnashopClient::AuthResult.new(
      body: {
        "expires_at" => 15.minutes.from_now.iso8601,
        "refresh_expires_at" => 30.days.from_now.iso8601
      },
      access_token: owner == "200" ? "target-access" : "source-access",
      refresh_token: owner == "200" ? "target-refresh" : "source-refresh",
      remnashop_user_id: owner
    )
  end

  def with_telegram_bot_token
    current = Rails.application.config.x.clean_pay
    configured = current.dup
    telegram = current.telegram.with(
      bot_token: CleanPay::AppConfig::Secret.new("12345:test-telegram-token")
    )
    configured.instance_variable_set(:@telegram, telegram)
    Rails.application.config.x.stub(:clean_pay, configured) { yield }
  end
end
