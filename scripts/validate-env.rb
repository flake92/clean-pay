#!/usr/bin/env ruby

require "bundler/setup"
require "active_support/all"
require "uri"
require_relative "../config/app_config"

class ProductionEnvValidator
  FORBIDDEN_NAMES = %w[COMPOSE_ENV_FILES COMPOSE_FILE COMPOSE_PROFILES].freeze
  NAME = /\A[A-Z][A-Z0-9_]*\z/

  def initialize(path)
    @path = Pathname(path).expand_path
  end

  def call
    values = parse
    validate_storage!(values)
    CleanPay::AppConfig.load(env: values, production: true)
    puts "Production environment is valid (#{values.size} variables)."
  end

  private

  attr_reader :path

  def parse
    raise "environment file does not exist: #{path}" unless path.file?

    values = {}
    path.each_line.with_index(1) do |raw, line_number|
      line = raw.chomp
      next if line.empty? || line.start_with?("#")
      raise "line #{line_number}: invalid assignment" unless
        line.match?(/\A[A-Z][A-Z0-9_]*=[^\r\n]*\z/)

      name, value = line.split("=", 2)
      raise "line #{line_number}: forbidden variable #{name}" if
        FORBIDDEN_NAMES.include?(name)
      raise "line #{line_number}: duplicate variable #{name}" if values.key?(name)
      raise "line #{line_number}: interpolation is forbidden" if value.include?("$")
      raise "line #{line_number}: quotes are not interpreted" if
        value.start_with?("\"", "'") || value.end_with?("\"", "'")

      values[name] = value
    end
    values
  end

  def validate_storage!(values)
    database = URI.parse(values.fetch("DATABASE_URL"))
    redis = URI.parse(values.fetch("REDIS_URL"))
    raise "DATABASE_URL credentials must match POSTGRES_USER" unless
      URI.decode_www_form_component(database.user.to_s) ==
        values.fetch("POSTGRES_USER")
    raise "DATABASE_URL credentials must match POSTGRES_PASSWORD" unless
      URI.decode_www_form_component(database.password.to_s) ==
        values.fetch("POSTGRES_PASSWORD")
    raise "DATABASE_URL database must match POSTGRES_DB" unless
      database.path.delete_prefix("/") == values.fetch("POSTGRES_DB")
    raise "POSTGRES_PASSWORD must contain at least 24 characters" if
      values.fetch("POSTGRES_PASSWORD").length < 24
    raise "public PostgreSQL requires sslmode=require or verify-full" if
      public_host?(database.host) &&
        !%w[require verify-full].include?(
          URI.decode_www_form(database.query.to_s).to_h["sslmode"]
        )
    raise "public Redis requires rediss" if
      public_host?(redis.host) && redis.scheme != "rediss"
  rescue KeyError => error
    raise "missing required variable #{error.key}"
  end

  def public_host?(host)
    !host.to_s.match?(/\A(?:localhost|127\.0\.0\.1|::1|postgres|redis)\z/)
  end
end

ProductionEnvValidator.new(ARGV.fetch(0, ".env.production")).call
