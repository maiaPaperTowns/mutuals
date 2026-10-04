export type IntakeProfile = {
  user_id: string;
  name: string;
  headline: string;
  skills: string[];
  interests: string[];
  goals: string[];
  offerings: string[];
  introduction: string;
  resume_filename?: string | null;
};

export type ProfileApi = {
  load: () => Promise<{ profile: IntakeProfile | null }>;
  submit: (message: string, file?: File) => Promise<IntakeProfile>;
};

export function createCloudProfileApi(
  load: () => Promise<string>,
  submit: (input: { message: string; resumeText: string; filename: string }) => Promise<string>,
  ensureAccount: () => Promise<void>,
  readResume: (file: File) => Promise<string> = readResumeText,
): ProfileApi {
  return {
    load: async () => { await ensureAccount(); return JSON.parse(await load()); },
    submit: async (message, file) => {
      const resumeText = file ? await readResume(file) : '';
      await ensureAccount();
      return JSON.parse(await submit({ message: message.trim(), resumeText, filename: file?.name ?? '' }));
    },
  };
}

export function createProfileApi(baseUrl: string, getToken: () => Promise<string | null>, ensureAccount: () => Promise<void>): ProfileApi {
  const request = async (path: string, body?: FormData) => {
    if (!baseUrl) throw new Error('Profile intake is not connected yet. Please try again once the service is available.');
    const token = await getToken();
    if (!token) throw new Error('Your session expired. Please sign in again.');
    await ensureAccount();
    let response: Response;
    try {
      response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
        method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}` }, body,
      });
    } catch {
      throw new Error('Could not reach the profile service. Your draft is still here; please try again.');
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = typeof data?.detail === 'string' ? data.detail : 'Could not save or load your profile. Please try again.';
      throw new Error(response.status === 401 ? 'Your session expired. Please sign in again.' : detail);
    }
    return data;
  };
  return {
    load: () => request('/onboarding/profile'),
    submit: (message, file) => {
      const body = new FormData();
      if (message.trim()) body.append('message', message.trim());
      if (file) body.append('file', file);
      return request('/onboarding/input', body);
    },
  };
}
import { readResumeText } from './resumeText';
