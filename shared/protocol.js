export const CLASSIFICATIONS = Object.freeze({
  defected: { code: 1, label: 'Defected', color: 'red', description: 'Reject · defect detected' },
  good: { code: 2, label: 'Good', color: 'green', description: 'Accept · no defect detected' },
  repairable: { code: 3, label: 'Repairable', color: 'yellow', description: 'Review · repair required' }
});
const aliases = { '1': 'defected', '2': 'good', '3': 'repairable', defected: 'defected', defective: 'defected', good: 'good', 'non-defected': 'good', 'non_defected': 'good', repairable: 'repairable' };
export function normalizeStatus(value) {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('status must be 1, 2, 3, defected, good, or repairable.');
  const result = aliases[String(value).trim().toLowerCase()];
  if (!result) throw new Error(`Unrecognized status: ${String(value).slice(0,50)}. Use 1 = defected, 2 = good, 3 = repairable.`);
  return result;
}
export function parseInspections(input) {
  if (input && !Array.isArray(input) && Array.isArray(input.cloths) && input.schema_version !== undefined && input.schema_version !== 1) throw new Error('Batch schema_version must be 1.');
  const items = Array.isArray(input) ? input : input && Array.isArray(input.cloths) ? input.cloths : [input];
  if (!items.length || items.length > 100) throw new Error('Upload between 1 and 100 cloth results per file.');
  return items.map((item, index) => {
    const prefix = `Result ${index + 1}: `;
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(prefix + 'expected a JSON object.');
    if (item.schema_version !== undefined && item.schema_version !== 1) throw new Error(prefix + 'schema_version must be 1.');
    if (typeof item.cloth_id !== 'string' || !item.cloth_id.trim() || item.cloth_id.length > 80 || /[\x00-\x1f]/.test(item.cloth_id)) throw new Error(prefix + 'cloth_id must be a nonempty string of up to 80 characters.');
    let status;
    try { status = normalizeStatus(item.status); } catch (e) { throw new Error(prefix + e.message); }
    if (item.confidence !== undefined && (typeof item.confidence !== 'number' || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1)) throw new Error(prefix + 'confidence must be a number from 0 to 1.');
    if (item.captured_at !== undefined && (typeof item.captured_at !== 'string' || !Number.isFinite(Date.parse(item.captured_at)))) throw new Error(prefix + 'captured_at must be a valid date/time string.');
    if (item.defects !== undefined && (!Array.isArray(item.defects) || item.defects.length > 100)) throw new Error(prefix + 'defects must be an array of up to 100 items.');
    return { ...item, schema_version: 1, cloth_id: item.cloth_id.trim(), status, status_code: CLASSIFICATIONS[status].code };
  });
}
export function parseJSON(text) {
  if (new TextEncoder().encode(text).length > 262144) throw new Error('JSON file must be 256 KB or smaller.');
  let input;
  try { input = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error('This file is not valid JSON. Check quotes, commas, and brackets.'); }
  return parseInspections(input);
}
