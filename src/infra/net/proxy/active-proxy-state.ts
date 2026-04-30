export type ActiveManagedProxyRegistration = {
  proxyUrl: string;
  stopped: boolean;
};

const activeProxyRegistrations: ActiveManagedProxyRegistration[] = [];

export function registerActiveManagedProxyUrl(proxyUrl: string): ActiveManagedProxyRegistration {
  const registration = { proxyUrl, stopped: false };
  activeProxyRegistrations.push(registration);
  return registration;
}

export function stopActiveManagedProxyRegistration(
  registration: ActiveManagedProxyRegistration,
): void {
  registration.stopped = true;
}

export function findTopActiveManagedProxyRegistration(): ActiveManagedProxyRegistration | null {
  for (let index = activeProxyRegistrations.length - 1; index >= 0; index -= 1) {
    const registration = activeProxyRegistrations[index];
    if (!registration.stopped) {
      return registration;
    }
  }
  return null;
}

export function pruneStoppedManagedProxyRegistrations(): void {
  for (let index = activeProxyRegistrations.length - 1; index >= 0; index -= 1) {
    if (activeProxyRegistrations[index]?.stopped) {
      activeProxyRegistrations.splice(index, 1);
    }
  }
}

export function getActiveManagedProxyUrl(): string | undefined {
  return findTopActiveManagedProxyRegistration()?.proxyUrl;
}

export function _resetActiveManagedProxyStateForTests(): void {
  activeProxyRegistrations.splice(0, activeProxyRegistrations.length);
}
