class Account::RemnashopLinksController < ApplicationController
  MERGE_COOKIE = :clean_pay_account_merge

  before_action :require_full_session!

  def create
    body = params.expect(remnashop_link: [ :email, :password ])
    auth = authenticate_email!(body.to_h)
    profile = remnashop_client.me(access_token: auth.access_token)
    if profile["is_email_verified"] == true
      link_verified!(auth, profile)
    else
      stage_verification!(auth, profile)
    end
  end

  private

  def remnashop_client
    @remnashop_client ||= Integrations::RemnashopClient.new
  end

  def authenticate_email!(payload)
    remnashop_client.login(payload)
  rescue Integrations::RemnashopClient::Error => error
    raise unless error.code == "AUTH_FAILED"

    remnashop_client.register(payload)
  end

  def link_verified!(auth, profile)
    email = EmailAddress.parse(profile.fetch("email")).to_s
    if Current.web_user.remnashop_user_id.blank? ||
        Current.web_user.remnashop_user_id == auth.remnashop_user_id
      adopt_owner!(auth, email)
      redirect_to(
        link_account_path,
        notice: "E-mail аккаунт подключён.",
        status: :see_other
      )
    else
      issue_merge_confirmation!(auth, profile, email)
      redirect_to account_merge_confirmation_path, status: :see_other
    end
  end

  def stage_verification!(auth, profile)
    email = EmailAddress.parse(profile.fetch("email")).to_s
    Current.web_user.update!(
      pending_remnashop_user_id: auth.remnashop_user_id,
      pending_remnashop_email: email,
      auth_pending: true
    )
    take_token_custody!(auth)
    remnashop_client.request_email_verification(
      access_token: auth.access_token,
      email:
    )
    redirect_to verify_email_path, status: :see_other
  end

  def adopt_owner!(auth, email)
    Current.web_user.update!(
      remnashop_user_id: auth.remnashop_user_id,
      email:,
      email_verified: true,
      pending_remnashop_user_id: nil,
      pending_remnashop_email: nil,
      auth_pending: false
    )
    take_token_custody!(auth)
  rescue ActiveRecord::RecordNotUnique
    raise ErrorHandling::Error.new("CONFLICT", status: :conflict)
  end

  def issue_merge_confirmation!(auth, profile, email)
    user = Current.web_user
    raise ErrorHandling::Error.new("CONFLICT", status: :conflict) if
      user.telegram_id.blank?

    attributes = {
      source_remnashop_user_id: user.remnashop_user_id,
      target_remnashop_user_id: auth.remnashop_user_id,
      source_email: user.email,
      target_email: email,
      telegram_id: user.telegram_id,
      telegram_username: user.telegram_username
    }
    preflight = remnashop_client.merge_users(
      payload: merge_payload(attributes),
      dry_run: true
    )
    values = preflight.to_h.stringify_keys
    valid = values["dry_run"] == true &&
      values["source_user_id"].to_s ==
        attributes.fetch(:source_remnashop_user_id) &&
      values["target_user_id"].to_s ==
        attributes.fetch(:target_remnashop_user_id) &&
      Array(values["conflicts"]).empty?
    raise ErrorHandling::Error.new("CONFLICT", status: :conflict) unless valid

    _confirmation, token = AccountMergeConfirmation.issue!(
      web_user: user,
      **attributes
    )
    cookies[MERGE_COOKIE] = session_cookie_options.merge(
      value: token,
      expires: 10.minutes.from_now
    )
  end

  def merge_payload(attributes)
    {
      source_user_id: Integer(attributes.fetch(:source_remnashop_user_id)),
      target_user_id: Integer(attributes.fetch(:target_remnashop_user_id)),
      reason: "Clean Pay explicit account merge",
      email_resolution: "KEEP_TARGET",
      telegram_resolution: "KEEP_SOURCE",
      payment_resolution: "REKEY_SOURCE"
    }
  rescue ArgumentError
    raise ErrorHandling::Error.new("CONFLICT", status: :conflict)
  end

  def take_token_custody!(auth)
    Current.web_session.take_remnashop_token_custody!(
      access_token: auth.access_token,
      refresh_token: auth.refresh_token,
      access_expires_at: Time.iso8601(auth.body.fetch("expires_at")),
      refresh_expires_at: Time.iso8601(auth.body.fetch("refresh_expires_at"))
    )
  end
end
