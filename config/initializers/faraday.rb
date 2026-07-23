module CleanPay
  HttpDefaults = Data.define(
    :open_timeout,
    :read_timeout,
    :write_timeout,
    :max_retries
  )
end

Rails.application.config.x.http = CleanPay::HttpDefaults.new(
  open_timeout: 2,
  read_timeout: 5,
  write_timeout: 5,
  max_retries: 2
)
