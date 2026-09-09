// Verified formula transcription for (O.o)!I8:Q8 only.
// Inputs are resolved Excel cell values, NOT a replacement for BOM lookups.
// Percentages K/M are fractions (0.01 = 1%). SE stock is deliberately absent.
export function calculateExcelRow(cells) {
  for (const key of ['G','H','J','K','M','S','U','V']) {
    if (typeof cells[key] !== 'number' || !Number.isFinite(cells[key]) || cells[key] < 0)
      throw new Error(`Missing/invalid Excel input: ${key}`);
  }
  for (const key of ['S','U','V']) if (cells[key] === 0) throw new Error(`Excel division by zero: ${key}`);
  const I = cells.G * cells.H / 1000;
  const L = cells.K * I;
  const N = cells.M * I;
  const O = I + cells.J + L + N;
  const P = Math.ceil(O / cells.V) * cells.V / cells.U;
  const Q = Math.ceil(P * cells.U / cells.S);
  const result = {I,L,N,O,P,Q};
  if (Object.values(result).some(v => !Number.isFinite(v))) throw new Error('Numeric overflow');
  return result;
}
