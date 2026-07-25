// Stub for @sudobility/subscription-components - not used by this app
import React from 'react';

export const SubscriptionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return React.createElement(React.Fragment, null, children);
};

export const useSubscription = () => ({
  subscription: null,
  loading: false,
  error: null,
});

export const PricingCard: React.FC = () => null;
export const SubscriptionStatus: React.FC = () => null;
export const SubscriptionLayout: React.FC = () => null;
export const SubscriptionTile: React.FC = () => null;
export const SegmentedControl: React.FC = () => null;
