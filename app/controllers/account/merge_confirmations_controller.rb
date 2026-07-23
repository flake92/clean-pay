class Account::MergeConfirmationsController < ApplicationController
  MERGE_COOKIE = :clean_pay_account_merge

  before_action :require_full_session!

  def show
    @confirmation = current_confirmation
  end

  def update
    result = Identity::AccountMerge.new.call!(
      confirmation: current_confirmation,
      web_session: Current.web_session
    )
    write_access_cookie(result.access_token, Current.web_session)
    clear_merge_cookie
    redirect_to(
      cabinet_path,
      notice: "Аккаунты объединены.",
      status: :see_other
    )
  rescue Identity::AccountMerge::ConflictError,
    AccountMergeConfirmation::ClaimUnavailableError
    raise ErrorHandling::Error.new("CONFLICT", status: :conflict)
  end

  def destroy
    current_confirmation.cancel!
    clear_merge_cookie
    redirect_to(
      link_account_path,
      notice: "Объединение отменено.",
      status: :see_other
    )
  rescue AccountMergeConfirmation::ClaimUnavailableError
    raise ErrorHandling::Error.new("CONFLICT", status: :conflict)
  end

  private

  def current_confirmation
    AccountMergeConfirmation.resolve!(
      token: cookies[MERGE_COOKIE],
      web_user: Current.web_user
    )
  rescue AccountMergeConfirmation::TokenUnavailableError
    raise ActiveRecord::RecordNotFound
  end

  def clear_merge_cookie
    cookies.delete(
      MERGE_COOKIE,
      **session_cookie_options.except(:httponly)
    )
  end
end
