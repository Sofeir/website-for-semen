import type { Role, Stage } from '@sd/shared';

/** Кого предлагать ответственным на этапе. Этапы в справочнике можно переименовать — ориентируемся на код. */
export const STAGE_ROLES: Record<string, Role[]> = {
  intake: ['manager'],
  diagnostics: ['diagnostician', 'master'],
  approval: ['manager'],
  repair: ['master', 'diagnostician'],
  ready: ['manager'],
  issued: ['manager'],
};

export const preferRolesFor = (stage: Pick<Stage, 'code'> | null | undefined): Role[] =>
  (stage && STAGE_ROLES[stage.code]) || ['manager', 'diagnostician', 'master'];

/** Срок по умолчанию в рабочих днях из SLA этапа. */
export const dueDaysFor = (stage: Pick<Stage, 'slaHours'> | null | undefined) =>
  stage ? Math.max(0, Math.round(stage.slaHours / 24)) : 1;

export const stageNumber = (stages: Stage[], id: number) => String(stages.findIndex((s) => s.id === id) + 1).padStart(2, '0');
