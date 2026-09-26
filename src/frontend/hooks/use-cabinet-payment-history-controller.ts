"use client";

import { useState } from "react";

export function useCabinetPaymentHistoryController() {
  const [isExpanded, setIsExpanded] = useState(false);

  function toggleExpanded() {
    setIsExpanded((expanded) => !expanded);
  }

  return {
    isExpanded,
    toggleExpanded,
  };
}
