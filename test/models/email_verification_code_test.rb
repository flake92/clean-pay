require "test_helper"

class EmailVerificationCodeTest < ActiveSupport::TestCase
  test "consumes the correct code exactly once" do
    verification, code = EmailVerificationCode.issue!(web_user: create_web_user)

    refute_equal code, verification.code_hash
    verification.consume!(code)

    assert_predicate verification.reload.consumed_at, :present?
    assert_raises(EmailVerificationCode::UnavailableError) do
      verification.consume!(code)
    end
  end

  test "counts failed attempts and locks at the maximum" do
    verification, code = EmailVerificationCode.issue!(
      web_user: create_web_user,
      max_attempts: 2
    )

    2.times do
      assert_raises(EmailVerificationCode::UnavailableError) do
        verification.consume!("wrong-code")
      end
    end

    assert_equal 2, verification.reload.attempts
    assert_raises(EmailVerificationCode::UnavailableError) do
      verification.consume!(code)
    end
  end
end
