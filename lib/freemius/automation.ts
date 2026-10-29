import type { Freemius } from '@freemius/sdk';

import { plansFromPricingTable, type ProviderPlan } from './verification';

export type CreatePlanInput = {
  name: string;
  title: string;
  currency: string;
  monthlyPrice: number | null;
  lifetimePrice: number | null;
};

export type FreemiusAutomationApi = {
  capabilities: { createPlan: boolean };
  listPlans(): Promise<ProviderPlan[]>;
  createPlan(input: CreatePlanInput): Promise<{ planId: string; pricingId: string | null }>;
};

// Product-scoped SDK client: official read operations work. Plan creation and
// pricing writes live under developer scope which the installed SDK client
// cannot authenticate with (product Bearer tokens are product-scope only), so
// createPlan stays unavailable until a developer-scoped client is provided.
export function sdkAutomationApi(client: Freemius): FreemiusAutomationApi {
  return {
    capabilities: { createPlan: false },
    async listPlans() {
      const data = await client.api.product.retrievePricingData();
      return plansFromPricingTable(data);
    },
    async createPlan() {
      throw new Error('developer_scope_unavailable');
    },
  };
}
