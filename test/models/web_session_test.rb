require "test_helper"

class WebSessionTest < ActiveSupport::TestCase
  test "tracks access and refresh lifecycle" do
    session = create_web_session

    assert_predicate session, :active?
    assert_predicate session, :access_active?

    session.revoke!

    assert_not session.active?
    assert_not session.access_active?
  end

  test "encrypts upstream tokens at rest" do
    session = create_web_session(
      remnashop_access_token: "access-secret",
      remnashop_refresh_token: "refresh-secret"
    )
    raw = WebSession.connection.select_one(
      WebSession.sanitize_sql_array(
        [ "SELECT remnashop_access_token, remnashop_refresh_token FROM web_sessions WHERE id = ?", session.id ]
      )
    )

    assert_equal "access-secret", session.reload.remnashop_access_token
    refute_equal "access-secret", raw.fetch("remnashop_access_token")
    refute_equal "refresh-secret", raw.fetch("remnashop_refresh_token")
  end

  test "moves upstream token custody to exactly one active session" do
    user = create_web_user
    previous = create_web_session(
      web_user: user,
      remnashop_access_token: "old-access",
      remnashop_refresh_token: "old-refresh"
    )
    current = create_web_session(web_user: user)

    current.take_remnashop_token_custody!(
      access_token: "new-access",
      refresh_token: "new-refresh",
      access_expires_at: 10.minutes.from_now,
      refresh_expires_at: 1.day.from_now
    )

    assert_nil previous.reload.remnashop_access_token
    assert_equal "new-access", current.reload.remnashop_access_token
    assert_equal 1, user.web_sessions.active.count {
      |session| session.remnashop_access_token.present?
    }
  end
end
