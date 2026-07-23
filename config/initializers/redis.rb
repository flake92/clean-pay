redis_config = Rails.application.config.x.clean_pay
pool_size = ENV.fetch("RAILS_MAX_THREADS", 5).to_i

Rails.application.config.x.redis_key_prefix = "clean-pay"
Rails.application.config.x.redis_pool =
  ConnectionPool.new(size: pool_size, timeout: 1) do
    Redis.new(
      url: redis_config.storage.redis.to_s,
      connect_timeout: 1,
      read_timeout: 1,
      write_timeout: 1,
      reconnect_attempts: 1
    )
  end
