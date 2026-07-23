import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["submit"]

  submit() {
    if (!this.hasSubmitTarget || this.submitTarget.disabled) return

    this.submitTarget.disabled = true
    this.submitTarget.value = "Создаём платёж…"
  }
}
