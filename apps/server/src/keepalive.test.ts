import { describe, expect, it } from 'vitest';
import { inWindow } from './keepalive';

describe('вікно «не засинати»', () => {
  it('16–1 охоплює вечір і першу годину ночі', () => {
    expect(inWindow(16, [16, 1])).toBe(true);
    expect(inWindow(23, [16, 1])).toBe(true);
    expect(inWindow(0, [16, 1])).toBe(true);
    expect(inWindow(1, [16, 1])).toBe(false);
    expect(inWindow(15, [16, 1])).toBe(false);
  });
  it('вікно в межах доби', () => {
    expect(inWindow(10, [9, 18])).toBe(true);
    expect(inWindow(18, [9, 18])).toBe(false);
  });
});
