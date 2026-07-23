require "test_helper"

class IntegrationStatusTest < ActiveSupport::TestCase
  test "reports state and staleness from the checked timestamp" do
    status = IntegrationStatus.create!(
      service: "remnashop",
      status: :ok,
      checked_at: 2.minutes.ago
    )

    assert_predicate status, :ok?
    assert status.stale?(after: 1.minute)
    assert_not status.stale?(after: 5.minutes)
  end
end
