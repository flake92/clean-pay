import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SubscriptionDeviceDetails } from "@/frontend/components/subscription-device-details";
import {
  formatSubscriptionDevice,
  MISSING_DEVICE_VALUE,
} from "@/frontend/lib/device-display";
import type { SubscriptionDevice } from "@/shared/remnashop/types";

function device(overrides: Partial<SubscriptionDevice>): SubscriptionDevice {
  return {
    hwid: "internal-device-id",
    platform: null,
    device_model: null,
    os_version: null,
    user_agent: null,
    ...overrides,
  };
}

describe("subscription device display", () => {
  it.each([
    {
      source: device({
        platform: "ios",
        device_model: "iPhone 12",
        os_version: "26.5.2",
        user_agent: "INCY/2.4.7/ios CFNetwork/3826.500.131 Darwin/24.5.0",
      }),
      expected: {
        deviceType: "iPhone 12",
        os: "iOS 26.5.2",
        client: "INCY 2.4.7",
        summary: "iPhone 12 INCY 2.4.7",
      },
    },
    {
      source: device({
        platform: "windows",
        device_model: "byte_x86_64",
        os_version: "11_10.0.22631",
        user_agent: "Happ/3.3.6/Windows/10.0.22631",
      }),
      expected: {
        deviceType: "Windows",
        os: "Windows 11_10.0.22631",
        client: "Happ 3.3.6",
        summary: "Windows Happ 3.3.6",
      },
    },
    {
      source: device({
        platform: "iOS",
        device_model: "iPhone 12",
        os_version: "26.5.2",
        user_agent: "Happ/5.2.0/iOS/26.5.2",
      }),
      expected: {
        deviceType: "iPhone 12",
        os: "iOS 26.5.2",
        client: "Happ 5.2.0",
        summary: "iPhone 12 Happ 5.2.0",
      },
    },
    {
      source: device({
        platform: "Android",
        device_model: "SM-T225",
        os_version: "14",
        user_agent: "Happ/3.25.1/Android/14",
      }),
      expected: {
        deviceType: "SM-T225",
        os: "Android 14",
        client: "Happ 3.25.1",
        summary: "SM-T225 Happ 3.25.1",
      },
    },
  ])("formats device, OS and client telemetry", ({ source, expected }) => {
    expect(formatSubscriptionDevice(source)).toEqual(expected);
  });

  it("uses a dash for every unavailable section", () => {
    expect(formatSubscriptionDevice(device({}))).toEqual({
      deviceType: MISSING_DEVICE_VALUE,
      os: MISSING_DEVICE_VALUE,
      client: MISSING_DEVICE_VALUE,
      summary: MISSING_DEVICE_VALUE,
    });
  });

  it("infers the platform while filtering technical models and trailing user-agent data", () => {
    expect(
      formatSubscriptionDevice(
        device({
          platform: "x86_64",
          device_model: "aarch64",
          os_version: "14",
          user_agent: "ExampleClient/v2.4.0-beta.1/Android/14 extra data",
        }),
      ),
    ).toEqual({
      deviceType: "Android",
      os: "Android 14",
      client: "ExampleClient 2.4.0-beta.1",
      summary: "Android ExampleClient 2.4.0-beta.1",
    });
  });

  it("does not expose a generic browser user agent as the subscription client", () => {
    expect(
      formatSubscriptionDevice(
        device({
          platform: "Linux",
          user_agent:
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0.0.0",
        }),
      ),
    ).toEqual({
      deviceType: "Linux",
      os: "Linux",
      client: MISSING_DEVICE_VALUE,
      summary: "Linux",
    });
  });

  it("keeps an available client name when its version is missing", () => {
    expect(
      formatSubscriptionDevice(device({ user_agent: "Happ/iOS" })).client,
    ).toBe("Happ");
  });

  it("preserves unknown OS values without inventing their meaning", () => {
    expect(
      formatSubscriptionDevice(
        device({
          platform: "FreeBSD",
          os_version: "14.1-RELEASE",
          user_agent: "Client/1.0/FreeBSD",
        }),
      ).os,
    ).toBe("FreeBSD 14.1-RELEASE");
  });

  it("removes invisible and bidirectional formatting controls from telemetry", () => {
    expect(
      formatSubscriptionDevice(
        device({
          platform: "Win\u202Edows",
          device_model: "Lap\u200Btop",
          os_version: "11\u2066.0",
          user_agent: "Ha\u200Bpp/5.2.0/Windows",
        }),
      ),
    ).toEqual({
      deviceType: "Laptop",
      os: "Windows 11.0",
      client: "Happ 5.2.0",
      summary: "Laptop Happ 5.2.0",
    });
  });

  it("renders concise fields without rendering the internal HWID or raw user agent", () => {
    const source = device({
      hwid: "sensitive-internal-hwid",
      platform: "iOS",
      device_model: "iPhone 12",
      os_version: "26.5.2",
      user_agent: "INCY/2.4.7/ios CFNetwork/private-trailing-data",
    });
    const markup = renderToStaticMarkup(
      createElement(SubscriptionDeviceDetails, { device: source }),
    );

    expect(markup).toContain("Тип устройства");
    expect(markup).toContain("iPhone 12");
    expect(markup).toContain("iOS 26.5.2");
    expect(markup).toContain("INCY 2.4.7");
    expect(markup).not.toContain(source.hwid);
    expect(markup).not.toContain(source.user_agent);
    expect(markup).not.toContain("CFNetwork");
  });
});
