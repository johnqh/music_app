// Stub for @sudobility/subscription_lib - not used by this app
export const useSubscriptionService = () => ({
  subscription: null,
  loading: false,
  error: null,
});

export const useSubscriptionPeriods = () => ({
  periods: [],
  loading: false,
  error: null,
});

export const useSubscriptionForPeriod = () => ({
  subscription: null,
  loading: false,
  error: null,
});

export const useSubscribable = () => ({
  subscribable: null,
  loading: false,
  error: null,
});

export const useUserSubscription = () => ({
  subscription: null,
  loading: false,
  error: null,
});

export const refreshSubscription = async () => {};

export const SubscriptionService = class {
  async getSubscription() {
    return null;
  }
  async subscribe() {
    return null;
  }
  async unsubscribe() {
    return null;
  }
};
