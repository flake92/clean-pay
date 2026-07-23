import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["dialog"]

  connect() {
    this.dialogTarget.addEventListener("close", this.restore)
  }

  disconnect() {
    this.dialogTarget.removeEventListener("close", this.restore)
  }

  open(event) {
    this.returnFocus = event.currentTarget
    this.dialogTarget.showModal()
  }

  close() {
    this.dialogTarget.close()
  }

  restore = () => this.returnFocus?.focus()
}
