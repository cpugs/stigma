import { describe, it, expect } from 'vitest';
import {
  extractDomain,
  lookupTracker,
  aggregateTrackers,
  getBadgeColor,
  getBadgeCount,
} from '../lib/tracker-matcher.js';

describe('extractDomain', () => {
  it('extracts domain from a full URL', () => {
    expect(extractDomain('https://www.google-analytics.com/analytics.js'))
      .toBe('www.google-analytics.com');
  });

  it('extracts domain from URL with path', () => {
    expect(extractDomain('https://connect.facebook.net/en_US/fbevents.js'))
      .toBe('connect.facebook.net');
  });

  it('returns null for invalid URLs', () => {
    expect(extractDomain('not-a-url')).toBe(null);
  });

  it('handles URLs with ports', () => {
    expect(extractDomain('https://example.com:8080/path'))
      .toBe('example.com');
  });
});

describe('lookupTracker', () => {
  const trackers = {
    'connect.facebook.net': {
      company: 'Meta',
      product: 'Facebook Pixel',
      category: 'advertising',
      dataTypes: ['browsing history', 'device info'],
    },
    'www.google-analytics.com': {
      company: 'Google',
      product: 'Google Analytics',
      category: 'analytics',
      dataTypes: ['browsing history', 'location'],
    },
  };

  it('returns tracker info for a known domain', () => {
    const result = lookupTracker('connect.facebook.net', trackers);
    expect(result).toEqual({
      domain: 'connect.facebook.net',
      company: 'Meta',
      product: 'Facebook Pixel',
      category: 'advertising',
      dataTypes: ['browsing history', 'device info'],
    });
  });

  it('returns null for an unknown domain', () => {
    expect(lookupTracker('example.com', trackers)).toBe(null);
  });
});

describe('aggregateTrackers', () => {
  it('deduplicates trackers by company+product', () => {
    const matches = [
      { domain: 'a.facebook.net', company: 'Meta', product: 'Facebook Pixel', category: 'advertising', dataTypes: ['browsing history'] },
      { domain: 'b.facebook.net', company: 'Meta', product: 'Facebook Pixel', category: 'advertising', dataTypes: ['browsing history'] },
      { domain: 'analytics.google.com', company: 'Google', product: 'Google Analytics', category: 'analytics', dataTypes: ['location'] },
    ];
    const result = aggregateTrackers(matches);
    expect(result).toHaveLength(2);
    expect(result.map(t => t.company)).toContain('Meta');
    expect(result.map(t => t.company)).toContain('Google');
  });

  it('merges dataTypes when deduplicating', () => {
    const matches = [
      { domain: 'a.com', company: 'Meta', product: 'Pixel', category: 'advertising', dataTypes: ['browsing history'] },
      { domain: 'b.com', company: 'Meta', product: 'Pixel', category: 'advertising', dataTypes: ['browsing history', 'location'] },
    ];
    const result = aggregateTrackers(matches);
    expect(result[0].dataTypes).toContain('browsing history');
    expect(result[0].dataTypes).toContain('location');
    expect(result[0].dataTypes).toHaveLength(2);
  });

  it('collects all matched domains into a domains array', () => {
    const matches = [
      { domain: 'a.facebook.net', company: 'Meta', product: 'Pixel', category: 'advertising', dataTypes: ['browsing history'] },
      { domain: 'b.facebook.net', company: 'Meta', product: 'Pixel', category: 'advertising', dataTypes: ['browsing history'] },
      { domain: 'a.facebook.net', company: 'Meta', product: 'Pixel', category: 'advertising', dataTypes: ['device info'] },
    ];
    const result = aggregateTrackers(matches);
    expect(result).toHaveLength(1);
    expect(result[0].domains).toEqual(['a.facebook.net', 'b.facebook.net']);
  });

  it('returns empty array for no matches', () => {
    expect(aggregateTrackers([])).toEqual([]);
  });
});

describe('getBadgeColor', () => {
  it('returns blue for 0-3 trackers', () => {
    expect(getBadgeColor(0)).toBe('#2196F3');
    expect(getBadgeColor(2)).toBe('#2196F3');
    expect(getBadgeColor(3)).toBe('#2196F3');
  });

  it('returns green for 4-8 trackers', () => {
    expect(getBadgeColor(4)).toBe('#4CAF50');
    expect(getBadgeColor(6)).toBe('#4CAF50');
    expect(getBadgeColor(8)).toBe('#4CAF50');
  });

  it('returns yellow for 9-15 trackers', () => {
    expect(getBadgeColor(9)).toBe('#FF9800');
    expect(getBadgeColor(12)).toBe('#FF9800');
    expect(getBadgeColor(15)).toBe('#FF9800');
  });

  it('returns red for 16+ trackers', () => {
    expect(getBadgeColor(16)).toBe('#F44336');
    expect(getBadgeColor(50)).toBe('#F44336');
  });
});

describe('getBadgeCount', () => {
  it('returns count as string', () => {
    expect(getBadgeCount(5)).toBe('5');
  });

  it('returns empty string for 0', () => {
    expect(getBadgeCount(0)).toBe('');
  });
});
