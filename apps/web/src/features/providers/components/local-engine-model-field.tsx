'use client';

import { useId, useState } from 'react';
import type { LocalEngine } from '@aiteam/contracts';
import { controlStyles } from '../../../shared/ui/controls';
import { LOCAL_ENGINE_MODEL_CHOICES } from '../local-engine-models';
import styles from './settings.module.css';

const ENGINE_DEFAULT_OPTION = '';
const CUSTOM_MODEL_OPTION = '__custom__';

interface LocalEngineModelFieldProps {
  engine: LocalEngine;
  /** '' = the engine's default model (Cài đặt API). */
  value: string;
  onChange: (model: string) => void;
}

/** Model of one agent on Claude Code / Codex: a quick pick, the engine default or any name. */
export function LocalEngineModelField({ engine, value, onChange }: LocalEngineModelFieldProps) {
  const choices = LOCAL_ENGINE_MODEL_CHOICES[engine];
  const customInputId = useId();
  const isKnownChoice = choices.some((choice) => choice.model === value);
  const [typingCustomModel, setTypingCustomModel] = useState(value !== '' && !isKnownChoice);
  const showCustomInput = choices.length === 0 || typingCustomModel;

  const selectedOption = typingCustomModel
    ? CUSTOM_MODEL_OPTION
    : isKnownChoice
      ? value
      : ENGINE_DEFAULT_OPTION;

  const pickOption = (option: string) => {
    const customPicked = option === CUSTOM_MODEL_OPTION;
    setTypingCustomModel(customPicked);
    onChange(customPicked ? '' : option);
  };

  return (
    <>
      {choices.length > 0 && (
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
                {choice.label}: {choice.note}
              </option>
            ))}
            <option value={CUSTOM_MODEL_OPTION}>Model khác (tự nhập tên)…</option>
          </select>
        </label>
      )}
      {showCustomInput && (
        <label className={controlStyles.field} htmlFor={customInputId}>
          {choices.length === 0 ? 'Model (tuỳ chọn)' : 'Tên model'}
          <input
            id={customInputId}
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={
              choices.length === 0
                ? 'Để trống: theo model mặc định của engine (Cài đặt API)'
                : 'vd. claude-sonnet-5-5'
            }
            className={`${controlStyles.fieldInput} ${styles.monoInput}`}
          />
        </label>
      )}
    </>
  );
}
