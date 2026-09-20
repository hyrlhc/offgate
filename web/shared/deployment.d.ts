export type ProfileName = 'live' | 'local';

export type Profile = {
  profile: ProfileName;
  label: string;
  contractId: string;
  /** Yedek profilde anchor yoktur. */
  anchorHomeDomain: string | null;
  usdcCode: string;
  usdcIssuer: string;
  eventId: string;
  networkPassphrase: string;
  horizonUrl: string;
  rpcUrl: string;
  friendbotUrl: string;
  readAccount: string;
};

export declare const PROFILES: Record<ProfileName, Profile>;
export declare function isProfile(name: unknown): name is ProfileName;
export declare const DEPLOYMENT: Profile;
