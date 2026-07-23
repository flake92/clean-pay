require "test_helper"

class Subscriptions::OperationsTest < ActiveSupport::TestCase
  test "account action records attempted and succeeded audit around mutation" do
    user = create_web_user
    session = upstream_session(user)
    client = FakeClient.new(reissue: { "success" => true })
    audit = AuditRecorder.new

    result = Subscriptions::AccountActions.new(client:, audit:).reissue(
      web_session: session
    )

    assert_equal true, result.fetch("success")
    assert_equal %w[
      subscription_reissue_attempted
      subscription_reissue_succeeded
    ], audit.actions
  end

  test "device mutation preserves failure and records sanitized outcome" do
    user = create_web_user
    session = upstream_session(user)
    client = FakeClient.new(delete_error: RuntimeError.new("failed"))
    audit = AuditRecorder.new

    assert_raises(RuntimeError) do
      Subscriptions::DeviceManagement.new(client:, audit:).delete(
        web_session: session,
        hwid: "device-1"
      )
    end

    assert_equal %w[device_delete_attempted device_delete_failed], audit.actions
    assert_equal "device-1", audit.records.last.dig(:metadata, :hwid)
    assert_equal "RuntimeError", audit.records.last.dig(:metadata, :error)
  end

  class FakeClient
    def initialize(reissue: nil, delete_error: nil)
      @reissue = reissue
      @delete_error = delete_error
    end

    def reissue(*) = @reissue

    def delete_device(*)
      raise @delete_error if @delete_error
    end
  end

  class AuditRecorder
    attr_reader :records

    def initialize
      @records = []
    end

    def call(**attributes)
      records << attributes
    end

    def actions = records.pluck(:action)
  end

  private

  def upstream_session(user)
    create_web_session(
      web_user: user,
      remnashop_access_token: "upstream-access",
      remnashop_refresh_token: "upstream-refresh",
      remnashop_access_token_expires_at: 15.minutes.from_now,
      remnashop_refresh_token_expires_at: 30.days.from_now
    )
  end
end
