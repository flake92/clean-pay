class Account::Passkeys::CredentialsController < ApplicationController
  before_action :require_verified_identity!

  def index
    @credentials = Current.web_user.web_authn_credentials.order(:created_at)
  end

  def destroy
    Current.web_user.with_lock do
      credential = Current.web_user.web_authn_credentials.find(params[:id])
      raise ErrorHandling::Error.new("FORBIDDEN", status: :forbidden) unless
        credential.destroy
    end

    redirect_to link_account_path,
      notice: "Ключ доступа удалён.",
      status: :see_other
  end
end
