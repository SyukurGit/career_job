import test from 'node:test';
import assert from 'node:assert/strict';
import { salaryMonthlyComparable, compareSalaryDescending } from '../../src/lib/salary.mjs';

test('IDR salary formats normalize guaranteed monthly lower bounds', () => {
  const cases = [
    ['Rp 5-8 juta/bulan', 5_000_000], ['Rp5jt–Rp8jt', 5_000_000],
    ['IDR 5.000.000 - 8.000.000 per month', 5_000_000],
    ['5,5 - 8,5 jt / bln', 5_500_000], ['5.5 million/month', 5_500_000],
    ['Rp 5.000.000,50 per bulan', 5_000_000.5], ['IDR 5,000,000.50 / month', 5_000_000.5],
    ['5000k/mo', 5_000_000], ['5000 ribu bulanan', 5_000_000],
    ['Rp 60 juta/tahun', 5_000_000], ['IDR 60000000 annually', 5_000_000],
    ['60 jt p.a.', 5_000_000], ['60jt/thn', 5_000_000],
    ['5jt/m', 5_000_000], ['60jt/y', 5_000_000], ['5 jt / month (gross)', 5_000_000],
    ['5jt sampai 8jt', 5_000_000], ['5jt s.d. 8jt', 5_000_000],
  ];
  for (const [input, expected] of cases) assert.equal(salaryMonthlyComparable(input), expected, input);
});

test('foreign currencies need explicit rates; no invented USD or ambiguous dollar conversion', () => {
  for (const input of ['USD1200/month', 'US$1200/month', 'SGD 2000', 'S$2000', 'AUD 3000', 'C$3000', 'EUR 4000', '€4000', 'GBP 5000', '£5000']) {
    assert.equal(salaryMonthlyComparable(input), null, input);
  }
  const rates = { USD: 15_000, SGD: 11_000, AUD: 10_000, CAD: 10_500, EUR: 17_000, GBP: 20_000 };
  assert.equal(salaryMonthlyComparable('USD1200/month', { rates }), 18_000_000);
  assert.equal(salaryMonthlyComparable('US$60k-90k/year', { rates }), 75_000_000);
  assert.equal(salaryMonthlyComparable('USD $1,200/month', { rates }), 18_000_000);
  assert.equal(salaryMonthlyComparable('S$2k/month', { rates }), 22_000_000);
  assert.equal(salaryMonthlyComparable('EUR 2.500,50/month', { rates }), 42_508_500);
  for (const input of ['$5000', 'JPY 500000', 'NOK 50000', 'MYR 10000', 'USD 1000 - IDR 20000000']) {
    assert.equal(salaryMonthlyComparable(input, { rates }), null, input);
  }
  for (const rate of [0, -1, '15000', NaN, Infinity]) assert.equal(salaryMonthlyComparable('USD 1000', { rates: { USD: rate } }), null);
});

test('unknown schedules, malformed amounts and non-guaranteed salary prose stay unknown', () => {
  for (const input of ['', 'Negotiable', 'up to Rp 8jt', 'Rp 5jt + 2jt bonus', '5jt for 20 hours', 'Rp 100000/hour', 'Rp 100000/h', 'Rp 500000/day', 'Rp 500000/d', 'Rp 2000000/week', 'Rp 2000000/w', '5jt/month/year', '1.23.456', '1,0000', '1,234.567,89', '0', '-5jt', '8jt-5jt']) {
    assert.equal(salaryMonthlyComparable(input), null, input);
  }
  assert.equal(salaryMonthlyComparable(null), null);
});

test('sorting compares monthly amounts and puts unknown currencies last', () => {
  const salaries = ['USD 2000', 'Rp 60 juta/year', 'Rp 7 juta/month', 'Negotiable', 'Rp 4 juta'];
  assert.deepEqual(salaries.sort(compareSalaryDescending), ['Rp 7 juta/month', 'Rp 60 juta/year', 'Rp 4 juta', 'USD 2000', 'Negotiable']);
  assert.equal(compareSalaryDescending('Unknown', 'USD 5000'), 0);
});
