require "test_helper"

class ConcurrencyTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  teardown do
    @users&.each do |user|
      PaymentRecord.where(web_user_id: user.id).delete_all
      PaymentOperation.where(web_user_id: user.id).delete_all
      WebUser.find_by(id: user.id)&.destroy!
    end
  end

  test "concurrent refresh replay returns one shared successor" do
    user = tracked_user
    original = Identity::SessionAuthenticator.new.issue!(
      web_user: user,
      auth_method: :email
    )

    results = race(2) do
      Identity::SessionAuthenticator.new.rotate!(original.refresh_token)
    end

    assert results.all? { |result| result.is_a?(Identity::SessionAuthenticator::Tokens) }
    assert_equal 1, results.map(&:refresh_token).uniq.size
    assert_equal 1, original.web_session.web_refresh_tokens.count
    assert_predicate original.web_session.reload, :active?
  end

  test "only one concurrent merge claimant receives the active lease" do
    confirmation, = AccountMergeConfirmation.issue!(
      web_user: tracked_user,
      source_remnashop_user_id: "100",
      target_remnashop_user_id: "200",
      target_email: "target@example.test",
      telegram_id: "42"
    )

    results = race(2) do |index|
      AccountMergeConfirmation.find(confirmation.id).claim!(
        token: "claim-#{index}",
        lease_for: 2.minutes
      )
    end

    assert_equal 1, results.count(true)
    assert_equal 1,
      results.count { |result| result.is_a?(AccountMergeConfirmation::ClaimUnavailableError) }
    assert_predicate confirmation.reload, :processing?
    assert_equal 1, confirmation.attempt_count
  end

  test "WebAuthn challenge is consumed exactly once under contention" do
    challenge = tracked_user.web_authn_challenges.create!(
      challenge: SecureRandom.urlsafe_base64(32),
      challenge_type: :authentication,
      expires_at: 5.minutes.from_now
    )

    results = race(2) do
      WebAuthnChallenge.find(challenge.id).consume!
    end

    assert_equal 1, results.count(true)
    assert_equal 1,
      results.count { |result| result.is_a?(WebAuthnChallenge::UnavailableError) }
    assert_predicate challenge.reload.consumed_at, :present?
  end

  test "one signed payment submission dispatches once under contention" do
    user = tracked_user
    user.update!(remnashop_user_id: "payment-race-owner")
    session = create_web_session(
      web_user: user,
      assurance_level: :full,
      auth_method: :email,
      remnashop_access_token: "upstream-access",
      remnashop_refresh_token: "upstream-refresh"
    )
    offers = payment_offers
    client = racing_payment_client(offers)
    token = Payments::CreateOperation.issue_submission_token
    command = {
      "plan_code" => "basic",
      "duration_days" => "30",
      "gateway_type" => "CARD",
      "confirmed_amount" => "199.00",
      "confirmed_currency" => "RUB",
      "offer_version" => Payments::CreateOperation.offer_version(offers)
    }

    results = race(2) do
      Payments::CreateOperation.new(client:).call!(
        kind: :purchase,
        web_session: WebSession.find(session.id),
        params: command,
        submission_token: token
      )
    end

    assert results.all? { _1.is_a?(Payments::CreateOperation::Result) }
    assert_equal 1, client.dispatch_count
    assert_equal 1, user.payment_operations.count
    assert_equal 1, user.payment_records.count
    assert_predicate user.payment_operations.first, :succeeded?
  end

  test "only one history worker owns the active lease" do
    state = tracked_user.create_payment_history_sync_state!(
      upstream_owner_hash: SecureRandom.hex(32)
    )

    results = race(2) do
      PaymentHistorySyncState.find(state.web_user_id).claim!
    end

    assert_equal 1,
      results.count { _1.is_a?(PaymentHistorySyncState::Claim) }
    assert_equal 1, results.count(nil)
    assert_equal 1, state.reload.attempt_count
  end

  private

  def tracked_user
    user = create_web_user
    (@users ||= []) << user
    user
  end

  def race(count)
    ready = Queue.new
    release = Queue.new
    threads = count.times.map do |index|
      Thread.new do
        ready << true
        release.pop
        ActiveRecord::Base.connection_pool.with_connection do
          yield(index)
        rescue StandardError => error
          error
        end
      end
    end
    count.times { ready.pop }
    count.times { release << true }
    threads.map(&:value)
  end

  def payment_offers
    {
      "gateways" => [],
      "plans" => [
        {
          "id" => 1,
          "public_code" => "basic",
          "name" => "Базовый",
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
  end

  def racing_payment_client(offers)
    Class.new do
      attr_reader :dispatch_count

      define_method(:initialize) do |value|
        @offers = value
        @mutex = Mutex.new
        @dispatch_count = 0
      end

      define_method(:offers) { |access_token:| @offers if access_token }
      define_method(:purchase) do |**|
        @mutex.synchronize { @dispatch_count += 1 }
        {
          "payment_id" => "65f5241d-3cc9-4de4-86a1-bb549af7c93b",
          "payment_url" => "https://pay.example.test/session",
          "purchase_type" => "NEW",
          "status" => "PENDING",
          "is_free" => false,
          "final_amount" => "199.00",
          "currency" => "RUB"
        }
      end
    end.new(offers)
  end
end
