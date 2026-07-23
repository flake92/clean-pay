require "test_helper"

class Http038Test < ActionDispatch::IntegrationTest
  test "hides a disabled reconciliation endpoint as not found" do
    post internal_payment_reconciliations_path,
      headers: { "X-Clean-Pay-Reconciliation-Secret" => "wrong" }

    assert_response :not_found
  end

  test "authenticates the worker and renders bounded machine JSON" do
    secret = "r" * 32
    reconciliation = CleanPay::AppConfig::Reconciliation.new(
      enabled: true,
      secret: CleanPay::AppConfig::Secret.new(secret),
      batch_size: 7,
      interval_seconds: 30,
      internal_url: nil
    )
    original = Rails.application.config.x.clean_pay
    clean_pay = Object.new
    clean_pay.define_singleton_method(:reconciliation) { reconciliation }
    clean_pay.define_singleton_method(:method_missing) do |name, *args, **kwargs,
      &block|
      original.public_send(name, *args, **kwargs, &block)
    end
    result = Payments::ReconcileBatch::Result.new(
      claimed: 2,
      succeeded: 1,
      deferred: 1,
      manual_required: 0,
      failed: 0
    )
    service = Minitest::Mock.new
    service.expect(:call!, result) do |limit:, deadline:|
      limit == 7 && deadline.future?
    end
    history = Minitest::Mock.new
    history_result = Payments::SyncHistoryBatch::Result.new(
      claimed: 0,
      succeeded: 0,
      deferred: 0,
      failed: 0
    )
    history.expect(:call!, history_result) do |limit:, deadline:|
      limit == 1 && deadline.future?
    end

    Rails.application.config.x.stub(:clean_pay, clean_pay) do
      Payments::ReconcileBatch.stub(:new, service) do
        Payments::SyncHistoryBatch.stub(:new, history) do
          post internal_payment_reconciliations_path,
            headers: {
              "X-Clean-Pay-Reconciliation-Secret" => secret
            }
        end
      end
    end

    assert_response :success
    assert_equal "application/json", response.media_type
    assert_equal 2, parsed_response.fetch("claimed")
    assert_equal 0, parsed_response.dig("history", "claimed")
    assert_equal "no-store", response.headers["Cache-Control"]
    service.verify
    history.verify
  end
end
