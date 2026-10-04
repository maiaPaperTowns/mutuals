// Visual fixture only, outside the production entry point. No real accounts or storage.
import React from 'react';
import { createRoot } from 'react-dom/client';
import ProfileChat from '../src/ProfileChat';
import { createProfileApi, type IntakeProfile } from '../src/profileApi';
import '../src/styles.css';

let profile: IntakeProfile | null = null;
const api = {
  load: async () => ({ profile }),
  submit: async (message: string, file?: File) => {
    profile = { user_id: 'visual-fixture', name: 'Alex Chen', headline: 'Building useful things with AI', skills: ['Python', 'React'], interests: ['Robotics'], goals: ['Meet designers'], offerings: ['Prototype development'], introduction: message, resume_filename: file?.name };
    return profile;
  },
};
const integration = new URLSearchParams(window.location.search).has('integration');
const config = integration ? await fetch('/.test-runtime/onboarding-browser.json').then(response => response.json()) : null;
const client = config ? createProfileApi(config.apiUrl, async () => config.token, async () => {}) : api;
createRoot(document.getElementById('root')!).render(<ProfileChat signedIn accountName={config?.accountName ?? 'Alex Chen'} api={client} onSignIn={() => {}} />);
