import { useMemo, useRef, type ReactNode } from 'react';
import { useProcedure, useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import { procedures, reducers, tables } from './module_bindings';
import ProfileChat from './ProfileChat';
import CloudNetworking from './CloudNetworking';
import { createCloudProfileApi } from './profileApi';

export default function LiveProfileChat({ signedIn, accountName, onSignIn, accountControl }: {
  signedIn: boolean; accountName: string; getToken: () => Promise<string | null>; onSignIn: () => void; accountControl: ReactNode;
}) {
  const [profiles, loaded] = useTable(tables.myProfile);
  const saveProfile = useReducer(reducers.saveMyProfile);
  const loadProfile = useProcedure(procedures.loadCloudProfile);
  const submitIntroduction = useProcedure(procedures.submitCloudIntroduction);
  const { isActive } = useSpacetimeDB();
  const account = useRef({ hasProfile: false, loaded, isActive, accountName, saveProfile });
  account.current = { hasProfile: profiles.length > 0, loaded, isActive, accountName, saveProfile };
  const api = useMemo(() => createCloudProfileApi(loadProfile, submitIntroduction, async () => {
    const state = account.current;
    if (!state.isActive || !state.loaded) throw new Error('Your account is still connecting. Please try again in a moment.');
    if (!state.hasProfile) await state.saveProfile({ displayName: state.accountName.trim().slice(0, 60) || 'Your account', headline: '', interests: '', showOnMap: false });
  }), [loadProfile, submitIntroduction]);
  return <ProfileChat signedIn={signedIn} ready={!signedIn || (isActive && loaded)} accountName={accountName} api={api} onSignIn={onSignIn} accountControl={accountControl} networking={signedIn && isActive && loaded && profiles.length > 0 ? <CloudNetworking /> : null} />;
}
