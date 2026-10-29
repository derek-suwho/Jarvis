import { describe, expect, it } from 'vitest';
import { AUTO_MODEL_ID, DEFAULT_SETTINGS, groupModels, modelLabel, setAvailableGroups } from '../src/lib/models';

describe('modelLabel', () => {
  it('shows reasoning and fast flag', () => {
    expect(modelLabel(DEFAULT_SETTINGS)).toEqual({ name: 'GPT-5.6 Sol', detail: 'Medium' });
    expect(modelLabel({ ...DEFAULT_SETTINGS, fast: true }).detail).toBe('Medium Fast');
  });

  it('omits reasoning for Auto', () => {
    expect(modelLabel({ ...DEFAULT_SETTINGS, modelId: AUTO_MODEL_ID })).toEqual({ name: 'Auto', detail: '' });
  });
});

describe('groupModels', () => {
  it('filters by name and drops empty groups', () => {
    const groups = groupModels('claude');
    expect(groups.map((g) => g.group)).toEqual(['Anthropic']);
    expect(groups[0].models.length).toBeGreaterThan(0);
    expect(groupModels('zzz')).toEqual([]);
  });

  it('lists only added providers', () => {
    setAvailableGroups(['Anthropic', 'xAI']);
    expect(groupModels('').map((g) => g.group)).toEqual(['Anthropic', 'xAI']);
    setAvailableGroups([]);
    expect(groupModels('')).toEqual([]);
    setAvailableGroups(null);
    expect(groupModels('').length).toBe(4);
  });
});
