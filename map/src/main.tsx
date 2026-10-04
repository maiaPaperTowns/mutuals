import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider, useAuth, useUser } from '@clerk/react';
import { DbConnection } from './module_bindings';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import App from './App';
import './styles.css';
import './redesign.css';

const uri = import.meta.env.VITE_SPACETIMEDB_URI;
const database = import.meta.env.VITE_SPACETIMEDB_DATABASE;
const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const isConfigured = Boolean(uri && database);

function makeConnection(token: string | null) {
  return DbConnection.builder()
    .withUri(uri)
    .withDatabaseName(database)
    .withToken(token ?? localStorage.getItem('mhacks-stdb-token') ?? undefined)
    .onConnect((_, _identity, sessionToken) => {
      if (!token) localStorage.setItem('mhacks-stdb-token', sessionToken);
    })
    .onConnectError((_, error) => console.error('SpacetimeDB connection failed:', error));
}

function AnonymousMap() {
  const builder = useMemo(() => makeConnection(null), []);
  return <SpacetimeDBProvider connectionBuilder={builder}><App live authEnabled={false} signedIn={false} /></SpacetimeDBProvider>;
}

function ClerkMap() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [tokenReady, setTokenReady] = useState(false);
  const [connectionToken, setConnectionToken] = useState<string | null>(null);
  const [providerReady, setProviderReady] = useState(true);
  const getApiToken = useCallback(() => getToken({ template: 'spacetimedb' }), [getToken]);

  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;
    setTokenReady(false);
    if (!isSignedIn) {
      setAuthToken(null);
      setTokenReady(true);
      return;
    }
    void getToken({ template: 'spacetimedb' }).then(token => {
      if (cancelled) return;
      setAuthToken(token);
      setTokenReady(true);
    }).catch(error => {
      if (cancelled) return;
      console.error('Could not get a SpacetimeDB auth token:', error);
      setAuthToken(null);
      setTokenReady(true);
    });
    return () => { cancelled = true; };
  }, [getToken, isLoaded, isSignedIn]);

  useEffect(() => {
    if (!isLoaded || !tokenReady || authToken === connectionToken) return;
    setProviderReady(false);
    const timer = window.setTimeout(() => {
      setConnectionToken(authToken);
      setProviderReady(true);
    }, 25);
    return () => window.clearTimeout(timer);
  }, [authToken, connectionToken, isLoaded, tokenReady]);

  const builder = useMemo(() => makeConnection(connectionToken), [connectionToken]);
  if (!providerReady) return <div className="map-loading">Reconnecting live map…</div>;
  return <SpacetimeDBProvider key={connectionToken ?? 'anonymous'} connectionBuilder={builder}>
    <App live authEnabled signedIn={Boolean(connectionToken)} accountName={user?.username ?? user?.firstName ?? 'Your account'} getApiToken={getApiToken} />
  </SpacetimeDBProvider>;
}

function Root() {
  if (!isConfigured) return <App live={false} authEnabled={false} signedIn={false} />;
  if (!clerkKey) return <AnonymousMap />;
  return <ClerkProvider publishableKey={clerkKey}><ClerkMap /></ClerkProvider>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><Root /></React.StrictMode>,
);
