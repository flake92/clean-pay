require "test_helper"

class Http026Test < ActionDispatch::IntegrationTest
  test "reissues subscription and redirects to rendered resource" do
    tokens = sign_in_with_upstream
    operation = Minitest::Mock.new
    operation.expect(
      :reissue,
      { "success" => true },
      [],
      web_session: tokens.web_session
    )

    Subscriptions::AccountActions.stub(:new, operation) do
      post reissue_subscription_path
    end

    assert_redirected_to subscription_path
    assert_equal "Ссылка подписки перевыпущена.", flash[:notice]
    operation.verify
  end
end
