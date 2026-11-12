'use client';

import { useState } from 'react';
import type { LocalEngine } from '@aiteam/contracts';
import { controlStyles } from '../../../shared/ui/controls';
import { useLocalEngineModels } from '../use-local-engine-models';
import { ModelListNotes } from './model-list-notes';
import styles from './settings.module.css';

const ENGINE_DEFAULT_OPTION = '';
const CUSTOM_MODEL_OPTION = '__custom__';

const MODEL_NAME_PLACEHOLDER: Record<LocalEngine, string> = {
  claude_code: 'vd. claude-sonnet-5-5',
  codex: 'vd. gpt-5.6-terra',
  antigravity: 'vd. gemini-3.8-flash-high',
};

interface LocalEngineModelFieldProps {
  engine: LocalEngine;
  /** '' = the engine's default model (Cài đặt API). */
  value: string;
  onChange: (model: string) => void;
}

/**
 * Model of one agent on Claude Code / Codex / Antigravity: a quick pick, the engine default or any
 * name. The picks are the installed CLI's own list (read again each time the form opens, or on ↻).
 */
export function LocalEngineModelField({ engine, value, onChange }: LocalEngineModelFieldProps) {
  const models = useLocalEngineModels(engine);
  const { choices } = models;
  // null until the owner picks an option: then derived from the saved value.
  const [customPicked, setCustomPicked] = useState<boolean | null>(null);
  const isKnownChoice = choices.some((choice) => choice.model === value);
  const typingCustomModel = customPicked ?? (value !== '' && !isKnownChoice);

  const selectedOption = typingCustomModel
    ? CUSTOM_MODEL_OPTION
    : isKnownChoice
      ? value
      : ENGINE_DEFAULT_OPTION;

  const pickOption = (option: string) => {
    const pickedCustom = option === CUSTOM_MODEL_OPTION;
    setCustomPicked(pickedCustom);
    onChange(pickedCustom ? '' : option);
  };

  return (
    <>
      <label className={controlStyles.field}>
        Model
        <select
          value={selectedOption}
          onChange={(event) => pickOption(event.target.value)}
          className={controlStyles.fieldInput}
        >
          <option value={ENGINE_DEFAULT_OPTION}>
            Theo model mặc định của engine (Cài đặt API)
          </option>
          {choices.map((choice) => (
            <option key={choice.model} value={choice.model}>
              {choice.note === '' ? choice.label : `${choice.label}: ${choice.note}`}
            </option>
          ))}
          <option value={CUSTOM_MODEL_OPTION}>Model khác (tự nhập tên)…</option>
        </select>
      </label>
      <ModelListNotes engine={engine} models={models} />
      {typingCustomModel && (
        <label className={controlStyles.field}>
          Tên model
          <input
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={MODEL_NAME_PLACEHOLDER[engine]}
            className={`${controlStyles.fieldInput} ${styles.monoInput}`}
          />
        </label>
      )}
    </>
  );
}
