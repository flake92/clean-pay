class DevicesController < ApplicationController
  before_action :require_verified_identity!

  def index
    @devices = operation.list(web_session: Current.web_session)
  rescue Subscriptions::DeviceManagement::ContractError
    raise ErrorHandling::Error.new("UPSTREAM_ERROR", status: :bad_gateway)
  end

  def destroy
    if params[:id]
      operation.delete(
        web_session: Current.web_session,
        hwid: params[:id]
      )
    else
      operation.delete_all(web_session: Current.web_session)
    end
    redirect_to subscription_devices_path,
      notice: "Список устройств обновлён.",
      status: :see_other
  end

  private

  def operation = Subscriptions::DeviceManagement.new
end
