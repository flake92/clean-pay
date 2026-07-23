class SupportsController < ApplicationController
  before_action :require_full_session!

  def show
    @support = Rails.application.config.x.clean_pay.support
  end
end
