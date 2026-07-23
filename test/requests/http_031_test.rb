require "test_helper"

class Http031Test < ActionDispatch::IntegrationTest
  test "renders owner-scoped synchronized payment history as HTML" do
    tokens = sign_in_with_upstream(
      create_web_user(remnashop_user_id: "history-owner")
    )
    payment = tokens.web_session.web_user.payment_records.create!(
      payment_id: SecureRandom.uuid,
      purchase_type: :new_purchase,
      status: :completed,
      final_amount: "199.00",
      currency: "RUB",
      gateway_type: "CARD"
    )
    sync = Minitest::Mock.new
    sync.expect(
      :call!,
      [ payment ],
      [],
      web_session: tokens.web_session
    )

    Payments::SyncHistoryPage.stub(:new, sync) { get payments_path }

    assert_response :success
    assert_equal "text/html", response.media_type
    assert_select "h1", "История платежей"
    assert_includes response.body, "199.0"
    assert_equal "no-store", response.headers["Cache-Control"]
    sync.verify
  end
end
