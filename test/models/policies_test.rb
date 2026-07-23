require "test_helper"

class PoliciesTest < ActiveSupport::TestCase
  test "denies every base action by default" do
    policy = ApplicationPolicy.new(nil, nil)

    assert_not policy.index?
    assert_not policy.show?
    assert_not policy.create?
    assert_not policy.update?
    assert_not policy.destroy?
    assert_predicate policy, :denied_by_default?
  end

  test "grants identity actions from explicit session assurance" do
    user = create_web_user(email_verified: true)
    Current.web_user = user
    Current.web_session = create_web_session(web_user: user, assurance_level: :full)
    policy = IdentityPolicy.new(user, :identity)

    assert_predicate policy, :manage_profile?
    assert_predicate policy, :manage_passkeys?
    assert_predicate policy, :link_identity?
    assert_not policy.public_auth?
  ensure
    Current.reset
  end

  test "limits bootstrap sessions to setup and logout" do
    user = create_web_user
    Current.web_user = user
    Current.web_session = create_web_session(
      web_user: user,
      assurance_level: :bootstrap
    )
    policy = IdentityPolicy.new(user, :identity)

    assert_predicate policy, :complete_bootstrap?
    assert_predicate policy, :manage_passkeys?
    assert_not policy.manage_profile?
    assert_predicate policy, :logout?
  ensure
    Current.reset
  end
end
