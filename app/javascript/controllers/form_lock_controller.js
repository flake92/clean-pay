import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["submit"]
  static values = { pendingLabel: { type: String, default: "Подождите…" } }

  connect() {
    this.element.addEventListener("turbo:submit-start", this.lock)
    this.element.addEventListener("turbo:submit-end", this.unlock)
  }

  disconnect() {
    this.element.removeEventListener("turbo:submit-start", this.lock)
    this.element.removeEventListener("turbo:submit-end", this.unlock)
  }

  lock = () => {
    if (!this.hasSubmitTarget || this.submitTarget.disabled) return

    this.originalLabel = this.submitTarget.value || this.submitTarget.textContent
    this.submitTarget.disabled = true
    this.setLabel(this.pendingLabelValue)
  }

  unlock = () => {
    if (!this.hasSubmitTarget) return

    this.submitTarget.disabled = false
    if (this.originalLabel) this.setLabel(this.originalLabel)
    this.originalLabel = null
  }

  setLabel(value) {
    if (this.submitTarget instanceof HTMLInputElement) {
      this.submitTarget.value = value || ""
    } else {
      this.submitTarget.textContent = value || ""
    }
  }
}
