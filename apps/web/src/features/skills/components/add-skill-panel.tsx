'use client';

import { useState } from 'react';
import {
  SKILL_CONTENT_MAX_LENGTH,
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_NAME_MAX_LENGTH,
  SKILL_UPLOAD_MAX_BYTES,
} from '@aiteam/contracts';
import { useApiQuery } from '../../../shared/api/use-api-query';
import { controlStyles, InlinePanel, StatusNotice } from '../../../shared/ui/controls';
import { useActionOutcome } from '../../../shared/ui/use-action-outcome';
import {
  addTemplateSkill,
  createWrittenSkill,
  importGithubSkill,
  loadSkillTemplates,
  uploadSkillFile,
} from '../skills-api';
import styles from './skills.module.css';

type SourceTab = 'write' | 'template' | 'file' | 'github';

const TABS: ReadonlyArray<{ id: SourceTab; label: string }> = [
  { id: 'write', label: 'Tự viết' },
  { id: 'template', label: 'Từ mẫu' },
  { id: 'file', label: 'Tải file .md / .zip' },
  { id: 'github', label: 'Link GitHub' },
];

/** "Thêm skill": four ways to bring a skill into the department. */
export function AddSkillPanel({
  departmentId,
  onAdded,
}: {
  departmentId: string;
  onAdded: () => void;
}) {
  const [tab, setTab] = useState<SourceTab>('write');
  const { outcome, isPending, performAction } = useActionOutcome();
  const add = (startAction: () => Promise<{ name: string }>) =>
    void performAction(startAction, (skill) => `Đã thêm skill "${skill.name}".`).then((skill) => {
      if (skill !== undefined) onAdded();
    });

  return (
    <InlinePanel title="Thêm skill" emphasised>
      <div className={controlStyles.buttonRow} role="group" aria-label="Nguồn skill">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={controlStyles.pillButton}
            aria-pressed={tab === entry.id}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {tab === 'write' && (
        <WrittenSkillForm
          disabled={isPending}
          onSubmit={(request) => add(() => createWrittenSkill(departmentId, request))}
        />
      )}
      {tab === 'template' && (
        <TemplatePicker
          disabled={isPending}
          onPick={(templateId) => add(() => addTemplateSkill(departmentId, templateId))}
        />
      )}
      {tab === 'file' && (
        <label className={controlStyles.field}>
          SKILL.md (hoặc file .md bất kỳ), hoặc .zip chứa một thư mục skill (tối đa{' '}
          {Math.round(SKILL_UPLOAD_MAX_BYTES / 1024 / 1024)} MB)
          <input
            type="file"
            accept=".md,.zip"
            disabled={isPending}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file !== undefined) add(() => uploadSkillFile(departmentId, file));
            }}
          />
        </label>
      )}
      {tab === 'github' && (
        <GithubImportForm
          disabled={isPending}
          onSubmit={(url) => add(() => importGithubSkill(departmentId, url))}
        />
      )}
      <StatusNotice outcome={outcome} />
    </InlinePanel>
  );
}

function WrittenSkillForm({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (request: { name: string; description: string; content: string }) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ name, description, content });
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
        Khi nào dùng (agent đọc dòng này để quyết định mở skill)
        <input
          className={controlStyles.fieldInput}
          value={description}
          maxLength={SKILL_DESCRIPTION_MAX_LENGTH}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <label className={controlStyles.field}>
        Hướng dẫn (Markdown)
        <textarea
          className={styles.contentInput}
          value={content}
          maxLength={SKILL_CONTENT_MAX_LENGTH}
          rows={10}
          onChange={(event) => setContent(event.target.value)}
        />
      </label>
      <button type="submit" className={controlStyles.primaryButton} disabled={disabled}>
        Tạo skill
      </button>
    </form>
  );
}

function TemplatePicker({
  disabled,
  onPick,
}: {
  disabled: boolean;
  onPick: (templateId: string) => void;
}) {
  const templates = useApiQuery('skill-templates', loadSkillTemplates);
  if (templates.status === 'loading')
    return <p className={styles.mutedText}>Đang tải skill mẫu…</p>;
  if (templates.status === 'error')
    return <StatusNotice outcome={{ tone: 'error', error: templates.error }} />;
  return (
    <ul className={styles.skillList}>
      {templates.result.map((template) => (
        <li key={template.id} className={styles.skillCard}>
          <span className={styles.skillName}>{template.name}</span>
          <p className={styles.skillDescription}>{template.description}</p>
          <button
            type="button"
            className={controlStyles.secondaryButton}
            disabled={disabled}
            onClick={() => onPick(template.id)}
          >
            Thêm vào phòng
          </button>
        </li>
      ))}
    </ul>
  );
}

function GithubImportForm({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (url: string) => void;
}) {
  const [url, setUrl] = useState('');
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(url);
      }}
    >
      <label className={controlStyles.field}>
        Link thư mục skill hoặc file .md trên GitHub (repo công khai)
        <input
          className={controlStyles.fieldInput}
          value={url}
          placeholder="https://github.com/anthropics/skills/tree/main/skills/pdf"
          required
          onChange={(event) => setUrl(event.target.value)}
        />
      </label>
      <p className={styles.mutedText}>
        Skill có thể kèm script mà agent sẽ chạy với quyền của bạn: chỉ thêm skill từ nguồn bạn tin.
      </p>
      <button type="submit" className={controlStyles.primaryButton} disabled={disabled}>
        {disabled ? 'Đang tải…' : 'Tải về'}
      </button>
    </form>
  );
}
