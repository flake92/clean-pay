const PAYMENT_GATEWAY_LABELS: Readonly<Record<string, string>> = {
  TELEGRAM_STARS: "Telegram Stars",
  YOOKASSA: "ЮKassa",
  YOOMONEY: "ЮMoney",
  CRYPTOMUS: "Cryptomus",
  HELEKET: "Heleket",
  CRYPTOPAY: "CryptoPay",
  FREEKASSA: "FreeKassa",
  MULENPAY: "MulenPay",
  PAYMASTER: "PayMaster",
  PLATEGA: "Platega",
  ROBOKASSA: "RoboKassa",
  ROLLYPAY: "RollyPay",
  URLPAY: "UrlPay",
  WATA: "WATA",
  VALUTIX: "Valutix",
};

export function paymentGatewayLabel(gatewayType: string) {
  return PAYMENT_GATEWAY_LABELS[gatewayType] ?? gatewayType;
}
