#!/usr/bin/env ruby

require "digest"
require "json"
require "open3"
require "optparse"
require "pathname"
require "uri"

options = {}
OptionParser.new do |parser|
  parser.on("--database-url URL") { |value| options[:database_url] = value }
  parser.on("--manifest PATH") { |value| options[:manifest] = value }
  parser.on("--expect-database NAME") { |value| options[:expect_database] = value }
end.parse!

%i[database_url manifest expect_database].each do |key|
  abort "missing --#{key.to_s.tr("_", "-")}" if options[key].to_s.empty?
end

manifest_path = Pathname(options.fetch(:manifest)).expand_path
manifest = JSON.parse(manifest_path.read)
archive = manifest_path.dirname.join(manifest.fetch("archive"))
abort "backup archive is missing" unless archive.file?
abort "backup checksum mismatch" unless
  Digest::SHA256.file(archive).hexdigest == manifest.fetch("sha256")

uri = URI.parse(options.fetch(:database_url))
database = uri.path.delete_prefix("/")
abort "target database does not match --expect-database" unless
  database == options.fetch(:expect_database)
abort "refusing to restore over the source database name" if
  database == manifest.fetch("database")

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

objects = capture!(
  environment,
  "psql",
  *connection,
  "--tuples-only",
  "--no-align",
  "--command",
  "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace " \
    "WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S')"
)
abort "target database is not empty" unless Integer(objects, 10).zero?

system(
  environment,
  "pg_restore",
  *connection,
  "--exit-on-error",
  "--no-owner",
  "--no-privileges",
  archive.to_s,
  exception: true
)

actual_version = capture!(
  environment,
  "psql",
  *connection,
  "--tuples-only",
  "--no-align",
  "--command",
  "SELECT COALESCE(max(version), '') FROM schema_migrations"
)
abort "restored schema version mismatch" unless
  actual_version == manifest.fetch("schema_version")

manifest.fetch("row_counts").each do |table, expected|
  actual = capture!(
    environment,
    "psql",
    *connection,
    "--tuples-only",
    "--no-align",
    "--command",
    "SELECT count(*) FROM #{table}"
  )
  abort "row count mismatch for #{table}" unless Integer(actual, 10) == expected
end

puts "Restore verified: #{database}"
