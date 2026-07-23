require "test_helper"

class Http017Test < ActionDispatch::IntegrationTest
  test "renders owner-bound masked merge confirmation" do
    user = create_web_user(
      remnashop_user_id: "100",
      telegram_id: "42"
    )
    sign_in_as(user)
    confirmation, token = issue_confirmation(user)
    cookies[:clean_pay_account_merge] = token

    get account_merge_confirmation_path

    assert_response :success
    assert_select "h1", "Подтвердите объединение аккаунтов"
    assert_includes response.body, confirmation.masked_target_email
    assert_not_includes response.body, confirmation.target_email
    assert_select "form[action=?]", account_merge_confirmation_path, count: 2
  end

  private

  def issue_confirmation(user)
    AccountMergeConfirmation.issue!(
      web_user: user,
      source_remnashop_user_id: "100",
      target_remnashop_user_id: "200",
      source_email: user.email,
      target_email: "target@example.test",
      telegram_id: user.telegram_id
    )
  end
end
