require "test_helper"

class Http020Test < ActionDispatch::IntegrationTest
  test "links verified Remnashop owner and redirects to account page" do
    user = create_web_user(
      remnashop_user_id: nil,
      telegram_id: "42"
    )
    tokens = sign_in_as(user, auth_method: :telegram)
    auth = upstream_auth("200")
    client = FakeClient.new(
      auth:,
      profile: {
        "email" => "owner@example.test",
        "is_email_verified" => true,
        "telegram_id" => "42"
      }
    )

    Integrations::RemnashopClient.stub(:new, client) do
      post account_remnashop_link_path, params: {
        remnashop_link: {
          email: "owner@example.test",
          password: "secret-password"
        }
      }
    end

    assert_redirected_to link_account_path
    assert_equal "200", user.reload.remnashop_user_id
    assert_equal "owner@example.test", user.email
    assert_predicate user, :email_verified?
    assert_equal "upstream-access", tokens.web_session.reload.remnashop_access_token
  end

  test "creates explicit confirmation instead of silently replacing owner" do
    user = create_web_user(
      remnashop_user_id: "100",
      telegram_id: "42",
      telegram_username: "clean_pay"
    )
    sign_in_as(user, auth_method: :telegram)
    auth = upstream_auth("200")
    client = FakeClient.new(
      auth:,
      profile: {
        "email" => "target@example.test",
        "is_email_verified" => true,
        "telegram_id" => nil
      },
      merge: {
        "dry_run" => true,
        "source_user_id" => 100,
        "target_user_id" => 200,
        "conflicts" => []
      }
    )

    Integrations::RemnashopClient.stub(:new, client) do
      post account_remnashop_link_path, params: {
        remnashop_link: {
          email: "target@example.test",
          password: "secret-password"
        }
      }
    end

    assert_redirected_to account_merge_confirmation_path
    confirmation = user.account_merge_confirmations.last
    assert_equal "100", confirmation.source_remnashop_user_id
    assert_equal "200", confirmation.target_remnashop_user_id
    assert cookies[:clean_pay_account_merge].present?
    assert_equal "100", user.reload.remnashop_user_id
  end

  class FakeClient
    def initialize(auth:, profile:, merge: nil)
      @auth = auth
      @profile = profile
      @merge = merge
    end

    def login(*) = @auth
    def me(*) = @profile
    def merge_users(*) = @merge
  end

  private

  def upstream_auth(owner)
    Integrations::RemnashopClient::AuthResult.new(
      body: {
        "expires_at" => 15.minutes.from_now.iso8601,
        "refresh_expires_at" => 30.days.from_now.iso8601
      },
      access_token: "upstream-access",
      refresh_token: "upstream-refresh",
      remnashop_user_id: owner
    )
  end
end
