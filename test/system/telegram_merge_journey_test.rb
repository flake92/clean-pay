require "application_system_test_case"

class TelegramMergeJourneyTest < ApplicationSystemTestCase
  test "requires explicit consent, supports cancel and completes a later merge" do
    user = create_web_user(
      remnashop_user_id: "100",
      telegram_id: "42",
      telegram_username: "clean_pay"
    )
    sign_in_browser(web_user: user, auth_method: :telegram, upstream: true)
    client = MergeClient.new

    with_telegram_bot_token do
      Integrations::RemnashopClient.stub(:new, client) do
        visit link_account_path
        submit_email_link

        first_confirmation = user.account_merge_confirmations.last
        assert_current_path account_merge_confirmation_path
        assert_text "Подтвердите объединение аккаунтов"
        assert_text first_confirmation.masked_target_email
        assert_not_equal "200", user.reload.remnashop_user_id

        click_button "Отмена"
        assert_current_path link_account_path
        assert_text "Объединение отменено."
        assert_predicate first_confirmation.reload, :failed?
        assert_equal "100", user.reload.remnashop_user_id

        submit_email_link
        second_confirmation = user.account_merge_confirmations
          .where.not(id: first_confirmation.id)
          .sole
        assert_not_equal first_confirmation.id, second_confirmation.id
        click_button "Объединить аккаунты"

        assert_current_path cabinet_path
        assert_text "Аккаунты объединены."
        assert_predicate second_confirmation.reload, :completed?
        assert_equal "200", user.reload.remnashop_user_id
        assert_equal "target@example.test", user.email
      end
    end

    assert_equal [ true, true, true, false ], client.merge_modes
  end

  class MergeClient
    attr_reader :merge_modes

    def initialize
      @merge_modes = []
      @telegram_owners = %w[100 200]
    end

    def login(*) = upstream_auth("200")

    def me(*)
      if merge_modes.include?(false)
        {
          "email" => "target@example.test",
          "is_email_verified" => true,
          "telegram_id" => "42"
        }
      else
        {
          "email" => "target@example.test",
          "is_email_verified" => true,
          "telegram_id" => nil
        }
      end
    end

    def telegram_auth(*) = upstream_auth(@telegram_owners.shift)

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

    def current_subscription(*) = nil

    private

    def upstream_auth(owner)
      Integrations::RemnashopClient::AuthResult.new(
        body: {
          "expires_at" => 15.minutes.from_now.iso8601,
          "refresh_expires_at" => 30.days.from_now.iso8601
        },
        access_token: "#{owner}-access",
        refresh_token: "#{owner}-refresh",
        remnashop_user_id: owner
      )
    end
  end

  private

  def submit_email_link
    fill_in "E-mail", with: "target@example.test"
    fill_in "Пароль", with: "transient-secret"
    click_button "Подключить e-mail"
  end

  def with_telegram_bot_token
    current = Rails.application.config.x.clean_pay
    configured = current.dup
    telegram = current.telegram.with(
      bot_token: CleanPay::AppConfig::Secret.new("12345:test-token")
    )
    configured.instance_variable_set(:@telegram, telegram)
    Rails.application.config.x.stub(:clean_pay, configured) { yield }
  end
end
