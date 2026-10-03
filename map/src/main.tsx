import React from 'react';
import ReactDOM from 'react-dom/client';
import { DbConnection } from './module_bindings';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import App from './App';
import './styles.css';

const uri = import.meta.env.VITE_SPACETIMEDB_URI;
const database = import.meta.env.VITE_SPACETIMEDB_DATABASE;
const isConfigured = Boolean(uri && database);

const connectionBuilder = isConfigured
  ? DbConnection.builder()
      .withUri(uri)
      .withDatabaseName(database)
      .withToken(localStorage.getItem('mhacks-stdb-token') ?? undefined)
      .onConnect((_, _identity, token) => {
        localStorage.setItem('mhacks-stdb-token', token);
      })
      .onConnectError((_, error) => console.error('SpacetimeDB connection failed:', error))
  : undefined;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {connectionBuilder ? (
      <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
        <App live />
      </SpacetimeDBProvider>
    ) : (
      <App live={false} />
    )}
  </React.StrictMode>,
);
