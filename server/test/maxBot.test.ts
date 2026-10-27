import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config';
import { pollOnce, replyText, senderOf, startMaxBot } from '../src/notify/maxBot';

describe('бот Max: ответ сотруднику его user id', () => {
  const old = { token: config.maxBotToken, url: config.maxApiUrl };
  beforeEach(() => {
    config.maxBotToken = 'test-token';
    config.maxApiUrl = 'https://max.test';
  });
  afterEach(() => {
    config.maxBotToken = old.token;
    config.maxApiUrl = old.url;
    vi.unstubAllGlobals();
  });

  it('понимает, кому отвечать: «Начать» и сообщение человека, но не бота и не канал', () => {
    expect(senderOf({ update_type: 'bot_started', user: { user_id: 11 } })).toBe(11);
    expect(senderOf({ update_type: 'message_created', message: { sender: { user_id: 12 } } })).toBe(12);
    expect(senderOf({ update_type: 'message_created', message: { sender: { user_id: 13, is_bot: true } } })).toBeNull();
    expect(senderOf({ update_type: 'message_created', message: {} })).toBeNull();
    expect(senderOf({ update_type: 'message_edited' })).toBeNull();
    expect(replyText(12)).toContain('12');
  });

  it('опрашивает /updates с токеном в заголовке и продолжает с последнего marker', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ updates: [{ update_type: 'bot_started', user: { user_id: 5 } }], marker: 77 }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const first = await pollOnce(null);
    expect(first.marker).toBe(77);
    expect(first.updates).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('https://max.test/updates?');
    expect(String(url)).not.toContain('marker=');
    expect(init.headers.Authorization).toBe('test-token');
    await pollOnce(77);
    expect(String(fetchMock.mock.calls[1][0])).toContain('marker=77');
  });

  it('ошибка токена или связи выбрасывается, а не молча теряется', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(pollOnce(null)).rejects.toThrow('HTTP 401');
  });

  it('в фоне отвечает человеку его id и не отвечает боту', async () => {
    const sent: any[] = [];
    let polls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: any) => {
        if (String(url).includes('/updates')) {
          polls += 1;
          if (polls > 1) await new Promise((r) => setTimeout(r, 50));
          return {
            ok: true,
            json: async () => ({
              updates:
                polls === 1
                  ? [
                      { update_type: 'bot_started', user: { user_id: 41 } },
                      { update_type: 'message_created', message: { sender: { user_id: 42, is_bot: true } } },
                    ]
                  : [],
              marker: polls,
            }),
          };
        }
        sent.push({ url: String(url), body: JSON.parse(init.body), auth: init.headers.Authorization });
        return { ok: true };
      }),
    );
    const stop = startMaxBot();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    stop();
    expect(sent[0].url).toBe('https://max.test/messages?user_id=41');
    expect(sent[0].body.text).toContain('41');
    expect(sent[0].auth).toBe('test-token');
  });

  it('без токена ничего не запускает', () => {
    config.maxBotToken = '';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    startMaxBot()();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
