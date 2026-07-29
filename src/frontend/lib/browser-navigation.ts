export function navigateTo(path: string) {
  window.location.assign(path);
}

export function replaceWith(path: string) {
  window.location.replace(path);
}
