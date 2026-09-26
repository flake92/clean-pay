export function paymentOwnerTransitionKey(input: {
  actorUserId: string;
  sourceUpstreamAccountId: string;
  targetUpstreamAccountId: string;
  telegramId: string | null;
}) {
  return JSON.stringify([
    "payment-owner-transition",
    1,
    input.actorUserId,
    input.sourceUpstreamAccountId,
    input.targetUpstreamAccountId,
    input.telegramId ?? "-",
  ]);
}
