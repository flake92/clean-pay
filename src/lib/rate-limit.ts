import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { BffError } from "@/lib/remnashop/errors";

export async function assertCooldown({
  key,
  action,
  windowSeconds,
}: {
  key: string;
  action: string;
  windowSeconds: number;
}) {
  const since = new Date(Date.now() - windowSeconds * 1000);
  const recentEvent = await prisma.rateLimitEvent.findFirst({
    where: {
      key,
      action,
      occurredAt: { gte: since },
    },
    orderBy: { occurredAt: "desc" },
  });

  if (recentEvent) {
    throw new BffError(
      "RATE_LIMITED",
      429,
      "Повторная отправка кода доступна через минуту.",
    );
  }
}

export async function recordRateLimitEvent({
  key,
  action,
  metadata,
}: {
  key: string;
  action: string;
  metadata?: Prisma.InputJsonValue;
}) {
  await prisma.rateLimitEvent.create({
    data: {
      key,
      action,
      metadata,
    },
  });
}
