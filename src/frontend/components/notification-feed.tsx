"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

import { loadNotificationFeedAction, markNotificationsReadAction } from "@/app/actions/notifications";
import type {
  NotificationFeedItemView,
  NotificationFeedPage,
} from "@/application/models/notifications";
import { Button, Message } from "@/frontend/components/sakai/form-foundation";
import { NOTIFICATIONS_READ_EVENT } from "@/frontend/hooks/use-unread-notifications";
import { parseTelegramHtml, safeHref, type TelegramNode } from "@/frontend/lib/telegram-html";

function renderNodes(nodes: TelegramNode[]): ReactNode {
  return nodes.map((node, index) => {
    if (node.kind === "text") return <Fragment key={index}>{node.text}</Fragment>;
    const children = renderNodes(node.children);
    switch (node.tag) {
      case "b":
        return <strong key={index}>{children}</strong>;
      case "i":
        return <em key={index}>{children}</em>;
      case "u":
        return <u key={index}>{children}</u>;
      case "s":
        return <s key={index}>{children}</s>;
      case "code":
        return <code key={index}>{children}</code>;
      case "pre":
        return <pre key={index}>{children}</pre>;
      case "blockquote":
        return <blockquote key={index}>{children}</blockquote>;
      case "spoiler":
        return <Spoiler key={index}>{children}</Spoiler>;
      case "a":
        return node.href ? (
          <a href={node.href} key={index} rel="noopener noreferrer" target="_blank">
            {children}
          </a>
        ) : (
          <Fragment key={index}>{children}</Fragment>
        );
    }
  });
}

function Spoiler({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className={open ? "tg-spoiler is-open" : "tg-spoiler"}
      onClick={() => setOpen(true)}
    >
      {children}
    </span>
  );
}

function Media({ item }: { item: NotificationFeedItemView }) {
  const src = `/api/notifications/media/${item.id}`;
  if (item.mediaType === "PHOTO") {
    // eslint-disable-next-line @next/next/no-img-element -- served by our own session-bound route
    return <img alt="" className="tg-bubble__media" loading="lazy" src={src} />;
  }
  if (item.mediaType === "VIDEO") {
    return <video className="tg-bubble__media" controls playsInline preload="metadata" src={src} />;
  }
  if (item.mediaType === "GIF") {
    return <video autoPlay className="tg-bubble__media" loop muted playsInline src={src} />;
  }
  if (item.mediaType === "DOCUMENT") {
    return (
      <a className="tg-bubble__file" href={src}>
        <i aria-hidden className="pi pi-file" /> Открыть файл
      </a>
    );
  }
  return null;
}

function timeLabel(iso: string) {
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function dayLabel(iso: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" })
    .format(new Date(iso));
}

function Bubble({ item, focused }: { item: NotificationFeedItemView; focused: boolean }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "center" });
  }, [focused]);

  return (
    <article
      className={focused ? "tg-message is-focused" : "tg-message"}
      id={`notification-${item.id}`}
      ref={ref}
    >
      <div className="tg-bubble">
        <Media item={item} />
        <div className="tg-bubble__text">{renderNodes(parseTelegramHtml(item.html))}</div>
        <div className="tg-bubble__meta">
          <span>{item.category === "NEWS" ? "Новость" : "Служебное"}</span>
          <time dateTime={item.createdAt}>{timeLabel(item.createdAt)}</time>
        </div>
      </div>
      {item.buttons.map((row, rowIndex) => (
        <div className="tg-buttons" key={rowIndex}>
          {row.map((button) => {
            const href = safeHref(button.url);
            if (!href) return null;
            const external = !href.startsWith("/");
            return (
              <a
                className="tg-button"
                href={href}
                key={`${button.text}-${button.url}`}
                {...(external ? { rel: "noopener noreferrer", target: "_blank" } : {})}
              >
                {button.text}
              </a>
            );
          })}
        </div>
      ))}
    </article>
  );
}

export function NotificationFeed({
  initialPage,
  focusItem,
}: {
  initialPage: NotificationFeedPage | null;
  focusItem: number | null;
}) {
  const [items, setItems] = useState(initialPage?.items ?? []);
  const [nextBeforeId, setNextBeforeId] = useState(initialPage?.nextBeforeId ?? null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(initialPage === null);
  const newestId = initialPage?.items[0]?.id;

  useEffect(() => {
    if (!newestId) return;
    void markNotificationsReadAction(newestId).then(() => {
      window.dispatchEvent(new Event(NOTIFICATIONS_READ_EVENT));
    });
  }, [newestId]);

  async function loadMore() {
    if (loading || nextBeforeId === null) return;
    setLoading(true);
    const result = await loadNotificationFeedAction(nextBeforeId);
    setLoading(false);
    if (!result.ok) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setItems((current) => [...current, ...result.page.items]);
    setNextBeforeId(result.page.nextBeforeId);
  }

  // Telegram shows the newest message last; the page opens on the newest one
  // through the "load older" button staying above the history.
  const ordered = [...items].reverse();

  return (
    <div className="tg-chat">
      {failed ? <Message severity="warn" text="Не удалось загрузить уведомления. Попробуйте позже." /> : null}
      {nextBeforeId !== null ? (
        <Button
          className="tg-chat__more"
          disabled={loading}
          label="Показать более ранние"
          loading={loading}
          onClick={() => void loadMore()}
          outlined
          severity="secondary"
        />
      ) : null}
      {!failed && ordered.length === 0 ? (
        <p className="tg-chat__empty">Уведомлений пока нет.</p>
      ) : null}
      {ordered.map((item, index) => {
        const day = dayLabel(item.createdAt);
        const showDay = index === 0 || dayLabel(ordered[index - 1]!.createdAt) !== day;
        return (
          <Fragment key={item.id}>
            {showDay ? <div className="tg-chat__day"><span>{day}</span></div> : null}
            <Bubble focused={focusItem === item.id} item={item} />
          </Fragment>
        );
      })}
    </div>
  );
}
