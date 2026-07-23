require "test_helper"

class AuditLogTest < ActiveSupport::TestCase
  test "is immutable after insertion" do
    log = AuditLog.create!(
      web_user: create_web_user,
      action: "identity.login",
      metadata: { "result" => "ok" }
    )

    assert_not log.update(action: "changed")
    assert_equal "identity.login", log.reload.action
    assert_not log.destroy
    assert_predicate log.reload, :persisted?
  end

  test "audit writer recursively filters sensitive metadata" do
    log = Platform::AuditWriter.new.call(
      action: "security_test",
      web_user: create_web_user,
      metadata: {
        safe: "visible",
        nested: {
          password: "open-password",
          token: "open-token"
        }
      }
    )

    assert_equal "visible", log.metadata.fetch("safe")
    assert_equal "[FILTERED]", log.metadata.dig("nested", "password")
    assert_equal "[FILTERED]", log.metadata.dig("nested", "token")
  end
end
