class IdentityPolicy < ApplicationPolicy
  def public_auth? = !authenticated?
  def logout? = true
  def complete_bootstrap? = authenticated? && Current.web_session&.bootstrap?
  def verify_email? = full_session? && !verified_identity?
  def manage_profile? = full_session? && verified_identity?
  def manage_passkeys? = complete_bootstrap? || manage_profile?
  def link_identity? = manage_profile?
end
