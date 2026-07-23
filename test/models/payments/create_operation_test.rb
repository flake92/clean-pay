require "test_helper"

class Payments::CreateOperationTest < ActiveSupport::TestCase
  class FakeClient
    attr_accessor :offers_response, :payment_response, :error
    attr_reader :dispatches

    def initialize(offers:, payment:)
      @offers_response = offers
      @payment_response = payment
      @dispatches = []
    end

    def offers(access_token:)
      raise "missing token" if access_token.blank?

      offers_response
    end

    def purchase(**attributes)
      dispatches << attributes
      raise error if error

      payment_response
    end

    def extend_subscription(**attributes) = purchase(**attributes)
  end

  setup do
    @user = create_web_user(remnashop_user_id: "upstream-42")
    @session = create_web_session(
      web_user: @user,
      assurance_level: :full,
      auth_method: :email,
      remnashop_access_token: "upstream-access",
      remnashop_refresh_token: "upstream-refresh"
    )
    @offers = {
      "gateways" => [
        {
          "gateway_type" => "CARD",
          "currency" => "RUB",
          "currency_symbol" => "₽"
        }
      ],
      "plans" => [
        {
          "id" => 7,
          "public_code" => "basic",
          "name" => "Базовый",
          "recommended_purchase_type" => "NEW",
          "durations" => [
            {
              "days" => 30,
              "prices" => [
                {
                  "gateway_type" => "CARD",
                  "currency" => "RUB",
                  "final_amount" => "199.00"
                }
              ]
            }
          ]
        }
      ]
    }
    @payment = {
      "payment_id" => "65f5241d-3cc9-4de4-86a1-bb549af7c93b",
      "payment_url" => "https://pay.example.test/session",
      "purchase_type" => "NEW",
      "status" => "PENDING",
      "is_free" => false,
      "final_amount" => "199.00",
      "currency" => "RUB"
    }
    @client = FakeClient.new(offers: @offers, payment: @payment)
  end

  test "durably dispatches once and replays the stored result" do
    token = Payments::CreateOperation.issue_submission_token
    service = Payments::CreateOperation.new(client: @client)

    first = service.call!(
      kind: :purchase,
      web_session: @session,
      params: command,
      submission_token: token
    )
    replay = service.call!(
      kind: :purchase,
      web_session: @session,
      params: command,
      submission_token: token
    )

    assert_predicate first.operation.reload, :succeeded?
    assert_equal first.operation, replay.operation
    assert_predicate replay, :replayed
    assert_equal 1, @client.dispatches.size
    assert_equal first.operation.upstream_key,
      @client.dispatches.first.fetch(:idempotency_key)
    assert_equal 1, first.operation.dispatch_attempt_count
    assert_equal @payment["payment_id"], first.payment.payment_id
  end

  test "rejects reuse of a signed submission with altered payload" do
    token = Payments::CreateOperation.issue_submission_token
    service = Payments::CreateOperation.new(client: @client)
    service.call!(
      kind: :purchase,
      web_session: @session,
      params: command,
      submission_token: token
    )

    assert_raises(Payments::CreateOperation::IdempotencyConflictError) do
      service.call!(
        kind: :purchase,
        web_session: @session,
        params: command.merge("confirmed_amount" => "198.00"),
        submission_token: token
      )
    end
    assert_equal 1, @client.dispatches.size
  end

  test "rechecks the offer before creating an operation" do
    stale_command = command
    @client.offers_response = @offers.deep_dup.tap {
      _1["plans"][0]["durations"][0]["prices"][0]["final_amount"] = "299.00"
    }

    assert_raises(Payments::CreateOperation::OfferChangedError) do
      Payments::CreateOperation.new(client: @client).call!(
        kind: :purchase,
        web_session: @session,
        params: stale_command,
        submission_token: Payments::CreateOperation.issue_submission_token
      )
    end
    assert_empty @client.dispatches
    assert_empty @user.payment_operations
  end

  test "persists an ambiguous upstream failure for reconciliation" do
    @client.error = Integrations::RemnashopClient::Error.new(
      code: "UPSTREAM_UNAVAILABLE",
      status: 502,
      detail: "timeout"
    )

    result = Payments::CreateOperation.new(client: @client).call!(
      kind: :purchase,
      web_session: @session,
      params: command,
      submission_token: Payments::CreateOperation.issue_submission_token
    )

    assert_predicate result.operation.reload, :outcome_unknown?
    assert_equal 1, result.operation.dispatch_attempt_count
    assert_nil result.payment
  end

  test "treats an invalid post-dispatch response as an unknown outcome" do
    @client.payment_response = @payment.merge("payment_id" => "not-a-uuid")

    result = Payments::CreateOperation.new(client: @client).call!(
      kind: :purchase,
      web_session: @session,
      params: command,
      submission_token: Payments::CreateOperation.issue_submission_token
    )

    assert_predicate result.operation.reload, :outcome_unknown?
    assert_equal "UPSTREAM_ERROR",
      result.operation.error_snapshot.fetch("code")
    assert_equal 1, @client.dispatches.size
  end

  test "limits only new payment submissions in a durable window" do
    service = Payments::CreateOperation.new(client: @client)
    key = service.send(:owner_hash, @user)
    10.times do
      RateLimitEvent.create!(
        key:,
        action: "payment_submission",
        occurred_at: 1.minute.ago
      )
    end

    error = assert_raises(ErrorHandling::Error) do
      service.call!(
        kind: :purchase,
        web_session: @session,
        params: command,
        submission_token: Payments::CreateOperation.issue_submission_token
      )
    end

    assert_equal "RATE_LIMITED", error.code
    assert_empty @client.dispatches
    assert_empty @user.payment_operations
  end

  private

  def command
    {
      "plan_code" => "basic",
      "duration_days" => "30",
      "gateway_type" => "CARD",
      "confirmed_amount" => "199.00",
      "confirmed_currency" => "RUB",
      "offer_version" => Payments::CreateOperation.offer_version(@offers)
    }
  end
end
