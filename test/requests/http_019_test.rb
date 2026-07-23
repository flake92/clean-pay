require "test_helper"

class Http019Test < ActionDispatch::IntegrationTest
  test "cancels only pending merge and clears token cookie" do
    user = create_web_user(
      remnashop_user_id: "100",
      telegram_id: "42"
    )
    sign_in_as(user)
    confirmation, token = AccountMergeConfirmation.issue!(
      web_user: user,
      source_remnashop_user_id: "100",
      target_remnashop_user_id: "200",
      target_email: "target@example.test",
      telegram_id: "42"
    )
    cookies[:clean_pay_account_merge] = token

    delete account_merge_confirmation_path

    assert_redirected_to link_account_path
    assert_predicate confirmation.reload, :failed?
    assert_equal "USER_CANCELLED", confirmation.last_error_code
    assert cookies[:clean_pay_account_merge].blank?
  end
end
