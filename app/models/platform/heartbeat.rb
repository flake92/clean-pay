require "tempfile"

module Platform
  class Heartbeat
    def initialize(path)
      @path = Pathname(path)
    end

    def write(at: Time.current)
      path.dirname.mkpath
      Tempfile.create([ path.basename.to_s, ".tmp" ], path.dirname) do |file|
        file.write((at.to_f * 1_000).to_i.to_s)
        file.flush
        file.fsync
        File.rename(file.path, path)
      end
      true
    end

    def fresh?(within:, at: Time.current)
      timestamp = Integer(path.read, exception: false)
      timestamp && timestamp >= ((at - within).to_f * 1_000).to_i
    rescue Errno::ENOENT
      false
    end

    private

    attr_reader :path
  end
end
