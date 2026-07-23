class ApplicationPolicy
  attr_reader :user, :record

  def initialize(user, record)
    @user = user
    @record = record
  end

  def index? = false
  def show? = false
  def create? = false
  def new? = create?
  def update? = false
  def edit? = update?
  def destroy? = false
  def denied_by_default? = true

  class Scope
    def initialize(user, scope)
      @user = user
      @scope = scope
    end

    def resolve = scope.none

    private

    attr_reader :user, :scope
  end

  private

  def authenticated? = user.present?
  def full_session? = Current.web_session&.full?
  def verified_identity? = user&.identity_verified?
end
