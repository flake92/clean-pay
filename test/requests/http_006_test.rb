require "test_helper"

class Http006Test < ActionDispatch::IntegrationTest
  test "changes the upstream password and replaces every local session" do
    user = create_web_user
    current_tokens = sign_in_as(user)
    peer_session = create_web_session(web_user: user)
    upstream = Integrations::RemnashopClient::AuthResult.new(
      body: {
        "expires_at" => 15.minutes.from_now.iso8601,
        "refresh_expires_at" => 30.days.from_now.iso8601
      },
      access_token: "new-upstream-access",
      refresh_token: "new-upstream-refresh",
      remnashop_user_id: "owner"
    )
    client = Object.new
    client.define_singleton_method(:change_password) do |access_token:, payload:|
      raise unless access_token == current_tokens.web_session.remnashop_access_token
      raise unless payload["current_password"] == "old secret"

      upstream
    end
    current_tokens.web_session.update!(
      remnashop_access_token: "old-upstream-access"
    )

    Integrations::RemnashopClient.stub(:new, client) do
      patch "/account/password",
        params: {
          password: {
            current_password: "old secret",
            new_password: "new secret value"
          }
        }
    end

    assert_redirected_to profile_path
    assert_not_nil current_tokens.web_session.reload.revoked_at
    assert_not_nil peer_session.reload.revoked_at
    assert_equal 1, user.web_sessions.active.count
    assert_equal "new-upstream-access",
      user.web_sessions.active.first.remnashop_access_token
  end
end
