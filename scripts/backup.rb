#!/usr/bin/env ruby

require "digest"
require "fileutils"
require "json"
require "open3"
require "optparse"
require "pathname"
require "securerandom"
require "time"
require "uri"

TABLES = %w[
  account_merge_confirmations app_settings audit_logs email_verification_codes
  integration_statuses payment_history_sync_states payment_operations
  payment_records rate_limit_events telegram_auth_states web_authn_challenges
  web_authn_credentials web_refresh_tokens web_sessions web_users
].freeze

options = {}
OptionParser.new do |parser|
  parser.on("--database-url URL") { |value| options[:database_url] = value }
  parser.on("--output-dir PATH") { |value| options[:output_dir] = value }
  parser.on("--image-id ID") { |value| options[:image_id] = value }
  parser.on("--refresh-key-id ID") { |value| options[:refresh_key_id] = value }
end.parse!

%i[database_url output_dir image_id refresh_key_id].each do |key|
  abort "missing --#{key.to_s.tr("_", "-")}" if options[key].to_s.empty?
end

uri = URI.parse(options.fetch(:database_url))
abort "database URL must use postgres/postgresql" unless
  %w[postgres postgresql].include?(uri.scheme)
database = uri.path.delete_prefix("/")
abort "database name is required" if database.empty?

output_dir = Pathname(options.fetch(:output_dir)).expand_path
FileUtils.mkdir_p(output_dir, mode: 0o700)
stamp = Time.now.utc.strftime("%Y%m%dT%H%M%SZ")
base = output_dir.join("clean-pay-#{stamp}")
archive = Pathname("#{base}.dump")
manifest_path = Pathname("#{base}.json")
abort "backup target already exists" if archive.exist? || manifest_path.exist?

environment = {
  "PGPASSWORD" => URI.decode_www_form_component(uri.password.to_s)
}
connection = [
  "--host", uri.host,
  "--port", (uri.port || 5432).to_s,
  "--username", URI.decode_www_form_component(uri.user.to_s),
  "--dbname", database
]

def capture!(environment, *command)
  output, status = Open3.capture2e(environment, *command)
  abort "#{command.first} failed: #{output}" unless status.success?
  output.strip
end

row_counts = TABLES.to_h do |table|
  value = capture!(
    environment,
    "psql",
    *connection,
    "--tuples-only",
    "--no-align",
    "--command",
    "SELECT count(*) FROM #{table}"
  )
  [ table, Integer(value, 10) ]
end
schema_version = capture!(
  environment,
  "psql",
  *connection,
  "--tuples-only",
  "--no-align",
  "--command",
  "SELECT COALESCE(max(version), '') FROM schema_migrations"
)

temporary = Pathname("#{archive}.#{SecureRandom.hex(6)}.tmp")
begin
  system(
    environment,
    "pg_dump",
    *connection,
    "--format=custom",
    "--compress=9",
    "--no-owner",
    "--no-privileges",
    "--file",
    temporary.to_s,
    exception: true
  )
  File.rename(temporary, archive)
ensure
  FileUtils.rm_f(temporary)
end

manifest = {
  format: 1,
  created_at: Time.now.utc.iso8601,
  archive: archive.basename.to_s,
  sha256: Digest::SHA256.file(archive).hexdigest,
  database: database,
  postgres_tool: capture!({}, "pg_dump", "--version"),
  schema_version: schema_version,
  row_counts: row_counts,
  image_id: options.fetch(:image_id),
  refresh_key_id: options.fetch(:refresh_key_id)
}
File.open(manifest_path, "wx", 0o600) do |file|
  file.write(JSON.pretty_generate(manifest) << "\n")
end
File.chmod(0o600, archive)
File.chmod(0o600, manifest_path)
puts manifest_path
