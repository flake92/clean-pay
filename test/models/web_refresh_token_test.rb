require "test_helper"

class WebRefreshTokenTest < ActiveSupport::TestCase
  test "stores the successor encrypted and exposes it only during grace" do
    predecessor = create_web_session.web_refresh_tokens.create!(
      token_hash: SecureRandom.hex(32),
      successor_token: "same-successor",
      consumed_at: Time.current,
      grace_expires_at: 30.seconds.from_now
    )
    ciphertext = WebRefreshToken.connection.select_value(
      WebRefreshToken.sanitize_sql_array(
        [ "SELECT successor_token FROM web_refresh_tokens WHERE id = ?", predecessor.id ]
      )
    )

    assert_predicate predecessor, :grace_active?
    assert_equal "same-successor", predecessor.reload.successor_token
    refute_equal "same-successor", ciphertext
  end

  test "rejects grace before consumption" do
    predecessor = create_web_session.web_refresh_tokens.new(
      token_hash: SecureRandom.hex(32),
      successor_token: "successor",
      consumed_at: Time.current,
      grace_expires_at: 1.second.ago
    )

    assert_not predecessor.valid?
    assert predecessor.errors.of_kind?(:grace_expires_at, :invalid)
  end
end
