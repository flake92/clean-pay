module Identity
  class PagesController < ApplicationController
    layout :page_layout

    before_action :redirect_authenticated_guest_page,
      only: %i[login register]
    before_action :require_session!,
      only: %i[
        register_verify_email
        verify_email
        passkey_setup
      ]
    before_action :require_verified_identity!,
      only: %i[profile link_account]

    def login; end
    def register; end
    def register_verify_email; end
    def verify_email; end
    def telegram_webapp; end
    def passkey_setup; end

    def profile
      @passkeys = Current.web_user.web_authn_credentials.order(:created_at)
    end

    def link_account
      @passkeys = Current.web_user.web_authn_credentials.order(:created_at)
    end

    private

    def page_layout
      return "application" if action_name.in?(%w[profile link_account])

      "auth"
    end

    def redirect_authenticated_guest_page
      return unless Current.web_session

      destination =
        if Current.web_session.bootstrap?
          passkey_setup_path
        elsif !Current.web_user.identity_verified?
          verify_email_path
        else
          cabinet_path
        end
      redirect_to destination, status: :see_other
    end
  end
end
