require "test_helper"

class Http012Test < ActionDispatch::IntegrationTest
  test "creates public passkey authentication options without a body" do
    post "/account/passkey_session", headers: json_headers

    assert_response :ok
    assert_equal "required", parsed_response.dig("data", "userVerification")
    assert_equal 60_000, parsed_response.dig("data", "timeout")
    assert_nil parsed_response.dig("data", "allowCredentials")
    assert_equal 1, WebAuthnChallenge.authentication.count
  end
end
