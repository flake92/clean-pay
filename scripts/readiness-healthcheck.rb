#!/usr/bin/env ruby

require "net/http"
require "uri"

begin
  target = URI("http://127.0.0.1:4000/internal/health/readiness")
  public_url = URI(ENV.fetch("APP_URL"))
  request = Net::HTTP::Get.new(target)
  request["Host"] = public_url.host
  request["X-Forwarded-Proto"] = public_url.scheme
  request["X-Clean-Pay-Readiness-Secret"] =
    ENV.fetch("READINESS_INTERNAL_SECRET")

  response = Net::HTTP.start(
    target.host,
    target.port,
    open_timeout: 2,
    read_timeout: 12
  ) { |http| http.request(request) }

  exit(response.is_a?(Net::HTTPSuccess) ? 0 : 1)
rescue StandardError => error
  warn "readiness healthcheck failed: #{error.class}"
  exit 1
end
