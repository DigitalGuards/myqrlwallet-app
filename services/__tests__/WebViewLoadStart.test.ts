import { isSameDocumentHistoryUpdate } from '../WebViewLoadStart';

describe('isSameDocumentHistoryUpdate', () => {
  it('treats an Android load start on a fully loaded page as a same-document update', () => {
    expect(isSameDocumentHistoryUpdate('android', { loading: false })).toBe(true);
  });

  it('treats new document loads and missing payloads as real loads', () => {
    expect(isSameDocumentHistoryUpdate('android', { loading: true })).toBe(false);
    expect(isSameDocumentHistoryUpdate('android', {})).toBe(false);
    expect(isSameDocumentHistoryUpdate('android', undefined)).toBe(false);
  });

  it('never skips a load start on iOS', () => {
    expect(isSameDocumentHistoryUpdate('ios', { loading: false })).toBe(false);
    expect(isSameDocumentHistoryUpdate('ios', { loading: true })).toBe(false);
  });
});
