import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static values = { text: String }
  static targets = ["status"]

  async copy() {
    try {
      await navigator.clipboard.writeText(this.textValue)
      this.report("Ссылка скопирована.")
    } catch {
      this.report("Не удалось скопировать. Выделите ссылку вручную.")
    }
  }

  report(value) {
    if (this.hasStatusTarget) this.statusTarget.textContent = value
  }
}
