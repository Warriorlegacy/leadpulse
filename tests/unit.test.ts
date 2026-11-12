import { describe, expect, it } from 'vitest';
import {
  parseCsv, csvCell, toCsv, similarity, hashPassword, verifyPassword,
  normalizeEmail, normalizePhone, validEmail, validPhone, elapsedMinutes,
  hmacHex, safeEqual, zonedToUtc, dateInTz,
} from '../server/util.js';

describe('CSV parsing and injection defence', () => {
  it('handles quoted fields, embedded newlines and escaped quotes', () => {
    const { rows, errors } = parseCsv('name,notes\r\n"Doe, Jane","said ""hello""\nand left"\r\n');
    expect(errors).toEqual([]);
    expect(rows[0]).toEqual(['name', 'notes']);
    expect(rows[1]).toEqual(['Doe, Jane', 'said "hello"\nand left']);
  });

  it('flags unterminated quotes and ragged rows', () => {
    const a = parseCsv('name,email\n"broken,field\n');
    expect(a.errors.some((e) => /unterminated/i.test(e))).toBe(true);
    const b = parseCsv('name,email,phone\nA,a@example.org\n');
    expect(b.errors.some((e) => /Row 2 has 2 columns/.test(e))).toBe(true);
  });

  it('rejects oversized files', () => {
    const result = parseCsv('name\n' + 'x\n'.repeat(100000), { maxBytes: 1024 });
    expect(result.truncated).toBe(true);
    expect(result.rows).toEqual([]);
  });

  it('neutralises formula payloads on export', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('+cmd')).toBe("'+cmd");
    expect(csvCell('normal value')).toBe('normal value');
    expect(csvCell('a,b"c')).toBe('"a,b""c"');
    const csv = toCsv(['name'], [['=HYPERLINK("x")']]);
    expect(csv).toContain("\"'=HYPERLINK");
    expect(csv).not.toMatch(/(^|,|\r\n)=HYPERLINK/);
  });
});

describe('PII normalisation and validation', () => {
  it('normalises email and phone without assuming a country format', () => {
    expect(normalizeEmail('  Jane.Doe@Example.COM ')).toBe('jane.doe@example.com');
    expect(normalizePhone('+1 (555) 010-1234')).toBe('15550101234');
    expect(validEmail('jane@example.org')).toBe(true);
    expect(validEmail('not-an-email')).toBe(false);
    expect(validPhone('+44 20 7946 0958')).toBe(true);
    expect(validPhone('123')).toBe(false);
  });

  it('fuzzy-matches similar names but not unrelated ones', () => {
    expect(similarity('Rohan Gupta', 'Rohan Gupta')).toBe(1);
    expect(similarity('Rohan Gupta', 'Rohan Guppta')).toBeGreaterThan(0.7);
    expect(similarity('Rohan Gupta', 'Acme Plumbing')).toBeLessThan(0.3);
  });
});

describe('password hashing', () => {
  it('uses a salted scrypt hash and verifies correctly', () => {
    const hash = hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^scrypt\$/);
    expect(hash).not.toContain('correct horse');
    expect(verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(verifyPassword('wrong password', hash)).toBe(false);
    expect(verifyPassword('x', 'not-a-hash')).toBe(false);
  });

  it('produces different hashes for the same password', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'));
  });
});

describe('HMAC helpers', () => {
  it('is deterministic and comparison is length-safe', () => {
    const a = hmacHex('secret', 'timestamp.body');
    expect(a).toBe(hmacHex('secret', 'timestamp.body'));
    expect(a).not.toBe(hmacHex('other', 'timestamp.body'));
    expect(safeEqual(a, a)).toBe(true);
    expect(safeEqual(a, a.slice(0, -1))).toBe(false);
  });
});

describe('SLA clock and timezone handling', () => {
  const org = {
    timezone: 'Asia/Kolkata', working_days: '1,2,3,4,5',
    working_hours_start: '09:00', working_hours_end: '18:00',
  };

  it('computes wall-clock elapsed minutes by default', () => {
    expect(elapsedMinutes('2026-11-12T04:00:00.000Z', '2026-11-12T04:37:00.000Z', org)).toBe(37);
    expect(elapsedMinutes('2026-11-12T04:00:00.000Z', '2026-11-12T03:00:00.000Z', org)).toBe(0);
  });

  it('counts only configured business hours when enabled', () => {
    // 2026-11-12 is a Thursday. 03:30Z = 09:00 IST, 12:30Z = 18:00 IST.
    const start = '2026-11-12T03:30:00.000Z';
    const end = '2026-11-12T12:30:00.000Z';
    expect(elapsedMinutes(start, end, org, true)).toBe(540);
    // Starting before business hours clips the outside portion.
    expect(elapsedMinutes('2026-11-12T00:00:00.000Z', '2026-11-12T04:30:00.000Z', org, true)).toBe(60);
  });

  it('excludes non-working days', () => {
    // Saturday 2026-11-14, 04:00Z–05:00Z falls inside 09:30–10:30 IST.
    expect(elapsedMinutes('2026-11-14T04:00:00.000Z', '2026-11-14T05:00:00.000Z', org, true)).toBe(0);
    expect(elapsedMinutes('2026-11-14T04:00:00.000Z', '2026-11-14T05:00:00.000Z', org, false)).toBe(60);
  });

  it('converts local wall time to UTC using the workspace timezone', () => {
    expect(new Date(zonedToUtc('2026-11-12', '09:00', 'Asia/Kolkata')).toISOString()).toBe('2026-11-12T03:30:00.000Z');
    expect(dateInTz(Date.parse('2026-11-12T20:00:00.000Z'), 'Asia/Kolkata')).toBe('2026-11-13');
  });
});
