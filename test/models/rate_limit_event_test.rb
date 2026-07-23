require "test_helper"

class RateLimitEventTest < ActiveSupport::TestCase
  test "selects only durable evidence older than the cutoff" do
    old = RateLimitEvent.create!(
      key: "identity:old",
      action: "login",
      occurred_at: 2.days.ago
    )
    RateLimitEvent.create!(
      key: "identity:new",
      action: "login",
      occurred_at: Time.current
    )

    assert_equal [ old ], RateLimitEvent.older_than(1.day.ago).to_a
  end
end
