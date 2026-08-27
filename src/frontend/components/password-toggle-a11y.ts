import type { PasswordPassThroughOptions } from "primereact/password";

type ToggleLabels = {
  hide: string;
  show: string;
};

function togglePassThrough(labels: ToggleLabels): PasswordPassThroughOptions {
  return {
    hideIcon: { "aria-label": labels.hide },
    showIcon: { "aria-label": labels.show },
  };
}

export const passwordToggleA11y = {
  primary: togglePassThrough({
    hide: "Скрыть введённые символы",
    show: "Показать введённые символы",
  }),
  confirmation: togglePassThrough({
    hide: "Скрыть повторно введённые символы",
    show: "Показать повторно введённые символы",
  }),
  current: togglePassThrough({
    hide: "Скрыть текущее введённое значение",
    show: "Показать текущее введённое значение",
  }),
  next: togglePassThrough({
    hide: "Скрыть новое введённое значение",
    show: "Показать новое введённое значение",
  }),
} as const;
