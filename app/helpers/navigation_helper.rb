module NavigationHelper
  def navigation_link(label, path)
    link_to label, path,
      class: class_names("nav-link", active: current_page?(path)),
      aria: { current: current_page?(path) ? "page" : nil }
  end
end
