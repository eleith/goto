import { defineWorkflowSpec, type Workflow } from 'openworkflow';

export interface RetainVisitsInput {
	scheduled?: boolean;
}

export const retentionSchedule = {
	id: 'goto:retain-visits',
	cron: '0 * * * *',
	timezone: 'UTC',
	input: { scheduled: true }
};

export const retainVisits: Workflow<RetainVisitsInput, 'completed', RetainVisitsInput>['spec'] =
	defineWorkflowSpec<RetainVisitsInput, 'completed'>({
		name: 'retain-visits',
		schedules: [retentionSchedule]
	});
