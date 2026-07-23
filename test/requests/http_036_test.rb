require "test_helper"

class Http036Test < ActionDispatch::IntegrationTest
  test "returns only a fresh aggregated readiness snapshot" do
    snapshot = {
      "status" => "ok",
      "checked_at" => Time.current.iso8601,
      "stale" => false
    }

    Platform::ReadinessCheck.stub(:public_snapshot, snapshot) do
      get readiness_health_path
    end

    assert_response :success
    assert_equal "ok", parsed_response.fetch("status")
    assert_equal false, parsed_response.fetch("stale")
    assert_equal "no-store", response.headers["Cache-Control"]
    assert_not parsed_response.key?("checks")
  end

  test "fails closed for a stale or unavailable snapshot" do
    snapshot = {
      "status" => "degraded",
      "checked_at" => nil,
      "stale" => true
    }

    Platform::ReadinessCheck.stub(:public_snapshot, snapshot) do
      get readiness_health_path
    end

    assert_response :service_unavailable
  end
end
