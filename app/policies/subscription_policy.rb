class SubscriptionPolicy < ApplicationPolicy
  def public_catalog? = true
  def show? = full_session? && verified_identity?
  def update? = show?
end
