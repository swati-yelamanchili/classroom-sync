import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { createTopicRecognitionProvider } from '../src/services/topicRecognition';

describe('loadConfig', () => {
  it('requires a passcode', () => {
    expect(() => loadConfig({})).toThrow('TEACHER_PASSCODE');
  });
  it('refuses the development secret in production', () => {
    expect(() => loadConfig({ TEACHER_PASSCODE: 'x', NODE_ENV: 'production' })).toThrow('AUTH_SECRET');
  });
  it('prefers API_PORT over an inherited PORT', () => {
    expect(loadConfig({ TEACHER_PASSCODE: 'x', API_PORT: '4000', PORT: '5173' }).port).toBe(4000);
    expect(loadConfig({ TEACHER_PASSCODE: 'x', PORT: '8080' }).port).toBe(8080);
  });
  it('splits origins and trims the public URL', () => {
    const config = loadConfig({ TEACHER_PASSCODE: 'x', CLIENT_ORIGINS: 'http://a, http://b', PUBLIC_BASE_URL: 'https://c/' });
    expect(config.clientOrigins).toEqual(['http://a', 'http://b']);
    expect(config.publicBaseUrl).toBe('https://c');
  });
});

describe('topic recognition feature flag', () => {
  it('is disabled and suggests nothing', async () => {
    const provider = createTopicRecognitionProvider('disabled');
    expect(provider.enabled).toBe(false);
    await expect(provider.suggest({ transcript: 'x', topics: [], currentTopicIndex: 0 })).resolves.toBeNull();
  });
  it('rejects a provider that does not exist', () => {
    expect(() => createTopicRecognitionProvider('some-model')).toThrow('No model-based provider');
  });
});
