json.status @payload.fetch(:status)
json.checkedAt @payload.fetch(:checked_at).iso8601
json.service @payload.fetch(:service)
json.version @payload.fetch(:version)
json.checks do
  @payload.fetch(:checks).each do |name, check|
    json.set! name do
      json.status check.status
      json.latencyMs check.latency_ms
      json.message check.message if check.message
    end
  end
end
