require "test_helper"

class Http033Test < ActionDispatch::IntegrationTest
  test "renders configured support channels for a full session" do
    sign_in_as(create_web_user)

    get support_path

    assert_response :success
    assert_equal "text/html", response.media_type
    assert_select "h1", "Поддержка"
  end

  test "redirects a guest to the Rails login page" do
    get support_path

    assert_response :see_other
    assert_redirected_to login_path
  end
end
