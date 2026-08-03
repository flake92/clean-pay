import { remnashopRequest } from "@/backend/integrations/remnashop/client";

const globalPlans = globalThis as typeof globalThis & {
  cleanPayPublicPlansRequest?: Promise<unknown>;
};

export async function getPublicPlans() {
  globalPlans.cleanPayPublicPlansRequest ??= remnashopRequest("/plans/public").finally(() => {
    delete globalPlans.cleanPayPublicPlansRequest;
  });

  return globalPlans.cleanPayPublicPlansRequest;
}
