require "test_helper"

class Http018Test < ActionDispatch::IntegrationTest
  test "confirms merge through model operation and clears evidence" do
    user = create_web_user(
      remnashop_user_id: "100",
      telegram_id: "42"
    )
    tokens = sign_in_as(user)
    confirmation, token = issue_confirmation(user)
    cookies[:clean_pay_account_merge] = token
    operation = Minitest::Mock.new
    result = Identity::AccountMerge::Result.new(
      web_user: user,
      access_token: "reissued-access",
      replayed: false
    )
    operation.expect(
      :call!,
      result,
      [],
      confirmation:,
      web_session: tokens.web_session
    )

    Identity::AccountMerge.stub(:new, operation) do
      patch account_merge_confirmation_path
    end

    assert_redirected_to cabinet_path
    assert_equal "Аккаунты объединены.", flash[:notice]
    assert cookies[:clean_pay_account_merge].blank?
    assert_equal "reissued-access", cookies[:clean_pay_access]
    operation.verify
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
