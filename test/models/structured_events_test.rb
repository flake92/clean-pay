require "test_helper"

class StructuredEventsTest < ActiveSupport::TestCase
  test "emits one recursively filtered JSON line" do
    output = StringIO.new
    logger = ActiveSupport::Logger.new(output)
    logger.formatter = CleanPay::JsonLogFormatter.new
    subscriber = CleanPay::JsonEventSubscriber.new(logger:)

    subscriber.emit(
      name: "identity.login",
      timestamp: Time.utc(2026, 7, 23).to_f * 1_000_000_000,
      payload: {
        outcome: "accepted",
        nested: {
          password: "open-password",
          token: "open-token",
          "cf-turnstile-response": "open-turnstile-proof"
        }
      },
      context: { request_id: "request-1" },
      tags: {}
    )

    lines = output.string.lines
    event = JSON.parse(lines.fetch(0))

    assert_equal 1, lines.size
    assert_equal "identity.login", event.fetch("event")
    assert_equal "identity", event.fetch("category")
    assert_equal "request-1", event.dig("context", "request_id")
    assert_equal "[FILTERED]", event.dig("payload", "nested", "password")
    assert_equal "[FILTERED]", event.dig("payload", "nested", "token")
    assert_equal "[FILTERED]",
      event.dig("payload", "nested", "cf-turnstile-response")
    refute_includes output.string, "open-password"
    refute_includes output.string, "open-token"
    refute_includes output.string, "open-turnstile-proof"
  end
end
