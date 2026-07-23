class PaymentPolicy < ApplicationPolicy
  def create? = full_session? && verified_identity?
  def show? = create? && owned_record?
  def index? = create?

  private

  def owned_record?
    record.respond_to?(:web_user_id) && record.web_user_id == user.id
  end
end
