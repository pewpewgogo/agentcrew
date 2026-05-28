import type { Pool } from 'pg';
import { AppError } from '../../shared/errors.js';
import type { ContextEntry, TargetType, AuthorKind } from '../../shared/types.js';

const row = (r: any): ContextEntry => ({
  id: Number(r.id), projectId: r.project_id,
  targetType: r.target_type as TargetType, targetId: r.target_id,
  authorUserId: r.author_user_id, authorKind: r.author_kind as AuthorKind,
  note: r.note, createdAt: r.created_at,
});

export class ContextService {
  constructor(private readonly pool: Pool) {}

  private async resolveProjectId(targetType: TargetType, targetId: string): Promise<string> {
    const tableMap: Record<TargetType, string> = {
      project: 'projects', milestone: 'milestones', task: 'tasks',
    };
    const col = targetType === 'project' ? 'id' : 'project_id';
    const idCol = targetType === 'project' ? 'id' : 'id';
    const r = await this.pool.query<{ project_id: string }>(
      `select ${col} as project_id from ${tableMap[targetType]} where ${idCol} = $1`,
      [targetId],
    );
    if (!r.rows[0]) throw new AppError('not_found', `${targetType} not found`, 404);
    return r.rows[0].project_id;
  }

  async append(input: {
    authorUserId: string; authorKind: AuthorKind;
    targetType: TargetType; targetId: string; note: string;
  }): Promise<ContextEntry> {
    const projectId = await this.resolveProjectId(input.targetType, input.targetId);
    const r = await this.pool.query(
      `insert into context_log (project_id, target_type, target_id, author_user_id, author_kind, note)
       values ($1,$2,$3,$4,$5,$6)
       returning id, project_id, target_type, target_id, author_user_id, author_kind, note, created_at`,
      [projectId, input.targetType, input.targetId, input.authorUserId, input.authorKind, input.note],
    );
    return row(r.rows[0]);
  }

  async query(filter: {
    project?: string; targetType?: TargetType; targetId?: string;
    since?: string; limit: number;
  }): Promise<ContextEntry[]> {
    const conds: string[] = []; const vals: unknown[] = [];
    if (filter.project)    { vals.push(filter.project);    conds.push(`project_id = $${vals.length}`); }
    if (filter.targetType) { vals.push(filter.targetType); conds.push(`target_type = $${vals.length}`); }
    if (filter.targetId)   { vals.push(filter.targetId);   conds.push(`target_id = $${vals.length}`); }
    if (filter.since)      { vals.push(filter.since);      conds.push(`created_at >= $${vals.length}`); }
    vals.push(filter.limit);
    const where = conds.length ? `where ${conds.join(' and ')}` : '';
    const r = await this.pool.query(
      `select id, project_id, target_type, target_id, author_user_id, author_kind, note, created_at
       from context_log ${where} order by created_at desc limit $${vals.length}`,
      vals,
    );
    return r.rows.map(row);
  }
}
