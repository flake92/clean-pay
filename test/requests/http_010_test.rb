require "test_helper"

class Http010Test < ActionDispatch::IntegrationTest
  test "creates registration options for a signed-in owner" do
    user = create_web_user
    sign_in_as(user)

    post "/account/passkey_registration", headers: json_headers

    assert_response :ok
    assert_equal Rails.application.config.x.clean_pay.urls.app.host,
      parsed_response.dig("data", "rp", "id")
    assert_equal "none", parsed_response.dig("data", "attestation")
    assert_equal "required",
      parsed_response.dig(
        "data",
        "authenticatorSelection",
        "userVerification"
      )
    assert_equal 1, user.web_authn_challenges.registration.count
  end
end
