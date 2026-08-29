"use client";

import { useState } from "react";

export function useTariffsPanelController() {
  const [selection, setSelection] = useState<Record<string, string>>({});

  function selectPrice(planCode: string, value: string) {
    setSelection((current) => ({
      ...current,
      [planCode]: value,
    }));
  }

  return {
    selection,
    selectPrice,
  };
}
