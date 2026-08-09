"use server";

import { loadNavigation } from "@/application/navigation/load-navigation";
import {
  requestAuthProfileGateway,
  requestNavigationReader,
} from "@/app/_composition/request-scoped-readers";

export async function loadNavigationAction() {
  return loadNavigation(requestNavigationReader, requestAuthProfileGateway);
}
