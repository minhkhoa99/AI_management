'use client';

import { useState } from 'react';
import {
  SKILL_CONTENT_MAX_LENGTH,
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_NAME_MAX_LENGTH,
  type SkillDetail,
} from '@aiteam/contracts';
import { useApiQuery } from '../../../shared/api/use-api-query';
import { controlStyles, InlinePanel, StatusNotice } from '../../../shared/ui/controls';
import { useActionOutcome } from '../../../shared/ui/use-action-outcome';
import { loadSkillDetail, updateSkill } from '../skills-api';
import styles from './skills.module.css';

/** "Xem / sửa": name, description and SKILL.md instructions; other files are listed. */
export function SkillEditorPanel({ skillId, onClose }: { skillId: string; onClose: () => void }) {
  const detail = useApiQuery(`skill:${skillId}`, () => loadSkillDetail(skillId));
  if (detail.status === 'loading') return <p className={styles.mutedText}>Đang tải skill…</p>;
  if (detail.status === 'error')
    return <StatusNotice outcome={{ tone: 'error', error: detail.error }} />;
  return <SkillEditorForm skill={detail.result} onClose={onClose} />;
}

function SkillEditorForm({ skill, onClose }: { skill: SkillDetail; onClose: () => void }) {
  const [name, setName] = useState(skill.name);
  const [description, setDescription] = useState(skill.description);
  const [content, setContent] = useState(skill.content);
  const { outcome, isPending, performAction } = useActionOutcome();

  return (
    <InlinePanel title={`Skill “${skill.name}”`} emphasised>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void performAction(
            () => updateSkill(skill.id, { name, description, content }),
            () => 'Đã lưu skill.',
          );
        }}
      >
        <label className={controlStyles.field}>
          Tên skill
          <input
            className={controlStyles.fieldInput}
            value={name}
            maxLength={SKILL_NAME_MAX_LENGTH}
            required
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className={controlStyles.field}>
          Khi nào dùng
          <input
            className={controlStyles.fieldInput}
            value={description}
            maxLength={SKILL_DESCRIPTION_MAX_LENGTH}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label className={controlStyles.field}>
          Hướng dẫn trong SKILL.md
          <textarea
            className={styles.contentInput}
            value={content}
            maxLength={SKILL_CONTENT_MAX_LENGTH}
            rows={14}
            onChange={(event) => setContent(event.target.value)}
          />
        </label>
        {skill.files.length > 1 && (
          <div className={controlStyles.field}>
            File đi kèm (giữ nguyên khi sửa)
            <ul className={styles.fileList}>
              {skill.files
                .filter((file) => file.path !== 'SKILL.md')
                .map((file) => (
                  <li key={file.path}>{file.path}</li>
                ))}
            </ul>
          </div>
        )}
        <StatusNotice outcome={outcome} />
        <div className={controlStyles.buttonRow}>
          <button type="submit" className={controlStyles.primaryButton} disabled={isPending}>
            Lưu
          </button>
          <button type="button" className={controlStyles.secondaryButton} onClick={onClose}>
            Đóng
          </button>
        </div>
      </form>
    </InlinePanel>
  );
}
