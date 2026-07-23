require "test_helper"

class Http005Test < ActionDispatch::IntegrationTest
  test "revokes all user sessions and clears both cookies" do
    user = create_web_user
    current = sign_in_as(user)
    other = create_web_session(web_user: user)

    delete "/account/session"

    assert_redirected_to root_path
    assert_predicate current.web_session.reload.revoked_at, :present?
    assert_predicate other.reload.revoked_at, :present?
    set_cookie = response.headers["Set-Cookie"].join("\n")
    assert_includes set_cookie, "clean_pay_access=;"
    assert_includes set_cookie, "clean_pay_refresh=;"
  end
end
