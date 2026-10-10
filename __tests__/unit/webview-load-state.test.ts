import {
  INITIAL_LOAD_STATE,
  LOAD_TIMEOUT_MS,
  webViewLoadReducer,
  type WebViewLoadState,
} from '../../src/webview/webViewLoadState';

const run = (...events: Parameters<typeof webViewLoadReducer>[1][]) =>
  events.reduce(webViewLoadReducer, INITIAL_LOAD_STATE);

describe('webViewLoadReducer', () => {
  it('mulai dari spinner', () => {
    expect(INITIAL_LOAD_STATE).toEqual({ loading: true, failed: false });
  });

  it('progress penuh menghentikan spinner', () => {
    expect(run({ type: 'progress', progress: 1 })).toEqual({
      loading: false,
      failed: false,
    });
  });

  it('progress 0.99 sudah dianggap selesai', () => {
    // Subresource yang tidak pernah selesai jangan menahan spinner selamanya.
    expect(run({ type: 'progress', progress: 0.99 }).loading).toBe(false);
  });

  it('progress sebagian tidak menghentikan spinner', () => {
    expect(run({ type: 'progress', progress: 0.4 })).toEqual(
      INITIAL_LOAD_STATE,
    );
  });

  it('onLoad menghentikan spinner', () => {
    expect(run({ type: 'done' })).toEqual({ loading: false, failed: false });
  });

  it('kegagalan menghentikan spinner dan menyimpan alasan', () => {
    expect(run({ type: 'fail', reason: 'net::ERR_CONNECTION_REFUSED' })).toEqual(
      { loading: false, failed: true, reason: 'net::ERR_CONNECTION_REFUSED' },
    );
  });

  it('kegagalan tanpa alasan tetap berhenti', () => {
    expect(run({ type: 'fail' })).toEqual({
      loading: false,
      failed: true,
      reason: undefined,
    });
  });

  it('timeout menghentikan spinner (kasus server tak terjangkau)', () => {
    // Inilah jaring pengaman intinya: tidak ada event apa pun selain start.
    const state = run({ type: 'timeout' });
    expect(state.loading).toBe(false);
    expect(state.failed).toBe(true);
    expect(state.reason).toContain('20 detik');
  });

  it('timeout tidak menimpa alasan kegagalan yang lebih spesifik', () => {
    const state = run(
      { type: 'fail', reason: 'net::ERR_NAME_NOT_RESOLVED' },
      { type: 'timeout' },
    );
    expect(state.reason).toBe('net::ERR_NAME_NOT_RESOLVED');
  });

  it('navigasi ulang menghapus status gagal', () => {
    const state = run(
      { type: 'fail', reason: 'boom' },
      { type: 'start' },
    );
    expect(state).toEqual({ loading: true, failed: false });
  });

  it('progress sisa setelah gagal tidak menghidupkan spinner', () => {
    const failed: WebViewLoadState = {
      loading: false,
      failed: true,
      reason: 'boom',
    };
    expect(webViewLoadReducer(failed, { type: 'progress', progress: 1 })).toBe(
      failed,
    );
  });

  it('batas waktu masuk akal', () => {
    expect(LOAD_TIMEOUT_MS).toBeGreaterThanOrEqual(10000);
    expect(LOAD_TIMEOUT_MS).toBeLessThanOrEqual(60000);
  });
});
