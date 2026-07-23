import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["menu", "overlay", "toggle"]

  connect() {
    this.escape = event => {
      if (event.key === "Escape") this.close()
    }
    addEventListener("keydown", this.escape)
  }

  disconnect() {
    removeEventListener("keydown", this.escape)
  }

  toggle() {
    this.element.classList.contains("navigation-open") ?
      this.close() : this.open()
  }

  open() {
    this.element.classList.add("navigation-open")
    this.toggleTarget.setAttribute("aria-expanded", "true")
    this.menuTarget.querySelector("a, button")?.focus()
  }

  close() {
    if (!this.element.classList.contains("navigation-open")) return

    this.element.classList.remove("navigation-open")
    this.toggleTarget.setAttribute("aria-expanded", "false")
    this.toggleTarget.focus()
  }
}
