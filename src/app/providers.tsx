"use client";

import { LayoutProvider } from "@/frontend/layout/context/layoutcontext";
import {
  addLocale,
  type LocaleOptions,
  PrimeReactProvider,
} from "primereact/api";

const russianPrimeAria = {
    cancelEdit: "Отменить редактирование",
    close: "Закрыть",
    collapseLabel: "Свернуть",
    collapseRow: "Строка свёрнута",
    editRow: "Редактировать строку",
    expandLabel: "Развернуть",
    expandRow: "Строка развёрнута",
    falseLabel: "Нет",
    filterConstraint: "Условие фильтра",
    filterOperator: "Оператор фильтра",
    firstPageLabel: "Первая страница",
    gridView: "Вид сеткой",
    hideFilterMenu: "Скрыть меню фильтра",
    jumpToPageDropdownLabel: "Выбор страницы",
    jumpToPageInputLabel: "Номер страницы",
    lastPageLabel: "Последняя страница",
    listLabel: "Список вариантов",
    listView: "Вид списком",
    moveAllToSource: "Переместить всё в исходный список",
    moveAllToTarget: "Переместить всё в целевой список",
    moveBottom: "Переместить в конец",
    moveDown: "Переместить вниз",
    moveToSource: "Переместить в исходный список",
    moveToTarget: "Переместить в целевой список",
    moveTop: "Переместить в начало",
    moveUp: "Переместить вверх",
    navigation: "Навигация",
    next: "Далее",
    nextPageLabel: "Следующая страница",
    nullLabel: "Не выбрано",
    otpLabel: "Введите символ {0} одноразового пароля",
    pageLabel: "Страница {page}",
    passwordHide: "Скрыть пароль",
    passwordShow: "Показать пароль",
    previous: "Назад",
    prevPageLabel: "Предыдущая страница",
    removeLabel: "Удалить",
    rotateLeft: "Повернуть влево",
    rotateRight: "Повернуть вправо",
    rowsPerPageLabel: "Строк на странице",
    saveEdit: "Сохранить изменения",
    scrollTop: "Прокрутить вверх",
    selectAll: "Все элементы выбраны",
    selectLabel: "Выбрать",
    selectRow: "Строка выбрана",
    showFilterMenu: "Показать меню фильтра",
    slide: "Слайд",
    slideNumber: "Слайд {slideNumber}",
    star: "1 звезда",
    stars: "Звёзд: {star}",
    trueLabel: "Да",
    unselectAll: "Выбор всех элементов отменён",
    unselectLabel: "Отменить выбор",
    unselectRow: "Выбор строки отменён",
    zoomImage: "Увеличить изображение",
    zoomIn: "Приблизить",
    zoomOut: "Отдалить",
} as NonNullable<LocaleOptions["aria"]> & Record<string, string>;

addLocale("ru", { aria: russianPrimeAria });

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrimeReactProvider value={{ locale: "ru" }}>
      <LayoutProvider>{children}</LayoutProvider>
    </PrimeReactProvider>
  );
}
