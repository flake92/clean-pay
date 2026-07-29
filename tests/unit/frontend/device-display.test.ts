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

  it.each([
    ["iOS", null, "iOS"],
    ["iOS", "Client/1.0/iPad", "iPad"],
    ["iOS", "Client/1.0/iPhone", "iPhone"],
    ["macOS", null, "macOS"],
  ])(
    "does not invent a hardware type from platform %s",
    (platform, userAgent, expectedDeviceType) => {
      expect(
        formatSubscriptionDevice(
          device({
            platform,
            user_agent: userAgent,
          }),
        ).deviceType,
      ).toBe(expectedDeviceType);
    },
  );

  it("preserves the more precise iPadOS platform", () => {
    expect(
      formatSubscriptionDevice(
        device({
          platform: "iPadOS",
          os_version: "18.0",
        }),
      ),
    ).toEqual({
      deviceType: "iPadOS",
      os: "iPadOS 18.0",
      client: MISSING_DEVICE_VALUE,
      summary: "iPadOS",
    });
  });

  it("does not classify a bare Darwin kernel token as macOS", () => {
    expect(
      formatSubscriptionDevice(
        device({
          user_agent: "CFNetwork/3826.500.131 Darwin/24.5.0",
        }),
      ),
    ).toEqual({
      deviceType: MISSING_DEVICE_VALUE,
      os: MISSING_DEVICE_VALUE,
      client: MISSING_DEVICE_VALUE,
      summary: MISSING_DEVICE_VALUE,
    });
  });

  it.each([
    ["Happ/5.2.0/iOS_18.0", "iOS", "iOS"],
    ["Happ/3.3.6/Windows_11", "Windows", "Windows"],
    ["Client/1.0/iPad_18", "iPad", "iOS"],
  ])(
    "recognizes underscore-delimited platform in %s",
    (userAgent, expectedDeviceType, expectedOs) => {
      const presentation = formatSubscriptionDevice(
        device({
          user_agent: userAgent,
        }),
      );

      expect(presentation.deviceType).toBe(expectedDeviceType);
      expect(presentation.os).toBe(expectedOs);
    },
  );

  it("normalizes unavailable sentinels to the same dash", () => {
    expect(
      formatSubscriptionDevice(
        device({
          platform: "-",
          device_model: "—",
          os_version: "–",
          user_agent: "N/A",
        }),
      ),
    ).toEqual({
      deviceType: MISSING_DEVICE_VALUE,
      os: MISSING_DEVICE_VALUE,
      client: MISSING_DEVICE_VALUE,
      summary: MISSING_DEVICE_VALUE,
    });
  });

  it.each([
    ["x64", "Windows", "Windows"],
    ["sdk_gphone64_x86_64", "Android", "Android"],
    ["Android SDK built for x86_64", "Android", "Android"],
  ])(
    "filters technical device model %s",
    (deviceModel, platform, expectedDeviceType) => {
      expect(
        formatSubscriptionDevice(
          device({
            platform,
            device_model: deviceModel,
          }),
        ).deviceType,
      ).toBe(expectedDeviceType);
    },
  );

  it.each([
    ["Streisand 1.6.48 (iPhone; iOS 18)", "Streisand 1.6.48"],
    ["Happ 5.2.0/iOS", "Happ 5.2.0"],
    ["FlClash X/v0.8.91/Android", "FlClash X 0.8.91"],
  ])("supports safe client version format %s", (userAgent, expectedClient) => {
    expect(
      formatSubscriptionDevice(
        device({
          user_agent: userAgent,
        }),
      ).client,
    ).toBe(expectedClient);
  });

  it("removes invisible and bidirectional formatting controls from telemetry", () => {
    expect(
      formatSubscriptionDevice(
        device({
          platform: "Win\u202Edows",
          device_model: "Lap\u061Ctop",
          os_version: "11\u2063.0",
          user_agent: "Ha\u00ADpp/5.2.0/Windows",
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
    const presentation = formatSubscriptionDevice(source);
    const markup = renderToStaticMarkup(
      createElement(SubscriptionDeviceDetails, { presentation }),
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
