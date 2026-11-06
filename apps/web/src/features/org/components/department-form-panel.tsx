'use client';

import { type FormEvent, useState } from 'react';
import { createDepartmentRequestSchema, type Department } from '@aiteam/contracts';
import { controlStyles, InlinePanel, StatusNotice } from '../../../shared/ui/controls';
import { useActionOutcome } from '../../../shared/ui/use-action-outcome';
import { createDepartment, updateDepartment } from '../../organization/organization-api';
import { DEPARTMENT_COLOR_CHOICES } from '../../organization/organization-labels';
import { collectFieldErrors } from '../org-tree-navigation';
import styles from './org-screen.module.css';

interface DepartmentFormPanelProps {
  /** Department being edited; undefined to create a new one. */
  editedDepartment?: Department;
  onSaved: (department: Department) => void;
  onCancel: () => void;
}

export function DepartmentFormPanel({
  editedDepartment,
  onSaved,
  onCancel,
}: DepartmentFormPanelProps) {
  const [name, setName] = useState(editedDepartment?.name ?? '');
  const [color, setColor] = useState<string>(
    editedDepartment?.color ?? DEPARTMENT_COLOR_CHOICES[0],
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const { outcome, isPending, performAction } = useActionOutcome();

  const submitDepartment = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = createDepartmentRequestSchema.safeParse({ name, color });
    if (!parsed.success) {
      setFieldErrors(collectFieldErrors(parsed.error));
      return;
    }
    setFieldErrors({});
    const saved = await performAction(
      () =>
        editedDepartment === undefined
          ? createDepartment(parsed.data)
          : updateDepartment(editedDepartment.id, parsed.data),
      () => null,
    );
    if (saved !== undefined) {
      onSaved(saved);
    }
  };

  return (
    <InlinePanel
      title={editedDepartment === undefined ? 'Thêm phòng ban' : `Sửa ${editedDepartment.name}`}
      emphasised
    >
      <form className={styles.form} onSubmit={(event) => void submitDepartment(event)} noValidate>
        <label className={controlStyles.field}>
          Tên phòng
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Phòng Dev"
            maxLength={80}
            className={
              fieldErrors.name === undefined
                ? controlStyles.fieldInput
                : `${controlStyles.fieldInput} ${controlStyles.fieldInputInvalid}`
            }
            aria-invalid={fieldErrors.name !== undefined}
            aria-describedby={fieldErrors.name === undefined ? undefined : 'department-name-error'}
          />
        </label>
        {fieldErrors.name !== undefined && (
          <span id="department-name-error" role="alert" className={controlStyles.fieldError}>
            {fieldErrors.name}
          </span>
        )}
        <fieldset className={styles.colorFieldset}>
          <legend className={styles.colorLegend}>Màu nhận diện</legend>
          <div className={styles.colorChoices}>
            {DEPARTMENT_COLOR_CHOICES.map((choice) => (
              <button
                key={choice}
                type="button"
                className={styles.colorSwatch}
                style={{ background: choice }}
                aria-pressed={color === choice}
                aria-label={`Màu ${choice}`}
                onClick={() => setColor(choice)}
              />
            ))}
          </div>
        </fieldset>
        <StatusNotice outcome={outcome} />
        <div className={controlStyles.buttonRow}>
          <button type="submit" className={controlStyles.primaryButton} disabled={isPending}>
            {editedDepartment === undefined ? 'Tạo phòng' : 'Lưu thay đổi'}
          </button>
          <button type="button" className={controlStyles.secondaryButton} onClick={onCancel}>
            Huỷ
          </button>
        </div>
      </form>
    </InlinePanel>
  );
}
