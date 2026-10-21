export type PrivateProviderBindingPublic = {
  bindingRevision: string;
  status: "ready";
  provider: "intervals";
  generation: number;
};
export type PrivateProviderBindingInternal = {
  provider: "intervals";
  ownerHash: string;
  environmentHash: string;
  athleteId: string;
  privateDataConnection: string;
  cacheScope: string;
  credentialFingerprint: string;
  bindingRevision: string;
  writesAllowed: boolean;
  status: "ready" | "refreshing";
};
export type PrivateProviderRefreshInput = {
  operationId: string;
  expectedBindingRevision: string;
  candidateKey: string;
  reconcileOnly?: boolean;
};
export type PrivateProviderRefreshResult = PrivateProviderBindingPublic & {
  operationId: string;
  verified: true;
};
export type PrivateProviderRefreshInspection = {
  operationId: string;
  status: "committed" | "rejected" | "settings-confirmed" | "unconfirmed" | "conflict";
  current: boolean;
  bindingRevision: string;
};
export type PrivateProviderBindingService = {
  enrollLegacy(input: {
    expectedCredentialFingerprint: string;
  }): Promise<PrivateProviderBindingPublic>;
  resolve(): Promise<PrivateProviderBindingInternal>;
  refresh(input: PrivateProviderRefreshInput): Promise<PrivateProviderRefreshResult>;
  inspect(operationId: string): Promise<PrivateProviderRefreshInspection>;
  recheck(operationId: string): Promise<PrivateProviderRefreshResult>;
};
export function createPrivateProviderBinding(
  options: Record<string, unknown>
): PrivateProviderBindingService;
export function privateProviderBinding(
  config: Record<string, unknown>,
  actor: { id: string; origin: string; readOnly: boolean },
  options?: Record<string, unknown>
): PrivateProviderBindingService;
